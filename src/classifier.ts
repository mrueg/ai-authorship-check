import { existsSync } from "node:fs";
import path from "node:path";
import {
  AutoModelForSequenceClassification,
  AutoTokenizer,
  env,
  type PreTrainedModel,
  type PreTrainedTokenizer,
} from "@huggingface/transformers";
import { chunkIds, MAX_CHUNKS, weightedMean, type LongText } from "./chunks.ts";

export interface Score {
  /** P(AI) in [0, 1]. */
  pAi: number;
  /** Tokens in the text, without special tokens. */
  tokens: number;
  /** Model inputs scored: 1 unless long-text is "chunks" and the text is long. */
  chunks: number;
  /** Whether part of the text was never read. */
  truncated: boolean;
}

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

  /**
   * Scores a text. With "truncate", only the first maxTokens tokens are read.
   * With "chunks", a longer text is split into up to MAX_CHUNKS pieces of at
   * most maxTokens tokens, and P(AI) is their length-weighted mean.
   */
  async classify(text: string, longText: LongText = "truncate"): Promise<Score> {
    const ids = this.tokenizer.encode(text, { add_special_tokens: false });
    // Room for the special tokens ([CLS], [SEP]) the tokenizer adds around each input.
    const window = this.maxTokens - this.tokenizer.encode("").length;
    if (longText === "truncate" || ids.length <= window) {
      return { pAi: await this.score(text), tokens: ids.length, chunks: 1, truncated: ids.length > window };
    }
    const chunks = chunkIds(ids, window);
    const scores: number[] = [];
    for (const chunk of chunks) scores.push(await this.score(this.tokenizer.decode(chunk)));
    return {
      pAi: weightedMean(scores, chunks.map((c) => c.length)),
      tokens: ids.length,
      chunks: chunks.length,
      truncated: ids.length > window * MAX_CHUNKS,
    };
  }

  /** P(AI) in [0, 1] for one model input; anything beyond maxTokens is cut off. */
  private async score(text: string): Promise<number> {
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
