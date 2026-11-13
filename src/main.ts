import * as core from "@actions/core";
import * as github from "@actions/github";
import { Classifier } from "./classifier.ts";
import { readConfig } from "./config.ts";
import { skipReason, verdictFor, type Reaction, type Verdict } from "./decide.ts";
import { extractTarget } from "./event.ts";
import { preprocess } from "./preprocess.ts";
import { addReaction, clearReactions, syncLabel } from "./react.ts";
import { findSignature } from "./signatures.ts";

/** Identity behind the default GITHUB_TOKEN; used to find our own old reactions. */
const ACTIONS_BOT = "github-actions[bot]";

interface Result {
  verdict: Verdict | "skipped";
  reason: string;
  pAi?: number;
}

async function run(): Promise<void> {
  const cfg = readConfig();
  const { eventName, payload, repo } = github.context;

  const extracted = extractTarget(eventName, payload as Parameters<typeof extractTarget>[1]);
  if ("skip" in extracted) {
    return finish({ verdict: "skipped", reason: extracted.skip });
  }
  const target = extracted.target;
  core.info(`Judging ${target.kind} #${target.number}${target.commentId ? ` (comment ${target.commentId})` : ""} by ${target.author}`);

  const result = await judge(target, cfg);
  finish(result);

  if (cfg.dryRun) {
    core.info("dry-run: not reacting or labeling");
    return;
  }

  const octokit = github.getOctokit(cfg.token);
  if (target.edited) {
    const ours = new Set(Object.values(cfg.reactions).filter((r): r is Reaction => r !== undefined));
    const removed = await clearReactions(octokit, repo, target, ACTIONS_BOT, ours);
    if (removed) core.info(`Removed ${removed} earlier reaction(s)`);
  }
  if (result.verdict === "skipped") return;

  const reaction = cfg.reactions[result.verdict];
  if (reaction) {
    await addReaction(octokit, repo, target, reaction);
    core.info(`Reacted ${reaction}`);
  }

  if (cfg.addLabel) {
    await syncLabel(octokit, repo, target, cfg.labelName, result.verdict === "ai");
  }
}

async function judge(target: Parameters<typeof skipReason>[0], cfg: ReturnType<typeof readConfig>): Promise<Result> {
  const skip = skipReason(target, cfg);
  if (skip) return { verdict: "skipped", reason: skip };

  if (cfg.signatureCheck) {
    const sig = findSignature(target.body);
    if (sig) return { verdict: "ai", reason: `AI signature: ${sig.name}`, pAi: 1 };
  }

  const text = preprocess(target.body);
  if (text.length < cfg.minLength) {
    return { verdict: "skipped", reason: `only ${text.length} characters after cleanup (min-length ${cfg.minLength})` };
  }

  const started = Date.now();
  const classifier = await Classifier.load(cfg.modelPath, cfg.maxTokens);
  core.info(`Model loaded in ${Date.now() - started} ms`);
  try {
    const t0 = Date.now();
    const pAi = await classifier.classify(text);
    core.info(`Classified ${text.length} characters in ${Date.now() - t0} ms: P(AI) = ${pAi.toFixed(4)}`);
    const verdict = verdictFor(pAi, cfg.humanThreshold, cfg.aiThreshold);
    const bands = `human < ${cfg.humanThreshold} ≤ undecided < ${cfg.aiThreshold} ≤ ai`;
    return { verdict, reason: `model P(AI) = ${pAi.toFixed(3)} (${bands})`, pAi };
  } finally {
    await classifier.dispose();
  }
}

function finish(result: Result): void {
  core.setOutput("verdict", result.verdict);
  core.setOutput("p-ai", result.pAi === undefined ? "" : result.pAi.toFixed(4));
  core.setOutput("reason", result.reason);
  core.info(`Verdict: ${result.verdict} (${result.reason})`);

  const icon = { human: "❤️", undecided: "👀", ai: "🚀", skipped: "⏭️" }[result.verdict];
  void core.summary
    .addHeading("AI Authorship Check", 3)
    .addTable([
      [{ data: "Verdict", header: true }, { data: "P(AI)", header: true }, { data: "Reason", header: true }],
      [`${icon} ${result.verdict}`, result.pAi === undefined ? "–" : result.pAi.toFixed(3), result.reason],
    ])
    .write()
    .catch(() => undefined); // summary file is missing when run outside Actions
}

run().catch((err: unknown) => {
  core.setFailed(err instanceof Error ? err.message : String(err));
});
