# Auto-Worker Agent

Autonomous task processor designed to run overnight via Ralph loop. Picks tasks from the backlog, implements them with full verification, handles code review, and auto-merges to main.

## Usage

Invoke via Ralph loop for overnight runs:
```bash
/ralph-loop "/auto-worker" --max-iterations 50 --completion-promise "AUTO_WORKER_COMPLETE"
```

Or run a single task cycle manually:
```
/auto-worker
```

---

## CRITICAL: Orchestrator Pattern

**YOU ARE AN ORCHESTRATOR, NOT A DOER.**

⚠️ **VIOLATION OF THIS RULE CAUSES CONTEXT EXHAUSTION AND INFINITE LOOPS** ⚠️

Your ONLY jobs are:
1. Check budget and decide whether to continue
2. Pick the next task from the queue
3. Expand minimal PRD into full plan
4. Spawn sub-agents for all execution work
5. Update task files with attempt logs
6. Output completion promise when done

**PROTECT YOUR CONTEXT** - Never do file reading, code exploration, or implementation yourself. Spawn sub-agents for everything.

### What You MUST NOT Do Directly

❌ **DO NOT** use the Edit tool - spawn a sub-agent
❌ **DO NOT** use the Read tool (except for task files) - spawn a sub-agent
❌ **DO NOT** use the Grep/Glob tools - spawn a sub-agent
❌ **DO NOT** take screenshots - spawn a sub-agent
❌ **DO NOT** interact with the simulator - spawn a sub-agent
❌ **DO NOT** write code - spawn a sub-agent

### What You CAN Do Directly

✅ Read QUEUE.md and task files (to pick tasks)
✅ Write to task files (to update attempt logs)
✅ Run simple bash commands for budget/status checks
✅ Spawn Task sub-agents (with max_turns!)
✅ Log progress to auto-worker-progress.log

---

## CRITICAL: Progress Logging

**LOG PROGRESS FREQUENTLY** - The user needs visibility into what's happening.

### Before EVERY Phase

Run this to log progress (replace PHASE and DESCRIPTION):

```bash
echo "[$(date '+%Y-%m-%d %H:%M:%S')] PHASE: DESCRIPTION" >> .claude/logs/auto-worker-progress.log
```

Examples:
```bash
echo "[$(date '+%Y-%m-%d %H:%M:%S')] Phase 0: Checking budget" >> .claude/logs/auto-worker-progress.log
echo "[$(date '+%Y-%m-%d %H:%M:%S')] Phase 1: Reading queue, found 3 pending tasks" >> .claude/logs/auto-worker-progress.log
echo "[$(date '+%Y-%m-%d %H:%M:%S')] Phase 3: Spawning dev sub-agent for task notifications-broken" >> .claude/logs/auto-worker-progress.log
```

### After Sub-Agent Returns

Log the result:
```bash
echo "[$(date '+%Y-%m-%d %H:%M:%S')] Sub-agent returned: SUCCESS/FAILED - brief summary" >> .claude/logs/auto-worker-progress.log
```

### Monitor Progress

User can watch progress in real-time:
```bash
tail -f .claude/logs/auto-worker-progress.log
```

---

## CRITICAL: Sub-Agent Timeouts

**ALL sub-agent Task calls MUST include `max_turns` to prevent infinite hangs.**

⚠️ **FAILURE TO INCLUDE max_turns WILL CAUSE THE RALPH LOOP TO HANG FOR HOURS** ⚠️

| Sub-agent Type | max_turns | Rationale |
|----------------|-----------|-----------|
| Task reading/planning | 15 | Quick exploration tasks |
| Implementation | 50 | Complex coding needs more turns |
| Testing | 30 | Simulator interaction + screenshots |
| PR creation | 15 | Straightforward git operations |
| Smoke test | 20 | Quick verification |

**Example Task call with max_turns:**
```
Task tool with subagent_type="general-purpose", max_turns=30:
"Your prompt here..."
```

If a sub-agent times out (returns incomplete), log it and retry with a fresh sub-agent or mark the task for retry in the next Ralph iteration.

### Handling Sub-Agent Timeout

When a sub-agent hits max_turns without completing:

1. **Log the timeout:**
   ```bash
   echo "[$(date '+%Y-%m-%d %H:%M:%S')] TIMEOUT: Sub-agent hit max_turns limit" >> .claude/logs/auto-worker-progress.log
   ```

2. **Check partial progress:** The sub-agent may have made partial progress (commits, file changes). Check git status.

3. **Decide next action:**
   - If partial progress exists: Update task log, mark for retry in next Ralph iteration
   - If no progress: Try once more with a simpler prompt or mark as blocked

4. **Never hang:** Always move forward - either retry, skip to next task, or output completion promise if stuck on all tasks.

---

## File Locations

```
.claude/
├── backlog/
│   ├── QUEUE.md              # Task queue (read/update this)
│   ├── tasks/                # Task PRD files
│   └── completed/            # Archived completed tasks
├── images/
│   ├── reference/            # Input: mockups, bug screenshots
│   └── verification/         # Output: test evidence
├── logs/                     # Console outputs, error dumps
└── budget/
    └── config.yaml           # Budget limits
```

---

## Phase 0: Check Budget

Before doing anything, check if we have budget remaining.

```bash
# Check current usage
ccusage --json | jq '.weekly_percent'
```

**Decision:**
- If usage >= 50% (or limit in config.yaml): Output `AUTO_WORKER_COMPLETE: Budget exceeded` and stop
- If usage < 50%: Continue to Phase 1

---

## Phase 1: Pick Next Task

### 1.1 Read the Queue

```bash
cat .claude/backlog/QUEUE.md
```

Look at the "Pending" section for available tasks.

### 1.2 Read All Pending Task Files

For each task in Pending, spawn a sub-agent to read and summarize:

```
Task tool with subagent_type="general-purpose", max_turns=15:

"Read the task file at .claude/backlog/tasks/<filename> and return:
- Priority (from frontmatter, or 'normal' if not specified)
- Brief summary (1 sentence)
- Has prior attempts? (check for '## Attempt Log' section)
- Number of prior loops (count ### Loop N headers)
- Is it blocked? (last attempt status)

Return as structured data."
```

### 1.3 Prioritize

Select the next task based on:
1. **High priority first** - Tasks with `priority: high` in frontmatter
2. **Fewer attempts first** - Prefer fresh tasks over retries
3. **Unblocked only** - Skip tasks where last attempt was "Blocked" (unless it's been < 3 loops)
4. **Your judgment** - Consider dependencies, complexity, risk

### 1.4 Update Queue

Move the selected task from "Pending" to "In Progress" in QUEUE.md.

---

## Phase 2: Expand Task

Read the task file and expand the minimal PRD into a full plan.

**Spawn a sub-agent:**

```
Task tool with subagent_type="general-purpose", max_turns=15:

"You are a technical planner. Read this task file and expand it into a detailed implementation plan.

Task file: .claude/backlog/tasks/<filename>

Your job:
1. Read the task description and any reference images
2. If there are prior attempt logs, READ THEM CAREFULLY - understand what was tried and what failed
3. Search the codebase to understand existing patterns
4. Create a detailed plan with:
   - Acceptance criteria (checkboxes)
   - Files that need to be modified
   - Technical approach
   - Verification steps (what to test on simulator)
   - Potential pitfalls to avoid (especially based on prior attempts)

Return the plan in markdown format.

IMPORTANT: If prior attempts exist, your plan MUST address what went wrong before."
```

---

## Phase 3: Implement

### 3.1 Determine Loop Number

Count existing "### Loop N" headers in the task file. New loop = max + 1.

### 3.2 Start Attempt Log Entry

Append to the task file:

```markdown
---

## Attempt Log

### Loop N (YYYY-MM-DD HH:MM)
**Status:** In Progress
**Commits:** (none yet)
```

### 3.3 Spawn Development Sub-Agent

```
Task tool with subagent_type="general-purpose", max_turns=50:

"You are implementing a feature.

## Task
<paste expanded plan here>

## Prior Attempts
<paste any prior attempt logs - what failed, what to avoid>

## Instructions
1. cd to repo root
2. Create a feature branch: git checkout -b feature/<task-slug>
3. Implement the feature following the plan
4. Commit frequently with atomic commits
5. Run type checks: pnpm --filter api-trpc type-check
6. Run tests: pnpm test

## Commit Format
git commit -m '<type>: <description>

Co-Authored-By: Claude <noreply@anthropic.com>'

## IMPORTANT
- If you encounter issues, document them clearly
- Take note of any error messages or unexpected behavior
- Do NOT give up - try multiple approaches if needed

## Report Back
- List of commits made (hashes + messages)
- Files modified
- Any issues encountered
- Ready for testing? (yes/no)
"
```

### 3.4 Handle Development Result

**If successful:** Update attempt log with commits, proceed to Phase 4

**If failed:**
1. Take screenshot of any errors: `xcrun simctl io booted screenshot .claude/images/verification/<task>-loop<N>-error.png`
2. Dump console logs: Save to `.claude/logs/<task>-loop<N>-console.log`
3. Update attempt log with what went wrong and screenshots/logs
4. Add "Recommendation for next attempt"
5. Check loop count:
   - If < 3 loops: Mark status as "Retry", continue to next Ralph iteration
   - If >= 3 loops: Mark status as "Blocked", move task back to Pending (Blocked section), pick next task

---

## Phase 4: Test on Simulator

### 4.0 Pre-Flight Check (REQUIRED)

**Before spawning any testing sub-agents, verify simulator tools work:**

```bash
# Check idb is installed and working
which idb || { echo "BLOCKED: idb not installed. Run: pipx install fb-idb --python /usr/bin/python3"; exit 1; }

# Test idb can communicate with simulator
idb list-targets 2>&1 | grep -q "Booted" || { echo "BLOCKED: No booted simulator found"; exit 1; }

echo "Pre-flight check passed"
```

**If pre-flight fails:**
1. Log the failure: `echo "[$(date)] BLOCKED: Simulator tools not available" >> .claude/logs/auto-worker-progress.log`
2. Mark task as "Blocked - requires simulator setup"
3. Move to next task or output completion promise
4. **DO NOT spawn testing sub-agents that will hang**

### 4.1 Start Development Servers

```bash
# Start backend and Metro
pnpm dev --local &

# Wait for servers
sleep 30

# Verify
curl -sf http://localhost:3000/health && echo "Backend OK"
curl -sf http://localhost:8081 && echo "Metro OK"
```

### 4.2 Boot Simulator and Launch App

```bash
# Get simulator UDID
SIM_UDID=$(xcrun simctl list devices available | grep "iPhone" | head -1 | grep -oE "[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}")

# Boot simulator
xcrun simctl boot $SIM_UDID 2>/dev/null || true

# Launch Expo Go
xcrun simctl launch $SIM_UDID host.exp.Exponent

# Open app
xcrun simctl openurl $SIM_UDID "exp://localhost:8081"
```

### 4.3 Spawn Testing Sub-Agent

```
Task tool with subagent_type="general-purpose", max_turns=30:

"You are testing a feature on iOS Simulator.

## Feature
<description>

## Acceptance Criteria
<from expanded plan>

## Verification Steps
<from expanded plan>

## Test Credentials
Use the test credentials from the seed script.
- Community: Search for 'Demo Community'

## Instructions
1. Use mcp__ios-simulator__ui_view to see current screen
2. Navigate through the app to test the feature
3. Take screenshots at each verification step
4. Save screenshots to .claude/images/verification/<task>-loop<N>-<step>.png

## CRITICAL
- You MUST take 2-5 screenshots as evidence
- If something fails, screenshot the failure
- Do not say 'cannot test' - fix blockers or report exactly what's broken

## Report Back
- PASS or FAIL for each acceptance criterion
- List of screenshots taken
- Any issues found (with details)
"
```

### 4.4 Handle Test Result

**If all tests pass:** Update attempt log with verification screenshots, proceed to Phase 5

**If tests fail:** Same as development failure - document, screenshot, potentially retry

### 4.5 Cleanup Servers

```bash
# Kill dev servers
pkill -f "node.*Togather" 2>/dev/null || true
pkill -f "expo" 2>/dev/null || true
lsof -ti :3000 | xargs kill -9 2>/dev/null || true
lsof -ti :8081 | xargs kill -9 2>/dev/null || true
```

---

## Phase 5: Create PR

**Spawn a sub-agent:**

```
Task tool with subagent_type="general-purpose", max_turns=15:

"You are creating a PR for a completed feature.

## Context
- Feature: <description>
- Branch: feature/<task-slug>
- Task file: .claude/backlog/tasks/<filename>

## Screenshots
<list of verification screenshots from Phase 4>

## Instructions
1. Ensure all changes are committed
2. Push branch: git push -u origin HEAD
3. Create PR:

gh pr create --base main --title '<feature title>' --body '## Summary
<bullet points from task>

## Screenshots
<embed verification screenshots>

## Test Plan
- [x] Verified on iOS Simulator
- [x] Unit tests pass
- [x] Type checks pass

## Task File
See: .claude/backlog/tasks/<filename>

---
Generated with Claude Auto-Worker'

## Report Back
- PR number
- PR URL
"
```

Update attempt log with PR number.

---

## Phase 6: Code Review Cycle

Invoke the review-cycle skill:

```
Use Skill tool: /review-cycle <PR_NUMBER>
```

This handles:
- Waiting for Cursor and Greptile bot reviews
- Fixing issues they raise
- Iterating until approved
- Resolving comment threads

---

## Phase 7: Smoke Test

After code review changes, do a quick sanity check.

**Spawn a sub-agent:**

```
Task tool with subagent_type="general-purpose", max_turns=20:

"Quick smoke test after code review changes.

## Instructions
1. Start dev servers: pnpm dev --local &
2. Wait 30 seconds
3. Boot simulator and launch app
4. Verify app loads without crash
5. Navigate to the feature area
6. Take ONE screenshot showing it still works
7. Kill dev servers

## Report Back
- PASS or FAIL
- Screenshot path
- Any issues
"
```

**If smoke test fails:** Document, potentially retry the review fixes

---

## Phase 8: Merge and Complete

### 8.1 Merge PR

```bash
gh pr merge <PR_NUMBER> --squash --delete-branch
```

### 8.2 Update Task File

Add final status to attempt log:

```markdown
**Status:** Complete
**PR:** #<number> → Merged

**Verification Screenshots:**
![Step 1](../../images/verification/<task>-loop<N>-step1.png)
![Step 2](../../images/verification/<task>-loop<N>-step2.png)
```

### 8.3 Move Task to Completed

```bash
mv .claude/backlog/tasks/<filename> .claude/backlog/completed/
```

### 8.4 Update Queue

Move task from "In Progress" to "Completed" table in QUEUE.md:

```markdown
| <filename> | #<PR> | <date> |
```

### 8.5 Commit Bookkeeping

```bash
git add .claude/
git commit -m "chore: complete task <filename>

Auto-worker completed task and merged PR #<number>.

Co-Authored-By: Claude <noreply@anthropic.com>"
git push
```

---

## Phase 9: Loop or Complete

Check if there are more pending tasks in QUEUE.md:

- **If more tasks exist:** Return to Phase 0 (check budget first)
- **If queue empty:** Output `AUTO_WORKER_COMPLETE: Queue empty`
- **If budget exceeded:** Output `AUTO_WORKER_COMPLETE: Budget exceeded`

---

## Completion Promises

Ralph loop detects these to know when to stop:

- `AUTO_WORKER_COMPLETE: Queue empty` - All tasks done
- `AUTO_WORKER_COMPLETE: Budget exceeded` - Hit usage limit
- `AUTO_WORKER_COMPLETE: Max iterations` - Ralph's own limit hit

---

## Error Recovery

### Circuit Breaker Pattern

**If the same error occurs 3+ times, STOP and escalate:**

Track error patterns in the attempt log. When you see repeated failures:

1. **Identify the pattern:** Same error message? Same tool failing?
2. **Log the circuit break:**
   ```bash
   echo "[$(date)] CIRCUIT BREAKER: Same error 3+ times - <error summary>" >> .claude/logs/auto-worker-progress.log
   ```
3. **Take action based on error type:**
   - **Tool not found (ENOENT):** Mark task as blocked, note required tool installation
   - **Auth errors (401/403):** Check credentials/tokens, may need manual intervention
   - **Timeout/hang:** Reduce scope, try alternative approach, or skip
4. **Never keep retrying the same failing operation**

Example circuit breaker situations:
- `spawn idb ENOENT` repeated → Block task, note "requires idb installation"
- `401 Unauthorized` repeated → Block task, note "auth configuration issue"
- Sub-agent timing out repeatedly → Simplify the task or mark as too complex

### Sub-agent Says "Can't Do X"

**NEVER ACCEPT THIS.** Instead:
1. Ask WHY
2. Fix the blocker
3. Spawn a new sub-agent with updated context
4. **BUT if you've tried 3 times, trigger the circuit breaker above**

### Servers Won't Start

```bash
# Kill everything on dev ports
lsof -ti :3000 | xargs kill -9 2>/dev/null || true
lsof -ti :8081 | xargs kill -9 2>/dev/null || true
pkill -f "node.*Togather" 2>/dev/null || true
```

### Simulator Issues

```bash
# Reset simulator
xcrun simctl shutdown all
xcrun simctl erase all
xcrun simctl boot <UDID>
```

### Git Issues

```bash
# If branch conflicts
git fetch origin main
git rebase origin/main
# Or reset and retry
git checkout main
git pull
git checkout -b feature/<new-branch>
```

---

## Safety Rules

1. **Check budget first** - Don't start work you can't finish
2. **Document everything** - Update task files with attempt logs
3. **Screenshot failures** - Visual evidence helps next loop
4. **Dump logs** - Console output in .claude/logs/
5. **Never skip testing** - Every feature must be verified on simulator
6. **Never skip code review** - Let bots review before merge
7. **Auto-merge only to main** - Single protected branch
8. **Commit bookkeeping** - Push task file updates so they persist
