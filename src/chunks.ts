/**
 * Splitting long texts for `long-text: chunks`. Kept free of transformers.js so
 * it can be unit-tested without a model.
 */

export type LongText = "truncate" | "chunks";

/** Upper bound on chunks per text, so one huge PR description can't stall the run. */
export const MAX_CHUNKS = 4;

/**
 * Splits token ids into at most `maxChunks` consecutive chunks of at most
 * `window` ids each, sized evenly so the last chunk isn't a tiny remainder.
 * Ids beyond `window * maxChunks` are dropped.
 */
export function chunkIds<T>(ids: readonly T[], window: number, maxChunks = MAX_CHUNKS): T[][] {
  if (window < 1) throw new Error(`window must be at least 1, got ${window}`);
  const kept = ids.slice(0, window * maxChunks);
  if (kept.length === 0) return [];
  const count = Math.ceil(kept.length / window);
  const size = Math.ceil(kept.length / count);
  const chunks: T[][] = [];
  for (let i = 0; i < kept.length; i += size) chunks.push(kept.slice(i, i + size));
  return chunks;
}

/** Mean of `values` weighted by `weights` (chunk lengths). */
export function weightedMean(values: readonly number[], weights: readonly number[]): number {
  if (values.length === 0 || values.length !== weights.length) {
    throw new Error(`need matching, non-empty values and weights (${values.length} vs ${weights.length})`);
  }
  let sum = 0, total = 0;
  values.forEach((v, i) => {
    sum += v * weights[i]!;
    total += weights[i]!;
  });
  return sum / total;
}
