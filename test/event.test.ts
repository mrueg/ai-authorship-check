import { describe, expect, it } from "vitest";
import { extractTarget } from "../src/event.js";

const user = { login: "octocat", type: "User" };

describe("extractTarget", () => {
  it("handles a new issue", () => {
    const r = extractTarget("issues", {
      action: "opened",
      issue: { number: 7, body: "It crashes", user, author_association: "NONE" },
    });
    expect(r).toEqual({
      target: {
        kind: "issue", body: "It crashes", author: "octocat", authorIsBot: false,
        association: "NONE", number: 7, commentId: undefined, edited: false,
      },
    });
  });

  it("handles pull_request_target the same as pull_request", () => {
    const pr = { number: 3, body: "Fixes #1", user, author_association: "CONTRIBUTOR" };
    const a = extractTarget("pull_request_target", { action: "opened", pull_request: pr });
    const b = extractTarget("pull_request", { action: "opened", pull_request: pr });
    expect(a).toEqual(b);
    expect("target" in a && a.target.kind).toBe("pull_request");
  });

  it("handles issue comments, including comments on PRs", () => {
    const r = extractTarget("issue_comment", {
      action: "created",
      issue: { number: 12 },
      comment: { id: 999, body: "+1 from me", user, author_association: "NONE" },
    });
    expect("target" in r && r.target).toMatchObject({ kind: "issue_comment", number: 12, commentId: 999 });
  });

  it("handles review comments", () => {
    const r = extractTarget("pull_request_review_comment", {
      action: "created",
      pull_request: { number: 5 },
      comment: { id: 42, body: "nit: rename", user },
    });
    expect("target" in r && r.target).toMatchObject({ kind: "review_comment", number: 5, commentId: 42 });
  });

  it("detects bots by type and by login suffix", () => {
    for (const u of [{ login: "renovate", type: "Bot" }, { login: "dependabot[bot]", type: "User" }]) {
      const r = extractTarget("issues", { action: "opened", issue: { number: 1, body: "x", user: u } });
      expect("target" in r && r.target.authorIsBot).toBe(true);
    }
  });

  it("skips edits that did not touch the body", () => {
    const r = extractTarget("issues", {
      action: "edited",
      changes: { title: { from: "old" } } as never,
      issue: { number: 1, body: "x", user },
    });
    expect(r).toEqual({ skip: "edit did not change the body" });
  });

  it("marks body edits", () => {
    const r = extractTarget("issues", {
      action: "edited",
      changes: { body: { from: "old" } },
      issue: { number: 1, body: "new", user },
    });
    expect("target" in r && r.target.edited).toBe(true);
  });

  it("skips other actions and events", () => {
    expect(extractTarget("issues", { action: "closed" })).toHaveProperty("skip");
    expect(extractTarget("push", { action: "created" })).toHaveProperty("skip");
  });

  it("treats a null body as empty", () => {
    const r = extractTarget("issues", { action: "opened", issue: { number: 1, body: null, user } });
    expect("target" in r && r.target.body).toBe("");
  });
});
