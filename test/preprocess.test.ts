import { describe, expect, it } from "vitest";
import { preprocess } from "../src/preprocess.js";

describe("preprocess", () => {
  it("removes HTML comments from templates", () => {
    expect(preprocess("<!-- Please describe the bug -->\nIt crashes on start.")).toBe("It crashes on start.");
  });

  it("removes fenced code blocks, terminated or not", () => {
    expect(preprocess("Before\n```js\nconst x = 1;\n```\nAfter")).toBe("Before\n\nAfter");
    expect(preprocess("Before\n~~~\nlog line\n~~~\nAfter")).toBe("Before\n\nAfter");
    expect(preprocess("Before\n```\nunterminated\nstill code")).toBe("Before");
  });

  it("removes quoted replies", () => {
    expect(preprocess("> you said this\n> and this\nI disagree.")).toBe("I disagree.");
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
