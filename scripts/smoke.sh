#!/usr/bin/env bash
# Runs the action image against sample events in dry-run mode and checks the outputs.
#   scripts/smoke.sh <image>
set -euo pipefail
image="${1:?usage: smoke.sh <image>}"
root="$(cd "$(dirname "$0")/.." && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
fail=0

# check <fixture> <event-name> <expected verdict: human|undecided|ai|skipped|judged> [log-pattern] [docker args...]
# log-pattern, if not empty, must appear in the action's log; extra docker args (e.g. -e INPUT_...) override inputs.
check() {
  local fixture="$1" event="$2" want="$3" pattern="${4:-}"
  shift 3; shift $(( $# > 0 ? 1 : 0 ))
  : > "$work/output"
  : > "$work/summary"
  docker run --rm \
    -v "$root/test/fixtures:/fixtures:ro" -v "$work:/work" \
    -e GITHUB_EVENT_NAME="$event" -e GITHUB_EVENT_PATH="/fixtures/$fixture" \
    -e GITHUB_REPOSITORY=owner/repo -e GITHUB_OUTPUT=/work/output -e GITHUB_STEP_SUMMARY=/work/summary \
    -e INPUT_GITHUB-TOKEN=unused -e INPUT_HUMAN-THRESHOLD=0.3 -e INPUT_AI-THRESHOLD=0.8 \
    -e INPUT_HUMAN-REACTION=heart -e INPUT_UNDECIDED-REACTION=eyes -e INPUT_AI-REACTION=rocket -e INPUT_MIN-LENGTH=40 -e INPUT_MAX-TOKENS=2048 \
    -e INPUT_SKIP-ASSOCIATIONS=OWNER,MEMBER -e INPUT_SIGNATURE-CHECK=true -e INPUT_ADD-LABEL=false \
    -e INPUT_LABEL-NAME=possibly-ai-generated -e INPUT_DRY-RUN=true \
    -e INPUT_LONG-TEXT=truncate -e INPUT_FAIL-ON-ERROR=false \
    "$@" "$image" | tee "$work/log" | sed 's/^/    /'
  local got p
  got="$(awk '/^verdict<</{getline; print; exit}' "$work/output")"
  p="$(awk '/^p-ai<</{getline; print; exit}' "$work/output")"
  if [[ -n "$pattern" ]] && ! grep -q -- "$pattern" "$work/log"; then
    echo "FAIL $fixture: log has no \"$pattern\""
    fail=1
  elif [[ "$got" == "$want" ]] || [[ "$want" == judged && ( "$got" == human || "$got" == undecided || "$got" == ai ) && -n "$p" ]]; then
    echo "ok   $fixture: verdict=$got p-ai=${p:-–}"
  else
    echo "FAIL $fixture: verdict=$got p-ai=${p:-–}, expected $want"
    fail=1
  fi
}

check issue_opened.json issues judged
check comment_signature.json issue_comment ai
check comment_bot.json issue_comment skipped
# Long text with a small max-tokens: truncate reads one input, chunks reads several.
check issue_long.json issues judged "truncated" -e INPUT_MAX-TOKENS=64
check issue_long.json issues judged "4 chunks, truncated" -e INPUT_MAX-TOKENS=64 -e INPUT_LONG-TEXT=chunks
exit "$fail"
