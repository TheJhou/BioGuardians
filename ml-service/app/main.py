"""FastAPI application — ML microservice for animal detection.

Endpoints:
  POST /ingest          — submit a new image processing job (async)
  POST /classify        — trigger Fase 2 classification of pending detections
  GET  /jobs            — list recent jobs
  GET  /jobs/{id}       — get job status + detections
  GET  /jobs/{id}/progress — detailed progress (images, detections, classified)
  GET  /health          — health check

A background worker loop polls for pending jobs and processes them
automatically (Fase 1 — detection). Fase 2 (classification) is
triggered manually via POST /classify to control VLM API usage.
"""

import asyncio
import logging
from contextlib import asynccontextmanager
from datetime import date as date_type
from typing import Optional
from pydantic import BaseModel, Field

from fastapi import FastAPI, HTTPException, Query

from .config import load_settings, Settings
from .db import Database
from .detector import AnimalDetector
from .classifier import SpeciesClassifier
from .pipeline import DetectionPipeline
from .sources.base import ImageSource
from .sources.local_dir import LocalDirectorySource
from .sources.camera_trap import CameraTrapSource

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
)
logger = logging.getLogger(__name__)

# --- Globals (initialized in lifespan) ---
settings: Optional[Settings] = None
db: Optional[Database] = None
detector: Optional[AnimalDetector] = None
classifier: Optional[SpeciesClassifier] = None
pipeline: Optional[DetectionPipeline] = None
_worker_task: Optional[asyncio.Task] = None


def _build_source(
    source_type: str,
    data_dir: Optional[str] = None,
    project_id: Optional[str] = None,
    limit: Optional[int] = None,
) -> ImageSource:
    """Build an ImageSource from a source type tag and optional data dir."""
    if source_type == "camera_trap":
        if not data_dir:
            raise ValueError("data_dir is required for camera_trap source")
        return CameraTrapSource(data_dir=data_dir, project_id=project_id, limit=limit)
    if source_type == "local_dir":
        if not data_dir:
            raise ValueError("data_dir is required for local_dir source")
        return LocalDirectorySource(directory=data_dir)
    if source_type == "satellite":
        raise ValueError(
            "Satellite source requires bbox and date — use the legacy /batch endpoint"
        )
    raise ValueError(f"Unknown source type: {source_type}")


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application startup/shutdown lifecycle."""
    global settings, db, detector, classifier, pipeline, _worker_task

    logger.info("Starting BioGuardians ML service...")
    settings = load_settings()

    # Database
    db = Database(settings)
    await db.connect()
    logger.info("Database connected")

    # ML models
    detector = AnimalDetector(settings)
    detector.load()

    classifier = SpeciesClassifier(settings)
    classifier.load()

    # Pipeline
    pipeline = DetectionPipeline(settings, db, detector, classifier)

    # Background worker: process pending jobs
    async def worker_loop():
        logger.info("Worker loop started — polling for pending jobs")
        while True:
            try:
                job = await db.get_next_pending_job()
                if job is None:
                    await asyncio.sleep(5)
                    continue

                job_id = job["id"]
                source_type = job.get("source", "satellite")
                data_dir = job.get("data_dir")

                logger.info("Worker: picked job %d (source=%s)", job_id, source_type)

                if source_type == "satellite":
                    # Legacy satellite batch — process all protected areas
                    # for the job's target date. This uses run_batch_satellite
                    # which creates sub-jobs per area internally.
                    target_date = job.get("data_captura", date_type.today())
                    logger.info("Worker: satellite job %d for date %s", job_id, target_date)
                    await pipeline.run_batch_satellite(target_date)
                    # Mark this umbrella job as done
                    await db.update_job_status(job_id, "concluido")
                else:
                    project_id = job.get("project_id")
                    limit = job.get("p_limit")
                    source = _build_source(source_type, data_dir, project_id=project_id, limit=limit)
                    await pipeline.run(job_id, source)

            except asyncio.CancelledError:
                logger.info("Worker loop cancelled")
                break
            except Exception as exc:
                logger.error("Worker loop error: %s", exc, exc_info=True)
                await asyncio.sleep(10)

    _worker_task = asyncio.create_task(worker_loop())

    logger.info("ML service ready (GPU device=%s)", settings.yolo_device)
    yield

    # Shutdown
    logger.info("Shutting down ML service...")
    if _worker_task:
        _worker_task.cancel()
        try:
            await _worker_task
        except asyncio.CancelledError:
            pass
    if db:
        await db.close()


app = FastAPI(
    title="BioGuardians ML Service",
    description="Animal detection and species classification from camera traps and satellite imagery",
    version="2.0.0",
    lifespan=lifespan,
)


# --- Request/Response models ---

class JobSummary(BaseModel):
    id: int
    bbox: Optional[str] = None
    data_captura: date_type
    satelite: Optional[str] = None
    status: str
    total_deteccoes: int
    source: str = "satellite"
    total_imagens: int = 0
    imagens_processadas: int = 0
    criado_em: str
    concluido_em: Optional[str] = None
    erro: Optional[str] = None


class DetectionItem(BaseModel):
    id: int
    especie_id: Optional[int] = None
    nome_cientifico: Optional[str] = None
    confianca: float
    lat: float
    lon: float
    bbox_pixel: Optional[str] = None
    nome_popular: Optional[str] = None
    status: str = "detected"


class JobDetail(JobSummary):
    scene_id: Optional[str] = None
    imagem_url: Optional[str] = None
    deteccoes: list[DetectionItem] = []


class IngestRequest(BaseModel):
    source: str = Field(..., description="Image source type: 'camera_trap' or 'local_dir'")
    data_dir: Optional[str] = Field(None, description="Path to the dataset directory")
    project_id: Optional[str] = Field(None, description="Filter to a single project (camera_trap only)")
    limit: Optional[int] = Field(None, ge=1, le=100000, description="Max images to process (camera_trap only)")


class IngestResponse(BaseModel):
    job_id: int
    status: str
    message: str


class ClassifyRequest(BaseModel):
    limit: int = Field(100, ge=1, le=1000, description="Max detections to classify")


class ClassifyResponse(BaseModel):
    classified: int
    message: str


class ProgressResponse(BaseModel):
    job_id: int
    status: str
    total_imagens: int
    imagens_processadas: int
    total_deteccoes: int
    pending_classification: int
    classified: int
    rejected: int
    inconclusive: int


# --- Endpoints ---

@app.get("/health")
async def health():
    """Health check."""
    return {
        "status": "ok",
        "model_loaded": detector is not None and detector._model is not None,
        "device": settings.yolo_device if settings else "unknown",
        "classifier": "vlm" if (settings and settings.openrouter_api_key) else "heuristic",
    }


@app.post("/ingest", response_model=IngestResponse)
async def ingest(req: IngestRequest):
    """Submit a new image processing job.

    Creates a deteccao_job with status='pendente' and returns immediately.
    The background worker picks it up and processes it via Fase 1 (detection).
    """
    if req.source not in ("camera_trap", "local_dir"):
        raise HTTPException(400, f"Unsupported source: {req.source}. Use 'camera_trap' or 'local_dir'.")

    if not req.data_dir:
        raise HTTPException(400, "data_dir is required")

    job_id = await db.create_job(
        source=req.source,
        data_dir=req.data_dir,
        project_id=req.project_id,
        p_limit=req.limit,
    )

    logger.info("Ingest: created job %d (source=%s, data_dir=%s)", job_id, req.source, req.data_dir)

    return IngestResponse(
        job_id=job_id,
        status="pendente",
        message=f"Job {job_id} created. The worker will process it automatically.",
    )


@app.post("/classify", response_model=ClassifyResponse)
async def classify(req: ClassifyRequest):
    """Trigger Fase 2 — classify pending detections via VLM.

    Processes up to `limit` detections with status='detected'.
    Call repeatedly to process all pending detections.
    """
    classified = await pipeline.classify_pending(limit=req.limit)
    return ClassifyResponse(
        classified=classified,
        message=f"Classified {classified} detections. Call again to process more.",
    )


@app.get("/jobs", response_model=list[JobSummary])
async def list_jobs(
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
):
    """List recent detection jobs."""
    jobs = await db.list_jobs(limit=limit, offset=offset)
    return [
        JobSummary(
            id=j["id"],
            bbox=j.get("bbox"),
            data_captura=j["data_captura"],
            satelite=j.get("satelite"),
            status=j["status"],
            total_deteccoes=j["total_deteccoes"],
            source=j.get("source", "satellite"),
            total_imagens=j.get("total_imagens", 0),
            imagens_processadas=j.get("imagens_processadas", 0),
            criado_em=j["criado_em"].isoformat() if j.get("criado_em") else "",
            concluido_em=j["concluido_em"].isoformat() if j.get("concluido_em") else None,
            erro=j.get("erro"),
        )
        for j in jobs
    ]


@app.get("/jobs/{job_id}", response_model=JobDetail)
async def get_job(job_id: int):
    """Get job details and its detections."""
    job = await db.get_job(job_id)
    if not job:
        raise HTTPException(404, "Job not found")

    detections = await db.get_job_detections(job_id)

    return JobDetail(
        id=job["id"],
        bbox=job.get("bbox"),
        data_captura=job["data_captura"],
        satelite=job.get("satelite"),
        status=job["status"],
        total_deteccoes=job["total_deteccoes"],
        source=job.get("source", "satellite"),
        total_imagens=job.get("total_imagens", 0),
        imagens_processadas=job.get("imagens_processadas", 0),
        criado_em=job["criado_em"].isoformat() if job.get("criado_em") else "",
        concluido_em=job["concluido_em"].isoformat() if job.get("concluido_em") else None,
        erro=job.get("erro"),
        scene_id=job.get("scene_id"),
        imagem_url=job.get("imagem_url"),
        deteccoes=[
            DetectionItem(
                id=d["id"],
                especie_id=d.get("especie_id"),
                nome_cientifico=d.get("nome_cientifico"),
                confianca=float(d.get("confianca", 0)),
                lat=d["lat"],
                lon=d["lon"],
                bbox_pixel=d.get("bbox_pixel"),
                nome_popular=d.get("nome_popular"),
                status=d.get("status", "detected"),
            )
            for d in detections
        ],
    )


@app.get("/jobs/{job_id}/progress", response_model=ProgressResponse)
async def get_job_progress(job_id: int):
    """Get detailed progress for a job (images, detections, classification status)."""
    job = await db.get_job(job_id)
    if not job:
        raise HTTPException(404, "Job not found")

    # Get detection status counts
    async with db._pool.acquire() as conn:
        counts = await conn.fetchrow(
            """SELECT
                   COUNT(*) FILTER (WHERE status = 'detected') AS pending,
                   COUNT(*) FILTER (WHERE status = 'classified') AS classified,
                   COUNT(*) FILTER (WHERE status = 'rejected') AS rejected,
                   COUNT(*) FILTER (WHERE status = 'inconclusive') AS inconclusive,
                   COUNT(*) AS total
               FROM deteccao
               WHERE job_id = $1""",
            job_id,
        )

    return ProgressResponse(
        job_id=job_id,
        status=job["status"],
        total_imagens=job.get("total_imagens", 0),
        imagens_processadas=job.get("imagens_processadas", 0),
        total_deteccoes=counts["total"] if counts else 0,
        pending_classification=counts["pending"] if counts else 0,
        classified=counts["classified"] if counts else 0,
        rejected=counts["rejected"] if counts else 0,
        inconclusive=counts["inconclusive"] if counts else 0,
    )
