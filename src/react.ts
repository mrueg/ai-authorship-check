import type { getOctokit } from "@actions/github";
import type { Reaction } from "./decide.ts";
import type { Target } from "./event.ts";

type Octokit = ReturnType<typeof getOctokit>;

export interface Repo {
  owner: string;
  repo: string;
}

/**
 * Removes verdict reactions previously left by `actor` on the target, so an
 * edited comment ends up with exactly one verdict.
 */
export async function clearReactions(
  octokit: Octokit,
  repo: Repo,
  target: Target,
  actor: string,
  ours: ReadonlySet<string>,
): Promise<number> {
  const api = reactionApi(octokit, repo, target);
  const stale = (await api.list()).filter((r) => r.user?.login === actor && ours.has(r.content));
  for (const r of stale) {
    await api.remove(r.id);
  }
  return stale.length;
}

export async function addReaction(octokit: Octokit, repo: Repo, target: Target, content: Reaction): Promise<void> {
  await reactionApi(octokit, repo, target).create(content);
}

interface ReactionApi {
  create(content: Reaction): Promise<unknown>;
  list(): Promise<{ id: number; content: string; user?: { login: string } | null }[]>;
  remove(reactionId: number): Promise<unknown>;
}

/** The reaction endpoints for the target: issues and PRs share one set, each comment kind has its own. */
function reactionApi(octokit: Octokit, repo: Repo, target: Target): ReactionApi {
  const r = octokit.rest.reactions;
  switch (target.kind) {
    case "issue":
    case "pull_request": {
      const ids = { ...repo, issue_number: target.number };
      return {
        create: (content) => r.createForIssue({ ...ids, content }),
        list: () => octokit.paginate(r.listForIssue, { ...ids, per_page: 100 }),
        remove: (reaction_id) => r.deleteForIssue({ ...ids, reaction_id }),
      };
    }
    case "issue_comment": {
      const ids = { ...repo, comment_id: target.commentId! };
      return {
        create: (content) => r.createForIssueComment({ ...ids, content }),
        list: () => octokit.paginate(r.listForIssueComment, { ...ids, per_page: 100 }),
        remove: (reaction_id) => r.deleteForIssueComment({ ...ids, reaction_id }),
      };
    }
    case "review_comment": {
      const ids = { ...repo, comment_id: target.commentId! };
      return {
        create: (content) => r.createForPullRequestReviewComment({ ...ids, content }),
        list: () => octokit.paginate(r.listForPullRequestReviewComment, { ...ids, per_page: 100 }),
        remove: (reaction_id) => r.deleteForPullRequestComment({ ...ids, reaction_id }),
      };
    }
  }
}

/** Adds or removes the label on the issue/PR itself. Comments never change labels. */
export async function syncLabel(
  octokit: Octokit,
  repo: Repo,
  target: Target,
  label: string,
  present: boolean,
): Promise<void> {
  if (target.kind !== "issue" && target.kind !== "pull_request") return;
  if (present) {
    await octokit.rest.issues.addLabels({ ...repo, issue_number: target.number, labels: [label] });
    return;
  }
  try {
    await octokit.rest.issues.removeLabel({ ...repo, issue_number: target.number, name: label });
  } catch (err) {
    if ((err as { status?: number }).status !== 404) throw err; // label was not there
  }
}
