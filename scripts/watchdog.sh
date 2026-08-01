#!/bin/bash
#
# Fleet watchdog — the manager layer above the orchestrators.
#
# It never edits code and never implements anything. It detects, diagnoses with
# nothing but bash + gh + ccusage (there is no model call anywhere in here, so a
# run costs $0), and escalates with precision. The respawn ladder lives inside
# the overnight supervisor; this catches what a supervisor cannot see about
# itself — that it died, that it is burning money, that it left a claim behind.
#
# Runs every 30 minutes from launchd. Exits in well under a second when the
# machine is idle. Writes one line to a log when everything is fine, because
# silence is the product: if this thing is talking to you, something is wrong.
#
#   ./scripts/watchdog.sh                  # a real run
#   WATCHDOG_DRY_RUN=1 ./scripts/watchdog.sh   # diagnose, mutate nothing
#
# Thresholds live in scripts/watchdog.config.sh. Install instructions are in
# scripts/com.supa.fleet-watchdog.plist and .github/GARDENERS.md § "Watchdog".

# NOT `set -e`. A watchdog that dies on one flaky `gh` call is strictly worse
# than one that reports four findings out of five — the whole point is to still
# be standing when things are going wrong. Every command that matters is checked
# by hand instead.
set -uo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
REPO_ROOT=$(cd "$SCRIPT_DIR/.." && pwd)
cd "$REPO_ROOT" || exit 1

# shellcheck source=scripts/watchdog.config.sh
. "${WATCHDOG_CONFIG:-$SCRIPT_DIR/watchdog.config.sh}"

DRY_RUN=${WATCHDOG_DRY_RUN:-0}

# The configured paths are repo-relative by default but must survive being set
# to an absolute path (which is how you point a test run at a fixture, and how
# anyone running the watchdog against a second checkout will write it).
abs_path() { case "$1" in /*) printf '%s' "$1" ;; *) printf '%s/%s' "$REPO_ROOT" "$1" ;; esac; }
STATE_DIR=$(abs_path "$WATCHDOG_STATE_DIR")
OVERNIGHT_DIR=$(abs_path "$WATCHDOG_OVERNIGHT_DIR")
LOG="$STATE_DIR/watchdog.log"
LOCK="$STATE_DIR/.lock"
PAGE_LEDGER="$STATE_DIR/last-page"

mkdir -p "$STATE_DIR" || exit 1

NOW=$(date +%s)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

# Roll the log before appending, not after: this job is installed once on a
# machine nobody revisits, and launchd rotates neither this file nor its own
# StandardOut/StandardErrorPath. `wc -c` on a missing file is 0, which is the
# first-run case.
log() {
  local size
  size=$(wc -c <"$LOG" 2>/dev/null || echo 0)
  if [ "${size:-0}" -gt "$WATCHDOG_LOG_MAX_BYTES" ]; then
    tail -n "$WATCHDOG_LOG_KEEP_LINES" "$LOG" >"$LOG.roll" 2>/dev/null \
      && mv "$LOG.roll" "$LOG"
  fi
  printf '[%s] %s\n' "$(date '+%F %T')" "$*" >>"$LOG"
}

# `date -j -f` chokes on the fractional seconds ccusage emits
# (2026-08-01T00:00:00.000Z), so strip them. Prints nothing on a value it cannot
# parse — callers must handle empty.
iso_to_epoch() {
  local iso=${1:-}
  [ -n "$iso" ] || return 0
  iso=${iso%%.*}
  case "$iso" in *Z) : ;; *) iso="${iso}Z" ;; esac
  date -j -u -f '%Y-%m-%dT%H:%M:%SZ' "$iso" +%s 2>/dev/null
}

# The overnight supervisor's own slugify (overnight.md § 2.1), byte for byte.
# The long character class is not a style choice: BSD sed does not understand
# `\+`, and with it the substitution silently matches nothing.
slugify() {
  printf '%s' "$1" | tr '[:upper:]' '[:lower:]' \
    | sed 's/[^a-z0-9][^a-z0-9]*/-/g; s/^-//; s/-$//' \
    | cut -c1-40 | sed 's/-$//'
}

human_age() {
  local secs=${1:-0}
  if [ "$secs" -lt 3600 ]; then printf '%dm' $((secs / 60))
  else printf '%dh%02dm' $((secs / 3600)) $(((secs % 3600) / 60)); fi
}

# Findings accumulate as newline-delimited markdown bullets. PAGE_ holds the
# subset worth waking someone for.
#
# `add_page` takes an IDENTITY KEY as well as the prose, and the page-suppression
# digest is taken over the keys alone. This is the whole reason the cooldown
# works: every page's prose interpolates something that moves between runs — a
# live block cost, a minute-resolution age, a countdown — so a digest over the
# rendered text is different on every single sweep and suppresses nothing. The
# key answers "is this the same problem?", which is the question being asked.
# A key must therefore contain no measurement, only the check name and whatever
# identifies the specific thing (an issue number, a run's stop-epoch).
FINDINGS=""
PAGE_FINDINGS=""
PAGE_KEYS=""
add_finding() { FINDINGS="${FINDINGS}- $1"$'\n'; }
add_page() {
  FINDINGS="${FINDINGS}- $2"$'\n'
  PAGE_FINDINGS="${PAGE_FINDINGS}- $2"$'\n'
  PAGE_KEYS="${PAGE_KEYS}$1"$'\n'
}

# ---------------------------------------------------------------------------
# Single-flight
# ---------------------------------------------------------------------------
#
# launchd fires on a wall-clock interval and does not care whether the last run
# finished. `mkdir` is the atomic test-and-set every POSIX shell has. macOS has
# no `timeout(1)`, so a wedged `gh` cannot be capped directly — the stale-lock
# break below is what stops one hung run from muting the watchdog forever.

LOCK_NONCE="$$.$(date +%s).${RANDOM}"

if ! mkdir "$LOCK" 2>/dev/null; then
  lock_age=$(( NOW - $(stat -f %m "$LOCK" 2>/dev/null || echo "$NOW") ))
  if [ "$lock_age" -gt $((WATCHDOG_LOCK_STALE_MINUTES * 60)) ]; then
    log "breaking stale lock (held $(human_age "$lock_age"))"
    rm -rf "$LOCK"
    mkdir "$LOCK" 2>/dev/null || exit 0
  else
    log "skip: another run holds the lock ($(human_age "$lock_age"))"
    exit 0
  fi
fi
printf '%s' "$LOCK_NONCE" >"$LOCK/nonce"

# Release only a lock we still own. Without the nonce check: run A wedges, run B
# breaks the stale lock and takes its own, then A finally exits and its trap
# deletes B's — after which the two overlap with no guard at all.
release_lock() {
  [ "$(cat "$LOCK/nonce" 2>/dev/null)" = "$LOCK_NONCE" ] && rm -rf "$LOCK"
}
trap release_lock EXIT

# ---------------------------------------------------------------------------
# Preflight
# ---------------------------------------------------------------------------

for tool in gh jq git; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    log "ABORT: $tool not on PATH (launchd PATH is not your shell's — see the plist)"
    exit 1
  fi
done

if ! gh auth status >/dev/null 2>&1; then
  log "ABORT: gh is not authenticated"
  exit 1
fi

# ---------------------------------------------------------------------------
# Gate — is there anything to watch at all?
# ---------------------------------------------------------------------------
#
# Cheapest signal first. `pgrep` and `stat` are free; the single `gh issue list`
# only happens if the machine looks idle, and it is what distinguishes "nothing
# is running" from "something claimed an issue and then vanished" — which is the
# orphan case and the whole reason this check cannot be skipped.

SESSION_COUNT=$(pgrep -x "$WATCHDOG_SESSION_PROCS" 2>/dev/null | grep -c .)

IN_PROGRESS=$(gh issue list --label "agent:in-progress" --state open --limit 50 \
  --json number,title,updatedAt,url 2>/dev/null)
[ -n "$IN_PROGRESS" ] || IN_PROGRESS='[]'
IN_PROGRESS_COUNT=$(printf '%s' "$IN_PROGRESS" | jq 'length' 2>/dev/null || echo 0)

OVERNIGHT_MARKER=0
[ -f "$OVERNIGHT_DIR/caffeinate.pid" ] && OVERNIGHT_MARKER=1
[ -f "$OVERNIGHT_DIR/stop-epoch" ] && OVERNIGHT_MARKER=1

if [ "$SESSION_COUNT" -eq 0 ] && [ "$IN_PROGRESS_COUNT" -eq 0 ] && [ "$OVERNIGHT_MARKER" -eq 0 ]; then
  log "idle: no sessions, no claims, no overnight marker"
  exit 0
fi

# ---------------------------------------------------------------------------
# (a) LIVENESS  +  (c) ORPHANED CLAIMS
# ---------------------------------------------------------------------------
#
# One pass, because they are the same measurement read at two thresholds: an
# issue with no open PR that has shown no sign of life for LIVENESS_MINUTES is
# stalled and worth mentioning; the same issue past ORPHAN_HOURS with no session
# process anywhere is abandoned, and the claim label has to come off or the
# issue disappears from every future queue permanently (overnight.md § 1.1
# filters `agent:in-progress` out).
#
# "Sign of life" is the newest of four things:
#   1. an OPEN linked PR      — not stalled at all, it is done and awaiting review
#   2. a LOCAL branch tip     — the branch name is derived from the issue the same
#                               way the supervisor derives it (init-prefix/slug)
#   3. a REMOTE branch tip    — the same branch on origin. Local refs alone see
#                               only agents running on THIS Mac; a Cursor Cloud
#                               agent, a Conductor session, or a CI agent (see
#                               CLAUDE.md § "Agent Backend Selection") pushes to
#                               origin and is otherwise invisible here.
#   4. the issue's updatedAt  — comments and label edits are agent activity too
#
# (3) is read with `git ls-remote --heads origin`, which asks the remote directly
# and writes nothing into the local ref store — so it cannot race an agent's
# checkout the way a background `git fetch` would. The script still never
# fetches.
#
# RESIDUAL RISK, stated plainly: a remote agent that has claimed an issue and
# not pushed anything for ORPHAN_HOURS can still be falsely reclaimed. There is
# no signal left to distinguish it from an abandoned claim. The convention that
# closes it is on the agent side, not here — an agent that claims an issue
# should comment on it when it does, and again on any long silent stretch; that
# moves `updatedAt` and makes it visible. Documented in GARDENERS.md § Watchdog.

BRANCH_REFS=$(git for-each-ref --format='%(committerdate:unix) %(refname:short)' \
  refs/heads refs/remotes/origin 2>/dev/null)

# One network call for the whole loop rather than one per issue.
REMOTE_REFS=$(git ls-remote --heads origin 2>/dev/null)
REMOTE_REFS_OK=$?

RECLAIMED=""

while IFS=$'\t' read -r num title updated url; do
  [ -n "${num:-}" ] || continue

  lookup_failed=0

  # 1. an open PR means this issue is finished, not stalled.
  #
  # Fail CLOSED. A transient API error here produces no `OPEN` state, which is
  # indistinguishable from "no PR" — and the consequence of guessing wrong is
  # relabelling a finished issue back to `agent:ready` so a second agent redoes
  # work that is already in review.
  open_pr=""
  if pr_refs=$(gh issue view "$num" --json closedByPullRequestsReferences \
                 --jq '.closedByPullRequestsReferences[].number' 2>/dev/null); then
    for p in $pr_refs; do
      if state=$(gh pr view "$p" --json state --jq '.state' 2>/dev/null); then
        if [ "$state" = "OPEN" ]; then open_pr="$p"; break; fi
      else
        lookup_failed=1; break
      fi
    done
  else
    lookup_failed=1
  fi
  [ -n "$open_pr" ] && continue

  # 2 + 3 + 4. newest of the branch tips and the issue's own updatedAt.
  last=$(iso_to_epoch "$updated")
  [ -n "$last" ] || last=0

  slug=$(slugify "$title")
  slug=${slug:-issue-$num}

  if [ -n "$BRANCH_REFS" ]; then
    tip=$(printf '%s\n' "$BRANCH_REFS" \
      | awk -v s="/$slug" -v i="issue-$num" \
          'index($2, s) || index($2, i) { if ($1 > m) m = $1 } END { if (m) print m }')
    [ -n "${tip:-}" ] && [ "$tip" -gt "$last" ] && last=$tip
  fi

  # The remote's ref list carries SHAs, not dates, so a matching branch costs one
  # more API call to date. Only reached for issues that look stale locally, which
  # is a handful at most.
  remote_branch=""
  if [ "$REMOTE_REFS_OK" -eq 0 ] && [ -n "$REMOTE_REFS" ]; then
    remote_branch=$(printf '%s\n' "$REMOTE_REFS" \
      | awk -v s="/$slug" -v i="issue-$num" \
          '{ sub(/^refs\/heads\//, "", $2) } index($2, s) || index($2, i) { print $2; exit }')
  fi
  if [ -n "$remote_branch" ]; then
    if rdate=$(gh api "repos/{owner}/{repo}/commits/$remote_branch" \
                 --jq '.commit.committer.date' 2>/dev/null); then
      rtip=$(iso_to_epoch "$rdate")
      [ -n "${rtip:-}" ] && [ "$rtip" -gt "$last" ] && last=$rtip
    else
      lookup_failed=1
    fi
  fi

  age=$((NOW - last))

  if [ "$age" -gt $((WATCHDOG_ORPHAN_HOURS * 3600)) ] && [ "$SESSION_COUNT" -eq 0 ]; then
    # Orphan. Report-only by design — reclaiming is a repair, not an emergency,
    # and the queue is strictly better off afterwards. Nobody needs waking.
    if [ "$lookup_failed" -eq 1 ] || [ "$REMOTE_REFS_OK" -ne 0 ]; then
      add_finding "**Orphaned claim (unverified)** — [#$num]($url) *$title* looks stale after $(human_age "$age"), but a PR or remote-branch lookup failed this sweep, so it was **not** reclaimed. Re-checked in 30 minutes."
    elif [ "$WATCHDOG_RECLAIM" = "1" ] && [ "$DRY_RUN" != "1" ]; then
      # Record the repair only if it actually happened. Reporting a reclaim that
      # silently failed leaves the issue out of the queue AND tells the owner it
      # was put back.
      if gh issue edit "$num" --remove-label "agent:in-progress" --add-label "agent:ready" >/dev/null 2>&1; then
        gh issue comment "$num" --body \
"Reclaimed by watchdog: labelled \`agent:in-progress\` with no open PR, no local or remote branch activity, and no issue activity for $(human_age "$age"), and no agent session is running on the host. Returning it to \`agent:ready\` so a future run can pick it up.

If you are an agent still working this issue from another machine, comment here when you claim an issue — that is the signal this check reads.

*(scripts/watchdog.sh — no code was changed.)*" >/dev/null 2>&1
        RECLAIMED="${RECLAIMED}#$num "
        add_finding "**Orphaned claim reclaimed** — [#$num]($url) *$title* was stuck at \`agent:in-progress\` for $(human_age "$age") with no PR, no branch activity local or remote, and no live session. Relabelled \`agent:ready\`."
      else
        add_finding "**Reclaim FAILED** — [#$num]($url) *$title* is an orphaned claim but \`gh issue edit\` failed. It is still \`agent:in-progress\` and still invisible to the queue. Release it by hand: \`gh issue edit $num --remove-label agent:in-progress --add-label agent:ready\`."
      fi
    else
      why=$([ "$DRY_RUN" = "1" ] && echo "dry run" || echo "\`WATCHDOG_RECLAIM=$WATCHDOG_RECLAIM\`")
      add_finding "**Orphaned claim** — [#$num]($url) *$title* stuck at \`agent:in-progress\` for $(human_age "$age") with no PR and no live session. Not reclaimed ($why); release it with \`gh issue edit $num --remove-label agent:in-progress --add-label agent:ready\`."
    fi
  elif [ "$age" -gt $((WATCHDOG_LIVENESS_MINUTES * 60)) ]; then
    add_finding "**No sign of life** — [#$num]($url) *$title* has been claimed for $(human_age "$age") with no open PR and no commit on \`*/$slug\` local or remote. Becomes an orphan reclaim at ${WATCHDOG_ORPHAN_HOURS}h."
  fi
done < <(printf '%s' "$IN_PROGRESS" | jq -r '.[] | [.number, .title, .updatedAt, .url] | @tsv')

# ---------------------------------------------------------------------------
# (b) SPEND PACE
# ---------------------------------------------------------------------------
#
# ccusage's active 5-hour block, against a ceiling the owner sets. A warning
# threshold only: the watchdog has no authority to stop a run, and would not use
# it if it did. Two thresholds, because one number cannot serve both jobs:
#
#   CEILING  — "this block is unusually expensive", worth a line in the report.
#   PAGE     — "this is running away", worth waking someone.
#
# And the page has a gate. The owner's own measured baseline is ~$50 blocks
# during ordinary heavy parallel work at the keyboard, so an ungated page fires
# constantly while he is sitting right there watching it happen — after which he
# mutes the bot and loses the *other* page too. The page therefore only fires
# when no unattended run is in flight: while the supervisor is running it owns
# its own `max-spend` guard and will stop itself, and duplicating that is how you
# train someone to ignore a channel. Spend running away with nobody supervising
# it is the case with no other backstop, and that is the one that pages.

if command -v ccusage >/dev/null 2>&1; then
  BLOCK=$(ccusage blocks --json 2>/dev/null \
    | jq -r '[.blocks[]? | select(.isActive)] | first | "\(.costUSD // 0)\t\(.startTime // "")"' 2>/dev/null)
  cost=$(printf '%s' "$BLOCK" | cut -f1)
  block_start=$(printf '%s' "$BLOCK" | cut -f2)
  if [ -n "${cost:-}" ] && [ "$cost" != "null" ]; then
    verdict=$(awk -v c="$cost" -v ceil="$WATCHDOG_SPEND_CEILING_USD" \
                  -v pg="$WATCHDOG_SPEND_PAGE_USD" -v f="$WATCHDOG_SPEND_WARN_FRACTION" \
      'BEGIN { if (c >= pg) print "page"; else if (c >= ceil) print "over";
               else if (c >= ceil * f) print "near"; else print "ok" }')
    pretty=$(awk -v c="$cost" 'BEGIN { printf "%.2f", c }')
    started=$(iso_to_epoch "$block_start")
    elapsed=""
    [ -n "$started" ] && elapsed=" after $(human_age $((NOW - started)))"

    # An overnight run is "expected active" while its stop-epoch is in the future.
    OVERNIGHT_ACTIVE=0
    if [ -f "$OVERNIGHT_DIR/stop-epoch" ]; then
      se=$(tr -dc '0-9' <"$OVERNIGHT_DIR/stop-epoch" 2>/dev/null)
      [ -n "${se:-}" ] && [ "$NOW" -lt "$se" ] && OVERNIGHT_ACTIVE=1
    fi

    case "$verdict" in
      page)
        if [ "$OVERNIGHT_ACTIVE" -eq 0 ]; then
          # Key carries no measurement — see add_page. "Still over $40" at 03:00
          # and at 03:30 is the same problem and must not page twice.
          add_page "spend-runaway" "**Spend running away** — \$$pretty in the active ccusage block${elapsed}, page threshold \$${WATCHDOG_SPEND_PAGE_USD}, and no unattended run is in flight to guard itself."
        else
          add_finding "**Spend running away** — \$$pretty in the active ccusage block${elapsed}, past the \$${WATCHDOG_SPEND_PAGE_USD} page threshold. Not paged: an overnight run is in flight and owns its own \`max-spend\` guard."
        fi ;;
      over) add_finding "**Spend over ceiling** — \$$pretty in the active ccusage block${elapsed}, ceiling \$${WATCHDOG_SPEND_CEILING_USD}. Pages at \$${WATCHDOG_SPEND_PAGE_USD}." ;;
      near) add_finding "**Spend pace** — \$$pretty in the active ccusage block${elapsed}, $(awk -v f="$WATCHDOG_SPEND_WARN_FRACTION" 'BEGIN{printf "%.0f", f*100}')%+ of the \$${WATCHDOG_SPEND_CEILING_USD} ceiling." ;;
    esac
  fi
elif [ "$(cat "$STATE_DIR/ccusage-missing" 2>/dev/null)" != "$(date '+%F')" ]; then
  # Once a day, not every sweep. The preflight aborts loudly for gh/jq/git;
  # ccusage going missing (a node version bump moves it, and the plist pins an
  # nvm path) would otherwise delete the entire spend check with nothing said —
  # which is the silent-no-match failure this script rejects everywhere else.
  date '+%F' >"$STATE_DIR/ccusage-missing"
  log "WARN: ccusage not on PATH; the spend check did not run"
  add_finding "**Spend check disabled** — \`ccusage\` is not on the watchdog's PATH, so no spend was measured this sweep or any other. launchd does not read your shell profile; check the \`PATH\` in \`com.supa.fleet-watchdog.plist\` (a node version bump moves \`ccusage\`). Reported once a day."
fi

# ---------------------------------------------------------------------------
# (d) OVERNIGHT RUN HEALTH
# ---------------------------------------------------------------------------
#
# The supervisor writes `stop-epoch` (the instant it intends to stop) and
# `caffeinate.pid` at Phase 0 and clears caffeinate at Phase 8. Two failure
# shapes fall out of that pair, and neither is visible from inside the run:
#
#   run died mid-flight  — stop-epoch is still in the future but no agent
#                          session exists. If the queue is non-empty this is the
#                          page: the night is being wasted and nobody knows.
#   caffeinate leak      — the pidfile's process is alive well past stop-epoch.
#                          The laptop is pinned awake, possibly for days.

if [ -f "$OVERNIGHT_DIR/stop-epoch" ]; then
  STOP_EPOCH=$(tr -dc '0-9' <"$OVERNIGHT_DIR/stop-epoch" 2>/dev/null)
  if [ -n "${STOP_EPOCH:-}" ] && [ "$NOW" -lt "$STOP_EPOCH" ] && [ "$SESSION_COUNT" -eq 0 ]; then
    remaining=$(human_age $((STOP_EPOCH - NOW)))

    # A failed query must not read as "queue empty". Collapsing an error into 0
    # here would downgrade the page to a report line and hide the exact incident
    # this check exists to surface, so an unknown queue pages too.
    READY_COUNT=""
    if ready_json=$(gh issue list --label "agent:ready" --state open --limit 50 \
                      --json number,labels 2>/dev/null); then
      READY_COUNT=$(printf '%s' "$ready_json" \
        | jq '[.[] | select([.labels[].name] | index("agent:blocked") | not)
                   | select([.labels[].name] | index("agent:in-progress") | not)] | length' 2>/dev/null)
    fi

    # The key identifies the run that died (its stop-epoch), not how long it has
    # been dead — otherwise the countdown in the prose re-pages every 30 minutes.
    if [ -z "${READY_COUNT:-}" ]; then
      add_page "overnight-dead:$STOP_EPOCH" "**Overnight run died mid-flight** — \`stop-epoch\` says it should still be working for another ${remaining} and no agent session is alive. The ready-queue query failed, so the queue depth is unknown — paging rather than assuming it was empty."
    elif [ "$READY_COUNT" -gt 0 ]; then
      add_page "overnight-dead:$STOP_EPOCH" "**Overnight run died mid-flight** — \`stop-epoch\` says it should still be working for another ${remaining}, no agent session is alive, and ${READY_COUNT} issue(s) are still \`agent:ready\`. The rest of the night is being wasted."
    else
      add_finding "**Overnight run ended early** — \`stop-epoch\` had ${remaining} left and no session is alive, but the queue is empty, so there was nothing left to do. Stale marker: \`$WATCHDOG_OVERNIGHT_DIR/stop-epoch\`."
    fi
  fi
fi

if [ -f "$OVERNIGHT_DIR/caffeinate.pid" ]; then
  CAFF_PID=$(tr -dc '0-9' <"$OVERNIGHT_DIR/caffeinate.pid" 2>/dev/null)
  if [ -n "${CAFF_PID:-}" ] && kill -0 "$CAFF_PID" 2>/dev/null; then
    if [ -n "${STOP_EPOCH:-}" ] && [ "$NOW" -gt $((STOP_EPOCH + 3600)) ]; then
      add_finding "**caffeinate leak** — pid \`$CAFF_PID\` is still holding the machine awake $(human_age $((NOW - STOP_EPOCH))) past \`stop-epoch\`. Clear it with \`kill $CAFF_PID && rm $WATCHDOG_OVERNIGHT_DIR/caffeinate.pid\`."
    fi
  fi
fi

# ---------------------------------------------------------------------------
# (e) GARDENER FAILURES
# ---------------------------------------------------------------------------
#
# Read from workflow-run conclusions rather than by searching for gh-aw's
# failure-report issues. The run list is exact and stable; the issue title
# gh-aw generates is an implementation detail of a version we do not pin, and a
# watchdog that silently matches nothing is worse than no check at all.
#
# Scoped with `--workflow` per file rather than one repo-wide list filtered
# afterwards. An unscoped `--limit 50` applies the limit BEFORE the filter, so on
# a heavy CI day fifty `CI` failures push every gardener failure off the end and
# the check reports nothing — which reads as an all-clear. That is the same
# silent-no-match failure this check was written to avoid, arrived at from the
# other side. The workflow list comes from the directory, so a sixth gardener is
# covered the day it lands.

SINCE=$(date -u -v-"${WATCHDOG_GARDENER_FAILURE_DAYS}"d +%FT%TZ)

for wf_file in "$REPO_ROOT"/.github/workflows/gardener-*.lock.yml \
               "$REPO_ROOT"/.github/workflows/watchdog-*.lock.yml; do
  [ -f "$wf_file" ] || continue
  wf_name=$(basename "$wf_file")
  fails=$(gh run list --workflow="$wf_name" --status failure --created ">=$SINCE" \
    --limit 50 --json workflowName,url 2>/dev/null \
    | jq -r 'if length > 0 then "\(.[0].workflowName)\t\(length)\t\(.[0].url)" else empty end' 2>/dev/null)
  [ -n "${fails:-}" ] || continue
  IFS=$'\t' read -r wf count wfurl <<<"$fails"
  add_finding "**Gardener failing** — \`$wf\` failed ${count}× in the last ${WATCHDOG_GARDENER_FAILURE_DAYS}d. [Latest run]($wfurl)"
done

# ---------------------------------------------------------------------------
# All clear
# ---------------------------------------------------------------------------

if [ -z "$FINDINGS" ]; then
  log "all clear: sessions=$SESSION_COUNT claims=$IN_PROGRESS_COUNT"
  exit 0
fi

# ---------------------------------------------------------------------------
# Escalate — ONE issue
# ---------------------------------------------------------------------------
#
# One issue per day, updated in place. A watchdog that opens an issue every 30
# minutes trains you to ignore it, which is the only failure mode that actually
# matters here.
#
# The title carries no em dash and is matched by exact string in jq rather than
# through `gh --search`. GitHub's search tokenizer does not treat `[watchdog]`
# as a literal, and a near-match here does not fail loudly — it silently forks a
# second issue every run.

TITLE="$WATCHDOG_ISSUE_PREFIX fleet report $(date '+%F')"
BODY_FILE="$STATE_DIR/report.md"

{
  printf 'Automated sweep by `scripts/watchdog.sh`. Updated in place through the day;\n'
  printf 'a new issue opens tomorrow. The watchdog reads and escalates — it never\n'
  printf 'edits code and never opens a PR.\n\n'
  printf '**Last swept:** %s · **sessions:** %s · **claims:** %s\n\n' \
    "$(date -u '+%F %T UTC')" "$SESSION_COUNT" "$IN_PROGRESS_COUNT"
  if [ -n "$PAGE_FINDINGS" ]; then
    printf '## Page-worthy\n\n%s\n' "$PAGE_FINDINGS"
    OTHER=$(printf '%s' "$FINDINGS" | grep -vxF -f <(printf '%s' "$PAGE_FINDINGS") 2>/dev/null)
    [ -n "${OTHER:-}" ] && printf '## Also noticed\n\n%s\n\n' "$OTHER"
  else
    printf '## Findings\n\n%s\n' "$FINDINGS"
  fi
  [ -n "$RECLAIMED" ] && printf '**Reclaimed this sweep:** %s\n\n' "$RECLAIMED"
  printf -- '---\n'
  printf '*Thresholds: liveness %sm · orphan %sh · spend $%s report / $%s page. Edit\n' \
    "$WATCHDOG_LIVENESS_MINUTES" "$WATCHDOG_ORPHAN_HOURS" \
    "$WATCHDOG_SPEND_CEILING_USD" "$WATCHDOG_SPEND_PAGE_USD"
  printf '`scripts/watchdog.config.sh`. See `.github/GARDENERS.md` § Watchdog.*\n'
} >"$BODY_FILE"

if [ "$DRY_RUN" = "1" ]; then
  log "dry-run: would file/update \"$TITLE\""
  cat "$BODY_FILE"
else
  EXISTING=$(gh issue list --label "$WATCHDOG_ISSUE_LABEL" --state open --limit 30 \
    --json number,title 2>/dev/null \
    | jq -r --arg t "$TITLE" 'map(select(.title == $t)) | .[0].number // empty' 2>/dev/null)

  if [ -n "${EXISTING:-}" ]; then
    if gh issue edit "$EXISTING" --body-file "$BODY_FILE" >/dev/null 2>&1; then
      log "updated issue #$EXISTING"
    else
      log "WARN: could not update issue #$EXISTING"
    fi
    ISSUE_REF="#$EXISTING"
  else
    # `gh issue create` has no --json; it prints the URL.
    NEW_URL=$(gh issue create --title "$TITLE" --label "$WATCHDOG_ISSUE_LABEL" \
      --body-file "$BODY_FILE" 2>&1 | grep -o 'https://[^ ]*')
    if [ -n "${NEW_URL:-}" ]; then
      log "filed $NEW_URL"
      ISSUE_REF="#${NEW_URL##*/}"
    else
      # Almost always a missing label. Say so — a watchdog that cannot report is
      # the one failure this script must never swallow.
      log "WARN: could not file the report issue. Does the '$WATCHDOG_ISSUE_LABEL' label exist? (gh label create '$WATCHDOG_ISSUE_LABEL')"
      ISSUE_REF="(unfiled)"
    fi
  fi
fi

# ---------------------------------------------------------------------------
# Escalate — Telegram, page-worthy only
# ---------------------------------------------------------------------------
#
# An orphan reclaim is a repair and stays in the issue. A dead overnight run
# mid-queue, or runaway spend with nobody supervising, is a page. The ledger
# stops an unchanged page from re-sending every 30 minutes; a genuinely new
# condition still goes out immediately.
#
# The digest is over PAGE_KEYS — the identity of each finding — and never over
# the rendered prose. Every page interpolates something that moves between
# sweeps (a live cost, a minute-resolution age, a countdown), so a digest over
# the text differs on every run and suppresses nothing at all: the cooldown
# would be inert and an ongoing 3am condition would page every 30 minutes,
# which is the notification fatigue this whole design exists to avoid.
# Sorted, so two findings arriving in a different order are still the same page.

[ -n "$PAGE_FINDINGS" ] || exit 0

DIGEST=$(printf '%s' "$PAGE_KEYS" | sort | shasum -a 256 | cut -c1-16)
LAST_DIGEST=""; LAST_SENT=0
if [ -f "$PAGE_LEDGER" ]; then
  LAST_DIGEST=$(cut -d' ' -f1 <"$PAGE_LEDGER")
  LAST_SENT=$(cut -d' ' -f2 <"$PAGE_LEDGER")
  [ -n "${LAST_SENT:-}" ] || LAST_SENT=0
fi

if [ "$DIGEST" = "$LAST_DIGEST" ] && [ $((NOW - LAST_SENT)) -lt $((WATCHDOG_PAGE_COOLDOWN_HOURS * 3600)) ]; then
  log "page suppressed (unchanged, ${WATCHDOG_PAGE_COOLDOWN_HOURS}h cooldown)"
  exit 0
fi

# launchd starts this from a bare environment — it never sources your shell
# profile — so fall back to the keychain, which is where overnight.md § 8.4
# tells you to put these anyway.
#
# `$USER` is guarded because a bare launchd environment is exactly where it can
# be unset, and under `set -u` that is two stderr lines into launchd.err.log on
# every page plus a dead keychain fallback — in the one environment the fallback
# exists to serve.
KEYCHAIN_USER=${USER:-$(id -un)}
: "${TELEGRAM_BOT_TOKEN:=$(security find-generic-password -a "$KEYCHAIN_USER" -s TELEGRAM_BOT_TOKEN -w 2>/dev/null)}"
: "${TELEGRAM_CHAT_ID:=$(security find-generic-password -a "$KEYCHAIN_USER" -s TELEGRAM_CHAT_ID -w 2>/dev/null)}"

MSG="[watchdog] ${ISSUE_REF:-report}
$(printf '%s' "$PAGE_FINDINGS" | sed 's/\*\*//g')
Full report: $TITLE"

if [ "$DRY_RUN" = "1" ]; then
  log "dry-run: would page"
  printf '%s\n' "$MSG"
  exit 0
fi

if [ -n "${TELEGRAM_BOT_TOKEN:-}" ] && [ -n "${TELEGRAM_CHAT_ID:-}" ]; then
  # Plain text, no parse_mode: MarkdownV2 would need every `.`, `-`, `#`, `(`
  # and `$` in these findings escaped, and one miss loses the whole message with
  # `400: can't parse entities`. --data-urlencode is what keeps newlines intact.
  OK=$(curl -sS -m 20 -X POST \
    "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/sendMessage" \
    -d chat_id="$TELEGRAM_CHAT_ID" \
    -d disable_web_page_preview=true \
    --data-urlencode "text=$MSG" 2>/dev/null | jq -r '.ok // false' 2>/dev/null)
  if [ "$OK" = "true" ]; then
    printf '%s %s\n' "$DIGEST" "$NOW" >"$PAGE_LEDGER"
    log "paged via telegram"
  else
    # The report issue is the fallback and it is already filed. Don't write the
    # ledger — a failed send must not suppress the retry in 30 minutes.
    log "WARN: telegram send failed; the page is in ${ISSUE_REF:-the report issue}"
  fi
else
  log "no telegram creds (env or keychain); the page is in ${ISSUE_REF:-the report issue}"
fi
