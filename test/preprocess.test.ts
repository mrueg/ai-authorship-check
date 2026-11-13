import { describe, expect, it } from "vitest";
import { preprocess } from "../src/preprocess.ts";

describe("preprocess", () => {
  it("removes zero-width characters, soft hyphens and bidi controls", () => {
    expect(preprocess("Hel\u200Blo wo\u00ADrld\u200D \u202Eok\u202C\uFEFF")).toBe("Hello world ok");
  });
  it("removes HTML comments from templates", () => {
    expect(preprocess("<!-- Please describe the bug -->\nIt crashes on start.")).toBe("It crashes on start.");
  });

  it("removes fenced code blocks, terminated or not", () => {
    expect(preprocess("Before\n```js\nconst x = 1;\n```\nAfter")).toBe("Before\n\nAfter");
    expect(preprocess("Before\n~~~\nlog line\n~~~\nAfter")).toBe("Before\n\nAfter");
    expect(preprocess("Before\n```\nunterminated\nstill code")).toBe("Before");
  });

  it("follows CommonMark fence rules", () => {
    // A longer fence wraps a shorter one; only a fence at least as long closes it.
    expect(preprocess("````\n```\ninner code\n```\n````\nAfter")).toBe("After");
    // A fence line with an info string doesn't close a block.
    expect(preprocess("```\nfoo\n```python\nstill code\n```\nAfter")).toBe("After");
    // Tildes don't close a backtick block.
    expect(preprocess("```\ncode\n~~~\nmore code\n```\nAfter")).toBe("After");
    // ``` x ``` on one line is inline code, not a fence.
    expect(preprocess("``` x ``` is inline\nand more")).toBe("``` x ``` is inline\nand more");
  });

  it("removes quoted replies", () => {
    expect(preprocess("> you said this\n> and this\nI disagree.")).toBe("I disagree.");
  });

  it("removes <details> blocks with attributes", () => {
    expect(preprocess("See logs:\n<details open>\nboom\n</details>\nThanks")).toBe("See logs:\n\nThanks");
    expect(preprocess("<details class=\"log\"><summary>x</summary>boom</details>Thanks")).toBe("Thanks");
  });

  it("removes <details> blocks", () => {
    expect(preprocess("See logs:\n<details><summary>log</summary>\nboom\n</details>\nThanks")).toBe("See logs:\n\nThanks");
  });

  it("removes empty issue-form fields", () => {
    expect(preprocess("### Version\n\n_No response_\n\n### What happened\n\nIt broke")).toBe(
      "### Version\n\n### What happened\n\nIt broke",
    );
  });

  it("keeps link text and drops URLs and images", () => {
    expect(preprocess("See [the docs](https://x.y/z) and https://a.b/c ![img](i.png)")).toBe("See the docs and");
  });

  it("normalizes whitespace and line endings", () => {
    expect(preprocess("a  \t b\r\n\r\n\r\n\r\nc")).toBe("a b\n\nc");
  });

  it("keeps inline code and plain prose", () => {
    expect(preprocess("Calling `foo()` throws.")).toBe("Calling `foo()` throws.");
  });
});
