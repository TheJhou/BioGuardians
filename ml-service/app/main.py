"""FastAPI application — ML microservice for satellite animal detection.

Endpoints:
  POST /detect       — start a detection job (bbox + date)
  GET  /jobs         — list recent jobs
  GET  /jobs/{id}    — get job status + detections
  GET  /health       — health check
"""

import logging
from contextlib import asynccontextmanager
from datetime import date
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

class DetectRequest(BaseModel):
    bbox: str = Field(..., description="minLng,minLat,maxLng,maxLat")
    date: date = Field(..., description="Target satellite image date (YYYY-MM-DD)")


class DetectResponse(BaseModel):
    job_id: int
    status: str


class JobSummary(BaseModel):
    id: int
    bbox: str
    data_captura: date
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


# --- Endpoints ---

@app.get("/health")
async def health():
    """Health check."""
    return {
        "status": "ok",
        "model_loaded": detector is not None and detector._model is not None,
        "classifier": "heuristic",
    }


@app.post("/detect", response_model=DetectResponse)
async def detect(req: DetectRequest):
    """Start a satellite detection job.

    Creates a job in the database and runs the pipeline synchronously
    (the request blocks until completion). For production, this should
    use a background task queue.
    """
    # Validate bbox format
    parts = req.bbox.split(",")
    if len(parts) != 4:
        raise HTTPException(400, "bbox must be 'minLng,minLat,maxLng,maxLat'")
    try:
        coords = [float(p) for p in parts]
    except ValueError:
        raise HTTPException(400, "bbox coordinates must be numeric")

    # Create job
    job_id = await db.create_job(
        bbox=req.bbox,
        data_captura=req.date,
        satelite="CBERS-4A",
        instrumento="WPM",
        produto="L4_DN",
    )

    # Run pipeline (synchronous for MVP)
    try:
        total = await pipeline.run(job_id, req.bbox, req.date)
        return DetectResponse(job_id=job_id, status="concluido")
    except Exception as exc:
        raise HTTPException(500, f"Detection failed: {exc}")


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
