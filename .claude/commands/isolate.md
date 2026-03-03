# Isolated Development Agent (Orchestrator)

Creates an isolated development environment using a fixed worker slot. Each worker owns dedicated resources (worktree, ports, simulator) that it can aggressively manage.

## Usage

```
/isolate <worker-number> <feature-description>
```

Examples:
```
/isolate 1 Add a "mark all as read" button to notifications
/isolate 2 Fix the profile image upload bug
/isolate 3 Add dark mode toggle to settings
/isolate 4 Refactor authentication flow
```

---

## CRITICAL: Orchestrator Pattern

**YOU ARE AN ORCHESTRATOR, NOT A DOER.**

Your ONLY jobs are:
1. Clean up and prepare your worker's resources
2. Spawn sub-agents to do actual work
3. Monitor sub-agent results
4. Log activity when done
5. NEVER let sub-agents give up - if they fail, fix the issue and spawn again

**PROTECT YOUR CONTEXT** - Never do file reading, code writing, or exploration yourself. Spawn sub-agents for everything.

---

## Worker Resource Assignments

Each worker has FIXED, DEDICATED resources. You OWN these - clean them up aggressively.

| Worker | Worktree | Backend Port | Metro Port | Simulator | UDID |
|--------|----------|--------------|------------|-----------|------|
| 1 | `../Togather-worktrees/worker-1` | 3001 | 19001 | Test Sim 1 | E2D4D884-4A2C-45C5-9E76-BF55FF3C393F |
| 2 | `../Togather-worktrees/worker-2` | 3002 | 19002 | Test Sim 2 | 9857B313-E271-433A-8568-6D994156A2B2 |
| 3 | `../Togather-worktrees/worker-3` | 3003 | 19003 | Test Sim 3 | C3E057E4-77D8-4220-8F25-FC94C96782B1 |
| 4 | `../Togather-worktrees/worker-4` | 3004 | 19004 | Test Sim 4 | 3BEA97A2-650C-477B-99F0-60934CD74140 |

---

## Phase 1: Clean Up & Prepare Resources

You OWN your worker's resources. Clean them up without hesitation.

### 1.1 Kill Any Processes on Your Ports

```bash
# Kill anything on your backend port
lsof -ti :$BACKEND_PORT | xargs kill -9 2>/dev/null || true

# Kill anything on your metro port
lsof -ti :$METRO_PORT | xargs kill -9 2>/dev/null || true

# Also kill any expo processes that might be lingering
pkill -f "expo.*$METRO_PORT" 2>/dev/null || true
```

### 1.2 Sync and Reset Your Worktree

```bash
cd $WORKTREE_PATH

# Discard any uncommitted changes
git checkout -- .
git clean -fd

# Fetch latest main
git fetch origin main

# Reset branch to latest main (IMPORTANT: ensures worktree is up to date)
# This ensures you have the latest dev scripts with --agent=N support
git checkout worker-$N-branch 2>/dev/null || git checkout -b worker-$N-branch
git reset --hard origin/main

# Verify we're synced
git log -1 --oneline origin/main
git log -1 --oneline HEAD
# These should show the same commit

# Ensure dependencies are up to date (main may have new deps)
pnpm install

# CRITICAL: Build the shared package (required for backend to start)
pnpm --filter @togather/shared build
```

**IMPORTANT:** The `pnpm dev --local --agent=N` command requires:
1. The latest scripts from main
2. The `@togather/shared` package to be built (dist/ folder must exist)

### 1.3 Prepare Your Simulator

```bash
# Ensure simulator is booted
xcrun simctl boot $SIMULATOR_UDID 2>/dev/null || true

# Kill any existing Expo Go instance
xcrun simctl terminate $SIMULATOR_UDID host.exp.Exponent 2>/dev/null || true
```

### 1.4 Log Start of Work

Update `.claude/workspace-resources.md` with a START entry:

```
[TIMESTAMP] WORKER-$N START: "<feature description>"
```

### 1.5 Create Feature Branch

```bash
cd $WORKTREE_PATH

# Create a feature branch from current position
FEATURE_SLUG=$(echo "<feature>" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9]/-/g' | sed 's/--*/-/g' | cut -c1-50)
git checkout -b "feature/$FEATURE_SLUG"
```

---

## Phase 2: Development (SUB-AGENT)

**Spawn a sub-agent** for development work:

```
Task tool with subagent_type="general-purpose":

"You are developing a feature in an isolated worktree.

## Context
- Worktree: $WORKTREE_PATH
- Feature: <feature description>

## Instructions
1. cd to the worktree: cd $WORKTREE_PATH
2. Search the codebase to understand existing patterns
3. Plan your implementation
4. Write tests first (if applicable)
5. Implement the feature
6. Run type checks: pnpm --filter api-trpc type-check
7. Run tests: pnpm test
8. Commit frequently with atomic commits

## Commit Format
git commit -m '<type>: <description>

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>'

## Report Back
When done, report:
- Files modified
- Number of commits
- Test results
- Any issues or concerns
"
```

**On sub-agent completion:**
- If successful: proceed to Phase 3
- If failed with fixable issue: spawn another sub-agent to fix it
- If blocked: investigate why, fix it yourself (briefly), then re-spawn

---

## Phase 3: Testing (SUB-AGENT)

### 3.1 Start Development Servers

**ALWAYS use the agent-dev script** - it handles Watchman issues, shared package builds, port cleanup, and uses `CI=true` to avoid FSEventStreamStart errors:

```bash
cd $WORKTREE_PATH

# RECOMMENDED: Use the agent-dev script
# This automatically:
# - Resets Watchman and clears corrupted state
# - Builds @togather/shared if needed
# - Kills any existing processes on your ports
# - Starts backend on port 3000+N (e.g., 3001 for worker 1)
# - Starts Metro on port 19000+N with CI=true (avoids Watchman issues)
# - Waits for servers to be healthy
# - Optionally boots simulator and launches Expo Go

pnpm dev:agent --agent=$WORKER_NUMBER --reset-watchman --launch-sim
```

**Check server status:**
```bash
# Check if servers are already running
pnpm dev:agent --agent=$WORKER_NUMBER --check-only
```

**Stop servers:**
```bash
pnpm dev:agent --agent=$WORKER_NUMBER --stop
```

**Fallback (only if agent-dev script doesn't exist):**
```bash
# If you're on an older branch without agent-dev.js, use this:
cd $WORKTREE_PATH
CI=true pnpm dev --local --agent=$WORKER_NUMBER &

# Wait and verify
sleep 30
curl -sf "http://localhost:$BACKEND_PORT/health" > /dev/null && echo "Backend OK" || echo "Backend not ready"
curl -sf "http://localhost:$METRO_PORT/" > /dev/null && echo "Metro OK" || echo "Metro not ready"
```

### 3.2 Connect App to Metro

Before spawning the testing sub-agent, ensure the app is connected to Metro:

```bash
# Verify Metro is running and ready
curl -sf "http://localhost:$METRO_PORT/" > /dev/null && echo "Metro ready" || echo "Metro not ready yet"

# The dev command with --agent=N should have started Metro on the correct port
# If the app shows "Could not connect to development server", the app needs to be
# manually pointed to the correct URL
```

**If app shows connection error:**
1. Open Expo Go on the simulator
2. Enter the URL manually: `exp://localhost:$METRO_PORT`
3. Or shake device (Cmd+Ctrl+Z) to open dev menu and change URL

### 3.3 Spawn Testing Sub-agent

**Spawn a sub-agent** for UI testing:

```
Task tool with subagent_type="general-purpose":

"You are testing a feature on iOS Simulator.

## Context
- Simulator: $SIMULATOR_NAME (UDID: $SIMULATOR_UDID)
- Feature: <feature description>
- Expected behavior: <what should happen>
- Metro Port: $METRO_PORT (app should connect to exp://localhost:$METRO_PORT)

## Test Credentials
Use the test credentials from the seed script.
- Community: Search for 'Demo Community'

## Instructions
1. Use mcp__ios-simulator__ui_view with udid='$SIMULATOR_UDID' to see current screen
2. If you see a 'Could not connect' error:
   - The dev server may not be running - report this back
   - Or the app is pointing to wrong URL - it should be exp://localhost:$METRO_PORT
3. Navigate to the relevant screen using ui_tap and ui_type
4. Test the new feature thoroughly
5. Check for:
   - Feature works as expected
   - No crashes or errors
   - UI looks correct
   - Edge cases handled

## IMPORTANT
- You MUST complete testing. Do not say 'cannot test because X'
- If something is broken, report WHAT is broken and HOW to fix it
- Take screenshots using mcp__ios-simulator__screenshot

## Report Back
- Test results (PASS/FAIL for each test case)
- Screenshots taken
- Issues found (with specific details)
- Suggested fixes if any issues found
"
```

**On sub-agent completion:**
- If tests pass: proceed to Phase 4
- If tests fail with issues: spawn a dev sub-agent to fix, then re-test
- If sub-agent says "can't test": DO NOT ACCEPT THIS. Ask WHY and fix the blocker

### 3.4 Launch App on Simulator

After Metro is running, launch the app on your simulator:

```bash
# Launch Expo Go on your simulator
xcrun simctl launch $SIMULATOR_UDID host.exp.Exponent 2>/dev/null || true

# Wait for Expo Go to open
sleep 3

# The app should auto-connect. If not, use the MCP tools to:
# 1. Take a screenshot: mcp__ios-simulator__ui_view(udid=$SIMULATOR_UDID)
# 2. If on Expo Go home, tap the URL bar and enter: exp://localhost:$METRO_PORT
```

### 3.5 Cleanup Servers

After testing completes:

```bash
# Kill the dev process (this kills both backend and Metro)
kill $DEV_PID 2>/dev/null || true

# Force kill anything on your ports (safety cleanup)
lsof -ti :$BACKEND_PORT | xargs kill -9 2>/dev/null || true
lsof -ti :$METRO_PORT | xargs kill -9 2>/dev/null || true

# Terminate Expo Go on simulator
xcrun simctl terminate $SIMULATOR_UDID host.exp.Exponent 2>/dev/null || true
```

---

## Phase 4: Create PR (SUB-AGENT)

**Spawn a sub-agent** for PR creation:

```
Task tool with subagent_type="general-purpose":

"You are creating a PR for a completed feature.

## Context
- Worktree: $WORKTREE_PATH
- Feature: <feature description>

## Instructions
1. cd to worktree: cd $WORKTREE_PATH
2. Ensure all changes committed: git status
3. Run final tests: pnpm test
4. Push branch: git push -u origin HEAD
5. Create PR against main:

gh pr create --base main --title '<feature title>' --body '## Summary
<bullet points>

## Test Plan
- [ ] Test steps

## Screenshots
<if UI changes>

🤖 Generated with [Claude Code](https://claude.com/claude-code)'

## Report Back
- PR number
- PR URL
- Any issues
"
```

---

## Phase 5: Review Cycle

After PR is created, invoke the review-cycle skill:

```
Use the Skill tool: /review-cycle <PR_NUMBER>
```

This handles:
- Waiting for Cursor Bugbot and Greptile reviews
- Fixing issues
- Iterating until approved

---

## Phase 6: Log Completion

### 6.1 Update Activity Log

Update `.claude/workspace-resources.md` with an END entry:

```
[TIMESTAMP] WORKER-$N END: "<feature description>" - PR #<number>
```

### 6.2 Final Report

```markdown
## Worker $N Development Complete

**Feature:** <description>
**PR:** #<number> (<url>)
**Branch:** <branch-name>

### Resources Used
- Worktree: $WORKTREE_PATH
- Backend Port: $BACKEND_PORT
- Metro Port: $METRO_PORT
- Simulator: $SIMULATOR_NAME

### Development Summary
- Sub-agents spawned: X
- Files modified: Y
- Commits: Z

### Testing Summary
- UI tested on: $SIMULATOR_NAME
- Test result: PASS/FAIL

### Review Status
- PR created: Yes
- Review cycle started: Yes

### Next Steps
1. Monitor PR for review completion
2. Merge to main when approved
3. Auto-deploys to staging
4. Test on staging, then trigger production deploy
```

---

## Quick Reference

### Worker 1
```bash
WORKTREE_PATH="../Togather-worktrees/worker-1"
BACKEND_PORT=3001
METRO_PORT=19001
SIMULATOR_NAME="Test Sim 1"
SIMULATOR_UDID="E2D4D884-4A2C-45C5-9E76-BF55FF3C393F"
```

### Worker 2
```bash
WORKTREE_PATH="../Togather-worktrees/worker-2"
BACKEND_PORT=3002
METRO_PORT=19002
SIMULATOR_NAME="Test Sim 2"
SIMULATOR_UDID="9857B313-E271-433A-8568-6D994156A2B2"
```

### Worker 3
```bash
WORKTREE_PATH="../Togather-worktrees/worker-3"
BACKEND_PORT=3003
METRO_PORT=19003
SIMULATOR_NAME="Test Sim 3"
SIMULATOR_UDID="C3E057E4-77D8-4220-8F25-FC94C96782B1"
```

### Worker 4
```bash
WORKTREE_PATH="../Togather-worktrees/worker-4"
BACKEND_PORT=3004
METRO_PORT=19004
SIMULATOR_NAME="Test Sim 4"
SIMULATOR_UDID="3BEA97A2-650C-477B-99F0-60934CD74140"
```

---

## Error Recovery

### Sub-agent Says "Can't Do X"

**NEVER ACCEPT THIS.** Instead:
1. Ask the sub-agent WHY it can't do X
2. Identify the blocker
3. Fix the blocker yourself (minimal work)
4. Spawn a new sub-agent with updated instructions

### Server Won't Start

```bash
# You own these ports - kill everything
lsof -ti :$BACKEND_PORT | xargs kill -9
lsof -ti :$METRO_PORT | xargs kill -9

# Also check for node/expo zombies
pkill -f "node.*$WORKTREE_PATH" 2>/dev/null || true
pkill -f "expo.*$METRO_PORT" 2>/dev/null || true
```

### Metro Fails with "FSEventStreamStart" or Watchman Errors

This happens when Watchman gets into a bad state from watching multiple worktrees:

```bash
# Reset Watchman completely
watchman shutdown-server
sleep 2
watchman version  # Restarts it

# If still failing, clear Watchman state
watchman watch-del-all
rm -rf /Users/$USER/.local/state/watchman/*

# Then restart
watchman version
```

### Backend Fails with "Cannot find module @togather/shared"

The shared package needs to be built after resetting the worktree:

```bash
cd $WORKTREE_PATH
pnpm --filter @togather/shared build
```

### Simulator Issues

```bash
# You own this simulator - reset it if needed
xcrun simctl shutdown $SIMULATOR_UDID
xcrun simctl erase $SIMULATOR_UDID
xcrun simctl boot $SIMULATOR_UDID

# Reinstall Expo Go
xcrun simctl install $SIMULATOR_UDID ~/.expo/ios-simulator-app-cache/Expo-Go-*.app
```

### Worktree Issues

```bash
# You own this worktree - force reset
cd $WORKTREE_PATH
git checkout -- .
git clean -fd
git fetch origin main
git reset --hard origin/main
pnpm install
```

---

## Safety Rules

1. **You OWN your resources** - Kill/reset without hesitation
2. **NEVER do dev work yourself** - Spawn sub-agents
3. **NEVER accept "can't test"** - Fix blockers and retry
4. **ALWAYS log activity** - Start and end entries
5. **ALWAYS base PRs on main** - Single protected branch
6. **COMMIT frequently in sub-agents** - Atomic commits
7. **KILL servers after testing** - Clean up your ports
