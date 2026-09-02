"""Species classification via OpenRouter VLM (Claude Sonnet 4).

Sends the detected animal crop to a vision-language model that:
1. Identifies the species (scientific name)
2. Generates a description in Portuguese
3. Classifies the extinction risk (IUCN/MMA category)

Falls back to the heuristic classifier if OPENROUTER_API_KEY is not set.
"""

import base64
import json
import logging
from dataclasses import dataclass
from typing import Optional

import cv2
import httpx
import numpy as np

from .config import Settings

logger = logging.getLogger(__name__)


@dataclass
class ClassificationResult:
    """Result of species classification for a detection."""
    nome_cientifico: Optional[str]
    nome_popular: Optional[str]
    descricao: Optional[str]
    categoria_ameaca: Optional[str]  # CR, EN, VU, NT, LC, DD
    confidence: float
    method: str  # 'ai' or 'heuristic'


VALID_CATEGORIES = {"CR", "EN", "VU", "NT", "LC", "DD"}

OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"

PROMPT = """You are a wildlife biologist specialized in Brazilian fauna.
Analyze this satellite image crop showing a detected animal.

Return a JSON object with exactly these fields:
{
  "nome_cientifico": "scientific name in lowercase or null",
  "nome_popular": "common name in Portuguese or null",
  "descricao": "2-3 sentence description in Portuguese",
  "categoria_ameaca": "one of: CR, EN, VU, NT, LC, DD",
  "confianca": "number from 0.0 to 1.0"
}

Context: satellite image (CBERS-4A WPM) in a Brazilian protected area. Biome: {biome}.
If you cannot identify the species, set nome_cientifico to null and confianca to 0.0."""


# ---- Heuristic fallback (kept for when API key is not configured) ----

SPECIES_BY_BIOME = {
    "cat": {
        "amazonia": ("panthera onca", "onça-pintada", 0.35),
        "mata_atlantica": ("panthera onca", "onça-pintada", 0.30),
        "pantanal": ("panthera onca", "onça-pintada", 0.40),
        "cerrado": ("puma concolor", "onça-parda", 0.25),
        "caatinga": ("leopardus tigrinus", "gato-do-mato-pintado", 0.20),
        "_default": None,
    },
    "dog": {
        "amazonia": ("speothos venaticus", "cachorro-vinagre", 0.30),
        "_default": None,
    },
}


def infer_biome(lat: float, lon: float) -> str:
    """Infer a Brazilian biome from coordinates (simplified)."""
    if lat < -5 and lon < -45:
        return "amazonia"
    if lat < -10 and lon < -40:
        return "amazonia"
    if -22 < lat < -16 and -58 < lon < -54:
        return "pantanal"
    if -20 < lat < -5 and -55 < lon < -40:
        return "cerrado"
    if -15 < lat < -3 and -42 < lon < -34:
        return "caatinga"
    if lat < -5 and -42 < lon < -35:
        return "mata_atlantica"
    if -33 < lat < -5 and -52 < lon < -35:
        return "mata_atlantica"
    if lat < -28 and lon > -55:
        return "pampa"
    return "unknown"


def _crop_to_base64_jpeg(crop: np.ndarray, quality: int = 85) -> str:
    """Encode a numpy crop as base64 JPEG string."""
    # OpenCV expects BGR; our crops are BGR already (read from rasterio as BGR).
    # If the crop is very small, upscale it so the VLM can see details.
    h, w = crop.shape[:2]
    if h < 128 or w < 128:
        scale = max(128 / h, 128 / w)
        crop = cv2.resize(crop, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_CUBIC)
    ok, buf = cv2.imencode(".jpg", crop, [cv2.IMWRITE_JPEG_QUALITY, quality])
    if not ok:
        raise RuntimeError("Failed to encode crop as JPEG")
    return base64.b64encode(buf.tobytes()).decode("ascii")


def _parse_ai_response(raw) -> Optional[dict]:
    """Parse the JSON response from the VLM, tolerating markdown fences and extra text."""
    if raw is None:
        logger.warning("VLM returned None content")
        return None

    if not isinstance(raw, str):
        raw = str(raw)

    text = raw.strip()

    # Strip markdown code fences
    if text.startswith("```"):
        lines = text.split("\n")
        lines = [l for l in lines if not l.strip().startswith("```")]
        text = "\n".join(lines).strip()

    # Try direct parse first
    data = None
    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        pass

    # If direct parse failed, try to extract JSON from within the text
    if data is None:
        import re
        # Find the first { ... } block (greedy but balanced-ish via regex)
        match = re.search(r'\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}', text, re.DOTALL)
        if match:
            try:
                data = json.loads(match.group())
            except json.JSONDecodeError:
                pass

    if data is None:
        logger.warning("VLM returned non-JSON response: %s", text[:300])
        return None

    # Normalize fields
    nome_cientifico = data.get("nome_cientifico")
    if nome_cientifico:
        nome_cientifico = nome_cientifico.strip().lower()
        if len(nome_cientifico) < 4:
            nome_cientifico = None

    categoria = data.get("categoria_ameaca")
    if categoria:
        categoria = str(categoria).strip().upper()
        if categoria not in VALID_CATEGORIES:
            categoria = None

    try:
        confianca = float(data.get("confianca", 0))
    except (TypeError, ValueError):
        confianca = 0.0

    return {
        "nome_cientifico": nome_cientifico,
        "nome_popular": data.get("nome_popular"),
        "descricao": data.get("descricao"),
        "categoria_ameaca": categoria,
        "confianca": confianca,
    }


class SpeciesClassifier:
    """Classifies detected animals using a vision-language model via OpenRouter."""

    def __init__(self, settings: Settings):
        self._settings = settings
        self._heuristic = _HeuristicFallback()

    def load(self) -> None:
        if self._settings.openrouter_api_key:
            logger.info(
                "Species classifier: using OpenRouter VLM (%s)",
                self._settings.openrouter_model,
            )
        else:
            logger.warning(
                "OPENROUTER_API_KEY not set — falling back to heuristic classifier"
            )

    def classify(
        self,
        crop: np.ndarray,
        coco_class_name: str,
        lat: float,
        lon: float,
        detection_confidence: float,
    ) -> ClassificationResult:
        """Classify a detected animal crop to a Brazilian species.

        Args:
            crop: cropped image of the detected animal (numpy array, BGR)
            coco_class_name: COCO class name from the detector
            lat: latitude of detection center
            lon: longitude of detection center
            detection_confidence: YOLOv8 detection confidence

        Returns:
            ClassificationResult with species, description, risk and confidence.
        """
        if self._settings.openrouter_api_key:
            try:
                return self._classify_with_vlm(crop, lat, lon, detection_confidence)
            except Exception as exc:
                logger.error("VLM classification failed, falling back to heuristic: %s", exc)

        return self._heuristic.classify(coco_class_name, lat, lon, detection_confidence)

    def _classify_with_vlm(
        self,
        crop: np.ndarray,
        lat: float,
        lon: float,
        detection_confidence: float,
    ) -> ClassificationResult:
        """Send crop to OpenRouter VLM and parse the response."""
        biome = infer_biome(lat, lon)
        b64 = _crop_to_base64_jpeg(crop)

        prompt = PROMPT.format(biome=biome)

        payload = {
            "model": self._settings.openrouter_model,
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": prompt},
                        {
                            "type": "image_url",
                            "image_url": {"url": f"data:image/jpeg;base64,{b64}"},
                        },
                    ],
                }
            ],
            "max_tokens": 600,
            "temperature": 0.2,
            "response_format": {"type": "json_object"},
        }

        headers = {
            "Authorization": f"Bearer {self._settings.openrouter_api_key}",
            "Content-Type": "application/json",
        }

        with httpx.Client(timeout=self._settings.http_timeout) as client:
            resp = client.post(OPENROUTER_URL, json=payload, headers=headers)

        if resp.status_code != 200:
            raise RuntimeError(
                f"OpenRouter API error {resp.status_code}: {resp.text[:300]}"
            )

        data = resp.json()

        # Extract content safely — some models return content as list
        try:
            content = data["choices"][0]["message"]["content"]
        except (KeyError, IndexError, TypeError) as exc:
            logger.error("Unexpected OpenRouter response structure: %s", str(data)[:300])
            raise RuntimeError(f"Cannot extract content from response: {exc}") from exc

        # Some models return content as a list of parts
        if isinstance(content, list):
            content = " ".join(
                part.get("text", "") if isinstance(part, dict) else str(part)
                for part in content
            )

        logger.debug("VLM raw response: %s", str(content)[:200])
        parsed = _parse_ai_response(content)

        if parsed is None or not parsed["nome_cientifico"]:
            return ClassificationResult(
                nome_cientifico=None,
                nome_popular=None,
                descricao=None,
                categoria_ameaca=None,
                confidence=0.0,
                method="ai",
            )

        return ClassificationResult(
            nome_cientifico=parsed["nome_cientifico"],
            nome_popular=parsed.get("nome_popular"),
            descricao=parsed.get("descricao"),
            categoria_ameaca=parsed.get("categoria_ameaca"),
            confidence=parsed["confianca"],
            method="ai",
        )


class _HeuristicFallback:
    """Heuristic classifier used when OPENROUTER_API_KEY is not set."""

    def classify(
        self,
        coco_class_name: str,
        lat: float,
        lon: float,
        detection_confidence: float,
    ) -> ClassificationResult:
        biome = infer_biome(lat, lon)
        species_map = SPECIES_BY_BIOME.get(coco_class_name, {})
        result = species_map.get(biome, species_map.get("_default"))

        if result is None:
            return ClassificationResult(
                nome_cientifico=None,
                nome_popular=None,
                descricao=None,
                categoria_ameaca=None,
                confidence=0.0,
                method="heuristic",
            )

        nome_cientifico, nome_popular, base_confidence = result
        combined = min(base_confidence * detection_confidence, 1.0)

        return ClassificationResult(
            nome_cientifico=nome_cientifico,
            nome_popular=nome_popular,
            descricao=None,
            categoria_ameaca=None,
            confidence=combined,
            method="heuristic",
        )
