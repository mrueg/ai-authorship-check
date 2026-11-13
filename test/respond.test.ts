import { describe, expect, it, vi } from "vitest";
import type { Config } from "../src/config.ts";
import type { Target } from "../src/event.ts";
import { respond, type Result } from "../src/respond.ts";

const repo = { owner: "o", repo: "r" };
const issue: Target = {
  kind: "issue", body: "x", author: "a", authorIsBot: false, association: "NONE", number: 7, edited: false,
};
const cfg = {
  reactions: { human: "heart", undecided: "eyes", ai: "rocket" },
  addLabel: true,
  labelName: "possibly-ai-generated",
} as Config;

type Existing = { id: number; content: string; user: { login: string } };

function fakeOctokit(opts: { reactor?: string; existing?: Existing[]; authenticated?: string } = {}) {
  const ok = () => vi.fn().mockResolvedValue({});
  const rest = {
    reactions: {
      createForIssue: vi.fn().mockResolvedValue({ data: { user: { login: opts.reactor ?? "github-actions[bot]" } } }),
      listForIssue: ok(),
      deleteForIssue: ok(),
    },
    issues: { addLabels: ok(), removeLabel: ok() },
    users: {
      getAuthenticated: opts.authenticated
        ? vi.fn().mockResolvedValue({ data: { login: opts.authenticated } })
        : vi.fn().mockRejectedValue(Object.assign(new Error("Resource not accessible by integration"), { status: 403 })),
    },
  };
  const paginate = vi.fn().mockResolvedValue(opts.existing ?? []);
  return { rest, octokit: { rest, paginate } as never };
}

const deleted = (f: ReturnType<typeof fakeOctokit>) =>
  f.rest.reactions.deleteForIssue.mock.calls.map((c) => c[0].reaction_id);

describe("respond", () => {
  const ai: Result = { verdict: "ai", reason: "r", pAi: 0.9 };
  const skipped: Result = { verdict: "skipped", reason: "too short" };

  it("on an edit, adds the new verdict first and removes only our other verdicts", async () => {
    const f = fakeOctokit({
      existing: [
        { id: 1, content: "heart", user: { login: "github-actions[bot]" } },
        { id: 2, content: "rocket", user: { login: "github-actions[bot]" } }, // the one just added
        { id: 3, content: "heart", user: { login: "someone" } },
      ],
    });
    await respond(f.octokit, repo, { ...issue, edited: true }, ai, cfg);
    expect(f.rest.reactions.createForIssue.mock.invocationCallOrder[0]!)
      .toBeLessThan(f.rest.reactions.deleteForIssue.mock.invocationCallOrder[0]!);
    expect(deleted(f)).toEqual([1]);
  });

  it("cleans up under the identity the reaction was added as, not a hardcoded bot", async () => {
    const f = fakeOctokit({
      reactor: "my-app[bot]",
      existing: [
        { id: 1, content: "heart", user: { login: "my-app[bot]" } },
        { id: 2, content: "heart", user: { login: "github-actions[bot]" } },
      ],
    });
    await respond(f.octokit, repo, { ...issue, edited: true }, ai, cfg);
    expect(deleted(f)).toEqual([1]);
  });

  it("without a new reaction, finds our old ones via the token's login", async () => {
    const f = fakeOctokit({
      authenticated: "maintainer",
      existing: [{ id: 5, content: "rocket", user: { login: "maintainer" } }],
    });
    await respond(f.octokit, repo, { ...issue, edited: true }, skipped, cfg);
    expect(f.rest.reactions.createForIssue).not.toHaveBeenCalled();
    expect(deleted(f)).toEqual([5]);
  });

  it("falls back to the Actions bot when the token can't look itself up", async () => {
    const f = fakeOctokit({ existing: [{ id: 6, content: "rocket", user: { login: "github-actions[bot]" } }] });
    await respond(f.octokit, repo, { ...issue, edited: true }, skipped, cfg);
    expect(deleted(f)).toEqual([6]);
  });

  it("removes the label when an edit ends up skipped", async () => {
    const f = fakeOctokit();
    await respond(f.octokit, repo, { ...issue, edited: true }, skipped, cfg);
    expect(f.rest.issues.removeLabel).toHaveBeenCalledWith({ ...repo, issue_number: 7, name: "possibly-ai-generated" });
  });

  it("leaves labels and reactions alone for a skipped new item", async () => {
    const f = fakeOctokit();
    await respond(f.octokit, repo, issue, skipped, cfg);
    expect(f.rest.issues.removeLabel).not.toHaveBeenCalled();
    expect(f.rest.issues.addLabels).not.toHaveBeenCalled();
    expect(f.rest.reactions.createForIssue).not.toHaveBeenCalled();
  });
});
