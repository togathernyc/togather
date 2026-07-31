#!/bin/bash

# Completion Gate Hook (Stop)
#
# Refuses to end a session that leaves uncommitted TypeScript which does not
# compile. Exit 2 BLOCKS the stop and feeds stderr back to Claude as the reason;
# exit 0 lets it stop. Never exit 1 — that is only a non-blocking notice, so a
# real failure would slip past. Every "can't run the check" path is exit 0 on
# purpose: a wedged session is worse than an unchecked one.

set -uo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || exit 0
cd "$REPO_ROOT" || exit 0

INPUT="$(cat)"
# Claude re-runs Stop hooks after a block; this is what stops a failing
# typecheck from looping the session forever.
case "$INPUT" in
  *'"stop_hook_active":true'* | *'"stop_hook_active": true'*) exit 0 ;;
esac

# Staged, unstaged, untracked TS. Renames ("R old -> new") end in the new path.
CHANGED=$(git status --porcelain -- '*.ts' '*.tsx' 2>/dev/null | awk '{print $NF}')
[ -z "$CHANGED" ] && exit 0

if node -e 'process.exit(require("./package.json").scripts.typecheck?0:1)' 2>/dev/null; then
  CHECK_DIR="$REPO_ROOT"
  CHECK_CMD=(pnpm typecheck)
  LABEL="pnpm typecheck"
else
  # No root script today: fall back to tsc in the first affected workspace.
  WORKSPACE=$(printf '%s\n' "$CHANGED" | grep -oE '^(apps|packages)/[^/]+' | head -1)
  CHECK_DIR="$REPO_ROOT/${WORKSPACE:-.}"
  [ -f "$CHECK_DIR/tsconfig.json" ] || exit 0
  CHECK_CMD=(npx tsc --noEmit)
  LABEL="tsc --noEmit in ${WORKSPACE:-.}"
fi
LOG=$(mktemp)
trap 'rm -f "$LOG"' EXIT
(cd "$CHECK_DIR" && "${CHECK_CMD[@]}") >"$LOG" 2>&1 &
CHECK_PID=$!

# Portable 120s cap (macOS has no coreutils `timeout`).
for _ in $(seq 120); do
  kill -0 "$CHECK_PID" 2>/dev/null || break
  sleep 1
done
if kill -0 "$CHECK_PID" 2>/dev/null; then
  kill -9 "$CHECK_PID" 2>/dev/null
  exit 0 # too slow to gate on
fi
wait "$CHECK_PID"
STATUS=$?
[ $STATUS -eq 0 ] && exit 0

FIRST_ERROR=$(grep -m1 "error TS" "$LOG" | cut -c1-200)
echo "Completion gate: $LABEL failed on uncommitted TypeScript. ${FIRST_ERROR:-Run it locally for the full output.}" >&2
exit 2
