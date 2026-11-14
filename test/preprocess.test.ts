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
    expect(preprocess("### Version\n\n_No response_\n\n### What happened\n\nIt broke")).toBe("It broke");
  });

  it("removes template section titles, checklists and stock placeholders", () => {
    const unfilled = [
      "**Describe the bug**",
      "A clear and concise description of what the bug is.",
      "",
      "**To Reproduce**",
      "Steps to reproduce the behavior:",
      "1. Go to '...'",
      "2. Click on '....'",
      "4. See error",
      "",
      "**Desktop (please complete the following information):**",
      " - OS: [e.g. iOS]",
      " - Browser [e.g. chrome, safari]",
      "",
      "**Screenshots**",
      "If applicable, add screenshots to help explain your problem.",
      "",
      "## Checklist",
      "- [x] I have read the contributing guide",
      "* [ ] Tests are included",
      "",
      "Add any other context about the problem here.",
    ].join("\n");
    expect(preprocess(unfilled)).toBe("");
    expect(preprocess("### Steps\n1. Open the app\n2. It crashes\n\n**Expected:** no crash")).toBe(
      "1. Open the app\n2. It crashes\n\n**Expected:** no crash",
    );
  });

  it("removes stack frames and log lines", () => {
    const pasted = [
      "It crashes when I paste a list:",
      "Uncaught TypeError: Cannot read property 'innerText' of null",
      "    at _buildList (word_paste.js:494)",
      "    at Object.clean (word_paste.js:130:12)",
      "\tat com.example.Foo.bar(Foo.java:42)",
      "Caused by: java.io.IOException: boom",
      "Traceback (most recent call last):",
      '  File "app.py", line 3, in <module>',
      "goroutine 1 [running]:",
      "thread 'main' panicked at src/main.rs:2:5:",
      "2024-01-02T03:04:05Z server started",
      "[ERROR] connection refused",
      "WARN: retrying",
      "Any idea what is going on?",
    ].join("\n");
    expect(preprocess(pasted)).toBe(
      "It crashes when I paste a list:\nUncaught TypeError: Cannot read property 'innerText' of null\nAny idea what is going on?",
    );
    // Prose that merely starts like a frame or a level stays.
    expect(preprocess("at least on Linux it works")).toBe("at least on Linux it works");
    expect(preprocess("Error handling is missing here.")).toBe("Error handling is missing here.");
  });

  it("stays fast on long adversarial lines", () => {
    const t0 = Date.now();
    preprocess("at x" + " (a:1".repeat(20_000));
    preprocess("**" + "a".repeat(60_000));
    preprocess("[e.g." + "]".repeat(60_000));
    expect(Date.now() - t0).toBeLessThan(500);
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
