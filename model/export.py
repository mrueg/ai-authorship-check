"""Export a single-logit Hugging Face text classifier to an int8 ONNX model
laid out for transformers.js, and check it against the PyTorch original.

    python model/export.py --repo ShantanuT01/vanguard-ai-text-detector \
        --revision 823061be63b90f2b42f64ac1e1f82772e872533b --out model/out

Output:
    <out>/config.json, tokenizer.json, tokenizer_config.json, special_tokens_map.json
    <out>/onnx/model_quantized.onnx
    <out>/MODEL_INFO.json   (source repo, revision, sha256, export check results)

--tiny swaps the weights for a 2-layer random model with the same tokenizer,
so the full pipeline can be smoke-tested in a minute without the 1.6 GB download.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import sys
from pathlib import Path

import numpy as np
import onnxruntime as ort
import torch
from huggingface_hub import snapshot_download
from onnxruntime.quantization import QuantType, quantize_dynamic
from transformers import AutoConfig, AutoModelForSequenceClassification, AutoTokenizer

TOKENIZER_FILES = ["tokenizer.json", "tokenizer_config.json", "special_tokens_map.json"]

# Mixed human / AI-sounding samples, used only to compare PyTorch and ONNX outputs.
CHECK_TEXTS = [
    "it crashes when i run it with --verbose, works fine without. linux, v2.3.1",
    "Thanks for the report! I can reproduce this on main, looks like the cache key ignores the arch.",
    "Great question! Here's a comprehensive overview of the issue and a step-by-step solution to resolve it.",
    "I hope this helps! Let me know if you have any further questions or need additional clarification.",
    "nit: this could be a const",
    "This pull request introduces several enhancements to improve the robustness, maintainability, "
    "and overall developer experience of the configuration loading module.",
]

# int8 dynamic quantization shifts scores a little; larger drift means the
# quantized model would change verdicts and must not ship.
MAX_INT8_DRIFT = 0.10
MAX_FP32_DRIFT = 1e-3


def sigmoid(x: np.ndarray) -> np.ndarray:
    return 1.0 / (1.0 + np.exp(-x))


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def load_model(src: Path, tiny: bool) -> torch.nn.Module:
    if tiny:
        d = AutoConfig.from_pretrained(src).to_dict()
        d.update(hidden_size=64, intermediate_size=128, num_hidden_layers=3,
                 num_attention_heads=4, global_attn_every_n_layers=3, local_attention=16)
        d.pop("layer_types", None)  # derived from num_hidden_layers on init
        cfg = AutoConfig.for_model(d.pop("model_type"), **d)
        torch.manual_seed(0)
        model = AutoModelForSequenceClassification.from_config(cfg)
    else:
        model = AutoModelForSequenceClassification.from_pretrained(src, attn_implementation="eager")
    model.config.reference_compile = False  # no torch.compile during tracing
    model.config._attn_implementation = "eager"
    if model.config.num_labels != 1:
        sys.exit(f"expected a single-logit classifier, got num_labels={model.config.num_labels}")
    return model.eval()


def torch_probs(model, tokenizer, texts: list[str]) -> np.ndarray:
    out = []
    with torch.no_grad():
        for t in texts:
            enc = tokenizer(t, return_tensors="pt")
            out.append(sigmoid(model(**enc).logits[0, 0].numpy()))
    return np.array(out)


def onnx_probs(path: Path, tokenizer, texts: list[str]) -> np.ndarray:
    sess = ort.InferenceSession(str(path), providers=["CPUExecutionProvider"])
    names = {i.name for i in sess.get_inputs()}
    out = []
    for t in texts:
        enc = tokenizer(t, return_tensors="np")
        feeds = {k: v.astype(np.int64) for k, v in enc.items() if k in names}
        out.append(sigmoid(sess.run(["logits"], feeds)[0][0, 0]))
    return np.array(out)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--repo", required=True)
    ap.add_argument("--revision", required=True, help="exact commit sha, never a branch")
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--tiny", action="store_true", help="random 3-layer model for smoke tests")
    args = ap.parse_args()

    if len(args.revision) != 40:
        sys.exit("--revision must be a full 40-character commit sha")

    patterns = ["config.json", *TOKENIZER_FILES] + ([] if args.tiny else ["model.safetensors"])
    src = Path(snapshot_download(args.repo, revision=args.revision, allow_patterns=patterns))

    out: Path = args.out
    shutil.rmtree(out, ignore_errors=True)
    (out / "onnx").mkdir(parents=True)

    tokenizer = AutoTokenizer.from_pretrained(src)
    model = load_model(src, args.tiny)
    model.config.save_pretrained(out)
    for name in TOKENIZER_FILES:
        shutil.copy(src / name, out / name)

    fp32 = out / "onnx" / "model.onnx"
    sample = tokenizer(CHECK_TEXTS[0], return_tensors="pt")
    print(f"exporting {args.repo}@{args.revision[:12]}{' (tiny)' if args.tiny else ''} ...", flush=True)
    torch.onnx.export(
        model,
        (sample["input_ids"], sample["attention_mask"]),
        str(fp32),
        input_names=["input_ids", "attention_mask"],
        output_names=["logits"],
        dynamic_axes={"input_ids": {0: "batch", 1: "seq"}, "attention_mask": {0: "batch", 1: "seq"},
                      "logits": {0: "batch"}},
        opset_version=17,
        dynamo=False,
    )

    q8 = out / "onnx" / "model_quantized.onnx"
    print("quantizing to int8 ...", flush=True)
    quantize_dynamic(str(fp32), str(q8), weight_type=QuantType.QInt8)

    ref = torch_probs(model, tokenizer, CHECK_TEXTS)
    p32 = onnx_probs(fp32, tokenizer, CHECK_TEXTS)
    p8 = onnx_probs(q8, tokenizer, CHECK_TEXTS)
    fp32_drift = float(np.abs(p32 - ref).max())
    int8_drift = float(np.abs(p8 - ref).max())
    print("P(AI)  torch    onnx-fp32  onnx-int8  text")
    for t, a, b, c in zip(CHECK_TEXTS, ref, p32, p8):
        print(f"       {a:.4f}   {b:.4f}     {c:.4f}     {t[:60]}")
    print(f"max drift: fp32 {fp32_drift:.2e}, int8 {int8_drift:.4f}")

    fp32.unlink()  # only the quantized model ships
    info = {
        "repo": args.repo,
        "revision": args.revision,
        "tiny": args.tiny,
        "file": "onnx/model_quantized.onnx",
        "sha256": sha256(q8),
        "bytes": q8.stat().st_size,
        "check": {"max_fp32_drift": fp32_drift, "max_int8_drift": int8_drift,
                  "torch": ref.round(4).tolist(), "int8": p8.round(4).tolist()},
    }
    (out / "MODEL_INFO.json").write_text(json.dumps(info, indent=2) + "\n")
    print(json.dumps({k: info[k] for k in ("sha256", "bytes")}))

    if fp32_drift > MAX_FP32_DRIFT:
        sys.exit(f"ONNX export does not match PyTorch (drift {fp32_drift:.2e} > {MAX_FP32_DRIFT})")
    if int8_drift > MAX_INT8_DRIFT:
        sys.exit(f"int8 model drifts too far from PyTorch ({int8_drift:.4f} > {MAX_INT8_DRIFT})")


if __name__ == "__main__":
    main()
