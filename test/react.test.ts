import { describe, expect, it, vi } from "vitest";
import { addReaction, clearReactions, syncLabel } from "../src/react.js";
import type { Target } from "../src/event.js";

const repo = { owner: "o", repo: "r" };
const issue: Target = {
  kind: "issue", body: "x", author: "a", authorIsBot: false, association: "NONE", number: 7, edited: false,
};
const comment: Target = { ...issue, kind: "issue_comment", commentId: 99 };
const review: Target = { ...issue, kind: "review_comment", commentId: 55 };

function fakeOctokit(existing: { id: number; content: string; user: { login: string } }[] = []) {
  const fn = () => vi.fn().mockResolvedValue({});
  const rest = {
    reactions: {
      createForIssue: fn(), createForIssueComment: fn(), createForPullRequestReviewComment: fn(),
      listForIssue: fn(), listForIssueComment: fn(), listForPullRequestReviewComment: fn(),
      deleteForIssue: fn(), deleteForIssueComment: fn(), deleteForPullRequestComment: fn(),
    },
    issues: { addLabels: fn(), removeLabel: fn() },
  };
  const paginate = vi.fn().mockResolvedValue(existing);
  return { rest, paginate, octokit: { rest, paginate } as never };
}

describe("addReaction", () => {
  it("uses the endpoint matching the target kind", async () => {
    const f = fakeOctokit();
    await addReaction(f.octokit, repo, issue, "heart");
    await addReaction(f.octokit, repo, comment, "eyes");
    await addReaction(f.octokit, repo, review, "rocket");
    expect(f.rest.reactions.createForIssue).toHaveBeenCalledWith({ ...repo, issue_number: 7, content: "heart" });
    expect(f.rest.reactions.createForIssueComment).toHaveBeenCalledWith({ ...repo, comment_id: 99, content: "eyes" });
    expect(f.rest.reactions.createForPullRequestReviewComment).toHaveBeenCalledWith({
      ...repo, comment_id: 55, content: "rocket",
    });
  });
});

describe("clearReactions", () => {
  it("removes only our own verdict reactions", async () => {
    const f = fakeOctokit([
      { id: 1, content: "heart", user: { login: "github-actions[bot]" } },
      { id: 2, content: "rocket", user: { login: "github-actions[bot]" } },
      { id: 3, content: "laugh", user: { login: "github-actions[bot]" } },
      { id: 4, content: "eyes", user: { login: "someone" } },
    ]);
    const ours = new Set(["heart", "eyes", "rocket"]);
    const removed = await clearReactions(f.octokit, repo, comment, "github-actions[bot]", ours);
    expect(removed).toBe(2);
    expect(f.rest.reactions.deleteForIssueComment.mock.calls.map((c) => c[0].reaction_id)).toEqual([1, 2]);
  });
});

describe("syncLabel", () => {
  it("labels issues and PRs, never because of a comment", async () => {
    const f = fakeOctokit();
    await syncLabel(f.octokit, repo, issue, "possibly-ai-generated", true);
    await syncLabel(f.octokit, repo, comment, "possibly-ai-generated", true);
    expect(f.rest.issues.addLabels).toHaveBeenCalledTimes(1);
  });

  it("ignores a missing label when removing", async () => {
    const f = fakeOctokit();
    f.rest.issues.removeLabel.mockRejectedValue(Object.assign(new Error("Not Found"), { status: 404 }));
    await expect(syncLabel(f.octokit, repo, issue, "l", false)).resolves.toBeUndefined();
  });
});
