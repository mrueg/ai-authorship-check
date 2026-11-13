/**
 * Removes text the author did not write themselves (quotes, template
 * boilerplate) and text the model was not trained on (code, logs, URLs).
 */
export function preprocess(body: string): string {
  let text = body.replace(/\r\n?/g, "\n");

  // HTML comments: issue/PR template instructions, hidden bot metadata.
  text = text.replace(/<!--[\s\S]*?(?:-->|$)/g, "");

  // Fenced code blocks (``` or ~~~), including unterminated ones.
  text = text.replace(/^ {0,3}(```|~~~)[^\n]*\n[\s\S]*?(?:^ {0,3}\1[^\n]*$|(?![\s\S]))/gm, "");

  // <details> blocks are almost always pasted logs or stack traces.
  text = text.replace(/<details>[\s\S]*?(?:<\/details>|$)/gi, "");

  const lines = text.split("\n").filter((line) => {
    const t = line.trim();
    if (t.startsWith(">")) return false; // quoted reply
    if (/^_no response_$/i.test(t)) return false; // empty issue-form field
    return true;
  });
  text = lines.join("\n");

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
