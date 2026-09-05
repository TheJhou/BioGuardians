"""Local VLM classifier using fine-tuned Qwen2-VL-2B.

Loads the fine-tuned model (or base model with LoRA adapter) for inference.
Falls back to OpenRouter/Claude if the local model is not available or
returns low confidence.

The local model runs on GPU (RTX 4060) and costs nothing per inference.
OpenRouter is used only as fallback for uncertain cases.
"""

import json
import logging
import os
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

import torch

from .config import Settings

logger = logging.getLogger(__name__)

CLASSIFY_PROMPT = (
    "You are a wildlife biologist. Look at this camera trap photo from Brazil "
    "and identify the animal species. "
    "Respond with ONLY a JSON object: "
    '{"nome_cientifico": "genus species", "nome_popular": "common name in Portuguese", '
    '"confianca": 0.0 to 1.0}'
)


@dataclass
class ClassificationResult:
    """Result of species classification."""
    nome_cientifico: Optional[str]
    nome_popular: Optional[str]
    descricao: Optional[str]
    categoria_ameaca: Optional[str]
    confidence: float
    method: str  # 'local_vlm' or 'openrouter' or 'heuristic'


class LocalVLMClassifier:
    """Classifies camera trap photos using a local fine-tuned Qwen2-VL model.

    Falls back to OpenRouter if the local model is unavailable or returns
    low confidence.
    """

    def __init__(self, settings: Settings):
        self._settings = settings
        self._model = None
        self._processor = None
        self._device = settings.yolo_device  # reuse the device setting
        self._openrouter = OpenRouterFallback(settings)

    def load(self) -> None:
        """Load the local fine-tuned model if available and enabled."""
        if not self._settings.local_vlm_enabled:
            logger.info("Local VLM disabled (LOCAL_VLM_ENABLED=false) — OpenRouter only")
            return

        model_path = os.environ.get("LOCAL_VLM_PATH", "models/qwen2vl-finetuned")

        if not os.path.exists(model_path):
            logger.warning(
                "Local VLM not found at %s — will use OpenRouter fallback only",
                model_path,
            )
            return

        try:
            from transformers import Qwen2VLForConditionalGeneration, AutoProcessor
            from peft import PeftModel

            logger.info("Loading local VLM from %s (device=%s)", model_path, self._device)

            # Check if it's a LoRA adapter or a merged model
            adapter_config = Path(model_path) / "adapter_config.json"
            if adapter_config.exists():
                # LoRA adapter — load base model + adapter
                base = Qwen2VLForConditionalGeneration.from_pretrained(
                    "Qwen/Qwen2-VL-2B-Instruct",
                    torch_dtype=torch.bfloat16,
                    device_map="auto",
                )
                self._model = PeftModel.from_pretrained(base, model_path)
            else:
                # Merged model
                self._model = Qwen2VLForConditionalGeneration.from_pretrained(
                    model_path,
                    torch_dtype=torch.bfloat16,
                    device_map="auto",
                )

            self._processor = AutoProcessor.from_pretrained(model_path)
            self._model.eval()
            logger.info("Local VLM loaded successfully")

        except Exception as exc:
            logger.error("Failed to load local VLM: %s", exc)
            logger.warning("Will use OpenRouter fallback only")

    def classify(
        self,
        image_path: str,
        lat: float = 0,
        lon: float = 0,
        context: str = "camera trap photo in Brazil",
    ) -> ClassificationResult:
        """Classify an image using the local VLM, with OpenRouter fallback.

        Args:
            image_path: path to the image file
            lat: latitude (for biome inference)
            lon: longitude (for biome inference)
            context: description of the image source

        Returns:
            ClassificationResult with species info
        """
        # Try local VLM first
        if self._model is not None and self._processor is not None:
            try:
                result = self._classify_local(image_path)
                if result and result.nome_cientifico and result.confidence >= 0.5:
                    return result
                logger.info(
                    "Local VLM low confidence (%.2f) or no species — trying OpenRouter",
                    result.confidence if result else 0,
                )
            except Exception as exc:
                logger.warning("Local VLM failed: %s — trying OpenRouter", exc)

        # Fallback to OpenRouter
        return self._openrouter.classify(image_path, lat, lon, context)

    def _classify_local(self, image_path: str) -> Optional[ClassificationResult]:
        """Run local Qwen2-VL inference on an image."""
        from PIL import Image
        from qwen_vl_utils import process_vision_info

        image = Image.open(image_path).convert("RGB")

        messages = [
            {
                "role": "user",
                "content": [
                    {"type": "image", "image": image},
                    {"type": "text", "text": CLASSIFY_PROMPT},
                ],
            },
        ]

        text = self._processor.apply_chat_template(
            messages, tokenize=False, add_generation_prompt=True
        )
        image_inputs, video_inputs = process_vision_info(messages)
        inputs = self._processor(
            text=[text],
            images=image_inputs,
            videos=video_inputs,
            padding=True,
            return_tensors="pt",
        ).to(self._model.device)

        with torch.no_grad():
            output_ids = self._model.generate(
                **inputs,
                max_new_tokens=200,
                do_sample=False,
                temperature=1.0,
            )

        # Decode only the new tokens
        generated = self._processor.batch_decode(
            output_ids[:, inputs["input_ids"].shape[1]:],
            skip_special_tokens=True,
        )[0]

        logger.info("Local VLM response: %s", generated[:200])

        parsed = _parse_json_response(generated)
        if parsed is None:
            return ClassificationResult(
                nome_cientifico=None, nome_popular=None, descricao=None,
                categoria_ameaca=None, confidence=0.0, method="local_vlm",
            )

        confidence = parsed.get("confianca", 0.5)
        try:
            confidence = float(confidence)
        except (ValueError, TypeError):
            confidence = 0.5

        return ClassificationResult(
            nome_cientifico=parsed.get("nome_cientifico"),
            nome_popular=parsed.get("nome_popular"),
            descricao=None,
            categoria_ameaca=None,
            confidence=confidence,
            method="local_vlm",
        )


class OpenRouterFallback:
    """OpenRouter/Claude fallback classifier."""

    def __init__(self, settings: Settings):
        self._settings = settings

    def classify(
        self,
        image_path: str,
        lat: float,
        lon: float,
        context: str,
    ) -> ClassificationResult:
        """Classify using OpenRouter VLM (Claude Sonnet 4)."""
        if not self._settings.openrouter_api_key:
            return ClassificationResult(
                nome_cientifico=None, nome_popular=None, descricao=None,
                categoria_ameaca=None, confidence=0.0, method="heuristic",
            )

        import base64
        import cv2
        import httpx

        img = cv2.imread(image_path)
        if img is None:
            return ClassificationResult(
                nome_cientifico=None, nome_popular=None, descricao=None,
                categoria_ameaca=None, confidence=0.0, method="openrouter",
            )

        ok, buf = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, 85])
        if not ok:
            return ClassificationResult(
                nome_cientifico=None, nome_popular=None, descricao=None,
                categoria_ameaca=None, confidence=0.0, method="openrouter",
            )
        b64 = base64.b64encode(buf.tobytes()).decode("ascii")

        prompt = (
            "You are a wildlife biologist specialized in Brazilian fauna. "
            "This is a camera trap photo from a Brazilian forest. "
            "Look carefully at the image — there IS an animal in this photo. "
            "Identify the species based on body shape, size, color, and habitat. "
            'Respond with ONLY a JSON object (no markdown): '
            '{"nome_cientifico": "genus species", '
            '"nome_popular": "nome popular em português", '
            '"descricao": "2-3 frases em português", '
            '"categoria_ameaca": "CR ou EN ou VU ou NT ou LC ou DD", '
            '"confianca": 0.0 a 1.0}\n\n'
            f"Contexto: {context}. "
            "Even if uncertain, give your best guess. Only return null if "
            "there is truly no animal visible."
        )

        payload = {
            "model": self._settings.openrouter_model,
            "messages": [{
                "role": "user",
                "content": [
                    {"type": "text", "text": prompt},
                    {"type": "image_url",
                     "image_url": {"url": f"data:image/jpeg;base64,{b64}"}},
                ],
            }],
            "max_tokens": 600,
            "temperature": 0.2,
            "response_format": {"type": "json_object"},
        }

        headers = {
            "Authorization": f"Bearer {self._settings.openrouter_api_key}",
            "Content-Type": "application/json",
        }

        try:
            with httpx.Client(timeout=self._settings.http_timeout) as client:
                resp = client.post(
                    "https://openrouter.ai/api/v1/chat/completions",
                    json=payload, headers=headers,
                )

            if resp.status_code != 200:
                logger.error("OpenRouter error %d: %s", resp.status_code, resp.text[:300])
                return ClassificationResult(
                    nome_cientifico=None, nome_popular=None, descricao=None,
                    categoria_ameaca=None, confidence=0.0, method="openrouter",
                )

            data = resp.json()
            content = data["choices"][0]["message"]["content"]
            if isinstance(content, list):
                content = " ".join(
                    p.get("text", "") if isinstance(p, dict) else str(p)
                    for p in content
                )

            parsed = _parse_json_response(content)
            if parsed is None or not parsed.get("nome_cientifico"):
                return ClassificationResult(
                    nome_cientifico=None, nome_popular=None, descricao=None,
                    categoria_ameaca=None, confidence=0.0, method="openrouter",
                )

            return ClassificationResult(
                nome_cientifico=parsed["nome_cientifico"],
                nome_popular=parsed.get("nome_popular"),
                descricao=parsed.get("descricao"),
                categoria_ameaca=parsed.get("categoria_ameaca"),
                confidence=parsed.get("confianca", 0.5),
                method="openrouter",
            )

        except Exception as exc:
            logger.error("OpenRouter classification failed: %s", exc)
            return ClassificationResult(
                nome_cientifico=None, nome_popular=None, descricao=None,
                categoria_ameaca=None, confidence=0.0, method="openrouter",
            )


def _parse_json_response(text: str) -> Optional[dict]:
    """Parse JSON from a VLM response, tolerating markdown fences."""
    if not text:
        return None

    text = text.strip()

    # Strip markdown code fences
    if text.startswith("```"):
        lines = text.split("\n")
        lines = [l for l in lines if not l.strip().startswith("```")]
        text = "\n".join(lines).strip()

    # Try direct parse
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass

    # Try extracting JSON from text
    match = re.search(r'\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}', text, re.DOTALL)
    if match:
        try:
            return json.loads(match.group())
        except json.JSONDecodeError:
            pass

    return None
