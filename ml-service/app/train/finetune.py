"""Fine-tune Qwen2-VL-2B with QLoRA for camera trap species classification.

Uses 4-bit quantization + LoRA adapters to fit in 8GB VRAM (RTX 4060).
The model learns to classify Brazilian fauna from camera trap photos
using the Wildlife Insights labeled dataset.

Usage:
    python -m app.train.finetune \
        --dataset-dir /data/dataset \
        --output-dir /models/qwen2vl-finetuned \
        --epochs 3 \
        --batch-size 2 \
        --grad-accum 8

After training, merge the LoRA adapter into the base model:
    python -m app.train.finetune --merge --adapter-dir /models/qwen2vl-finetuned \
        --output-dir /models/qwen2vl-merged
"""

import argparse
import json
import logging
import os
from pathlib import Path
from typing import Optional

import torch
from torch.utils.data import Dataset

logger = logging.getLogger(__name__)

# The prompt used during training and inference
TRAIN_PROMPT = (
    "You are a wildlife biologist. Look at this camera trap photo from Brazil "
    "and identify the animal species. "
    "Respond with ONLY a JSON object: "
    '{"nome_cientifico": "genus species", "nome_popular": "common name", "confianca": 0.0 to 1.0}'
)

MODEL_ID = "Qwen/Qwen2-VL-2B-Instruct"


class CameraTrapDataset(Dataset):
    """Dataset for Qwen2-VL fine-tuning from JSONL files."""

    def __init__(self, jsonl_path: str, processor, max_samples: int = 0):
        self.records = []
        with open(jsonl_path, "r", encoding="utf-8") as f:
            for line in f:
                self.records.append(json.loads(line))
        if max_samples > 0:
            self.records = self.records[:max_samples]
        self.processor = processor

        # Confidence per species: more training examples -> higher base confidence.
        # This teaches the model to express higher confidence for well-represented species.
        from collections import Counter
        counts = Counter(r["scientific"] for r in self.records)
        max_count = max(counts.values()) if counts else 1
        min_count = min(counts.values()) if counts else 1
        self.confidence = {}
        for sp, n in counts.items():
            # Scale 0.70 to 0.99 based on relative sample count
            if max_count == min_count:
                self.confidence[sp] = 0.90
            else:
                ratio = (n - min_count) / (max_count - min_count)
                self.confidence[sp] = 0.70 + 0.29 * ratio

    def __len__(self):
        return len(self.records)

    def __getitem__(self, idx):
        record = self.records[idx]
        from PIL import Image
        image = Image.open(record["image_path"]).convert("RGB")

        # Target response: JSON with species info + confidence
        target = json.dumps({
            "nome_cientifico": record["scientific"],
            "nome_popular": record["common_name"],
            "confianca": round(self.confidence.get(record["scientific"], 0.85), 2),
        }, ensure_ascii=False)

        # Build conversation for Qwen2-VL
        messages = [
            {
                "role": "user",
                "content": [
                    {"type": "image", "image": image},
                    {"type": "text", "text": TRAIN_PROMPT},
                ],
            },
            {
                "role": "assistant",
                "content": [{"type": "text", "text": target}],
            },
        ]

        return messages


def finetune(
    dataset_dir: str,
    output_dir: str,
    epochs: int = 5,
    batch_size: int = 1,
    grad_accum: int = 4,
    lr: float = 2e-4,
    lora_r: int = 16,
    lora_alpha: int = 32,
    max_samples: int = 0,
):
    """Fine-tune Qwen2-VL-2B with QLoRA.

    Args:
        dataset_dir: directory with train.jsonl, val.jsonl, images/
        output_dir: where to save the LoRA adapter
        epochs: number of training epochs
        batch_size: micro-batch size (2 for 8GB VRAM)
        grad_accum: gradient accumulation steps (effective batch = batch_size * grad_accum)
        lr: learning rate for LoRA
        lora_r: LoRA rank
        lora_alpha: LoRA alpha
        max_samples: limit total samples (0 = all)
    """
    from transformers import (
        Qwen2VLForConditionalGeneration,
        AutoProcessor,
        BitsAndBytesConfig,
        TrainingArguments,
        Trainer,
    )
    from peft import LoraConfig, get_peft_model, prepare_model_for_kbit_training
    from qwen_vl_utils import process_vision_info

    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    dataset_dir = Path(dataset_dir)

    logger.info("Loading model %s with 4-bit quantization", MODEL_ID)

    bnb_config = BitsAndBytesConfig(
        load_in_4bit=True,
        bnb_4bit_quant_type="nf4",
        bnb_4bit_compute_dtype=torch.bfloat16,
        bnb_4bit_use_double_quant=True,
    )

    model = Qwen2VLForConditionalGeneration.from_pretrained(
        MODEL_ID,
        quantization_config=bnb_config,
        device_map="auto",
        torch_dtype=torch.bfloat16,
    )

    model = prepare_model_for_kbit_training(model)

    # LoRA config — attention and MLP projections only.
    # r=16 keeps trainable params ~18M and is safer for 8GB VRAM.
    lora_config = LoraConfig(
        r=lora_r,
        lora_alpha=lora_alpha,
        lora_dropout=0.05,
        bias="none",
        task_type="CAUSAL_LM",
        target_modules=[
            "q_proj", "k_proj", "v_proj", "o_proj",
            "gate_proj", "up_proj", "down_proj",
        ],
    )

    model = get_peft_model(model, lora_config)
    model.print_trainable_parameters()

    processor = AutoProcessor.from_pretrained(
        MODEL_ID,
        # Force smaller resolution to fit 8GB VRAM and avoid OOM on first pass.
        # 500px images are resized to ~420x420 -> ~225 patches, much faster.
        max_pixels=28 * 28 * 420,
        min_pixels=224 * 28 * 28,
    )

    # Load datasets
    train_dataset = CameraTrapDataset(
        str(dataset_dir / "train.jsonl"), processor, max_samples
    )
    val_dataset = CameraTrapDataset(
        str(dataset_dir / "val.jsonl"), processor, max_samples
    )

    logger.info("Train: %d samples, Val: %d samples",
                len(train_dataset), len(val_dataset))

    # Custom collator for Qwen2-VL
    def collate_fn(batch):
        """Collate messages into model inputs using qwen_vl_utils."""
        from qwen_vl_utils import process_vision_info

        texts = []
        for messages in batch:
            text = processor.apply_chat_template(
                messages, tokenize=False, add_generation_prompt=False
            )
            texts.append(text)

        # process_vision_info extracts images from the message format
        image_inputs, video_inputs = process_vision_info(batch)

        batch_inputs = processor(
            text=texts,
            images=image_inputs,
            videos=video_inputs,
            padding=True,
            return_tensors="pt",
        )

        # Labels = input_ids (model learns to generate the assistant response)
        labels = batch_inputs["input_ids"].clone()
        # Mask padding tokens
        labels[labels == processor.tokenizer.pad_token_id] = -100
        batch_inputs["labels"] = labels

        return batch_inputs

    # Training arguments
    training_args = TrainingArguments(
        output_dir=str(output_dir),
        num_train_epochs=epochs,
        per_device_train_batch_size=batch_size,
        per_device_eval_batch_size=batch_size,
        gradient_accumulation_steps=grad_accum,
        learning_rate=lr,
        warmup_steps=50,
        lr_scheduler_type="cosine",
        logging_steps=10,
        eval_strategy="epoch",
        save_strategy="epoch",
        save_total_limit=2,
        bf16=True,
        gradient_checkpointing=True,
        gradient_checkpointing_kwargs={"use_reentrant": False},
        optim="adamw_torch",
        report_to="none",
        remove_unused_columns=False,
        dataloader_num_workers=0,
    )

    trainer = Trainer(
        model=model,
        args=training_args,
        train_dataset=train_dataset,
        eval_dataset=val_dataset,
        data_collator=collate_fn,
    )

    logger.info("Starting training...")
    trainer.train()

    # Save LoRA adapter
    model.save_pretrained(str(output_dir / "adapter"))
    processor.save_pretrained(str(output_dir / "adapter"))
    logger.info("LoRA adapter saved to %s/adapter", output_dir)


def merge_adapter(adapter_dir: str, output_dir: str):
    """Merge LoRA adapter into base model for standalone deployment."""
    from transformers import Qwen2VLForConditionalGeneration, AutoProcessor
    from peft import PeftModel

    logger.info("Loading base model %s", MODEL_ID)
    base_model = Qwen2VLForConditionalGeneration.from_pretrained(
        MODEL_ID,
        torch_dtype=torch.bfloat16,
        device_map="auto",
    )

    logger.info("Loading adapter from %s", adapter_dir)
    model = PeftModel.from_pretrained(base_model, adapter_dir)
    model = model.merge_and_unload()

    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    model.save_pretrained(str(output_dir))
    processor = AutoProcessor.from_pretrained(adapter_dir)
    processor.save_pretrained(str(output_dir))
    logger.info("Merged model saved to %s", output_dir)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")

    parser = argparse.ArgumentParser(description="Fine-tune Qwen2-VL-2B")
    sub = parser.add_subparsers(dest="command")

    # Train
    train_p = sub.add_parser("train", help="Fine-tune with QLoRA")
    train_p.add_argument("--dataset-dir", required=True)
    train_p.add_argument("--output-dir", required=True)
    train_p.add_argument("--epochs", type=int, default=5)
    train_p.add_argument("--batch-size", type=int, default=1)
    train_p.add_argument("--grad-accum", type=int, default=8)
    train_p.add_argument("--lr", type=float, default=2e-4)
    train_p.add_argument("--lora-r", type=int, default=16)
    train_p.add_argument("--lora-alpha", type=int, default=32)
    train_p.add_argument("--max-samples", type=int, default=0)

    # Merge
    merge_p = sub.add_parser("merge", help="Merge LoRA adapter into base model")
    merge_p.add_argument("--adapter-dir", required=True)
    merge_p.add_argument("--output-dir", required=True)

    args = parser.parse_args()

    if args.command == "train":
        finetune(
            dataset_dir=args.dataset_dir,
            output_dir=args.output_dir,
            epochs=args.epochs,
            batch_size=args.batch_size,
            grad_accum=args.grad_accum,
            lr=args.lr,
            lora_r=args.lora_r,
            lora_alpha=args.lora_alpha,
            max_samples=args.max_samples,
        )
    elif args.command == "merge":
        merge_adapter(args.adapter_dir, args.output_dir)
    else:
        parser.print_help()
