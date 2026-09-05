"""Database operations using asyncpg.

Handles detection jobs, per-image checkpoints (imagem_job), detections,
species lookup/creation, and occurrences. Supports both the legacy
satellite workflow and the new bulk camera trap workflow.
"""

import asyncpg
from dataclasses import dataclass
from typing import Optional
from datetime import datetime, date

from .config import Settings
from .sources.base import ImageItem


@dataclass
class DetectionRecord:
    """A single detection to be saved."""
    job_id: int
    especie_id: Optional[int]
    nome_cientifico: Optional[str]
    confianca: float
    lat: float
    lon: float
    bbox_pixel: Optional[str]
    recorte_url: Optional[str]
    metodo_classificacao: str = "heuristic"
    modelo_ia: Optional[str] = None
    confianca_ia: Optional[float] = None
    image_job_id: Optional[int] = None
    status: str = "detected"


@dataclass
class ImageJobRecord:
    """Checkpoint record for a single image within a job."""
    id: int
    job_id: int
    source: str
    source_image_id: str
    status: str
    detection_count: int


class Database:
    def __init__(self, settings: Settings):
        self._settings = settings
        self._database_url = settings.database_url
        self._pool: Optional[asyncpg.Pool] = None

    async def connect(self) -> None:
        self._pool = await asyncpg.create_pool(
            dsn=self._database_url,
            min_size=2,
            max_size=self._settings.db_pool_max,
            command_timeout=60,
        )

    async def close(self) -> None:
        if self._pool:
            await self._pool.close()

    # ------------------------------------------------------------------
    # Jobs (deteccao_job)
    # ------------------------------------------------------------------

    async def create_job(
        self,
        bbox: Optional[str] = None,
        data_captura: Optional[date] = None,
        satelite: Optional[str] = None,
        instrumento: Optional[str] = None,
        produto: Optional[str] = None,
        source: str = "satellite",
        data_dir: Optional[str] = None,
        project_id: Optional[str] = None,
        p_limit: Optional[int] = None,
    ) -> int:
        """Create a new detection job.

        Fields are optional to support both satellite and camera trap
        sources. Satellite jobs pass bbox/satelite/instrumento/produto;
        camera trap jobs pass source='camera_trap' and data_dir.
        """
        async with self._pool.acquire() as conn:
            row = await conn.fetchrow(
                """INSERT INTO deteccao_job
                     (bbox, data_captura, satelite, instrumento, produto, status, source, data_dir, project_id, p_limit)
                   VALUES ($1, $2, $3::varchar, $4::varchar, $5::varchar, 'pendente', $6::varchar, $7, $8::varchar, $9)
                   RETURNING id""",
                bbox,
                data_captura or date.today(),
                satelite,
                instrumento,
                produto,
                source,
                data_dir,
                project_id,
                p_limit,
            )
            return row["id"]

    async def update_job_status(
        self,
        job_id: int,
        status: str,
        total_deteccoes: int = 0,
        erro: Optional[str] = None,
        scene_id: Optional[str] = None,
        imagem_url: Optional[str] = None,
    ) -> None:
        async with self._pool.acquire() as conn:
            await conn.execute(
                """UPDATE deteccao_job
                   SET status = $2::varchar,
                       total_deteccoes = $3,
                       erro = $4,
                       scene_id = COALESCE($5, scene_id),
                       imagem_url = COALESCE($6, imagem_url),
                       concluido_em = CASE WHEN $2::varchar IN ('concluido', 'erro') THEN now() ELSE concluido_em END
                   WHERE id = $1""",
                job_id,
                status,
                total_deteccoes,
                erro,
                scene_id,
                imagem_url,
            )

    async def increment_job_progress(self, job_id: int) -> None:
        """Increment the imagens_processadas counter for a job."""
        async with self._pool.acquire() as conn:
            await conn.execute(
                "UPDATE deteccao_job SET imagens_processadas = imagens_processadas + 1 WHERE id = $1",
                job_id,
            )

    async def get_next_pending_job(self) -> Optional[dict]:
        """Atomically pick the next pending job for the worker loop.

        Uses FOR UPDATE SKIP LOCKED so multiple workers (if any) don't
        pick the same job.
        """
        async with self._pool.acquire() as conn:
            row = await conn.fetchrow(
                """UPDATE deteccao_job
                   SET status = 'processando'
                   WHERE id = (
                       SELECT id FROM deteccao_job
                       WHERE status = 'pendente'
                       ORDER BY criado_em
                       FOR UPDATE SKIP LOCKED
                       LIMIT 1
                   )
                   RETURNING *"""
            )
            return dict(row) if row else None

    async def get_job(self, job_id: int) -> Optional[dict]:
        async with self._pool.acquire() as conn:
            row = await conn.fetchrow("SELECT * FROM deteccao_job WHERE id = $1", job_id)
            return dict(row) if row else None

    async def list_jobs(self, limit: int = 20, offset: int = 0) -> list[dict]:
        async with self._pool.acquire() as conn:
            rows = await conn.fetch(
                """SELECT * FROM deteccao_job
                   ORDER BY criado_em DESC
                   LIMIT $1 OFFSET $2""",
                limit,
                offset,
            )
            return [dict(r) for r in rows]

    async def list_protected_areas(self) -> list[dict]:
        """Return id, name and bbox of all protected areas (satellite batch)."""
        async with self._pool.acquire() as conn:
            rows = await conn.fetch(
                """SELECT id,
                          nome,
                          ST_XMin(geom) || ',' || ST_YMin(geom) || ',' ||
                          ST_XMax(geom) || ',' || ST_YMax(geom) AS bbox
                   FROM area_protegida
                   ORDER BY id"""
            )
            return [dict(r) for r in rows]

    # ------------------------------------------------------------------
    # Image checkpoint (imagem_job)
    # ------------------------------------------------------------------

    async def upsert_image_job(self, job_id: int, item: ImageItem) -> ImageJobRecord:
        """Insert or fetch an image checkpoint record.

        If the image already exists (same source + source_image_id),
        return the existing record — this provides idempotency so
        reprocessing a job skips already-completed images.
        """
        async with self._pool.acquire() as conn:
            row = await conn.fetchrow(
                """INSERT INTO imagem_job
                     (job_id, source, source_image_id, path, lat, lon,
                      timestamp, camera_id, project_id, deployment_id, image_hash, status)
                   VALUES ($1, $2::varchar, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'pending')
                   ON CONFLICT (source, source_image_id) DO NOTHING
                   RETURNING id, job_id, source, source_image_id, status, detection_count""",
                job_id,
                item.source,
                item.image_id,
                item.path,
                item.lat,
                item.lon,
                item.timestamp,
                item.camera_id,
                item.project_id,
                item.deployment_id,
                item.image_hash,
            )

            if row is None:
                # Already existed (ON CONFLICT) — fetch by unique key, not job_id.
                # The unique constraint is (source, source_image_id), so the existing
                # row may belong to a different job. We reuse that row and update
                # its job_id to the current job so progress is tracked correctly.
                row = await conn.fetchrow(
                    """UPDATE imagem_job
                          SET job_id = $1
                        WHERE source = $2 AND source_image_id = $3
                      RETURNING id, job_id, source, source_image_id, status, detection_count""",
                    job_id,
                    item.source,
                    item.image_id,
                )

            if row is None:
                # source_image_id was NULL — no conflict, but INSERT returned None.
                # This shouldn't happen, but handle gracefully.
                raise RuntimeError(
                    f"upsert_image_job: could not insert or find image "
                    f"(source={item.source}, image_id={item.image_id})"
                )

            return ImageJobRecord(
                id=row["id"],
                job_id=row["job_id"],
                source=row["source"],
                source_image_id=row["source_image_id"],
                status=row["status"],
                detection_count=row["detection_count"],
            )

    async def update_image_status(
        self,
        image_job_id: int,
        status: str,
        detection_count: int = 0,
        error: Optional[str] = None,
    ) -> None:
        """Update the status of an image checkpoint."""
        async with self._pool.acquire() as conn:
            await conn.execute(
                """UPDATE imagem_job
                   SET status = $2::imagem_status,
                       detection_count = $3,
                       error = $4
                   WHERE id = $1""",
                image_job_id,
                status,
                detection_count,
                error,
            )

    async def find_processed_duplicate(
        self,
        image_hash: Optional[str] = None,
        deployment_id: Optional[str] = None,
        timestamp: Optional[datetime] = None,
        exclude_id: Optional[int] = None,
    ) -> Optional[dict]:
        """Find an already-processed imagem_job row that represents the
        same physical record as the incoming image.

        Two checks (OR):
        - image_hash: identical file content, even if re-registered under
          a different image_id or source.
        - deployment_id + timestamp: same camera trap at the same instant —
          catches the same photo registered twice with different IDs.
        """
        clauses = []
        params: list = []

        if image_hash:
            params.append(image_hash)
            clauses.append(f"image_hash = ${len(params)}")
        if deployment_id and timestamp:
            params.append(deployment_id)
            params.append(timestamp)
            clauses.append(
                f"(deployment_id = ${len(params)-1} AND timestamp = ${len(params)})"
            )

        if not clauses:
            return None

        params.append(exclude_id or -1)
        query = (
            "SELECT id, job_id, source, source_image_id, status "
            "FROM imagem_job "
            f"WHERE ({' OR '.join(clauses)}) "
            "  AND status IN ('classified', 'completed') "
            f"  AND id <> ${len(params)} "
            "ORDER BY id LIMIT 1"
        )
        async with self._pool.acquire() as conn:
            row = await conn.fetchrow(query, *params)
            return dict(row) if row else None

    # ------------------------------------------------------------------
    # Detections (deteccao)
    # ------------------------------------------------------------------

    async def save_detection(self, det: DetectionRecord) -> int:
        """Save a detection record."""
        async with self._pool.acquire() as conn:
            row = await conn.fetchrow(
                """INSERT INTO deteccao
                     (job_id, especie_id, nome_cientifico, confianca, lat, lon,
                      bbox_pixel, recorte_url, metodo_classificacao, modelo_ia,
                      confianca_ia, image_job_id, status)
                   VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::varchar, $10, $11, $12, $13::deteccao_status)
                   RETURNING id""",
                det.job_id,
                det.especie_id,
                det.nome_cientifico,
                det.confianca,
                det.lat,
                det.lon,
                det.bbox_pixel,
                det.recorte_url,
                det.metodo_classificacao,
                det.modelo_ia,
                det.confianca_ia,
                det.image_job_id,
                det.status,
            )
            return row["id"]

    async def list_unclassified_detections(self, limit: int = 100) -> list[dict]:
        """Fetch detections with status='detected' for Fase 2 classification.

        Joins imagem_job to get the source (for context) and image path
        (for re-cropping if the saved crop is unavailable).
        """
        async with self._pool.acquire() as conn:
            rows = await conn.fetch(
                """SELECT d.id, d.job_id, d.confianca, d.lat, d.lon,
                          d.bbox_pixel, d.recorte_url,
                          ij.source, ij.path AS image_path, ij.timestamp,
                          d.image_job_id
                   FROM deteccao d
                   JOIN imagem_job ij ON ij.id = d.image_job_id
                   WHERE d.status = 'detected'
                   ORDER BY d.confianca DESC
                   LIMIT $1""",
                limit,
            )
            return [dict(r) for r in rows]

    async def update_detection_classification(
        self,
        detection_id: int,
        especie_id: Optional[int],
        nome_cientifico: Optional[str],
        metodo_classificacao: str,
        modelo_ia: Optional[str],
        confianca_ia: Optional[float],
        status: str,
    ) -> None:
        """Update a detection with the VLM classification result."""
        async with self._pool.acquire() as conn:
            await conn.execute(
                """UPDATE deteccao
                   SET especie_id = $2,
                       nome_cientifico = $3,
                       metodo_classificacao = $4::varchar,
                       modelo_ia = $5,
                       confianca_ia = $6,
                       status = $7::deteccao_status
                   WHERE id = $1""",
                detection_id,
                especie_id,
                nome_cientifico,
                metodo_classificacao,
                modelo_ia,
                confianca_ia,
                status,
            )

    async def update_detection_status(self, detection_id: int, status: str) -> None:
        """Update only the status of a detection."""
        async with self._pool.acquire() as conn:
            await conn.execute(
                "UPDATE deteccao SET status = $2::deteccao_status WHERE id = $1",
                detection_id,
                status,
            )

    async def get_job_detections(self, job_id: int) -> list[dict]:
        async with self._pool.acquire() as conn:
            rows = await conn.fetch(
                """SELECT d.*, e.nome_popular
                   FROM deteccao d
                   LEFT JOIN especie e ON e.id = d.especie_id
                   WHERE d.job_id = $1
                   ORDER BY d.confianca DESC""",
                job_id,
            )
            return [dict(r) for r in rows]

    # ------------------------------------------------------------------
    # Species (especie)
    # ------------------------------------------------------------------

    async def find_species_by_name(self, nome_cientifico: str) -> Optional[int]:
        async with self._pool.acquire() as conn:
            row = await conn.fetchrow(
                "SELECT id FROM especie WHERE nome_cientifico = $1",
                nome_cientifico.lower().strip(),
            )
            return row["id"] if row else None

    async def find_or_create_species(
        self,
        nome_cientifico: str,
        nome_popular: Optional[str] = None,
        categoria_ameaca: str = "DD",
        descricao: Optional[str] = None,
    ) -> int:
        """Find a species by scientific name, or create it if it doesn't exist."""
        nome_cientifico = nome_cientifico.lower().strip()
        async with self._pool.acquire() as conn:
            row = await conn.fetchrow(
                "SELECT id FROM especie WHERE nome_cientifico = $1",
                nome_cientifico,
            )
            if row:
                return row["id"]

            genus_name = nome_cientifico.split()[0] if " " in nome_cientifico else nome_cientifico

            taxon_row = await conn.fetchrow(
                """SELECT id FROM taxon WHERE nome = $1 AND "rank" = 'genero'""",
                genus_name,
            )
            if taxon_row:
                genero_id = taxon_row["id"]
            else:
                inserted = await conn.fetchrow(
                    """INSERT INTO taxon (nome, "rank", parent_id)
                       VALUES ($1, 'genero', NULL) RETURNING id""",
                    genus_name,
                )
                genero_id = inserted["id"]

            inserted = await conn.fetchrow(
                """INSERT INTO especie
                     (nome_cientifico, nome_popular, categoria_ameaca, genero_id, descricao, status)
                   VALUES ($1, $2, $3, $4, $5, 'ativo')
                   RETURNING id""",
                nome_cientifico,
                nome_popular,
                categoria_ameaca,
                genero_id,
                descricao,
            )
            return inserted["id"]

    async def update_species_info(
        self,
        especie_id: int,
        descricao: Optional[str] = None,
        categoria_ameaca: Optional[str] = None,
        nome_popular: Optional[str] = None,
    ) -> None:
        """Update species description, risk category and/or popular name."""
        fields = []
        params = []
        idx = 1

        if descricao is not None:
            fields.append(f"descricao = ${idx}")
            params.append(descricao)
            idx += 1

        if categoria_ameaca is not None:
            fields.append(f"categoria_ameaca = ${idx}")
            params.append(categoria_ameaca)
            idx += 1

        if nome_popular is not None:
            fields.append(f"nome_popular = ${idx}")
            params.append(nome_popular)
            idx += 1

        if not fields:
            return

        fields.append(f"atualizado_em = now()")
        params.append(especie_id)

        async with self._pool.acquire() as conn:
            await conn.execute(
                f"UPDATE especie SET {', '.join(fields)} WHERE id = ${idx}",
                *params,
            )

    # ------------------------------------------------------------------
    # Occurrences (ocorrencia)
    # ------------------------------------------------------------------

    async def occurrence_exists(
        self,
        especie_id: int,
        lat: float,
        lon: float,
        data_evento: date,
    ) -> bool:
        """Check whether an occurrence already exists for the same
        species at the same location on the same date.

        Prevents duplicate occurrence records when the same capture
        event arrives as two different images (re-registered photo,
        burst frame with same timestamp, different source, etc.).
        """
        async with self._pool.acquire() as conn:
            row = await conn.fetchrow(
                """SELECT 1 FROM ocorrencia
                   WHERE especie_id = $1
                     AND data_evento = $2
                     AND lat = $3 AND lon = $4
                   LIMIT 1""",
                especie_id,
                data_evento,
                lat,
                lon,
            )
            return row is not None

    async def create_occurrence(
        self,
        especie_id: int,
        lat: float,
        lon: float,
        data_evento: date,
        base_registro: str,
        fonte: str = "deteccao_satelite",
    ) -> int:
        """Create an occurrence record.

        The fonte parameter allows distinguishing between satellite
        detections ('deteccao_satelite') and camera trap detections
        ('camera_trap').
        """
        async with self._pool.acquire() as conn:
            row = await conn.fetchrow(
                """INSERT INTO ocorrencia
                     (especie_id, lat, lon, geom, data_evento, fonte, base_registro)
                   VALUES ($1, $2, $3, ST_SetSRID(ST_MakePoint($3, $2), 4326), $4, $5::fonte_ocorrencia_tipo, $6)
                   RETURNING id""",
                especie_id,
                lat,
                lon,
                data_evento,
                fonte,
                base_registro,
            )
            return row["id"]
