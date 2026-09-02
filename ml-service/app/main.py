"""FastAPI application — ML microservice for satellite animal detection.

Endpoints:
  POST /batch        — trigger batch processing of all protected areas (internal)
  GET  /jobs         — list recent jobs
  GET  /jobs/{id}    — get job status + detections
  GET  /health       — health check
"""

import logging
from contextlib import asynccontextmanager
from datetime import date as date_type
from typing import Optional
from pydantic import BaseModel, Field

from fastapi import FastAPI, HTTPException, Query

from .config import load_settings, Settings
from .db import Database
from .satellite import Cbers4aFetcher
from .detector import AnimalDetector
from .classifier import SpeciesClassifier
from .pipeline import DetectionPipeline

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
)
logger = logging.getLogger(__name__)

# --- Globals (initialized in lifespan) ---
settings: Optional[Settings] = None
db: Optional[Database] = None
fetcher: Optional[Cbers4aFetcher] = None
detector: Optional[AnimalDetector] = None
classifier: Optional[SpeciesClassifier] = None
pipeline: Optional[DetectionPipeline] = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application startup/shutdown lifecycle."""
    global settings, db, fetcher, detector, classifier, pipeline

    logger.info("Starting BioGuardians ML service...")
    settings = load_settings()

    # Database
    db = Database(settings)
    await db.connect()
    logger.info("Database connected")

    # Satellite fetcher
    fetcher = Cbers4aFetcher(settings)

    # ML models
    detector = AnimalDetector(settings)
    detector.load()

    classifier = SpeciesClassifier(settings)
    classifier.load()

    # Pipeline
    pipeline = DetectionPipeline(settings, db, fetcher, detector, classifier)

    logger.info("ML service ready")
    yield

    # Shutdown
    logger.info("Shutting down ML service...")
    if db:
        await db.close()


app = FastAPI(
    title="BioGuardians ML Service",
    description="Satellite animal detection and species classification",
    version="1.0.0",
    lifespan=lifespan,
)


# --- Request/Response models ---

class JobSummary(BaseModel):
    id: int
    bbox: str
    data_captura: date_type
    satelite: str
    status: str
    total_deteccoes: int
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


class JobDetail(JobSummary):
    scene_id: Optional[str] = None
    imagem_url: Optional[str] = None
    deteccoes: list[DetectionItem] = []


class BatchRequest(BaseModel):
    date: date_type = Field(..., description="Target satellite image date (YYYY-MM-DD)")
    area_ids: Optional[list[int]] = Field(
        None, description="Specific area IDs to process (optional, defaults to all)"
    )


class BatchResponse(BaseModel):
    total_areas: int
    processadas: int
    erros: int
    total_deteccoes: int


# --- Endpoints ---

@app.get("/health")
async def health():
    """Health check."""
    return {
        "status": "ok",
        "model_loaded": detector is not None and detector._model is not None,
        "classifier": "heuristic",
    }


@app.post("/batch", response_model=BatchResponse)
async def batch(req: BatchRequest):
    """Trigger batch processing of all protected areas.

    Not exposed publicly — only accessible within the Docker network.
    Reads area_protegida polygons from the database, computes bbox for
    each, and runs the detection pipeline.
    """
    try:
        results = await pipeline.run_batch(req.date, req.area_ids)
        return BatchResponse(**results)
    except Exception as exc:
        raise HTTPException(500, f"Batch failed: {exc}")


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
            bbox=j["bbox"],
            data_captura=j["data_captura"],
            satelite=j["satelite"],
            status=j["status"],
            total_deteccoes=j["total_deteccoes"],
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
        bbox=job["bbox"],
        data_captura=job["data_captura"],
        satelite=job["satelite"],
        status=job["status"],
        total_deteccoes=job["total_deteccoes"],
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
            )
            for d in detections
        ],
    )
