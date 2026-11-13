"""Export a single-logit Hugging Face text classifier to ONNX, laid out for
transformers.js, and check it against the PyTorch original. Ships int8 if a
quantization setting keeps scores within MAX_INT8_DRIFT, otherwise fp32.

    python model/export.py --repo ShantanuT01/vanguard-ai-text-detector \
        --revision 823061be63b90f2b42f64ac1e1f82772e872533b --out model/out

Output:
    <out>/config.json, tokenizer.json, tokenizer_config.json, special_tokens_map.json
    <out>/onnx/model_quantized.onnx   (or onnx/model.onnx if no int8 setting is accurate enough)
    <out>/MODEL_INFO.json   (source repo, revision, quantization, sha256, export check results)

--tiny swaps the weights for a 3-layer random model with the same tokenizer,
so the full pipeline can be smoke-tested in a minute without the 1.6 GB download.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import shutil
import sys
from pathlib import Path

import numpy as np
import onnx
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

# ModernBERT mixes global attention with 128-token sliding-window (local) attention, and
# all texts above are far shorter than that window. One text of ~500 tokens makes the
# drift check cover the sliding-window masking the action relies on for long inputs.
LONG_TEXT = " ".join([
    "When I run the build in watch mode on Linux, the process exits after the first rebuild",
    "instead of watching. It worked on 2.3.0 and broke after upgrading to 2.4.1.",
    "I tried raising the inotify limit, clearing the cache and reinstalling, but nothing changed.",
    "This change refactors the loader so that configuration files are discovered once, validated",
    "against the schema, and cached for the lifetime of the process, which removes the repeated",
    "disk reads that showed up in the profile.",
] * 5)
CHECK_TEXTS.append(LONG_TEXT)

# int8 dynamic quantization shifts scores a little; larger drift means the
# quantized model would change verdicts and is not shipped.
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
    # Trace with the long text so sequence-length-dependent paths (sliding-window masks) are
    # traced for long inputs; the drift check below covers short ones too.
    sample = tokenizer(LONG_TEXT, return_tensors="pt")
    print(f"check texts: {[len(tokenizer(t)['input_ids']) for t in CHECK_TEXTS]} tokens", flush=True)
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

    ref = torch_probs(model, tokenizer, CHECK_TEXTS)
    p32 = onnx_probs(fp32, tokenizer, CHECK_TEXTS)
    fp32_drift = float(np.abs(p32 - ref).max())
    print(f"fp32 ONNX drift vs PyTorch: {fp32_drift:.2e}")
    if fp32_drift > MAX_FP32_DRIFT:
        sys.exit(f"ONNX export does not match PyTorch (drift {fp32_drift:.2e} > {MAX_FP32_DRIFT})")

    # Try int8 settings from smallest to most conservative; ship the first whose
    # scores stay within MAX_INT8_DRIFT of PyTorch, else ship fp32.
    matmuls = [n.name for n in onnx.load(str(fp32), load_external_data=False).graph.node if n.op_type == "MatMul"]
    head = [n for n in matmuls if re.search(r"head|classifier", n)]
    attention = [n for n in matmuls if re.search(r"attn|attention", n, re.I)]
    attempts = [
        ("all", dict()),
        ("matmul-per-channel", dict(op_types_to_quantize=["MatMul"], per_channel=True, nodes_to_exclude=head)),
        ("mlp-only-per-channel", dict(op_types_to_quantize=["MatMul"], per_channel=True,
                                      nodes_to_exclude=head + attention)),
    ]
    q8 = out / "onnx" / "model_quantized.onnx"
    chosen, drifts, scores = None, {}, {"torch": ref.round(4).tolist()}
    for name, opts in attempts:
        quantize_dynamic(str(fp32), str(q8), weight_type=QuantType.QInt8, **opts)
        p8 = onnx_probs(q8, tokenizer, CHECK_TEXTS)
        drifts[name] = float(np.abs(p8 - ref).max())
        scores[name] = p8.round(4).tolist()
        print(f"int8 '{name}': drift {drifts[name]:.4f}, {q8.stat().st_size / 1e6:.0f} MB", flush=True)
        if drifts[name] <= MAX_INT8_DRIFT:
            chosen = name
            break
        q8.unlink()

    print("P(AI)  " + "  ".join(f"{k[:18]:>18}" for k in scores) + "  text")
    for i, t in enumerate(CHECK_TEXTS):
        print("       " + "  ".join(f"{v[i]:>18.4f}" for v in scores.values()) + f"  {t[:50]}")

    if chosen:
        fp32.unlink()  # only the quantized model ships
        shipped, dtype = q8, "q8"
    else:
        print(f"no int8 setting stays within {MAX_INT8_DRIFT}; shipping fp32", flush=True)
        shipped, dtype = fp32, "fp32"

    info = {
        "repo": args.repo,
        "revision": args.revision,
        "tiny": args.tiny,
        "file": str(shipped.relative_to(out)),
        "dtype": dtype,
        "quantization": chosen,
        "sha256": sha256(shipped),
        "bytes": shipped.stat().st_size,
        "check": {"max_fp32_drift": fp32_drift, "max_int8_drift": drifts, "scores": scores},
    }
    (out / "MODEL_INFO.json").write_text(json.dumps(info, indent=2) + "\n")
    print(json.dumps({k: info[k] for k in ("file", "quantization", "sha256", "bytes")}))


if __name__ == "__main__":
    main()
