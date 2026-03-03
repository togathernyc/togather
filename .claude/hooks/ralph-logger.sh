#!/bin/bash

# Ralph Loop Logger Hook
# Logs iteration progress to a file for visibility
# This hook runs ALONGSIDE the ralph-loop plugin's stop hook

set -euo pipefail

# Configuration
RALPH_STATE_FILE=".claude/ralph-loop.local.md"
LOG_DIR=".claude/logs"
mkdir -p "$LOG_DIR"

# Only run if ralph-loop is active
if [[ ! -f "$RALPH_STATE_FILE" ]]; then
  exit 0
fi

# Parse frontmatter (use || true to prevent exit on no match)
FRONTMATTER=$(sed -n '/^---$/,/^---$/{ /^---$/d; p; }' "$RALPH_STATE_FILE")
ITERATION=$(echo "$FRONTMATTER" | grep '^iteration:' | sed 's/iteration: *//' || true)
MAX_ITERATIONS=$(echo "$FRONTMATTER" | grep '^max_iterations:' | sed 's/max_iterations: *//' || true)
STARTED_AT=$(echo "$FRONTMATTER" | grep '^started_at:' | sed 's/started_at: *//' | tr -d '"' || true)
COMPLETION_PROMISE=$(echo "$FRONTMATTER" | grep '^completion_promise:' | sed 's/completion_promise: *//' | sed 's/^"\(.*\)"$/\1/' || true)

# Determine log file - use date from started_at or create new session
SESSION_DATE=$(echo "$STARTED_AT" | cut -d'T' -f1 | tr -d '-')
SESSION_TIME=$(echo "$STARTED_AT" | cut -d'T' -f2 | cut -d':' -f1-2 | tr -d ':')
LOG_FILE="$LOG_DIR/ralph-session-${SESSION_DATE}-${SESSION_TIME}.log"

# Get hook input to check for completion
HOOK_INPUT=$(cat)
TRANSCRIPT_PATH=$(echo "$HOOK_INPUT" | jq -r '.transcript_path // ""')

# Calculate runtime
if [[ -n "$STARTED_AT" ]]; then
  START_EPOCH=$(date -j -f "%Y-%m-%dT%H:%M:%SZ" "$STARTED_AT" "+%s" 2>/dev/null || date -d "$STARTED_AT" "+%s" 2>/dev/null || echo "0")
  NOW_EPOCH=$(date "+%s")
  if [[ "$START_EPOCH" -gt 0 ]]; then
    RUNTIME_SECS=$((NOW_EPOCH - START_EPOCH))
    RUNTIME_HRS=$((RUNTIME_SECS / 3600))
    RUNTIME_MINS=$(((RUNTIME_SECS % 3600) / 60))
    RUNTIME="${RUNTIME_HRS}h ${RUNTIME_MINS}m"
  else
    RUNTIME="unknown"
  fi
else
  RUNTIME="unknown"
fi

# Check what happened in this iteration
STATUS="continuing"
if [[ -n "$TRANSCRIPT_PATH" ]] && [[ -f "$TRANSCRIPT_PATH" ]]; then
  # Get last assistant message
  LAST_OUTPUT=$(grep '"role":"assistant"' "$TRANSCRIPT_PATH" | tail -1 | jq -r '.message.content | map(select(.type == "text")) | map(.text) | join("\n")' 2>/dev/null || echo "")

  # Check for completion promise
  if [[ "$COMPLETION_PROMISE" != "null" ]] && [[ -n "$COMPLETION_PROMISE" ]]; then
    if echo "$LAST_OUTPUT" | grep -q "<promise>$COMPLETION_PROMISE</promise>"; then
      STATUS="COMPLETED"
    fi
  fi

  # Check for errors or stuck indicators
  if echo "$LAST_OUTPUT" | grep -qi "error\|exception\|failed\|stuck\|cannot"; then
    STATUS="error-detected"
  fi

  # Get a brief summary (first 200 chars of last output)
  SUMMARY=$(echo "$LAST_OUTPUT" | head -c 200 | tr '\n' ' ')
else
  SUMMARY="(no transcript available)"
fi

# Log entry
TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')
{
  echo "================================================================================"
  echo "[$TIMESTAMP] Iteration $ITERATION complete (runtime: $RUNTIME)"
  echo "Status: $STATUS"
  echo "Max iterations: $MAX_ITERATIONS ($(if [[ $MAX_ITERATIONS -eq 0 ]]; then echo "unlimited"; else echo "$((MAX_ITERATIONS - ITERATION)) remaining"; fi))"
  echo "Completion promise: $COMPLETION_PROMISE"
  echo "--------------------------------------------------------------------------------"
  echo "Summary: ${SUMMARY:0:500}..."
  echo "================================================================================"
  echo ""
} >> "$LOG_FILE"

# Also output to stderr so it's visible in terminal
echo "📝 Ralph logger: Iteration $ITERATION logged to $LOG_FILE (status: $STATUS, runtime: $RUNTIME)" >&2

# Always exit 0 - we're just logging, not blocking
exit 0
