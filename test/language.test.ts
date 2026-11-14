import { describe, expect, it } from "vitest";
import { isClearlyNotEnglish, isEnglish } from "../src/language.ts";

describe("isClearlyNotEnglish", () => {
  it.each([
    "在启动时崩溃，日志中没有任何错误信息，请帮忙看看是什么原因导致的问题",
    "При запуске приложение падает, в логах нет никаких ошибок, подскажите пожалуйста в чём дело",
    "起動時にクラッシュします。ログにはエラーが出ていません。原因を教えてください。",
    "Das Problem tritt auf, wenn die Datei nicht existiert und der Pfad leer ist. Ich habe es mit der neuesten Version getestet, aber es passiert immer noch.",
    "Le problème se produit quand le fichier n'existe pas et que le chemin est vide. J'ai testé avec la dernière version mais ça arrive encore.",
    "El problema ocurre cuando el archivo no existe y la ruta está vacía. Lo probé con la última versión pero sigue pasando igual que antes.",
    "O problema acontece quando o arquivo não existe e o caminho está vazio. Testei com a versão mais recente mas continua acontecendo sempre.",
  ])("flags %j", (text) => {
    expect(isClearlyNotEnglish(text)).toBe(true);
  });

  it.each([
    "I tried this on the latest version and it is still broken for me, but only on Linux.",
    "LGTM, CI passes on arm64 too.",
    "Refine metric item stringer by string builder write methods instead of `fmt.Fprintf`. Benchmark result before refinement: Benchmark result after refinement:",
    "Bump lodash from 4.17.20 to 4.17.21 in /frontend, fixes CVE-2021-23337 prototype pollution via template function.",
    "短い",
  ])("lets English and short text through: %j", (text) => {
    expect(isClearlyNotEnglish(text)).toBe(false);
  });
});

describe("isEnglish (corpus filter)", () => {
  it("accepts English and rejects other languages", () => {
    expect(isEnglish("I tried this on the latest version and it is still broken for me, but only on Linux.")).toBe(true);
    expect(isEnglish("Das Problem tritt auf, wenn die Datei nicht existiert und der Pfad leer ist.")).toBe(false);
  });
});
