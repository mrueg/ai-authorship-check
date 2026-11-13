import { existsSync } from "node:fs";
import path from "node:path";
import {
  AutoModelForSequenceClassification,
  AutoTokenizer,
  env,
  type PreTrainedModel,
  type PreTrainedTokenizer,
} from "@huggingface/transformers";

/**
 * Local AI-text classifier. Expects a transformers.js model directory:
 *
 *   <modelPath>/config.json
 *   <modelPath>/tokenizer.json, tokenizer_config.json, special_tokens_map.json
 *   <modelPath>/onnx/model_quantized.onnx   (int8), or onnx/model.onnx (fp32)
 *
 * The model must output a single logit per input (P(AI) = sigmoid(logit)),
 * as ShantanuT01/vanguard-ai-text-detector does.
 */
export class Classifier {
  private constructor(
    private readonly tokenizer: PreTrainedTokenizer,
    private readonly model: PreTrainedModel,
    private readonly maxTokens: number,
  ) {}

  static async load(modelPath: string, maxTokens: number): Promise<Classifier> {
    env.allowRemoteModels = false;
    env.allowLocalModels = true;
    const dir = path.resolve(modelPath);
    env.localModelPath = path.dirname(dir);
    const name = path.basename(dir);

    const tokenizer = await AutoTokenizer.from_pretrained(name, { local_files_only: true });
    // model/export.py ships fp32 when no int8 setting is accurate enough.
    const quantized = existsSync(path.join(dir, "onnx", "model_quantized.onnx"));
    const model = await AutoModelForSequenceClassification.from_pretrained(name, {
      local_files_only: true,
      dtype: quantized ? "q8" : "fp32",
      device: "cpu",
    });
    return new Classifier(tokenizer, model, maxTokens);
  }

  /** Returns P(AI) in [0, 1]. Text beyond maxTokens is truncated. */
  async classify(text: string): Promise<number> {
    const inputs = await this.tokenizer(text, { truncation: true, max_length: this.maxTokens });
    const { logits } = await this.model(inputs);
    const values = logits.data as Float32Array;
    if (values.length !== 1) {
      throw new Error(`Expected a single-logit model, got ${values.length} logits`);
    }
    return sigmoid(values[0]!);
  }

  async dispose(): Promise<void> {
    await this.model.dispose();
  }
}

export function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}
