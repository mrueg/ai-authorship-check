import type { getOctokit } from "@actions/github";
import type { Reaction } from "./decide.js";
import type { Target } from "./event.js";

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
  const reactions = await listReactions(octokit, repo, target);
  const stale = reactions.filter((r) => r.user?.login === actor && ours.has(r.content));
  for (const r of stale) {
    await deleteReaction(octokit, repo, target, r.id);
  }
  return stale.length;
}

export async function addReaction(octokit: Octokit, repo: Repo, target: Target, content: Reaction): Promise<void> {
  switch (target.kind) {
    case "issue":
    case "pull_request":
      await octokit.rest.reactions.createForIssue({ ...repo, issue_number: target.number, content });
      return;
    case "issue_comment":
      await octokit.rest.reactions.createForIssueComment({ ...repo, comment_id: target.commentId!, content });
      return;
    case "review_comment":
      await octokit.rest.reactions.createForPullRequestReviewComment({
        ...repo,
        comment_id: target.commentId!,
        content,
      });
      return;
  }
}

async function listReactions(octokit: Octokit, repo: Repo, target: Target) {
  switch (target.kind) {
    case "issue":
    case "pull_request":
      return octokit.paginate(octokit.rest.reactions.listForIssue, {
        ...repo,
        issue_number: target.number,
        per_page: 100,
      });
    case "issue_comment":
      return octokit.paginate(octokit.rest.reactions.listForIssueComment, {
        ...repo,
        comment_id: target.commentId!,
        per_page: 100,
      });
    case "review_comment":
      return octokit.paginate(octokit.rest.reactions.listForPullRequestReviewComment, {
        ...repo,
        comment_id: target.commentId!,
        per_page: 100,
      });
  }
}

async function deleteReaction(octokit: Octokit, repo: Repo, target: Target, reactionId: number): Promise<void> {
  switch (target.kind) {
    case "issue":
    case "pull_request":
      await octokit.rest.reactions.deleteForIssue({ ...repo, issue_number: target.number, reaction_id: reactionId });
      return;
    case "issue_comment":
      await octokit.rest.reactions.deleteForIssueComment({
        ...repo,
        comment_id: target.commentId!,
        reaction_id: reactionId,
      });
      return;
    case "review_comment":
      await octokit.rest.reactions.deleteForPullRequestComment({
        ...repo,
        comment_id: target.commentId!,
        reaction_id: reactionId,
      });
      return;
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
