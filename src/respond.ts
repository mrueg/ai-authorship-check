import type { getOctokit } from "@actions/github";
import * as core from "@actions/core";
import type { Config } from "./config.ts";
import type { Reaction, Verdict } from "./decide.ts";
import type { Target } from "./event.ts";
import { addReaction, clearReactions, syncLabel, type Repo } from "./react.ts";

type Octokit = ReturnType<typeof getOctokit>;

/** Identity behind the default GITHUB_TOKEN. */
const ACTIONS_BOT = "github-actions[bot]";

export interface Result {
  verdict: Verdict | "skipped";
  reason: string;
  pAi?: number;
}

/** Reacts and labels. Adds the new reaction before removing old ones, so a cancelled run never leaves none. */
export async function respond(octokit: Octokit, repo: Repo, target: Target, result: Result, cfg: Config): Promise<void> {
  const reaction = result.verdict === "skipped" ? undefined : cfg.reactions[result.verdict];
  let reactor: string | undefined;
  if (reaction) {
    reactor = await addReaction(octokit, repo, target, reaction);
    core.info(`Reacted ${reaction}`);
  }

  if (target.edited) {
    const ours = new Set(Object.values(cfg.reactions).filter((r): r is Reaction => r !== undefined));
    const actor = reactor ?? (await tokenLogin(octokit));
    const removed = await clearReactions(octokit, repo, target, actor, ours, reaction);
    if (removed) core.info(`Removed ${removed} earlier reaction(s)`);
  }

  // A skipped edit still removes the label: the text it was given for is gone.
  if (cfg.addLabel && (result.verdict !== "skipped" || target.edited)) {
    await syncLabel(octokit, repo, target, cfg.labelName, result.verdict === "ai");
  }
}

/**
 * Login behind the token, for finding our earlier reactions when we did not just react.
 * Works for personal access tokens; GITHUB_TOKEN and app tokens can't call this
 * endpoint, so fall back to the Actions bot.
 */
async function tokenLogin(octokit: Octokit): Promise<string> {
  try {
    return (await octokit.rest.users.getAuthenticated()).data.login;
  } catch {
    return ACTIONS_BOT;
  }
}
