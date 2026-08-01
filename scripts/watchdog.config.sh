# shellcheck shell=bash
# Fleet watchdog — thresholds. Edit this file, not watchdog.sh.
#
# Sourced by scripts/watchdog.sh. Every value can also be overridden from the
# environment (the `${VAR:-default}` form below), which is how the launchd plist
# and one-off manual runs change behaviour without editing anything.
#
#   WATCHDOG_DRY_RUN=1 ./scripts/watchdog.sh    # diagnose, change nothing
#
# See .github/GARDENERS.md § "Watchdog" for what each check does and why.

# ---------------------------------------------------------------------------
# Liveness
# ---------------------------------------------------------------------------

# An `agent:in-progress` issue with no open PR and no branch commit or issue
# activity inside this window is reported as stalled. 45 minutes is roughly two
# units of work in the overnight supervisor's Phase 2 — shorter than that and a
# long test run looks like a hang.
WATCHDOG_LIVENESS_MINUTES=${WATCHDOG_LIVENESS_MINUTES:-45}

# The same issue, still dead after this long AND with no session process alive
# anywhere on the machine AND no local or remote branch activity, is an orphaned
# claim: the run that took it is gone and nothing else will ever release the
# label. Reclaimed automatically.
#
# This SUPERSEDES the overnight supervisor's own 12h stale-claim sweep
# (overnight.md § 0.5) — once the watchdog is installed it always gets there
# first, and the effective window is this number, not 12h. See
# .github/GARDENERS.md § Watchdog → "Which layer owns the reclaim".
WATCHDOG_ORPHAN_HOURS=${WATCHDOG_ORPHAN_HOURS:-2}

# Set to 0 to make orphan detection report-only (no relabel, no comment).
WATCHDOG_RECLAIM=${WATCHDOG_RECLAIM:-1}

# ---------------------------------------------------------------------------
# Spend pace
# ---------------------------------------------------------------------------

# Dollars per ccusage 5-hour block. Two thresholds, because one number cannot
# do both jobs and a single $10 ceiling produced a page every 30 minutes during
# ordinary interactive work — measured $53 in a block, 26 minutes in, with
# nothing unusual happening.
#
#   CEILING — a line in the daily report. "This block is expensive."
#   PAGE    — a Telegram message. "This is running away."
#
# Set against the owner's measured baseline: heavy parallel work reaches ~$50 a
# block, so $25 is genuinely notable and $40 is genuinely alarming.
WATCHDOG_SPEND_CEILING_USD=${WATCHDOG_SPEND_CEILING_USD:-25}
WATCHDOG_SPEND_PAGE_USD=${WATCHDOG_SPEND_PAGE_USD:-40}

# Report at this fraction of the ceiling, one band below it.
WATCHDOG_SPEND_WARN_FRACTION=${WATCHDOG_SPEND_WARN_FRACTION:-0.8}

# The page also has a gate that is not a number: it only fires when NO
# unattended run is in flight. While the overnight supervisor is running it owns
# its own `max-spend` guard and stops itself, so paging then is duplicate noise —
# and noise is what makes someone mute the bot, which silently disables the
# dead-run page too. Spend running away with nobody supervising is the case with
# no other backstop, and that is the one worth waking for.

# ---------------------------------------------------------------------------
# Gardener failures
# ---------------------------------------------------------------------------

# How far back to look for failed gardener / watchdog workflow runs.
WATCHDOG_GARDENER_FAILURE_DAYS=${WATCHDOG_GARDENER_FAILURE_DAYS:-1}

# ---------------------------------------------------------------------------
# Process detection
# ---------------------------------------------------------------------------

# Matched with `pgrep -x` — an ERE against the process NAME, not its argv.
# Deliberately not `pgrep -f`: every MCP child on this machine inherits a PATH
# containing `/Users/<you>/.opencode/bin`, so `pgrep -f opencode` matches a
# dozen unrelated node processes and the watchdog would never see an idle
# machine. Verified on macOS 25.4.
#
# KEEP THIS IN STEP WITH THE CLIs THE FLEET ACTUALLY RUNS. It is a heuristic,
# not a guarantee — a launcher that execs a versioned binary directly presents a
# different `comm`. It is also, by construction, blind to any agent that is not
# a process on THIS Mac; that gap is covered separately by the remote-branch
# check before any reclaim (see watchdog.sh § LIVENESS).
WATCHDOG_SESSION_PROCS=${WATCHDOG_SESSION_PROCS:-'claude|droid|opencode'}

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------

# Where the overnight supervisor keeps its marker files (caffeinate.pid,
# stop-epoch, run.log). Must match `.claude/commands/overnight.md`.
WATCHDOG_OVERNIGHT_DIR=${WATCHDOG_OVERNIGHT_DIR:-.claude/logs/overnight}

# The watchdog's own gitignored state: the log, the lock, the page ledger.
WATCHDOG_STATE_DIR=${WATCHDOG_STATE_DIR:-.claude/logs/watchdog}

# ---------------------------------------------------------------------------
# Escalation
# ---------------------------------------------------------------------------

WATCHDOG_ISSUE_LABEL=${WATCHDOG_ISSUE_LABEL:-watchdog:report}
WATCHDOG_ISSUE_PREFIX=${WATCHDOG_ISSUE_PREFIX:-'[watchdog]'}

# Don't re-send an identical page more often than this. A page whose content
# CHANGED goes out immediately regardless — the cooldown suppresses repetition,
# never news.
WATCHDOG_PAGE_COOLDOWN_HOURS=${WATCHDOG_PAGE_COOLDOWN_HOURS:-6}

# A run holding the lock longer than this is assumed dead and the lock is broken.
WATCHDOG_LOCK_STALE_MINUTES=${WATCHDOG_LOCK_STALE_MINUTES:-30}

# The log rolls itself: launchd rotates neither this file nor its own
# StandardOut/StandardErrorPath, and this job is installed once on a machine
# nobody revisits.
WATCHDOG_LOG_MAX_BYTES=${WATCHDOG_LOG_MAX_BYTES:-1048576}
WATCHDOG_LOG_KEEP_LINES=${WATCHDOG_LOG_KEEP_LINES:-5000}
