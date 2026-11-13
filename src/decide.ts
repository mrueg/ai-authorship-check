import type { Config } from "./config.ts";
import type { Target } from "./event.ts";

export type Verdict = "human" | "undecided" | "ai";

/** The reactions GitHub supports. */
export const REACTIONS = ["+1", "-1", "laugh", "confused", "heart", "hooray", "rocket", "eyes"] as const;
export type Reaction = (typeof REACTIONS)[number];

export function skipReason(target: Target, cfg: Pick<Config, "skipAssociations">): string | undefined {
  if (target.authorIsBot) return `author ${target.author} is a bot`;
  if (cfg.skipAssociations.has(target.association)) {
    return `author association ${target.association} is in skip-associations`;
  }
  if (target.body.trim() === "") return "body is empty";
  return undefined;
}

/**
 * P(AI) below humanThreshold → human, at or above aiThreshold → ai,
 * anything in between → undecided.
 */
export function verdictFor(pAi: number, humanThreshold: number, aiThreshold: number): Verdict {
  if (pAi >= aiThreshold) return "ai";
  if (pAi < humanThreshold) return "human";
  return "undecided";
}
