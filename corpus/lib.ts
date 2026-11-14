import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { TargetKind } from "../src/event.ts";

export { isEnglish } from "../src/language.ts";

/** The same four kinds of text the action judges. */
export type Kind = TargetKind;

export interface CorpusItem {
  id: string;
  label: "human" | "ai";
  kind: Kind;
  /** gharchive-pre2023 | gharchive-disclosed | generated */
  origin: string;
  created_at: string;
  repo: string;
  url: string;
  /** Issue/PR title; for comments the title of the parent issue/PR. */
  title: string;
  /** Parent body for comments, file path + diff hunk for review comments. */
  context: string;
  /** The judged text, raw (the eval applies the action's own preprocessing). */
  text: string;
  /** dev: tune thresholds on this. test: report final numbers on this only. */
  split: "dev" | "test";
  /** Generated items only. */
  generator?: string;
  style?: string;
  pair_of?: string;
}

/** Parses a JSON-lines file, skipping blank lines. */
export function readJsonl<T>(file: string): T[] {
  return readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as T);
}

/** Split by repository, so near-duplicate text from one repo never spans dev and test. */
export function splitFor(repo: string): "dev" | "test" {
  const byte = createHash("sha256").update(repo.toLowerCase()).digest()[0]!;
  return byte % 2 === 0 ? "dev" : "test";
}

export function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle<T>(xs: T[], rand: () => number): T[] {
  for (let i = xs.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [xs[i], xs[j]] = [xs[j]!, xs[i]!];
  }
  return xs;
}
