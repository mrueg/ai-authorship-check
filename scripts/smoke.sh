#!/usr/bin/env bash
# Runs the action image against sample events in dry-run mode and checks the outputs.
#   scripts/smoke.sh <image>
set -euo pipefail
image="${1:?usage: smoke.sh <image>}"
root="$(cd "$(dirname "$0")/.." && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
fail=0

# check <fixture> <event-name> <expected verdict: human|undecided|ai|skipped|judged>
check() {
  local fixture="$1" event="$2" want="$3"
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
    "$image" | sed 's/^/    /'
  local got p
  got="$(awk '/^verdict<</{getline; print; exit}' "$work/output")"
  p="$(awk '/^p-ai<</{getline; print; exit}' "$work/output")"
  if [[ "$got" == "$want" ]] || [[ "$want" == judged && ( "$got" == human || "$got" == undecided || "$got" == ai ) && -n "$p" ]]; then
    echo "ok   $fixture: verdict=$got p-ai=${p:-–}"
  else
    echo "FAIL $fixture: verdict=$got p-ai=${p:-–}, expected $want"
    fail=1
  fi
}

check issue_opened.json issues judged
check comment_signature.json issue_comment ai
check comment_bot.json issue_comment skipped
exit "$fail"
