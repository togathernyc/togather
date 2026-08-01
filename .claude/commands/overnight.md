# Overnight Orchestrator

Long-running (multi-hour) supervisor. Drains a queue of GitHub issues labelled
`agent:ready`, ships each one as a gated unit of work with an evidence bundle
and a PR, and leaves a morning report.

## Usage

```
/overnight
/overnight max-issues=6 stop-by=06:30 min-window=25
```

| Argument      | Default | Meaning                                                                 |
| ------------- | ------- | ----------------------------------------------------------------------- |
| `max-issues`  | `4`     | Hard cap on issues attempted this run, shipped or not.                  |
| `stop-by`     | `07:00` | Local wall-clock time. Never *start* a new unit at or after this.        |
| `min-window`  | `20`    | Percent. Stop when the 5-hour Claude window drops below this.            |

All three are ceilings, not targets. Hitting the queue's end is a perfectly
good reason to stop at 1am.

---

## Relationship to `/auto-worker`

**This command supersedes `/auto-worker` for queue-driven work.** The queue lives
in GitHub issues, not `.claude/backlog/QUEUE.md`, so the two commands read from
different places and must not be run against the same backlog at the same time.

`.claude/commands/auto-worker.md` stays as-is and is still the right thing for a
Ralph loop over the file-based backlog. Everything it says about the
**orchestrator pattern**, **sub-agent `max_turns`**, **progress logging**, and
the **circuit breaker** applies here verbatim — this file does not repeat it.
Read auto-worker.md's "CRITICAL:" sections once before your first run.

The one rule worth restating, because breaking it is how overnight runs die:

> **You are an orchestrator.** Spawn sub-agents for reading, searching,
> implementing, and screenshotting. Your own context has to survive four issues
> and a morning report. Every file you read yourself is context you do not get
> back at 4am.

---

## The labels

Created once via `gh label create` (already done — the commands below are the
idempotent recreate, safe to re-run):

```bash
# Check first; gh label create errors on an existing name.
gh label list --limit 200 --json name --jq '.[].name' | grep -E '^(agent:|priority:)'
```

```bash
gh label create "agent:ready"       --color 0E8A16 --description "Queued for the overnight orchestrator to pick up"
gh label create "agent:in-progress" --color FBCA04 --description "Claimed by an overnight run - do not hand-edit"
gh label create "agent:blocked"     --color B60205 --description "Overnight run escalated this - see the comment for why"
gh label create "agent:automerge"   --color 1D76DB --description "Opt in to merge-on-green with no human gate"
gh label create "priority:high"     --color D93F0B --description "Overnight orchestrator takes this before older issues"
```

| Label               | Set by  | Meaning                                                                                             |
| ------------------- | ------- | --------------------------------------------------------------------------------------------------- |
| `agent:ready`       | human   | This issue is picked up. Acceptance criteria in the body are complete enough to work from unattended. |
| `agent:in-progress` | agent   | Claimed by a run. Removed when the run finishes with it, whatever the outcome.                        |
| `agent:blocked`     | agent   | Escalated. A comment says why. **Never picked up again** until a human removes the label.             |
| `agent:automerge`   | human   | Opt in to merge-on-green. Without it, the PR is left open for you.                                    |
| `priority:high`     | human   | Jump the queue.                                                                                       |
| `init:<name>`       | human   | Optional. Names the initiative; becomes the branch prefix. Absent → `misc`.                           |

**Hard rule: the supervisor never edits its own inputs.** It may add and remove
`agent:in-progress` / `agent:blocked` on an issue it has claimed. It must never
add or remove `agent:ready`, `agent:automerge`, `priority:high`, or `init:*`,
and must never edit an issue's title or body. Those are the human's instructions
to it; rewriting them is how a loop talks itself into shipping something nobody
asked for. If the acceptance criteria are wrong, that is a `agent:blocked` with
a comment, not an edit.

---

## Kicking off from your phone

You do not need a terminal to fill the queue.

1. **From GitHub mobile (or the web UI):** open an issue — or file one with the
   **Agent task** template — and add the `agent:ready` label. Add `priority:high`
   if it should jump the queue, `agent:automerge` if you are happy for it to
   merge itself, and `init:<name>` to group it with an initiative. That is the
   whole handoff. Anything sitting in `agent:ready` when a run starts is fair
   game.
2. **From the Claude app:** Dispatch a session against this repo and send
   `/overnight`. Same loop, same guards. Use the arguments to shorten it if
   you are dispatching mid-day: `/overnight max-issues=1`.
3. **Kicked off, then went to bed:** you get the morning report as an iMessage
   (Phase 8). No need to check anything until then.

Queueing an issue does **not** start a run. A run only starts when you invoke
`/overnight`. The label is the inbox; the command is the worker.

---

## Phase 0: Preflight

Nothing below runs until all of this passes. A failed preflight is a stop, not
a workaround.

### 0.1 Keep the machine awake

```bash
caffeinate -dims &
CAFFEINATE_PID=$!
echo "caffeinate pid=$CAFFEINATE_PID"
```

**Write the PID into your progress log immediately.** You have to kill it in
Phase 8, and if you lose the number you leave the founder's laptop pinned awake
all day:

```bash
mkdir -p .claude/logs/overnight
echo "[$(date '+%Y-%m-%d %H:%M:%S')] caffeinate pid=$CAFFEINATE_PID" >> .claude/logs/overnight/run.log
```

`-dims` = no display sleep, no idle sleep, no disk sleep, and keep the system
awake. Without it a simulator screenshot at 3am hits a sleeping machine.

### 0.2 Verify the tools

```bash
gh auth status                    # must show a logged-in account
git status --porcelain            # must be empty
git rev-parse --abbrev-ref HEAD   # must be main
which ccusage                     # must resolve
which caffeinate                  # /usr/bin/caffeinate
```

Then get current:

```bash
git checkout main && git pull --ff-only origin main
```

**If the tree is dirty, stop.** Do not stash. Uncommitted work in the checkout
is someone's in-flight session, and an overnight run that stashes it will lose
it. Report "preflight failed: dirty tree" and exit.

### 0.3 Read the budget

Parse `max-issues`, `stop-by`, `min-window` from the arguments; use the defaults
above for anything absent. Log the resolved values — the morning report has to
explain why the run stopped, and "hit max-issues=4" is only meaningful if the 4
is written down.

```bash
echo "[$(date '+%Y-%m-%d %H:%M:%S')] budget: max-issues=$MAX_ISSUES stop-by=$STOP_BY min-window=$MIN_WINDOW" >> .claude/logs/overnight/run.log
```

### 0.4 Baseline the spend

Record where usage stands *before* any work, so the morning report can quote the
delta rather than your lifetime total:

```bash
ccusage blocks --active --json > .claude/logs/overnight/usage-start.json
```

---

## The guards

Checked at Phase 0 and again in Phase 7 before every issue. Any one of them
tripping ends the run — you finish the unit in flight, you do not start another.

| Guard    | Check                                                             | Trip condition                    |
| -------- | ----------------------------------------------------------------- | --------------------------------- |
| Count    | issues attempted this run                                          | `>= max-issues`                   |
| Clock    | `date +%H:%M` local                                                | `>= stop-by`                      |
| Window   | `/usage`, else the ccusage proxy below                             | `< min-window` percent remaining  |
| Queue    | `gh issue list --label agent:ready`                                | empty                             |

### Reading the window

**`/usage` is authoritative** — run it and read the 5-hour window's remaining
percentage. That is the number the rate limiter actually uses.

`ccusage` does not expose the Anthropic-side quota, so it is a **proxy, not a
substitute**. What it does give you is how much of the current 5-hour block is
left, which is the other thing you care about — there is no point starting a
90-minute unit with 20 minutes of block left:

```bash
ccusage blocks --active --json --jq '.blocks[] | select(.isActive) | {
  remainingMinutes: .projection.remainingMinutes,
  percentLeft: (.projection.remainingMinutes / 300 * 100 | floor),
  costSoFar: .costUSD,
  projectedCost: .projection.totalCost
}'
```

If `/usage` is unavailable in the session, use `percentLeft` against
`min-window` and say so in the morning report — "window guard ran on the
ccusage proxy" — so the number is not read as more precise than it is.

---

## Phase 1: Pick the next issue

### 1.1 Read the queue

```bash
gh issue list --label "agent:ready" --state open --limit 50 \
  --json number,title,labels,createdAt,url \
  --jq '[ .[]
          | select([.labels[].name] | index("agent:blocked") | not)
          | select([.labels[].name] | index("agent:in-progress") | not)
          | { number, title, url, createdAt,
              high: ([.labels[].name] | index("priority:high") != null),
              init: ([.labels[].name] | map(select(startswith("init:"))) | first // "init:misc") } ]
        | sort_by((if .high then 0 else 1 end), .createdAt)'
```

Take the **first element**. That is `priority:high` first, then oldest-first
within each tier.

Note what the filters are for: `agent:blocked` is an escalation a human has not
cleared yet, and `agent:in-progress` means another run (or an earlier iteration
of this one) already claimed it. Both stay in the queue label; neither is
eligible.

⚠️ **An empty array is ambiguous.** `gh issue list` with a label that does not
exist returns `[]` and exit 0 — identical to an empty queue. If you get `[]` on
the first pass, confirm the label exists (`gh label list | grep agent:ready`)
before reporting "queue empty", or a typo will read as a clean night.

### 1.2 Claim it

```bash
gh issue edit "$ISSUE" --add-label "agent:in-progress"
gh issue comment "$ISSUE" --body "Claimed by overnight run $(date '+%Y-%m-%d %H:%M %Z')."
```

Claim **before** creating the branch. The claim is what stops a second run — or
you, awake and impatient at 2am — from starting the same issue twice.

### 1.3 Extract the acceptance criteria

```bash
gh issue view "$ISSUE" --json body --jq '.body' \
  | grep -nE '^[[:space:]]*-[[:space:]]\[[ xX]\]'
```

Those checklist lines **are** the specification. Copy them verbatim — do not
paraphrase, tighten, or "clarify" them. If they are empty or too vague to verify
from a transcript, that is a Phase 6 escalation right now, before any code:
label `agent:blocked`, comment asking for criteria, move on.

---

## Phase 2: Execute as a gated unit

### 2.1 Branch

```bash
INIT=$(gh issue view "$ISSUE" --json labels \
  --jq '[.labels[].name] | map(select(startswith("init:"))) | first // "init:misc"' \
  | sed 's/^init://')
SLUG=$(gh issue view "$ISSUE" --json title --jq '.title' \
  | tr '[:upper:]' '[:lower:]' \
  | sed 's/[^a-z0-9][^a-z0-9]*/-/g; s/^-//; s/-$//' \
  | cut -c1-40 | sed 's/-$//')
git checkout -b "$INIT/$SLUG"
```

⚠️ That character class is written the long way — `[^a-z0-9][^a-z0-9]*`, not
`[^a-z0-9]\+` — because macOS ships **BSD sed**, which does not understand `\+`
in a basic regex. With `\+` the substitution silently matches nothing and you
get a branch name with spaces and `&` still in it, which `git checkout -b` then
mangles. The trailing `sed 's/-$//'` runs *after* `cut`, because truncating at
40 characters can land on a hyphen.

Branch names are `<initiative>/<slug>` — `chat-polish/thread-page-rooting`,
`misc/fix-avatar-fallback`. The prefix is what makes a week of overnight runs
legible in the branch list instead of forty `feature/*` branches.

### 2.2 Set the goal

**Run `/goal` before writing any code.** Paste the acceptance checklist from
1.3 verbatim, and bound it:

```
/goal <acceptance checklist, verbatim, one line per item> — or stop after 25 turns
```

The turn cap is a ceiling, not a target. It is the same unit as auto-worker.md's
per-task cap and a different unit from `max-issues` (issues) or the review
cycles in Phase 5. If a unit is hitting 25 turns, that is the signal the issue
was underspecified — escalate it (Phase 6), do not raise the number.

### 2.3 Implement

Spawn sub-agents. The completion gate (`.claude/hooks/completion-gate.sh`, Stop
hook) will refuse to let a sub-agent finish while a `.ts`/`.tsx` file **it
changed** has a TypeScript error, so typecheck-on-touched-files is enforced for
you and does not need to be in the sub-agent's prompt as a request.

What the gate does **not** cover, and you therefore still have to do:

- files outside `apps/*` / `packages/*` (no workspace tsconfig, gate exits 0)
- pre-existing errors in files you did not touch (deliberately ignored)
- tests, lint, and anything runtime

Commit atomically as you go:

```bash
git commit -m "<type>(<scope>): <what changed and why>

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Phase 3: Evidence bundle

Assemble this **before** opening the PR. A PR without evidence is a PR you have
to re-verify in the morning, which defeats the point of the run.

### 3.1 Which suites to run

Derive from the touched paths:

```bash
git diff --name-only origin/main...HEAD
```

| Touched                | Run                                                          |
| ---------------------- | ------------------------------------------------------------ |
| `apps/convex/**`       | `pnpm --filter convex-functions test`                        |
| `apps/mobile/**`       | `pnpm --filter mobile test`                                   |
| `apps/web/**`          | `pnpm --filter @togather/web type-check`                      |
| `packages/shared/**`   | `pnpm --filter @togather/shared test && … type-check`         |
| anything, as a floor   | the touched workspace's own `tsc --noEmit`                    |

Capture the tail of each run — pass/fail counts, not the whole log:

```bash
pnpm --filter convex-functions test 2>&1 | tail -30 \
  | tee .claude/logs/overnight/issue-$ISSUE-convex-test.log
```

### 3.2 UI changes: screenshots

If the diff touches `apps/mobile/**` and the change is visible, capture it.

```bash
# Is there anything to screenshot on?
xcrun simctl list devices booted | grep -q iPhone && echo "simulator available"
```

If one is booted, use the ios-simulator MCP tools —
`mcp__ios-simulator__get_booted_sim_id`, then `mcp__ios-simulator__ui_view` to
navigate and `mcp__ios-simulator__screenshot` to capture. Spawn a sub-agent for
this (see auto-worker.md Phase 4 for the prompt shape and its pre-flight check;
do not let a testing sub-agent hang unbounded on a dead simulator).

Write captures to `.claude/logs/overnight/issue-<n>/` — that path is gitignored,
which is deliberate. **Screenshots are never committed.** Binary evidence in the
history bloats the repo permanently for a fact that is only interesting for a
day.

If **no simulator is available**, do not quietly skip it. Put this at the top of
the Evidence section, verbatim, where it cannot be missed:

```markdown
> ⚠️ **UI change — needs device verify.** No simulator was available during the
> overnight run, so nothing here has been seen rendering. Per ADR-013, CI is
> blind to native rendering regressions.
```

And if the diff touches native media, `expo-*` native views, the mobile
dependency graph, or `pnpm-lock.yaml`, that warning is **mandatory regardless of
screenshots** — a simulator screenshot is not a device verify. See CLAUDE.md,
"JS Changes Can Break Native Rendering".

### 3.3 Convex changes: deploy note

This repo has **no preview deploys**. `deploy-convex.yml` fires on push to
`main` for `apps/convex/**` and `packages/shared/**`, which means **merging is
the staging deploy** — there is no intermediate step where you get to look.

So for a Convex diff, the Evidence section says which of these it is:

- **Schema or migration touched** → human merge, full stop (also CODEOWNERS-
  protected; see Phase 6). Note that merging deploys to staging immediately.
- **Function logic only, tests green** → safe to merge on green; note that
  staging picks it up on merge.

### 3.4 Attaching evidence

Everything goes in an `## Evidence` section in the PR body: summarised test
output in a fenced block, the deploy note, the device-verify warning if it
applies.

**Screenshots are the awkward part.** There is no supported `gh` command that
uploads an image into a PR body — the web UI uses a private endpoint. So:

1. **Preferred:** if the repo has an evidence release (`gh release view
   agent-evidence`), upload there and link the asset URLs, which render inline:
   ```bash
   gh release upload agent-evidence .claude/logs/overnight/issue-$ISSUE/*.png --clobber
   ```
2. **Otherwise:** list the local absolute paths in the Evidence section under a
   heading that says what they are, e.g. `Screenshots (local to the run
   machine, not uploaded)`. Say plainly that they are local. A path the founder
   can `open` at breakfast beats a silently dropped screenshot; a path presented
   as if it were a link does not.

Do **not** commit the images to make them linkable. That is the one option that
is off the table.

---

## Phase 4: Open the PR

Write the body to a file rather than inlining a heredoc. The body contains a
fenced code block for the test output, and nesting one fence inside another is
how you end up with a PR body that renders as half a code block:

````bash
git push -u origin HEAD

BODY=.claude/logs/overnight/issue-$ISSUE-pr-body.md
cat > "$BODY" <<'EOF'
## Summary

<2-4 bullets: what changed and why>

## Acceptance criteria

<the checklist from the issue, verbatim, boxes ticked as verified>

## Evidence

### Tests
```
<summarised output>
```

### Screenshots
<links, local paths, or the device-verify warning>

### Deploy note
<Phase 3.3, if Convex was touched>

Closes #<issue>

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF

gh pr create --base main \
  --title "<type>(<scope>): <what this does>" \
  --body-file "$BODY"
````

The body file lands in the gitignored run directory, so it is never committed
and is still there in the morning if the `gh pr create` itself fails.

`Closes #<issue>` matters beyond tidiness: it is what makes a merge close the
issue automatically, so a merged unit cannot be picked up again by a later run.

---

## Phase 5: Review cycle

Run the existing loop — do not reimplement it here:

```
/review-cycle <PR_NUMBER>
```

`.claude/commands/review-cycle.md` already handles requesting the bot review,
waiting out autofix before touching comments, fixing findings, resolving
threads, and the CI/conflict phases. It sets its own `/goal` in cycles.

**One override for overnight use:** review-cycle's Phase 7 merges. Under
`/overnight` **you do not let it merge** — merging is Phase 6 below and it is
gated on labels review-cycle knows nothing about. Tell it so when you invoke it:

> Run every phase except Phase 7 (Merge) and Phase 8 (post-merge CI). Stop when
> the PR is mergeable and report; the overnight orchestrator decides whether to
> merge.

---

## Phase 6: Merge policy

Three conditions. All three, or the PR stays open.

### 6.1 Is CI green?

```bash
gh pr checks "$PR" --json bucket \
  --jq 'if length == 0 then "NO_CHECKS" else (all(.[]; .bucket == "pass" or .bucket == "skipping") | tostring) end'
```

`true` → green. `false` → not green. `NO_CHECKS` → **not green** — no checks ran
at all, which is a configuration problem, not a pass.

> **Hard rule: never merge anything without green CI.** Not "the failure looks
> unrelated", not "it's a flake, I re-ran it once and it's probably fine". If CI
> is not green the PR is left open. This rule has no overnight exception,
> because 3am is exactly when the reasoning for an exception sounds best.

`NO_CHECKS` is the expected result for a **stacked PR**: `ci.yml` triggers on
`pull_request: branches: [main]` only, so a PR based on another branch gets no
checks at all. Treating that as not-green is the correct outcome, not a bug to
work around — the checks appear once the parent merges and GitHub retargets the
base to `main`. Phase 4 opens PRs against `main` precisely so this is rare.

### 6.2 Does the diff touch a protected path?

`.github/CODEOWNERS` marks paths CI cannot vouch for. **Any hit means the PR is
left for human merge regardless of every label and every green check.**

```bash
PROTECTED='^(\.github/workflows/|apps/api-trpc/src/prisma/|apps/mobile/(ios|android)/|apps/mobile/app\.config\.js|apps/mobile/\.fingerprint|packages/|pnpm-lock\.yaml|apps/mobile/package\.json|apps/mobile/native-deps\.json|apps/convex/(functions/auth/|auth\.ts|lib/auth\.ts|functions/authInternal\.ts|functions/billing\.ts|functions/ee/billing\.ts|functions/finance/|lib/finance/|migrations/|functions/migrations/|functions/migrations\.ts|functions/admin/migrations\.ts|functions/meetings/migrations\.ts|functions/notifications/migrations\.ts))'
gh pr view "$PR" --json files --jq '.files[].path' | grep -E "$PROTECTED" \
  && echo "PROTECTED PATH -> human merge only"
```

The paths, and why each one is off-limits to an unattended agent:

| Path                                                                                                                                                                                                       | Why                                                                            |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `pnpm-lock.yaml`, `apps/mobile/package.json`, `apps/mobile/native-deps.json`                                                                                                                                | A JS-only dep change can blank native video/GIF on device while CI stays green. |
| `apps/mobile/ios/`, `apps/mobile/android/`, `apps/mobile/app.config.js`, `apps/mobile/.fingerprint`                                                                                                          | Native build config; a bad `runtimeVersion` bricks OTA for shipped builds.      |
| `apps/convex/functions/auth/`, `apps/convex/auth.ts`, `apps/convex/lib/auth.ts`, `apps/convex/functions/authInternal.ts`                                                                                     | Locks people out or lets the wrong people in. Tests assert code, not policy.    |
| `apps/convex/functions/billing.ts`, `apps/convex/functions/ee/billing.ts`, `apps/convex/functions/finance/`, `apps/convex/lib/finance/`                                                                      | Moves real money.                                                               |
| `apps/convex/migrations/`, `apps/convex/functions/migrations/`, `apps/convex/functions/migrations.ts`, `apps/convex/functions/{admin,meetings,notifications}/migrations.ts`                                  | Runs once against production data. There is no second attempt.                  |
| `.github/workflows/`, `apps/api-trpc/src/prisma/`, `packages/`                                                                                                                                              | CI infra and shared packages — blast radius beyond the PR.                      |

Keep this table in sync with `.github/CODEOWNERS`; that file is the source of
truth, this is the operational read of it.

### 6.3 Did the human opt in?

```bash
gh issue view "$ISSUE" --json labels --jq '[.labels[].name] | index("agent:automerge") != null'
```

Merge **only** if `true`, CI is green (6.1), review-cycle reported clean, and
6.2 found nothing:

```bash
gh pr merge "$PR" --squash --delete-branch
```

Otherwise leave it open. That is not a failure — for most issues it is the
expected outcome and the whole point of the run is that the PR is sitting there
ready when you wake up.

### 6.4 Close out the issue

Either way:

```bash
gh issue edit "$ISSUE" --remove-label "agent:in-progress"
gh issue comment "$ISSUE" --body "Overnight run: PR #<pr> — <merged | open, awaiting review>.

<one-paragraph evidence summary: which suites ran, screenshots or the device-verify note, deploy note>"
```

`agent:in-progress` comes off **whatever happened**. A leftover claim label
silently removes the issue from every future run's queue.

---

## Phase 7: Loop hygiene

Between units, every time:

```bash
git checkout main
git pull --ff-only origin main
git status --porcelain   # must be empty
```

Then re-check all four guards from "The guards" above. Only if every one is
clear do you go back to Phase 1.

Log the decision either way — the morning report has to say why the run ended,
and "queue still had 3 issues, clock guard tripped at 07:00" is the useful
version of "stopped".

---

## Failure handling

A unit fails when any of these happens:

- **3 consecutive completion-gate blocks** on the same unit. The gate stands
  down after 2 reports per session, so a third block means it is genuinely not
  compiling and the loop is not converging.
- **The `/goal` turn cap is exhausted** without the criteria met.
- **The same error 3 times** — auto-worker.md's circuit breaker, unchanged.
- **Acceptance criteria that cannot be verified** from the transcript.

When a unit fails:

```bash
gh issue edit "$ISSUE" --add-label "agent:blocked" --remove-label "agent:in-progress"
gh issue comment "$ISSUE" --body "Blocked by the overnight run $(date '+%Y-%m-%d %H:%M %Z').

**Why:** <the specific failure — the tsc error, the criterion that could not be verified, the repeated error>
**Branch:** \`<branch>\` (pushed, no PR)
**Transcript:** \`.claude/logs/overnight/run.log\` around $(date '+%H:%M') — see \`.claude/logs/overnight/issue-$ISSUE-*\`
**What would unblock it:** <the concrete thing a human needs to decide or provide>"
```

Push the branch even with no PR, so the partial work is recoverable. Then move
to the next issue.

> **Never retry the same issue twice in one night.** Not with a different
> approach, not "one more go now that I understand it". The second attempt has
> the same context that produced the first failure, and each retry costs a unit
> of the night that a fresh issue would use better. `agent:blocked` is picked up
> again only after a human removes the label — which is the point: it means a
> person has looked.

---

## Phase 8: Wrap-up

### 8.1 Release the machine

```bash
kill "$CAFFEINATE_PID" 2>/dev/null
pgrep -x caffeinate || echo "caffeinate stopped"
```

Do this **first**, before composing the report. If the report step fails you
still want the laptop free to sleep.

### 8.2 Spend for the run

```bash
ccusage blocks --active --json > .claude/logs/overnight/usage-end.json
```

Report the delta against `usage-start.json` from Phase 0.4, not a lifetime
total.

### 8.3 The morning report

```markdown
## Overnight run — <date>

**Ran:** <start> → <end> (<duration>) · **Stopped because:** <which guard tripped>
**Spend:** $<delta> · **Window left:** <n>%

### Shipped
- #<issue> <title> → PR #<pr> <url> — <merged | open for review>

### Blocked
- #<issue> <title> — <one-line reason>

### Evidence
- #<issue>: <suites run, pass counts> · <screenshots / ⚠️ needs device verify>

### Waiting for you
- <PRs open for review, with why they were not auto-merged: no agent:automerge / protected path / CI not green>
```

Lead with what needs the founder, not with what went well. The report is read on
a phone, before coffee.

### 8.4 Send it

**Preferred — iMessage**, if the imessage MCP reply tool is available in the
session:

```
mcp__plugin_imessage_imessage__reply  chat_id: "+12026150407"  message: <the report>
```

**Fallback** — if that tool is not in the session, post it to the pinned
tracking issue *and* print it:

```bash
gh issue list --state open --limit 10 --search "Overnight orchestrator run log in:title" --json number,title
gh issue comment "$TRACKING_ISSUE" --body "## Morning report

<report>"
```

If no tracking issue exists, create one titled `Overnight orchestrator — run
log`, pin it, and use it from then on.

Then print the report in the session regardless of which path worked. It is the
last thing in the transcript, which is where you will look if the notification
never arrived.

---

## Safety rules

1. **Never edit your own inputs.** Not `agent:ready`, not `agent:automerge`, not
   `priority:high`, not `init:*`, not an issue's title or body. Wrong criteria
   are an escalation, not an edit.
2. **Never merge without green CI.** No unrelated-looking failures, no flake
   exceptions, no `NO_CHECKS`.
3. **Never merge a protected path** (6.2), whatever the labels say.
4. **Never merge without `agent:automerge`.** Absent label = PR left open. That
   is the normal outcome.
5. **Never retry a failed issue the same night.**
6. **Never stash or discard someone else's uncommitted work.** Dirty tree =
   stop.
7. **Always remove `agent:in-progress`** when done with an issue, whatever the
   outcome.
8. **Always kill caffeinate**, even if the run ends badly.
9. **Always claim before branching.** Claim first, work second.
10. **Never commit screenshots or evidence binaries.**
11. **Finish the unit in flight, then stop.** A guard tripping mid-unit means no
    *next* unit — not an abandoned branch.
12. **Stay an orchestrator.** Sub-agents with `max_turns` for everything;
    context has to last the night.
