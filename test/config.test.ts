import { describe, expect, it } from "vitest";
import { parseLongText, parseNonEnglish } from "../src/config.ts";

describe("parseNonEnglish", () => {
  it("defaults to skip and accepts score", () => {
    expect(parseNonEnglish("")).toBe(true);
    expect(parseNonEnglish(" Skip ")).toBe(true);
    expect(parseNonEnglish("score")).toBe(false);
    expect(() => parseNonEnglish("ignore")).toThrow(/skip or score/);
  });
});

describe("parseLongText", () => {
  it("defaults to truncate and accepts chunks", () => {
    expect(parseLongText("")).toBe("truncate");
    expect(parseLongText("CHUNKS")).toBe("chunks");
    expect(() => parseLongText("split")).toThrow(/truncate or chunks/);
  });
});
