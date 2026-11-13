/**
 * Collects labeled GitHub text from GH Archive (https://www.gharchive.org).
 *
 *   node corpus/collect.ts human    > corpus/data/human.jsonl
 *   node corpus/collect.ts wild-ai  > corpus/data/wild-ai.jsonl
 *
 * human:   issues, PR descriptions, issue comments and review comments from
 *          sampled hours between 2019 and October 2022, before ChatGPT was
 *          released (2022-11-30). Treated as human-written.
 * wild-ai: issues and comments from 2026 that disclose AI authorship with a
 *          tool signature ("Generated with Claude Code", ...). The signature is
 *          stripped, so the eval measures the model and not the signature check.
 *
 * Author logins are used for de-duplication only and never written out.
 * Hourly archives are cached in corpus/.cache/.
 */
import { createHash } from "node:crypto";
import { createReadStream, existsSync, mkdirSync, renameSync } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGunzip } from "node:zlib";
import { createWriteStream } from "node:fs";
import { preprocess } from "../src/preprocess.ts";
import { findSignature } from "../src/signatures.ts";
import { isEnglish, splitFor, mulberry32, shuffle, type CorpusItem, type Kind } from "./lib.ts";

const CACHE = new URL("./.cache/", import.meta.url).pathname;
const MIN_CHARS = 40;
const MAX_CHARS = 4000;
const PER_REPO = 2;

/** Spread over years, months, weekdays and both EU and US working hours. */
const HUMAN_HOURS = [
  "2019-01-16-15", "2019-04-10-09", "2019-07-17-18", "2019-10-22-13",
  "2020-01-14-16", "2020-04-22-10", "2020-07-08-19", "2020-10-13-14",
  "2021-01-20-17", "2021-04-14-08", "2021-07-21-15", "2021-10-19-20",
  "2022-01-18-14", "2022-04-12-16", "2022-07-13-11", "2022-10-18-17",
];

/**
 * One hour per day from 2026-10-01 to 2026-11-12, rotating through the day.
 * Disclosed AI text was rare before autumn 2026 (~1 per hour in July, ~25 in October).
 */
const WILD_AI_HOURS = Array.from({ length: 43 }, (_, i) => {
  const day = new Date(Date.UTC(2026, 9, 1 + i)).toISOString().slice(0, 10);
  return `${day}-${String([9, 13, 15, 17, 20, 22, 3][i % 7]).padStart(2, "0")}`;
});

const PER_KIND: Record<"human" | "wild-ai", number> = { human: 300, "wild-ai": 1000 };

interface User { login?: string; type?: string }
interface Authored { body?: string | null; user?: User | null; title?: string; html_url?: string; created_at?: string }
interface GhEvent {
  id: string;
  type: string;
  created_at: string;
  repo: { name: string };
  payload: {
    action?: string;
    issue?: Authored & { pull_request?: unknown };
    pull_request?: Authored;
    comment?: Authored & { diff_hunk?: string; path?: string };
  };
}

interface Candidate extends CorpusItem { author: string }

async function download(hour: string): Promise<string> {
  mkdirSync(CACHE, { recursive: true });
  const file = `${CACHE}${hour}.json.gz`;
  if (existsSync(file)) return file;
  // GH Archive file names don't zero-pad the hour: 2019-04-10-9, not -09.
  const name = hour.replace(/-0(\d)$/, "-$1");
  const res = await fetch(`https://data.gharchive.org/${name}.json.gz`);
  if (!res.ok || !res.body) throw new Error(`GH Archive ${hour}: HTTP ${res.status}`);
  await pipeline(Readable.fromWeb(res.body as never), createWriteStream(`${file}.part`));
  renameSync(`${file}.part`, file);
  return file;
}

/**
 * Splits on "\n" only. node:readline also breaks on U+2028/U+2029, which are
 * legal unescaped inside JSON strings and do occur in comment bodies.
 */
async function* jsonLines(file: string): AsyncGenerator<string> {
  let rest = "";
  for await (const chunk of createReadStream(file).pipe(createGunzip()).setEncoding("utf8")) {
    const parts = (rest + (chunk as string)).split("\n");
    rest = parts.pop()!;
    yield* parts;
  }
  if (rest) yield rest;
}

function isBot(user: User | null | undefined): boolean {
  const login = (user?.login ?? "").toLowerCase();
  return user?.type === "Bot" || login.endsWith("[bot]") || /(^|[-_])bot$/.test(login);
}

/** Pulls the judged text and its context out of one event. */
function toCandidate(e: GhEvent): Candidate | undefined {
  const p = e.payload;
  let kind: Kind, item: Authored | undefined, title = "", context = "";
  if (e.type === "IssuesEvent" && p.action === "opened") {
    kind = "issue"; item = p.issue; title = p.issue?.title ?? "";
  } else if (e.type === "PullRequestEvent" && p.action === "opened") {
    kind = "pull_request"; item = p.pull_request; title = p.pull_request?.title ?? "";
  } else if (e.type === "IssueCommentEvent" && p.action === "created") {
    kind = "issue_comment"; item = p.comment;
    title = p.issue?.title ?? "";
    context = (p.issue?.body ?? "").slice(0, 2000);
  } else if (e.type === "PullRequestReviewCommentEvent" && p.action === "created") {
    kind = "review_comment"; item = p.comment;
    title = p.pull_request?.title ?? "";
    context = [p.comment?.path, p.comment?.diff_hunk?.slice(-1500)].filter(Boolean).join("\n");
  } else {
    return undefined;
  }
  if (!item?.body || isBot(item.user)) return undefined;
  return {
    id: `gha-${e.id}`,
    label: "human",
    kind,
    origin: "gharchive-pre2023",
    created_at: e.created_at,
    repo: e.repo.name,
    url: item.html_url ?? "",
    title,
    context,
    text: item.body,
    split: splitFor(e.repo.name),
    author: item.user?.login ?? "",
  };
}

/** Removes the disclosure footer and anything after it. */
export function stripSignature(body: string): string {
  const lines = body.replace(/\r\n?/g, "\n").split("\n");
  const at = lines.findIndex((l) => findSignature(l) !== undefined);
  if (at < 0) return body;
  let end = at;
  while (end > 0 && /^\s*(?:-{3,}|_{3,}|\*{3,})?\s*$/.test(lines[end - 1]!)) end--; // blank lines and --- rules
  return lines.slice(0, end).join("\n").trimEnd();
}

function accept(c: Candidate, mode: "human" | "wild-ai"): Candidate | undefined {
  if (mode === "wild-ai") {
    if (c.kind !== "issue" && c.kind !== "issue_comment") return undefined;
    if (!findSignature(c.text)) return undefined;
    c = { ...c, label: "ai", origin: "gharchive-disclosed", text: stripSignature(c.text) };
    if (findSignature(c.text)) return undefined; // more than one marker; keep it simple
  } else if (findSignature(c.text)) {
    return undefined;
  }
  const clean = preprocess(c.text);
  if (clean.length < MIN_CHARS || clean.length > MAX_CHARS) return undefined;
  if (!isEnglish(clean)) return undefined;
  return c;
}

async function main(): Promise<void> {
  const mode = process.argv[2];
  if (mode !== "human" && mode !== "wild-ai") throw new Error("usage: node corpus/collect.ts human|wild-ai");
  const hours = mode === "human" ? HUMAN_HOURS : WILD_AI_HOURS;

  // Reservoir-sample at most PER_HOUR_KIND candidates per kind and hour, so memory
  // stays small: a 2020 hour has ~8000 candidates, the final sample needs ~300 per kind.
  const PER_HOUR_KIND = 150;
  const rand = mulberry32(1);
  const pool: Candidate[] = [];
  for (const hour of hours) {
    const file = await download(hour);
    const seen = new Map<Kind, number>();
    const res = new Map<Kind, Candidate[]>();
    for await (const line of jsonLines(file)) {
      if (!line.includes('"IssuesEvent"') && !line.includes('"PullRequestEvent"') && !line.includes("CommentEvent")) continue;
      const c = toCandidate(JSON.parse(line) as GhEvent);
      const ok = c && accept(c, mode);
      if (!ok) continue;
      const n = (seen.get(ok.kind) ?? 0) + 1;
      seen.set(ok.kind, n);
      const bucket = res.get(ok.kind) ?? [];
      res.set(ok.kind, bucket);
      if (bucket.length < PER_HOUR_KIND) bucket.push(ok);
      else {
        const j = Math.floor(rand() * n);
        if (j < PER_HOUR_KIND) bucket[j] = ok;
      }
    }
    for (const bucket of res.values()) pool.push(...bucket);
    const total = [...seen.values()].reduce((a, b) => a + b, 0);
    process.stderr.write(`${hour}: ${total} candidates\n`);
  }

  // Deterministic sample with diversity caps: one item per author, PER_REPO per repo,
  // no duplicate texts, PER_KIND per kind.
  shuffle(pool, mulberry32(2026));
  const authors = new Set<string>();
  const repos = new Map<string, number>();
  const texts = new Set<string>();
  const kinds = new Map<Kind, number>();
  let written = 0;
  for (const c of pool) {
    const fp = createHash("sha1").update(preprocess(c.text).toLowerCase().slice(0, 300)).digest("hex");
    if (authors.has(c.author) || texts.has(fp)) continue;
    if ((repos.get(c.repo) ?? 0) >= PER_REPO || (kinds.get(c.kind) ?? 0) >= PER_KIND[mode]) continue;
    authors.add(c.author); texts.add(fp);
    repos.set(c.repo, (repos.get(c.repo) ?? 0) + 1);
    kinds.set(c.kind, (kinds.get(c.kind) ?? 0) + 1);
    const { author: _drop, ...item } = c;
    process.stdout.write(JSON.stringify(item) + "\n");
    written++;
  }
  process.stderr.write(`wrote ${written} items: ${JSON.stringify(Object.fromEntries(kinds))}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err: unknown) => { console.error(err); process.exit(1); });
}
