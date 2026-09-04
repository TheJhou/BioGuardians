"""Measure VRAM usage during model load and forward pass."""
import os, sys, json
sys.path.insert(0, "/app")
os.environ["LOCAL_VLM_PATH"] = "/models/qwen2vl-finetuned/adapter"
os.environ["YOLO_DEVICE"] = "cuda"
os.environ["DATABASE_URL"] = "postgresql://dummy:dummy@localhost/dummy"

import torch
from transformers import Qwen2VLForConditionalGeneration, AutoProcessor, BitsAndBytesConfig
from peft import LoraConfig, get_peft_model, prepare_model_for_kbit_training

def vram_mb():
    free, total = torch.cuda.mem_get_info()
    used = total - free
    return used / 1e6, free / 1e6, total / 1e6

print(f"Before load: used={vram_mb()[0]:.0f}MB free={vram_mb()[1]:.0f}MB total={vram_mb()[2]:.0f}MB")

bnb = BitsAndBytesConfig(
    load_in_4bit=True, bnb_4bit_quant_type="nf4",
    bnb_4bit_compute_dtype=torch.bfloat16, bnb_4bit_use_double_quant=True,
)
model = Qwen2VLForConditionalGeneration.from_pretrained(
    "Qwen/Qwen2-VL-2B-Instruct", quantization_config=bnb,
    device_map="auto", torch_dtype=torch.bfloat16,
)
model = prepare_model_for_kbit_training(model)

print(f"After 4-bit load: used={vram_mb()[0]:.0f}MB free={vram_mb()[1]:.0f}MB")

# LoRA r=16
cfg16 = LoraConfig(r=16, lora_alpha=32, lora_dropout=0.05, bias="none",
    task_type="CAUSAL_LM",
    target_modules=["q_proj","k_proj","v_proj","o_proj","gate_proj","up_proj","down_proj"])
m16 = get_peft_model(model, cfg16)
m16.print_trainable_parameters()
print(f"After LoRA r=16: used={vram_mb()[0]:.0f}MB free={vram_mb()[1]:.0f}MB")

# Simulate training tensors (batch=1, seq~512, bf16)
dummy_hidden = torch.randn(1, 512, 1536, dtype=torch.bfloat16, device="cuda")
print(f"After dummy tensor: used={vram_mb()[0]:.0f}MB free={vram_mb()[1]:.0f}MB")

# Try batch=2
dummy2 = torch.randn(2, 512, 1536, dtype=torch.bfloat16, device="cuda")
print(f"After batch=2 tensor: used={vram_mb()[0]:.0f}MB free={vram_mb()[1]:.0f}MB")
del dummy2, dummy_hidden
torch.cuda.empty_cache()
print(f"After cleanup: used={vram_mb()[0]:.0f}MB free={vram_mb()[1]:.0f}MB")
