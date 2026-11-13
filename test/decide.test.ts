import { describe, expect, it } from "vitest";
import { skipReason, verdictFor } from "../src/decide.ts";
import { sigmoid } from "../src/classifier.ts";
import { parseReaction } from "../src/config.ts";
import { auroc, humanMetricsAt, metricsAt } from "../src/eval.ts";
import type { Target } from "../src/event.ts";

const base: Target = {
  kind: "issue", body: "hello there", author: "octocat", authorIsBot: false,
  association: "NONE", number: 1, edited: false,
};
const cfg = { skipAssociations: new Set(["OWNER", "MEMBER"]) };

describe("skipReason", () => {
  it("skips bots, skipped associations and empty bodies", () => {
    expect(skipReason({ ...base, authorIsBot: true }, cfg)).toMatch(/bot/);
    expect(skipReason({ ...base, association: "OWNER" }, cfg)).toMatch(/OWNER/);
    expect(skipReason({ ...base, body: "   " }, cfg)).toMatch(/empty/);
  });

  it("judges everyone else", () => {
    expect(skipReason(base, cfg)).toBeUndefined();
    expect(skipReason({ ...base, association: "CONTRIBUTOR" }, cfg)).toBeUndefined();
  });
});

describe("verdictFor", () => {
  it("splits P(AI) into human / undecided / ai bands", () => {
    expect(verdictFor(0.1, 0.3, 0.8)).toBe("human");
    expect(verdictFor(0.3, 0.3, 0.8)).toBe("undecided");
    expect(verdictFor(0.79, 0.3, 0.8)).toBe("undecided");
    expect(verdictFor(0.8, 0.3, 0.8)).toBe("ai");
    expect(verdictFor(0.99, 0.3, 0.8)).toBe("ai");
  });

  it("has no undecided band when both thresholds are equal", () => {
    expect(verdictFor(0.49, 0.5, 0.5)).toBe("human");
    expect(verdictFor(0.5, 0.5, 0.5)).toBe("ai");
  });
});

describe("parseReaction", () => {
  it("accepts GitHub reactions and none", () => {
    expect(parseReaction("x", "heart")).toBe("heart");
    expect(parseReaction("x", " Rocket ")).toBe("rocket");
    expect(parseReaction("x", "+1")).toBe("+1");
    expect(parseReaction("x", "none")).toBeUndefined();
    expect(parseReaction("x", "")).toBeUndefined();
  });

  it("rejects anything else", () => {
    expect(() => parseReaction("ai-reaction", "thumbsdown")).toThrow(/ai-reaction/);
  });
});

describe("sigmoid", () => {
  it("maps logits to probabilities", () => {
    expect(sigmoid(0)).toBe(0.5);
    expect(sigmoid(10)).toBeGreaterThan(0.9999);
    expect(sigmoid(-10)).toBeLessThan(0.0001);
  });
});

describe("eval metrics", () => {
  const scored = [
    { pAi: 0.9, ai: true }, { pAi: 0.7, ai: true }, { pAi: 0.6, ai: false }, { pAi: 0.1, ai: false },
  ];
  it("computes AUROC", () => {
    expect(auroc(scored)).toBe(1);
    expect(auroc([{ pAi: 0.5, ai: true }, { pAi: 0.5, ai: false }])).toBe(0.5);
  });
  it("computes precision, recall and human false-positive rate", () => {
    expect(metricsAt(scored, 0.5)).toMatchObject({ precision: 2 / 3, recall: 1, humanFpr: 0.5 });
    expect(metricsAt(scored, 0.8)).toMatchObject({ precision: 1, recall: 0.5, humanFpr: 0 });
  });
  it("computes the human band", () => {
    expect(humanMetricsAt(scored, 0.65)).toMatchObject({ precision: 1, recall: 1, aiFnr: 0 });
    expect(humanMetricsAt(scored, 0.75)).toMatchObject({ precision: 2 / 3, recall: 1, aiFnr: 0.5 });
  });
});
