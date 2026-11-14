import * as core from "@actions/core";
import { type LongText } from "./chunks.ts";
import { REACTIONS, type Reaction, type Verdict } from "./decide.ts";

export interface Config {
  token: string;
  humanThreshold: number;
  aiThreshold: number;
  /** Reaction per verdict; undefined means "don't react". */
  reactions: Record<Verdict, Reaction | undefined>;
  minLength: number;
  maxTokens: number;
  longText: LongText;
  /** Skip text that is clearly not English instead of scoring it. */
  skipNonEnglish: boolean;
  skipAssociations: Set<string>;
  signatureCheck: boolean;
  addLabel: boolean;
  labelName: string;
  dryRun: boolean;
  /** Fail the job when a reaction or label call fails, instead of warning. */
  failOnError: boolean;
  modelPath: string;
}

export function readConfig(): Config {
  const humanThreshold = number("human-threshold", 0, 1);
  const aiThreshold = number("ai-threshold", 0, 1);
  if (humanThreshold > aiThreshold) {
    throw new Error(`human-threshold (${humanThreshold}) must not be above ai-threshold (${aiThreshold})`);
  }
  return {
    token: core.getInput("github-token", { required: true }),
    humanThreshold,
    aiThreshold,
    reactions: {
      human: reaction("human-reaction"),
      undecided: reaction("undecided-reaction"),
      ai: reaction("ai-reaction"),
    },
    minLength: number("min-length", 0, Infinity),
    maxTokens: number("max-tokens", 16, 8192),
    longText: parseLongText(core.getInput("long-text")),
    skipNonEnglish: parseNonEnglish(core.getInput("non-english")),
    skipAssociations: new Set(
      core
        .getInput("skip-associations")
        .split(",")
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean),
    ),
    signatureCheck: core.getBooleanInput("signature-check"),
    addLabel: core.getBooleanInput("add-label"),
    labelName: core.getInput("label-name") || "possibly-ai-generated",
    dryRun: core.getBooleanInput("dry-run"),
    failOnError: core.getBooleanInput("fail-on-error"),
    modelPath: process.env.AI_AUTHORSHIP_CHECK_MODEL_PATH ?? "/model",
  };
}

function number(name: string, min: number, max: number): number {
  const raw = core.getInput(name, { required: true });
  const value = Number(raw);
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new Error(`Input "${name}" must be a number between ${min} and ${max}, got "${raw}"`);
  }
  return value;
}

export function parseReaction(name: string, raw: string): Reaction | undefined {
  const value = raw.trim().toLowerCase();
  if (value === "none" || value === "") return undefined;
  if ((REACTIONS as readonly string[]).includes(value)) return value as Reaction;
  throw new Error(`Input "${name}" must be one of ${REACTIONS.join(", ")} or none, got "${raw}"`);
}

function reaction(name: string): Reaction | undefined {
  return parseReaction(name, core.getInput(name));
}

export function parseLongText(raw: string): LongText {
  const value = raw.trim().toLowerCase() || "truncate";
  if (value === "truncate" || value === "chunks") return value;
  throw new Error(`Input "long-text" must be truncate or chunks, got "${raw}"`);
}

/** "skip" (default) or "score"; returns whether to skip. */
export function parseNonEnglish(raw: string): boolean {
  const value = raw.trim().toLowerCase() || "skip";
  if (value === "skip" || value === "score") return value === "skip";
  throw new Error(`Input "non-english" must be skip or score, got "${raw}"`);
}
