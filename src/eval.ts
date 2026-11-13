/**
 * Measures the classifier on a labeled JSONL file to pick the two thresholds.
 *
 *   node dist/eval.js <data.jsonl> [--split dev|test] [--model <path>] [--scores <out.jsonl>]
 *
 * Each line: {"text": "...", "label": "human" | "ai"}, optionally with the
 * corpus fields split, origin, kind, style and generator (see corpus/).
 * Tune thresholds on --split dev; report final numbers on --split test.
 *
 * Reports AUROC, then one table per threshold:
 *   ai-threshold:    precision/recall of 🚀 and the share of real people who would get 🚀
 *   human-threshold: precision/recall of ❤️ and the share of AI texts that would get ❤️
 */
import { readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { Classifier } from "./classifier.ts";
import { preprocess } from "./preprocess.ts";

interface Row {
  id?: string;
  text: string;
  label: "human" | "ai";
  split?: string;
  origin?: string;
  kind?: string;
  style?: string;
  generator?: string;
}

export interface Scored {
  pAi: number;
  ai: boolean;
}

export function auroc(scored: Scored[]): number {
  const pos = scored.filter((s) => s.ai).map((s) => s.pAi);
  const neg = scored.filter((s) => !s.ai).map((s) => s.pAi);
  if (pos.length === 0 || neg.length === 0) return NaN;
  let wins = 0;
  for (const p of pos) for (const n of neg) wins += p > n ? 1 : p === n ? 0.5 : 0;
  return wins / (pos.length * neg.length);
}

export function metricsAt(scored: Scored[], threshold: number) {
  let tp = 0, fp = 0, fn = 0, tn = 0;
  for (const s of scored) {
    const predAi = s.pAi >= threshold;
    if (predAi && s.ai) tp++;
    else if (predAi) fp++;
    else if (s.ai) fn++;
    else tn++;
  }
  const precision = tp + fp ? tp / (tp + fp) : NaN;
  const recall = tp + fn ? tp / (tp + fn) : NaN;
  const humanFpr = fp + tn ? fp / (fp + tn) : NaN;
  return { threshold, precision, recall, humanFpr, tp, fp, fn, tn };
}

/** ❤️ band: P(AI) < threshold. "Positive" here means human. */
export function humanMetricsAt(scored: Scored[], threshold: number) {
  let tp = 0, fp = 0, fn = 0;
  for (const s of scored) {
    const predHuman = s.pAi < threshold;
    if (predHuman && !s.ai) tp++;
    else if (predHuman) fp++;
    else if (!s.ai) fn++;
  }
  const aiTotal = scored.filter((s) => s.ai).length;
  return {
    threshold,
    precision: tp + fp ? tp / (tp + fp) : NaN,
    recall: tp + fn ? tp / (tp + fn) : NaN,
    aiFnr: aiTotal ? fp / aiTotal : NaN,
  };
}

/** Per-slice share of each verdict at the given thresholds. */
export function sliceTable(rows: Row[], scored: Scored[], key: keyof Row, humanT: number, aiT: number): string[] {
  const groups = new Map<string, number[]>();
  rows.forEach((r, i) => {
    const k = `${r.label}/${r[key] ?? "-"}`;
    groups.set(k, [...(groups.get(k) ?? []), scored[i]!.pAi]);
  });
  return [...groups.entries()].sort().map(([k, ps]) => {
    const share = (f: (p: number) => boolean) => ((100 * ps.filter(f).length) / ps.length).toFixed(0).padStart(4) + "%";
    const mean = ps.reduce((a, b) => a + b, 0) / ps.length;
    return [k.padEnd(36), String(ps.length).padStart(5), mean.toFixed(3).padStart(7),
      share((p) => p < humanT), share((p) => p >= humanT && p < aiT), share((p) => p >= aiT)].join("  ");
  });
}

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      split: { type: "string" },
      model: { type: "string", default: process.env.AI_AUTHORSHIP_CHECK_MODEL_PATH ?? "/model" },
      scores: { type: "string" },
      "human-threshold": { type: "string", default: "0.3" },
      "ai-threshold": { type: "string", default: "0.8" },
    },
  });
  const file = positionals[0];
  if (!file) throw new Error("usage: node dist/eval.js <data.jsonl> [--split dev|test] [--model <path>] [--scores <out.jsonl>]");

  const rows: Row[] = readFileSync(file, "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as Row)
    .filter((r) => !values.split || r.split === values.split);

  const classifier = await Classifier.load(values.model!, 2048);
  const scored: Scored[] = [];
  const started = Date.now();
  for (const [i, row] of rows.entries()) {
    scored.push({ pAi: await classifier.classify(preprocess(row.text)), ai: row.label === "ai" });
    if ((i + 1) % 100 === 0) process.stderr.write(`${i + 1}/${rows.length}\n`);
  }
  await classifier.dispose();
  if (values.scores) {
    writeFileSync(values.scores, rows.map((r, i) => JSON.stringify({ ...r, p_ai: scored[i]!.pAi })).join("\n") + "\n");
  }

  const ms = (Date.now() - started) / rows.length;
  console.log(`${rows.length} rows, ${ms.toFixed(0)} ms/row, AUROC ${auroc(scored).toFixed(4)}\n`);
  console.log("ai-threshold (🚀 when P(AI) >= t)");
  console.log("threshold  precision  recall  human-FPR    tp    fp    fn    tn");
  for (const t of [0.5, 0.6, 0.7, 0.8, 0.85, 0.9, 0.95, 0.99]) {
    const m = metricsAt(scored, t);
    console.log(
      [t.toFixed(2).padStart(9), m.precision.toFixed(3).padStart(10), m.recall.toFixed(3).padStart(7),
        m.humanFpr.toFixed(3).padStart(10), ...[m.tp, m.fp, m.fn, m.tn].map((n) => String(n).padStart(5))].join(" "),
    );
  }

  console.log("\nhuman-threshold (❤️ when P(AI) < t)");
  console.log("threshold  precision  recall  AI-as-human");
  for (const t of [0.05, 0.1, 0.2, 0.3, 0.4, 0.5]) {
    const m = humanMetricsAt(scored, t);
    console.log([t.toFixed(2).padStart(9), m.precision.toFixed(3).padStart(10), m.recall.toFixed(3).padStart(7),
      m.aiFnr.toFixed(3).padStart(12)].join(" "));
  }

  const humanT = Number(values["human-threshold"]), aiT = Number(values["ai-threshold"]);
  for (const key of ["origin", "kind", "style", "generator"] as const) {
    if (!rows.some((r) => r[key])) continue;
    console.log(`\nby ${key} (thresholds ${humanT} / ${aiT})`);
    console.log(`${"label/" + key}`.padEnd(36) + "      n   mean     ❤️      👀      🚀");
    for (const line of sliceTable(rows, scored, key, humanT, aiT)) console.log(line);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
}
