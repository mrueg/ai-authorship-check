import * as core from "@actions/core";
import * as github from "@actions/github";
import { Classifier } from "./classifier.ts";
import { readConfig, type Config } from "./config.ts";
import { skipReason, verdictFor } from "./decide.ts";
import { extractTarget, type Payload, type Target } from "./event.ts";
import { isClearlyNotEnglish } from "./language.ts";
import { preprocess } from "./preprocess.ts";
import { respond, type Result } from "./respond.ts";
import { findSignature } from "./signatures.ts";


async function run(): Promise<void> {
  const cfg = readConfig();
  const { eventName, payload, repo } = github.context;

  const extracted = extractTarget(eventName, payload as Payload);
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

  try {
    await respond(github.getOctokit(cfg.token), repo, target, result, cfg);
  } catch (err) {
    // Deleted comments, locked issues and read-only fork tokens are routine on busy repos.
    if (cfg.failOnError) throw err;
    core.warning(`Could not react or label (set fail-on-error to fail the job instead): ${message(err)}`);
  }
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function judge(target: Target, cfg: Config): Promise<Result> {
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
  if (cfg.skipNonEnglish && isClearlyNotEnglish(text)) {
    // The model was trained on English; its scores on other languages mean little.
    return { verdict: "skipped", reason: "text is not English (set non-english: score to judge it anyway)" };
  }

  const started = Date.now();
  const classifier = await Classifier.load(cfg.modelPath, cfg.maxTokens);
  core.info(`Model loaded in ${Date.now() - started} ms`);
  try {
    const t0 = Date.now();
    const { pAi, tokens, chunks, truncated } = await classifier.classify(text, cfg.longText);
    const detail = [`${tokens} tokens`, chunks > 1 && `${chunks} chunks`, truncated && "truncated"].filter(Boolean).join(", ");
    core.info(`Classified ${text.length} characters (${detail}) in ${Date.now() - t0} ms: P(AI) = ${pAi.toFixed(4)}`);
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
  core.setFailed(message(err));
});
