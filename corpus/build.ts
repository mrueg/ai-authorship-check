/**
 * Merges the collected and generated parts into corpus/data/corpus.jsonl and
 * prints a summary.
 *
 *   node corpus/build.ts
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import type { CorpusItem } from "./lib.ts";

const DATA = new URL("./data/", import.meta.url).pathname;
const PARTS = ["human.jsonl", "wild-ai.jsonl", "generated.jsonl"];

const items: CorpusItem[] = [];
for (const part of PARTS) {
  if (!existsSync(DATA + part)) {
    console.error(`skipping missing ${part}`);
    continue;
  }
  items.push(...readFileSync(DATA + part, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as CorpusItem));
}

const ids = new Set<string>();
for (const it of items) {
  if (ids.has(it.id)) throw new Error(`duplicate id ${it.id}`);
  ids.add(it.id);
}

writeFileSync(DATA + "corpus.jsonl", items.map((i) => JSON.stringify(i)).join("\n") + "\n");

const count = (f: (i: CorpusItem) => string) => {
  const m = new Map<string, number>();
  for (const i of items) m.set(f(i), (m.get(f(i)) ?? 0) + 1);
  return [...m.entries()].sort();
};
console.log(`corpus.jsonl: ${items.length} items\n`);
for (const [title, f] of [
  ["label / origin / split", (i: CorpusItem) => `${i.label.padEnd(6)} ${i.origin.padEnd(20)} ${i.split}`],
  ["label / kind", (i: CorpusItem) => `${i.label.padEnd(6)} ${i.kind}`],
  ["generated: style / generator", (i: CorpusItem) => (i.origin === "generated" ? `${i.style} / ${i.generator}` : "")],
] as const) {
  console.log(title);
  for (const [k, n] of count(f)) if (k) console.log(`  ${k.padEnd(44)} ${n}`);
  console.log();
}
