/**
 * Removes text the author did not write themselves (quotes, template
 * boilerplate) and text the model was not trained on (code, logs, URLs).
 */
export function preprocess(body: string): string {
  // HTML comments: issue/PR template instructions, hidden bot metadata.
  let text = stripInvisible(normalizeNewlines(body)).replace(/<!--[\s\S]*?(?:-->|$)/g, "");

  text = stripFencedCode(text);

  // <details> blocks are almost always pasted logs or stack traces.
  text = text.replace(/<details>[\s\S]*?(?:<\/details>|$)/gi, "");

  text = stripQuotes(text)
    .split("\n")
    .filter((line) => !/^_no response_$/i.test(line.trim())) // empty issue-form field
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

/** Removes fenced code blocks (``` or ~~~), including unterminated ones. */
export function stripFencedCode(text: string): string {
  return text.replace(/^ {0,3}(```|~~~)[^\n]*\n[\s\S]*?(?:^ {0,3}\1[^\n]*$|(?![\s\S]))/gm, "");
}

/** Removes quoted lines ("> ..."): text the author is replying to, not their own. */
export function stripQuotes(text: string): string {
  return text
    .split("\n")
    .filter((line) => !line.trim().startsWith(">"))
    .join("\n");
}
