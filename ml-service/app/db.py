"""Database operations using asyncpg — saves detection jobs and detections."""

import asyncpg
from dataclasses import dataclass
from typing import Optional
from datetime import datetime, date

from .config import Settings


@dataclass
class DetectionRecord:
    job_id: int
    especie_id: Optional[int]
    nome_cientifico: Optional[str]
    confianca: float
    lat: float
    lon: float
    bbox_pixel: Optional[str]
    recorte_url: Optional[str]
    metodo_classificacao: str = "heuristic"  # 'ai' or 'heuristic'
    modelo_ia: Optional[str] = None
    confianca_ia: Optional[float] = None


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

    async def create_job(
        self,
        bbox: str,
        data_captura: date,
        satelite: str,
        instrumento: str,
        produto: str,
    ) -> int:
        async with self._pool.acquire() as conn:
            row = await conn.fetchrow(
                """INSERT INTO deteccao_job
                     (bbox, data_captura, satelite, instrumento, produto, status)
                   VALUES ($1::varchar, $2, $3::varchar, $4::varchar, $5::varchar, 'pendente')
                   RETURNING id""",
                bbox,
                data_captura,
                satelite,
                instrumento,
                produto,
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

    async def save_detection(self, det: DetectionRecord) -> int:
        async with self._pool.acquire() as conn:
            row = await conn.fetchrow(
                """INSERT INTO deteccao
                     (job_id, especie_id, nome_cientifico, confianca, lat, lon,
                      bbox_pixel, recorte_url, metodo_classificacao, modelo_ia, confianca_ia)
                   VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::varchar, $10, $11)
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
            )
            return row["id"]

    async def create_occurrence(
        self,
        especie_id: int,
        lat: float,
        lon: float,
        data_evento: date,
        base_registro: str,
    ) -> int:
        async with self._pool.acquire() as conn:
            row = await conn.fetchrow(
                """INSERT INTO ocorrencia
                     (especie_id, lat, lon, geom, data_evento, fonte, base_registro)
                   VALUES ($1, $2, $3, ST_SetSRID(ST_MakePoint($3, $2), 4326), $4, 'deteccao_satelite', $5)
                   RETURNING id""",
                especie_id,
                lat,
                lon,
                data_evento,
                base_registro,
            )
            return row["id"]

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
        """Find a species by scientific name, or create it if it doesn't exist.

        When creating, extracts the genus from the scientific name and creates
        a minimal taxon entry (genus rank, no parent) if the genus doesn't exist.
        """
        nome_cientifico = nome_cientifico.lower().strip()
        async with self._pool.acquire() as conn:
            # Try to find existing species
            row = await conn.fetchrow(
                "SELECT id FROM especie WHERE nome_cientifico = $1",
                nome_cientifico,
            )
            if row:
                return row["id"]

            # Extract genus (first word of binomial)
            genus_name = nome_cientifico.split()[0] if " " in nome_cientifico else nome_cientifico

            # Find or create genus taxon
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

            # Create the species
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
        """Update species description, risk category and/or popular name.

        Overwrites existing values when the new values are not None.
        """
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

    async def get_job(self, job_id: int) -> Optional[dict]:
        async with self._pool.acquire() as conn:
            row = await conn.fetchrow("SELECT * FROM deteccao_job WHERE id = $1", job_id)
            return dict(row) if row else None

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
        """Return id, name and bbox of all protected areas for batch processing."""
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
