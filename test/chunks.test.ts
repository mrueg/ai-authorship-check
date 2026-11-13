import { describe, expect, it } from "vitest";
import { chunkIds, weightedMean } from "../src/chunks.ts";
import { parseLongText } from "../src/config.ts";

const range = (n: number) => Array.from({ length: n }, (_, i) => i);

describe("chunkIds", () => {
  it("keeps short inputs whole", () => {
    expect(chunkIds(range(5), 10)).toEqual([range(5)]);
    expect(chunkIds([], 10)).toEqual([]);
  });
  it("splits evenly instead of leaving a tiny remainder", () => {
    expect(chunkIds(range(11), 10).map((c) => c.length)).toEqual([6, 5]);
    expect(chunkIds(range(30), 10).map((c) => c.length)).toEqual([10, 10, 10]);
  });
  it("keeps order and drops ids beyond window * maxChunks", () => {
    const chunks = chunkIds(range(100), 10, 4);
    expect(chunks.flat()).toEqual(range(40));
    expect(chunks.every((c) => c.length <= 10)).toBe(true);
  });
});

describe("weightedMean", () => {
  it("weights by chunk length", () => {
    expect(weightedMean([1, 0], [3, 1])).toBe(0.75);
  });
  it("rejects mismatched input", () => {
    expect(() => weightedMean([], [])).toThrow();
    expect(() => weightedMean([1], [1, 2])).toThrow();
  });
});

describe("parseLongText", () => {
  it("accepts truncate and chunks, defaulting to truncate", () => {
    expect(parseLongText("")).toBe("truncate");
    expect(parseLongText(" Chunks ")).toBe("chunks");
    expect(() => parseLongText("split")).toThrow(/truncate or chunks/);
  });
});
