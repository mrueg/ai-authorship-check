/**
 * Cheap language checks. The model was trained on English; on other languages its
 * scores mean little, so the action skips text that clearly isn't English.
 */

/** Very common English words; few of them are words in other languages that use Latin letters. */
export const STOPWORDS = new Set(
  "the and to is it this that in for of with on not but be have can you i we a an are was if or as at so do".split(" "),
);

/**
 * More English function words for the lenient check, so terse technical English ("Refine X by
 * Y instead of Z") isn't mistaken for another language. Kept out of the corpus filter so the
 * corpus stays the same.
 */
const MORE_STOPWORDS = new Set(
  "by from after before instead when should would could which there their they my how what why where been has had then than also into only just about does using use used".split(" "),
);

interface Stats {
  letters: number;
  /** Share of letters that are A–Z. */
  latin: number;
  words: number;
  /** Share of words that are English stopwords. */
  stopwords: number;
  hits: number;
}

function stats(text: string, word: RegExp, stopwords: (w: string) => boolean): Stats {
  const letters = text.match(/\p{L}/gu) ?? [];
  const latin = letters.filter((ch) => /[A-Za-z]/.test(ch)).length;
  const words = text.toLowerCase().match(word) ?? [];
  const hits = words.filter(stopwords).length;
  return {
    letters: letters.length,
    latin: letters.length ? latin / letters.length : 0,
    words: words.length,
    stopwords: words.length ? hits / words.length : 0,
    hits,
  };
}

/** Strict check used to build the eval corpus: mostly Latin letters and enough common English words. */
export function isEnglish(text: string): boolean {
  const s = stats(text, /[a-z']+/g, (w) => STOPWORDS.has(w));
  return s.letters >= 20 && s.latin >= 0.95 && s.hits >= 3 && s.stopwords >= 0.12;
}

/**
 * Lenient check used by the action: true only when the text is clearly not English, so terse
 * English ("LGTM, CI passes on arm64 too") is still judged. Either most letters are outside
 * A–Z (Chinese, Cyrillic, ...), or a text of at least 20 words has almost no English
 * stopwords (German, French, Spanish, ...).
 */
export function isClearlyNotEnglish(text: string): boolean {
  // Whole words including accented letters: "vacía" must not count as "vac" + "a".
  const s = stats(text, /[\p{L}']+/gu, (w) => STOPWORDS.has(w) || MORE_STOPWORDS.has(w));
  if (s.letters < 20) return false;
  if (s.latin < 0.5) return true;
  return s.words >= 20 && s.stopwords < 0.05;
}
