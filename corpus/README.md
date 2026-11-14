# Eval corpus

Labeled GitHub text for measuring the classifier and choosing `human-threshold` and
`ai-threshold`. Built from public data; the data itself is not committed (see *Data* below).

| Part | File | Label | Source |
|---|---|---|---|
| Human | `human.jsonl` | human | GH Archive, 16 sampled hours from 2019 to Oct 2022, before ChatGPT launched (2022-11-30). Issues, PR descriptions, issue comments, review comments. |
| Disclosed AI | `wild-ai.jsonl` | ai | GH Archive, one hour per day from 2026-10-01 to 2026-11-12: issues and comments carrying an AI-tool signature ("🤖 Generated with Claude Code", ...). The signature footer is **removed**, so the eval measures the model, not the signature check. |
| Generated AI | `generated.jsonl` | ai | Written with the Copilot CLI for the same context as a human item (repo, title, parent post or diff), in three styles: `scratch` (written from the context), `casual` (told to sound like a busy developer) and `rewrite` (the human draft "improved" by the model, the AI-edited hard case). Models rotate, so each covers every style and kind. |

All items share one schema (`corpus/lib.ts`, `CorpusItem`). The text is stored raw; the eval
runs the action's own preprocessing.

## Building

```sh
node corpus/collect.ts human   > corpus/data/human.jsonl     # ~1.2 GB of downloads, cached
node corpus/collect.ts wild-ai > corpus/data/wild-ai.jsonl   # ~0.5 GB
node corpus/generate.ts --models <id,id,...> --limit 600     # spends Copilot AI credits
node corpus/build.ts                                         # → corpus/data/corpus.jsonl + summary
```

Collection is deterministic: the same hours, filters and seeded sampling give the same items.

**Filters** (both collected parts): no bot accounts, English only (heuristic), 40–20,000
characters after preprocessing, no duplicate texts, at most one item per author and two per
repository. Human items with any AI signature are dropped.

**Splits:** every item is assigned `dev` or `test` by a hash of its repository, so text from
one repository never ends up in both. Generated items inherit the split of the human item
they were written for. Tune thresholds on `dev`, report final numbers on `test` only.

## Evaluating

```sh
docker run --rm -v "$PWD/corpus/data:/data" --entrypoint node ghcr.io/mrueg/ai-authorship-check:v0.1.0 \
  /app/dist/eval.js /data/corpus.jsonl --split dev --scores /data/scores-dev.jsonl
```

Or run the **Eval** workflow (Actions → Eval → Run workflow), which rebuilds the corpus,
builds the image with the real model and writes the results to the job summary. Per-item
scores (`scores.jsonl`, with the raw text) are kept as a 14-day artifact.

### Reading the output

- **AUROC**: the chance that a random AI item scores above a random human item. 0.5 is a
  coin flip, 1.0 is perfect separation. It doesn't depend on the thresholds.
- **ai-threshold table**: for each candidate `ai-threshold`, how often 🚀 is right
  (`precision`), how many AI items get 🚀 (`recall`) and, most important, how many human
  items get 🚀 (`human-FPR`). Every false 🚀 is a real person told their text looks
  machine-written, so pick the threshold from the human-FPR you can live with.
- **human-threshold table**: the same for ❤️; `AI-as-human` is the share of AI items that
  get ❤️. A wrong ❤️ costs less than a wrong 🚀.
- **Slices** (origin, kind, length in tokens, style, generator): the ❤️/👀/🚀 share at the
  thresholds passed with `--human-threshold`/`--ai-threshold`. Use them to find where the
  model fails, not to tune: a slice has few items, and five items at 80% is four texts.

Tune on `--split dev`, then run `--split test` once to report the numbers. Re-tuning after
looking at `test` turns it into a second dev set.

### Results

Vanguard (fp32), GH Archive parts only, November 2026. Human-FPR is the share of human items
that get 🚀.

| Split | Cleanup | Items | AUROC | `ai-threshold` 0.8: FPR / recall | 0.95: FPR / recall |
|---|---|---|---|---|---|
| dev | v0.1.0 | 974 | 0.838 | 12.3% / 63% | 6.6% / 46% |
| test | v0.1.0 | 967 | 0.829 | 13.7% / 60% | 8.0% / 50% |
| dev | + template, stack-trace and log lines removed | 975 | 0.872 | 7.6% / 57% | 2.8% / 41% |

The default `ai-threshold` is 0.95: a wrong 🚀 is the costly mistake, and at 0.8 one human
text in eight got one. Most of those were unfilled issue and PR templates, which the cleanup
now removes. Texts over 2048 tokens are rare on GitHub (5 of 967 test items, all AI), so
`long-text: chunks` scored the same as `truncate` here.

## Known biases

- **Time:** human text is from 2019–2022 and AI text from 2026, so topics and tools differ
  (e.g. AI items mention newer frameworks). A model could partly learn the era instead of the
  author. Generated items reduce this, because they reuse the human items' contexts.
- **Disclosed AI is not typical AI:** people and agents that add a "Generated with" footer are
  mostly agentic coding tools, Claude Code in particular. Undisclosed AI text, the real
  target, may look different.
- **"Disclosed" is not "written entirely by AI":** the AI label comes from a tool footer,
  but the person may have edited the text, or written most of it and let the tool add a
  section. Some "AI" items are partly human, so precision and recall are pessimistic.
- **Short texts:** under about 128 tokens (a few sentences) the model sees too little; AI
  items that short mostly get ❤️ or 👀. `min-length` only removes the very shortest.
- **Templates:** issues and PRs often carry their repository's template. Unfilled template
  text is the author's in name only, and it looks generic enough to score as AI. The action's
  cleanup removes the common cases (see the main README); unusual templates get through.
- **Pre-2023 is not proof of human authorship:** templates, copy-paste and pre-ChatGPT tools
  exist, but this is the cleanest large source available.

## Data

`corpus/data/` and the download cache `corpus/.cache/` are git-ignored. The items are public
GitHub content, but they are other people's text: rebuild them locally rather than
republishing. Author logins are never stored.
