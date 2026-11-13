# AI Authorship Check

A GitHub Action that reads new issues, pull requests and comments and reacts with how it
thinks they were written:

| Reaction | Meaning | When |
|---|---|---|
| ❤️ | More likely written by a human | P(AI) < `human-threshold` (0.3) |
| 👀 | Undecided | in between |
| 🚀 | More likely AI-generated | P(AI) ≥ `ai-threshold` (0.8) |

The reactions are deliberately friendly: detection is a guess, and nobody should feel accused
by a bot. All three can be changed or turned off.

Classification runs **locally on the runner** with
[Vanguard](https://huggingface.co/ShantanuT01/vanguard-ai-text-detector), a ModernBERT-large
AI-text detector (MIT, 2nd place at PAN-CLEF 2026), exported to int8 ONNX. No API key, no
external service, and comment text never leaves the runner.

## Usage

```yaml
# .github/workflows/ai-authorship-check.yml
name: AI Authorship Check
on:
  issues:              { types: [opened, edited] }
  issue_comment:       { types: [created, edited] }
  pull_request_target: { types: [opened, edited] }
  # pull_request_review_comment: { types: [created, edited] }

permissions:
  issues: write
  pull-requests: write

concurrency:
  group: ai-authorship-check-${{ github.event.comment.id || github.event.issue.number || github.event.pull_request.number }}
  cancel-in-progress: true

jobs:
  ai-authorship-check:
    runs-on: ubuntu-latest
    steps:
      - uses: mrueg/ai-authorship-check@v0.1.0
        with:
          dry-run: true   # watch the verdicts in the job summary first, then remove this
```

`pull_request_target` is used so PRs from forks get a token that can add reactions. This is
safe here because the action **never checks out or runs PR code** — it only reads the event
payload. Don't add a checkout step to this workflow.

## How it decides

```
event → skip? → AI signature? → clean up text → Vanguard → P(AI) → ❤️ / 👀 / 🚀
```

1. **Skip**: bots (`[bot]` logins, `type: Bot`), authors whose association is in
   `skip-associations` (owners and members by default), empty bodies, and edits that didn't
   change the body.
2. **Signature check**: explicit AI-tool markers such as `🤖 Generated with Claude Code` or a
   `Co-Authored-By: Claude …` trailer give 🚀 without running the model. Runs on the raw text,
   because these markers often sit in footers and HTML comments.
3. **Cleanup**: removes what the author didn't write or the model wasn't trained on: HTML
   comments (template instructions), fenced code, `<details>` logs, quoted replies, empty
   issue-form fields, URLs and images. Texts shorter than `min-length` afterwards are skipped.
4. **Model**: P(AI) = sigmoid(logit) from Vanguard, reading up to `max-tokens` tokens.
5. **React**: ❤️ below `human-threshold`, 🚀 at or above `ai-threshold`, 👀 in between. On
   edits the action first removes its own earlier reaction, so there is always one verdict.

## Inputs

| Input | Default | |
|---|---|---|
| `human-threshold` | `0.3` | ❤️ when P(AI) is below this. |
| `ai-threshold` | `0.8` | 🚀 when P(AI) is at or above this; 👀 in between. Higher = fewer real people flagged. |
| `human-reaction` | `heart` | Any of `+1 -1 laugh confused heart hooray rocket eyes`, or `none`. |
| `undecided-reaction` | `eyes` | 〃 |
| `ai-reaction` | `rocket` | 〃 |
| `min-length` | `40` | Skip shorter texts (after cleanup). |
| `max-tokens` | `2048` | Truncate longer texts. |
| `skip-associations` | `OWNER,MEMBER` | Never judge these authors. |
| `signature-check` | `true` | 🚀 on explicit AI-tool signatures, without running the model. |
| `add-label` | `false` | Also label issues/PRs judged AI (removed if an edit flips it). |
| `label-name` | `possibly-ai-generated` | |
| `dry-run` | `false` | Classify and report, but don't react or label. |
| `github-token` | `${{ github.token }}` | |

Outputs: `verdict` (`human` / `undecided` / `ai` / `skipped`), `p-ai`, `reason`. Each run also writes a
job summary.

## Limitations

AI-text detection is unreliable, and this action should start conversations, not end them.
Vanguard was not trained on GitHub text; short comments, non-native English, and AI drafts a
person edited are all hard cases. The default thresholds give a wide 👀 band on purpose and
should be tuned on real data from your repos (see *Evaluating* below).

## Development

```sh
npm ci --ignore-scripts
npm run typecheck && npm test

# Full container test with a tiny random model (fast, no 1.6 GB download):
docker build --build-arg MODEL_TINY=true -t ai-authorship-check:smoke .
./scripts/smoke.sh ai-authorship-check:smoke
```

### The model

`model/export.py` downloads Vanguard at a pinned commit, exports it to ONNX, quantizes it to
int8, and **fails the build** if the ONNX model drifts from PyTorch (fp32 > 1e-3, int8 > 0.1).
The Docker build runs it; the result (with sha256 and check results in `/model/MODEL_INFO.json`)
is baked into the image. Exporting the real model needs about 8 GB of RAM, so it is built in CI.

To use a different single-logit classifier, build with
`--build-arg MODEL_REPO=… --build-arg MODEL_REVISION=<commit sha>`.

### Evaluating

```sh
# data.jsonl: {"text": "...", "label": "human" | "ai"} per line
docker run --rm -v "$PWD:/data" --entrypoint node ghcr.io/mrueg/ai-authorship-check:v0.1.0 \
  /app/dist/eval.js /data/data.jsonl
```

Or run the **Eval** workflow (Actions → Eval → Run workflow): it rebuilds the corpus from GH
Archive (see [`corpus/`](corpus/README.md)), builds the image with the real model and posts
the results to the job summary.

Prints AUROC, then for each `ai-threshold` the 🚀 precision/recall and the share of humans who
would get 🚀, and for each `human-threshold` the ❤️ precision/recall and the share of AI texts
that would get ❤️.

### Releasing

1. Tag `vX.Y.Z` and push; `.github/workflows/image.yml` builds the image with the real model,
   pushes `ghcr.io/mrueg/ai-authorship-check:vX.Y.Z` and smoke-tests it.
2. Make the GHCR package public.
3. Update `runs.image` in `action.yml` to the new tag (ideally pinned by digest), then move the
   `vX.Y.Z` git tag to that commit.

## License

[MIT](LICENSE). The bundled model, [Vanguard](https://huggingface.co/ShantanuT01/vanguard-ai-text-detector),
is also MIT-licensed by its author.
