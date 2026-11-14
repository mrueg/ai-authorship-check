/**
 * Removes text the author did not write themselves (quotes, template
 * boilerplate) and text the model was not trained on (code, logs, stack traces, URLs).
 */
export function preprocess(body: string): string {
  // HTML comments: issue/PR template instructions, hidden bot metadata.
  let text = stripInvisible(normalizeNewlines(body)).replace(/<!--[\s\S]*?(?:-->|$)/g, "");

  text = stripFencedCode(text);

  // <details> blocks (also <details open>) are almost always pasted logs or stack traces.
  text = text.replace(/<details\b[^>]*>[\s\S]*?(?:<\/details>|$)/gi, "");

  text = stripQuotes(text)
    .split("\n")
    .filter((line) => !isBoilerplate(line.trim()))
    .join("\n");

  // Markdown images and links: keep link text, drop URLs.
  text = text.replace(/!\[[^\]]*\]\([^)]*\)/g, "");
  text = text.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1");
  text = text.replace(/<?https?:\/\/[^\s>)]+>?/g, "");

  // Remaining HTML tags.
  text = text.replace(/<\/?[a-z][^>]*>/gi, "");

  // Normalize whitespace: Unicode NFKC, collapse blank lines and runs of spaces.
  text = text.normalize("NFKC");
  text = text.replace(/[ \t]+/g, " ");
  text = text.replace(/\n{3,}/g, "\n\n");
  return text.trim();
}

/**
 * Lines the author didn't write as prose: section titles and leftover placeholders of
 * issue/PR templates, checklists, and pasted stack traces or log lines. Unfilled templates
 * were the main source of human texts scored as AI in the eval.
 */
const BOILERPLATE: RegExp[] = [
  /^_no response_$/i, // empty issue-form field
  // Section titles: "### Steps to reproduce", "**Expected behavior**", "__Version:__".
  /^#{1,6}(?:\s|$)/,
  /^(?:\*\*|__)[^*_]{1,80}(?:\*\*|__):?$/,
  // Task lists: "- [ ] I have read the contributing guide".
  /^[-*+]\s+\[[ xX]\]/,
  // Placeholders of GitHub's default bug and feature templates.
  /^a clear and concise description of\b/i,
  /^steps to reproduce the behaviou?r:?$/i,
  /^if applicable, add (?:screenshots|the error stacktrace) to help explain your problem\.?$/i,
  /^add any other context (?:about the problem|or screenshots about the feature request) here\b/i,
  /^\d+\.\s+(?:go to|click on|scroll down to)\s+'\.+'$/i,
  /^\d+\.\s+see error$/i,
  /\[e\.g\.[^\]]*\]/i, // "- OS: [e.g. iOS]"
  // Stack frames (JavaScript, Java, Python, Go, Rust) and log lines.
  /^traceback \(most recent call last\):$/i,
  /^file ".+", line \d+/i,
  /^caused by:\s/i,
  /^goroutine \d+ \[/,
  /^thread '.+' panicked at\b/,
  /^\[?\d{4}-\d\d-\d\d[T ]\d\d:\d\d/, // timestamped log line
  /^\[?(?:TRACE|DEBUG|INFO|WARN|WARNING|ERROR|FATAL)\]?(?::|\s)/,
];

/** "at foo (file.js:12:3)", "at com.x.Y.z(Y.java:42)". Two cheap tests instead of one backtracking regex. */
function isStackFrame(line: string): boolean {
  return /^at\s+\S/.test(line) && /:\d+(?::\d+)?\)?$/.test(line);
}

function isBoilerplate(line: string): boolean {
  return isStackFrame(line) || BOILERPLATE.some((re) => re.test(line));
}

/**
 * Zero-width characters, soft hyphens and bidi controls: invisible when rendered,
 * but they change tokens, so they are a cheap way to shift the model's score or
 * break up a signature ("Gene\u200Brated with …").
 */
const INVISIBLE = /[\u00AD\u180E\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/g;

export function stripInvisible(text: string): string {
  return text.replace(INVISIBLE, "");
}

export function normalizeNewlines(text: string): string {
  return text.replace(/\r\n?/g, "\n");
}

/**
 * Removes fenced code blocks, including unterminated ones. Follows CommonMark: a
 * fence is 3+ backticks or tildes, and only a fence of the same character, at
 * least as long, with nothing after it closes the block. So ```` can wrap ```,
 * and a ```python line inside a block is content, not a closing fence.
 */
export function stripFencedCode(text: string): string {
  const kept: string[] = [];
  let open: { char: string; length: number } | undefined;
  for (const line of text.split("\n")) {
    if (!open) {
      const m = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
      // A backtick fence's info string can't contain backticks (``` x ``` is inline code).
      if (m && !(m[1]![0] === "`" && m[2]!.includes("`"))) {
        open = { char: m[1]![0]!, length: m[1]!.length };
        kept.push(""); // keep the text before and after as separate paragraphs
      } else {
        kept.push(line);
      }
    } else {
      const m = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(line);
      if (m && m[1]![0] === open.char && m[1]!.length >= open.length) open = undefined;
    }
  }
  return kept.join("\n");
}

/** Removes quoted lines ("> ..."): text the author is replying to, not their own. */
export function stripQuotes(text: string): string {
  return text
    .split("\n")
    .filter((line) => !line.trim().startsWith(">"))
    .join("\n");
}
