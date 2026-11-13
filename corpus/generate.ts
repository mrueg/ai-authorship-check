/**
 * Generates AI-written counterparts for human corpus items with the Copilot CLI.
 *
 *   node corpus/generate.ts --models claude-haiku-5.5,gpt-6-luna --limit 600 [--concurrency 4] [--dry-run]
 *
 * For each sampled human item it writes one AI item for the same context
 * (repo, title, parent post or diff), cycling through three styles:
 *
 *   scratch  the assistant writes the issue/PR/comment from the context alone
 *   casual   same, but told to sound like a busy developer (no headings, no pleasantries)
 *   rewrite  the assistant "improves" the human draft: the AI-edited hard case
 *
 * and through the given models, so every model covers every style and kind.
 * Copilot runs with all tools disabled in an empty directory. Output is appended
 * to corpus/data/generated.jsonl; reruns skip items already generated.
 */
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { parseArgs } from "node:util";
import { preprocess } from "../src/preprocess.ts";
import { findSignature } from "../src/signatures.ts";
import { mulberry32, shuffle, type CorpusItem } from "./lib.ts";

const run = promisify(execFile);
const DATA = new URL("./data/", import.meta.url).pathname;
export const STYLES = ["scratch", "casual", "rewrite"] as const;
type Style = (typeof STYLES)[number];

const NOUN: Record<CorpusItem["kind"], string> = {
  issue: "issue description",
  pull_request: "pull request description",
  issue_comment: "comment",
  review_comment: "review comment",
};

export function buildPrompt(item: CorpusItem, style: Style): string {
  const noun = NOUN[item.kind];
  const situation = {
    issue: `I'm opening an issue in the GitHub repository ${item.repo}, titled "${item.title}".`,
    pull_request: `I'm opening a pull request in the GitHub repository ${item.repo}, titled "${item.title}".`,
    issue_comment:
      `I'm replying in a GitHub thread in ${item.repo} titled "${item.title}". The original post:\n` +
      `<post>\n${item.context || "(no description)"}\n</post>`,
    review_comment:
      `I'm reviewing a pull request in ${item.repo} titled "${item.title}" and want to leave a comment on this change:\n` +
      `<diff>\n${item.context}\n</diff>`,
  }[item.kind];

  const task = {
    scratch: `Write the ${noun} for me.`,
    casual:
      `Write the ${noun} for me the way a busy developer would type it: short, plain and informal, ` +
      `no headings, no bullet lists, no greeting or sign-off.`,
    rewrite:
      `Here is my draft ${noun}:\n<draft>\n${item.text}\n</draft>\n` +
      `Improve it so it is clear and well written before I post it. Keep what it says.`,
  }[style];

  return `${situation}\n\n${task}\n\nReply with only the text to post on GitHub, nothing else.`;
}

/** Strips wrappers models add around the answer. Returns undefined for unusable output. */
export function cleanOutput(raw: string): string | undefined {
  let text = raw.replace(/\r\n?/g, "\n").trim();
  const fenced = text.match(/^```[a-z]*\n([\s\S]*?)\n```$/i);
  if (fenced) text = fenced[1]!.trim();
  text = text.replace(/^(?:here(?:'s| is)|sure|certainly)[^\n]{0,80}:\s*\n+/i, "");
  if (/^<(draft|post)>/.test(text)) text = text.replace(/^<\w+>\n?|\n?<\/\w+>$/g, "").trim();
  if (preprocess(text).length < 40) return undefined;
  if (/\b(I can(?:'|no)t help|I'm unable to|as an AI)\b/i.test(text.slice(0, 200))) return undefined;
  return text;
}

async function copilot(prompt: string, model: string): Promise<string> {
  const cwd = mkdtempSync(path.join(tmpdir(), "corpus-gen-"));
  const { stdout } = await run(
    "copilot",
    [
      "-p", prompt, "-s",
      "--model", model,
      "--available-tools", "none",
      "--no-custom-instructions", "--disable-builtin-mcps", "--no-ask-user", "--no-auto-update",
    ],
    { cwd, timeout: 180_000, maxBuffer: 4 << 20, env: { ...process.env, COPILOT_AUTO_UPDATE: "false" } },
  );
  return stdout;
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      models: { type: "string" },
      limit: { type: "string", default: "600" },
      concurrency: { type: "string", default: "4" },
      "dry-run": { type: "boolean", default: false },
    },
  });
  const models = (values.models ?? "").split(",").map((m) => m.trim()).filter(Boolean);
  if (!models.length) throw new Error("--models is required, e.g. --models claude-haiku-5.5,gpt-6-luna");

  const human: CorpusItem[] = readFileSync(`${DATA}human.jsonl`, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  // Same item order every run; interleave kinds so a partial run is still balanced.
  shuffle(human, mulberry32(7));
  const plan = human.slice(0, Number(values.limit)).map((item, i) => ({
    item,
    style: STYLES[i % STYLES.length]!,
    model: models[Math.floor(i / STYLES.length) % models.length]!,
  }));

  const out = `${DATA}generated.jsonl`;
  const done = new Set(
    existsSync(out) ? readFileSync(out, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l).pair_of) : [],
  );
  const todo = plan.filter((p) => !done.has(p.item.id));
  process.stderr.write(`${plan.length} planned, ${done.size} already done, ${todo.length} to generate\n`);

  if (values["dry-run"]) {
    for (const p of todo.slice(0, 3)) console.log(`--- ${p.model} / ${p.style} / ${p.item.kind}\n${buildPrompt(p.item, p.style)}\n`);
    return;
  }

  let next = 0, ok = 0, failed = 0;
  async function worker(): Promise<void> {
    while (next < todo.length) {
      const { item, style, model } = todo[next++]!;
      try {
        const text = cleanOutput(await copilot(buildPrompt(item, style), model));
        if (!text || findSignature(text)) { failed++; continue; }
        const gen: CorpusItem = {
          ...item,
          id: `gen-${createHash("sha1").update(`${item.id}/${style}/${model}`).digest("hex").slice(0, 12)}`,
          label: "ai",
          origin: "generated",
          created_at: new Date().toISOString(),
          url: "",
          text,
          generator: model,
          style,
          pair_of: item.id,
        };
        appendFileSync(out, JSON.stringify(gen) + "\n");
        ok++;
      } catch (err) {
        failed++;
        process.stderr.write(`failed ${item.id} (${model}): ${(err as Error).message.split("\n")[0]}\n`);
      }
      if ((ok + failed) % 25 === 0) process.stderr.write(`${ok + failed}/${todo.length} (${failed} failed)\n`);
    }
  }
  await Promise.all(Array.from({ length: Number(values.concurrency) }, worker));
  process.stderr.write(`done: ${ok} generated, ${failed} failed\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err: unknown) => { console.error(err); process.exit(1); });
}
