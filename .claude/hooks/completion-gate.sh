#!/bin/bash

# Completion Gate Hook (Stop)
#
# Blocks a session from ending while a file IT touched has a TypeScript error.
# Exit 2 blocks the stop and feeds stderr back as the reason; exit 0 lets it go.
# Never exit 1 — that is only a non-blocking notice, so a real failure would
# slip past.
#
# Two rules keep this from crying wolf:
#
#   1. Only errors in files with uncommitted changes count. This repo has a
#      pre-existing tsc baseline that has never been enforced (20 errors in
#      apps/mobile alone; nothing in CI runs tsc), so an unfiltered check would
#      report someone else's bug as yours and block every session.
#   2. Anything that is not a genuine type error fails open — missing deps,
#      offline npx, OOM, no tsconfig, timeout, a conflicted merge. We only ever
#      block on an "error TS" line whose file we touched.
#
# There is deliberately no root-tsconfig fallback: the root tsconfig.json sets
# no include/exclude, so tsc walks the whole monorepo (2,933 errors, ~59s). If
# no workspace matches the changed files, this exits 0.

set -uo pipefail

MAX_BLOCKS=2 # per session; after this the gate stands down rather than loop
BUDGET=120   # seconds, across all workspaces

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || exit 0
cd "$REPO_ROOT" || exit 0

# Claude always pipes hook JSON in. A tty means a human ran this by hand, and
# `cat` would otherwise block until the hook timeout.
if [ -t 0 ]; then INPUT=""; else INPUT="$(cat)"; fi

# Mid-merge/rebase the tree is full of conflict markers that are not ours.
git rev-parse -q --verify MERGE_HEAD >/dev/null 2>&1 && exit 0
git rev-parse -q --verify REBASE_HEAD >/dev/null 2>&1 && exit 0

# Tracked edits (renames report the new path) plus untracked files. -z keeps
# paths containing spaces intact.
CHANGED=$( {
  git diff --name-only -z HEAD -- '*.ts' '*.tsx'
  git ls-files --others --exclude-standard -z -- '*.ts' '*.tsx'
} 2>/dev/null | tr '\0' '\n' | sort -u)
[ -z "$CHANGED" ] && exit 0

WORKSPACES=$(printf '%s\n' "$CHANGED" | grep -oE '^(apps|packages)/[^/]+' | sort -u)
[ -z "$WORKSPACES" ] && exit 0

# NOTE: stop_hook_active is deliberately NOT used as a bail-out. The /goal
# command registers its own Stop hook, and once that blocks, stop_hook_active
# stays true for the rest of the session — which would permanently disable this
# gate in exactly the unattended loops it exists to protect. Instead we count
# our OWN consecutive blocks, keyed by session, and stand down after MAX_BLOCKS.
SESSION=$(printf '%s' "$INPUT" |
  python3 -c 'import json,sys; print(json.load(sys.stdin).get("session_id",""))' 2>/dev/null |
  tr -cd '[:alnum:]._-')
STATE="/tmp/claude-completion-gate-${SESSION:-nosession}"

LOG=$(mktemp)
trap 'rm -f "$LOG"' EXIT
DEADLINE=$(($(date +%s) + BUDGET))
BLOCKER=""
BLOCK_WS=""

for WS in $WORKSPACES; do
  [ -f "$WS/tsconfig.json" ] || continue
  [ "$(date +%s)" -ge "$DEADLINE" ] && break

  # --pretty false keeps the "path(line,col): error TSxxxx:" shape stable;
  # --no-install stops npx reaching for the network when deps are missing.
  (cd "$WS" && npx --no-install tsc --noEmit --pretty false) >"$LOG" 2>&1 &
  CHECK_PID=$!
  while kill -0 "$CHECK_PID" 2>/dev/null; do
    if [ "$(date +%s)" -ge "$DEADLINE" ]; then
      pkill -P "$CHECK_PID" 2>/dev/null # tsc is a child of the subshell
      kill -9 "$CHECK_PID" 2>/dev/null
      break
    fi
    sleep 1
  done
  wait "$CHECK_PID" 2>/dev/null

  # tsc reports paths relative to the workspace it ran in.
  WS_FILES=$(printf '%s\n' "$CHANGED" | sed -n "s|^$WS/||p")
  BLOCKER=$(awk -v list="$WS_FILES" '
    BEGIN { n = split(list, a, "\n"); for (i = 1; i <= n; i++) if (a[i] != "") want[a[i]] = 1 }
    /error TS/ { f = $0; sub(/\(.*/, "", f); if (f in want) { print; exit } }
  ' "$LOG")
  if [ -n "$BLOCKER" ]; then
    BLOCK_WS="$WS"
    break
  fi
done

# Clean run, or nothing we could check: reset the counter and let it stop.
if [ -z "$BLOCKER" ]; then
  rm -f "$STATE"
  exit 0
fi

COUNT=$(cat "$STATE" 2>/dev/null)
case "$COUNT" in '' | *[!0-9]*) COUNT=0 ;; esac
if [ "$COUNT" -ge "$MAX_BLOCKS" ]; then
  # Reported twice and still broken. Say so, but let the session end rather
  # than trap it. The state file stays, so we remain stood down until a pass.
  echo "Completion gate: still failing after $MAX_BLOCKS reports; standing down. $BLOCK_WS: $BLOCKER" >&2
  exit 0
fi
echo $((COUNT + 1)) >"$STATE"
echo "Completion gate: uncommitted TypeScript you changed does not compile. $BLOCK_WS: $(printf '%s' "$BLOCKER" | cut -c1-200)" >&2
exit 2
