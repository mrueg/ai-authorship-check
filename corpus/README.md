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

Prints AUROC, metrics per threshold, and the ❤️/👀/🚀 share per origin, kind, style and
generator.

## Known biases

- **Time:** human text is from 2019–2022 and AI text from 2026, so topics and tools differ
  (e.g. AI items mention newer frameworks). A model could partly learn the era instead of the
  author. Generated items reduce this, because they reuse the human items' contexts.
- **Disclosed AI is not typical AI:** people and agents that add a "Generated with" footer are
  mostly agentic coding tools, Claude Code in particular. Undisclosed AI text, the real
  target, may look different.
- **Pre-2023 is not proof of human authorship:** templates, copy-paste and pre-ChatGPT tools
  exist, but this is the cleanest large source available.

## Data

`corpus/data/` and the download cache `corpus/.cache/` are git-ignored. The items are public
GitHub content, but they are other people's text: rebuild them locally rather than
republishing. Author logins are never stored.
