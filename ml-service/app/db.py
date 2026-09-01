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


class Database:
    def __init__(self, settings: Settings):
        self._database_url = settings.database_url
        self._pool: Optional[asyncpg.Pool] = None

    async def connect(self) -> None:
        self._pool = await asyncpg.create_pool(
            dsn=self._database_url,
            min_size=1,
            max_size=5,
            command_timeout=30,
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
                   VALUES ($1, $2, $3, $4, $5, 'pendente')
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
                   SET status = $2,
                       total_deteccoes = $3,
                       erro = $4,
                       scene_id = COALESCE($5, scene_id),
                       imagem_url = COALESCE($6, imagem_url),
                       concluido_em = CASE WHEN $2 IN ('concluido', 'erro') THEN now() ELSE concluido_em END
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
                     (job_id, especie_id, nome_cientifico, confianca, lat, lon, bbox_pixel, recorte_url)
                   VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                   RETURNING id""",
                det.job_id,
                det.especie_id,
                det.nome_cientifico,
                det.confianca,
                det.lat,
                det.lon,
                det.bbox_pixel,
                det.recorte_url,
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
