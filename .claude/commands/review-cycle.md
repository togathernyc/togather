# PR Review Cycle Agent

Comprehensive PR processor that handles ALL blockers: review comments, CI failures, merge conflicts, and unresolved threads. Loops until the PR is fully mergeable.

## Usage

```
/review-cycle <pr-number>
```

Example:
```
/review-cycle 50
```

## Agent Instructions

You are a PR Review Cycle agent. Your job is to get a PR into a fully mergeable state by addressing ALL issues: bot comments, CI failures, merge conflicts, and unresolved threads.

### Configuration

- **Poll interval:** 30 seconds
- **Max poll attempts:** 30 (about 15 minutes max wait for bot review)
- **Max total cycles:** 20 (to prevent infinite loops)
- **Max Bugbot review rounds:** 3 (after 3 rounds of Bugbot review, resolve remaining Low severity threads without fixing)
- **Bot usernames:** `cursor`, `greptile-apps[bot]`
- **Autofix bot check name:** `Cursor Bugbot Autofix`

---

## CRITICAL: Fetch EVERYTHING Each Cycle

Every cycle, fetch the COMPLETE PR state. Do not rely on cached data or assumptions.

```bash
# Fetch comprehensive PR state - ALL fields
gh pr view <PR_NUMBER> --json \
  number,title,state,mergeable,mergeStateStatus,\
  reviewDecision,reviews,comments,\
  statusCheckRollup,commits,files,\
  headRefName,baseRefName,url
```

This gives you:
- `state`: OPEN, CLOSED, MERGED
- `mergeable`: MERGEABLE, CONFLICTING, UNKNOWN
- `mergeStateStatus`: BLOCKED, BEHIND, CLEAN, DIRTY, HAS_HOOKS, UNKNOWN, UNSTABLE
- `reviewDecision`: APPROVED, CHANGES_REQUESTED, REVIEW_REQUIRED, null
- `statusCheckRollup`: CI/CD check statuses
- `reviews`: All reviews from all users
- `comments`: PR-level comments (not just review threads!)

---

## Phase 1: Comprehensive State Check

### 1.1 Fetch Full PR State

```bash
PR_STATE=$(gh pr view <PR_NUMBER> --json \
  number,state,mergeable,mergeStateStatus,reviewDecision,\
  headRefName,baseRefName \
  --jq '{
    state: .state,
    mergeable: .mergeable,
    mergeStatus: .mergeStateStatus,
    reviewDecision: .reviewDecision,
    branch: .headRefName,
    base: .baseRefName
  }')
echo "$PR_STATE"
```

### 1.2 Check if Already Merged/Closed

```bash
gh pr view <PR_NUMBER> --json state --jq '.state'
```

- If `MERGED` or `CLOSED`: Exit with success message
- If `OPEN`: Continue

### 1.3 Sync Local Branch

```bash
git fetch origin
BRANCH=$(gh pr view <PR_NUMBER> --json headRefName --jq '.headRefName')
git checkout $BRANCH
git pull origin $BRANCH
```

---

## Phase 2: Handle Merge Conflicts

**ALWAYS check and fix merge conflicts before anything else.**

### 2.1 Check for Conflicts

```bash
gh pr view <PR_NUMBER> --json mergeable --jq '.mergeable'
```

- `MERGEABLE`: No conflicts, continue
- `CONFLICTING`: Fix conflicts (see below)
- `UNKNOWN`: Wait and re-check

### 2.2 Fix Merge Conflicts

If conflicting:

```bash
# Fetch and merge base branch
git fetch origin main
git merge origin/main --no-edit

# If conflicts occur, they'll be shown
git status
```

**For each conflicted file:**
1. Read the file to understand the conflict markers
2. Understand both sides of the conflict
3. Resolve by keeping the correct version (usually merge both changes intelligently)
4. Stage the resolved file: `git add <file>`

**After resolving all conflicts:**
```bash
git commit -m "chore: resolve merge conflicts with main

Co-Authored-By: Claude <noreply@anthropic.com>"
git push
```

**Wait 30 seconds and re-check mergeable status before continuing.**

---

## Phase 3: Handle CI/CD Failures

### 3.1 Fetch All Check Statuses

```bash
gh pr checks <PR_NUMBER> --json name,state,conclusion
```

Or via API for more detail:

```bash
gh pr view <PR_NUMBER> --json statusCheckRollup --jq '.statusCheckRollup[] | {name: .name, status: .status, conclusion: .conclusion}'
```

### 3.2 Check Status Meanings

- `SUCCESS` / `NEUTRAL` / `SKIPPED`: OK
- `PENDING` / `QUEUED` / `IN_PROGRESS`: Wait and re-poll
- `FAILURE` / `ERROR` / `TIMED_OUT`: Needs fixing

**Bugbot-specific statuses:**
- `Cursor Bugbot`: `NEUTRAL` = found issues (check threads), `SUCCESS` = no issues
- `Cursor Bugbot Autofix`: `IN_PROGRESS` = actively fixing issues, may push commits at any time. **NEVER commit or push while this is running.**

### 3.3 Fix CI Failures

For each failing check:

1. **Get failure details:**
   ```bash
   gh run view <run-id> --log-failed
   ```
   Or check the GitHub Actions URL in the check details.

2. **Common failures and fixes:**

   **Type errors:**
   ```bash
   pnpm --filter api-trpc type-check
   pnpm --filter mobile type-check
   # Fix any type errors shown
   ```

   **Test failures:**
   ```bash
   pnpm test --filter=mobile
   pnpm test --filter=api-trpc
   # Fix failing tests
   ```

   **Build failures:**
   ```bash
   pnpm --filter @togather/shared build
   pnpm --filter @togather/notifications build
   # Fix build errors
   ```

   **Lint failures:**
   ```bash
   pnpm lint --fix
   ```

3. **Commit fixes:**
   ```bash
   git add .
   git commit -m "fix: resolve CI failures

   Co-Authored-By: Claude <noreply@anthropic.com>"
   git push
   ```

4. **Wait for CI to re-run (poll every 30 seconds)**

---

## Phase 3.5: Wait for Bugbot Autofix Before Processing Comments

**CRITICAL:** Cursor Bugbot Autofix runs concurrently and may fix the same issues you're about to fix. Always wait for it to complete before processing review threads. This prevents:
- Push rejections (Autofix pushed while you were committing)
- Rebase conflicts (your fix overlaps with Autofix's fix on the same lines)
- Redundant work (fixing something Autofix already fixed)

### 3.5.1 Wait for Both Bugbot Checks

Poll until both `Cursor Bugbot` AND `Cursor Bugbot Autofix` have completed:

```bash
# Poll every 30 seconds until both Bugbot checks are done
gh pr view <PR_NUMBER> --json statusCheckRollup \
  --jq '.statusCheckRollup[] | select(.name | test("Cursor Bugbot")) | {name: .name, status: .status, conclusion: .conclusion}'
```

**Wait until:**
- `Cursor Bugbot` status is `COMPLETED`
- `Cursor Bugbot Autofix` status is `COMPLETED` (or doesn't appear, meaning no autofix was triggered)

**Do NOT proceed to Phase 4 while either check is `IN_PROGRESS`.**

### 3.5.2 Pull Autofix Commits

After Bugbot Autofix completes, it may have pushed commits. Always pull before processing:

```bash
git pull origin $BRANCH
```

This ensures your local branch has any Autofix commits, preventing conflicts later.

### 3.5.3 Track Bugbot Review Round

Increment a `bugbot_review_round` counter each time you enter this phase. After **3 rounds** of Bugbot review:
- Only fix **Medium** or higher severity issues
- **Resolve Low severity threads without fixing** — these are usually nitpicks about theoretical edge cases
- This prevents infinite loops where Bugbot keeps finding new low-severity issues after each fix

---

## Phase 4: Handle ALL Comments and Reviews

### 4.1 Fetch ALL Unresolved Review Threads

```bash
gh api graphql -f query='query {
  repository(owner: "togathernyc", name: "togather") {
    pullRequest(number: <PR_NUMBER>) {
      reviewThreads(first: 100) {
        nodes {
          id
          isResolved
          isOutdated
          path
          line
          comments(first: 10) {
            nodes {
              id
              body
              author { login }
              createdAt
            }
          }
        }
      }
    }
  }
}'
```

**Process ALL unresolved threads** - not just from bots:

```bash
# Filter unresolved, non-outdated threads
--jq '.data.repository.pullRequest.reviewThreads.nodes[] | select(.isResolved == false and .isOutdated == false)'
```

### 4.2 Fetch PR-Level Comments (Not Review Threads)

Bot comments sometimes appear as PR comments, not review threads:

```bash
gh pr view <PR_NUMBER> --json comments --jq '.comments[] | {author: .author.login, body: .body, createdAt: .createdAt}'
```

Check for any actionable comments from:
- `cursor`
- `greptile-apps[bot]`
- Any bot with actionable feedback

### 4.3 Fetch Review States

```bash
gh pr view <PR_NUMBER> --json reviews --jq '.reviews[] | {author: .author.login, state: .state, body: .body, submittedAt: .submittedAt}'
```

Check for:
- `CHANGES_REQUESTED` from any reviewer
- `COMMENTED` with actionable feedback

### 4.4 Process Each Issue

For EACH unresolved thread or actionable comment:

1. **Read the comment carefully** — note the severity level (if from Bugbot)
2. **Check if Bugbot Autofix already fixed it:**
   - Read the file at the mentioned path and line
   - Compare the current code against the issue described in the comment
   - If the issue is already resolved (Autofix pushed a commit), skip to step 6 (resolve thread)
   - Check git log for recent Autofix commits: `git log --oneline -5 --author="cursor"`
3. **If bugbot_review_round >= 3 and severity is Low:** skip to step 6 (resolve thread without fixing)
4. **Make the fix** - Edit the file to address the concern
5. **Verify the fix doesn't break anything:**
   ```bash
   pnpm --filter api-trpc type-check
   pnpm test --filter=mobile 2>/dev/null || true
   ```
6. **Commit the fix:**
   ```bash
   git add <files>
   git commit -m "fix: <description>

   Addresses review comment.

   Co-Authored-By: Claude <noreply@anthropic.com>"
   ```

### 4.5 ALWAYS Resolve Threads After Fixing

**THIS IS CRITICAL** - Unresolved threads block merge.

```bash
gh api graphql -f query='mutation {
  resolveReviewThread(input: {threadId: "<THREAD_ID>"}) {
    thread { isResolved }
  }
}'
```

**Verify it resolved:**
```bash
gh api graphql -f query='query {
  repository(owner: "togathernyc", name: "togather") {
    pullRequest(number: <PR_NUMBER>) {
      reviewThreads(first: 100) {
        nodes {
          id
          isResolved
        }
      }
    }
  }
}' --jq '[.data.repository.pullRequest.reviewThreads.nodes[] | select(.isResolved == false)] | length'
# Should return 0
```

### 4.6 Handle False Positives

If a comment is a false positive or not actionable:

1. **Reply explaining why:**
   ```bash
   gh api graphql -f query='mutation {
     addPullRequestReviewComment(input: {
       pullRequestReviewId: "<REVIEW_ID>",
       body: "This is intentional because [reason]. The current implementation [explanation].",
       inReplyTo: "<COMMENT_ID>"
     }) {
       comment { id }
     }
   }'
   ```

2. **Still resolve the thread** - Don't leave it open:
   ```bash
   gh api graphql -f query='mutation {
     resolveReviewThread(input: {threadId: "<THREAD_ID>"}) {
       thread { isResolved }
     }
   }'
   ```

---

## Phase 5: Push and Wait for Re-Review

### 5.1 Pull Before Push (Bugbot Autofix Safety)

**ALWAYS pull before pushing** to pick up any Bugbot Autofix commits that landed while you were working:

```bash
# Pull with rebase to put your fixes on top of any Autofix commits
git pull --rebase origin $BRANCH
```

**If rebase conflicts occur:**
1. Check if Autofix already fixed the same issue (common case)
2. If so, drop your commit: `git rebase --skip`
3. If different changes, resolve conflicts, `git add <files>`, `git rebase --continue`

### 5.2 Push All Fixes

```bash
git push origin $BRANCH
```

**If push is rejected** (Autofix pushed while you were rebasing):
```bash
git pull --rebase origin $BRANCH
git push origin $BRANCH
```

### 5.3 Wait for CI, Bugbot, AND Bugbot Autofix

Poll every 30 seconds. **Wait for ALL THREE checks to complete:**

```bash
# Check ALL statuses including Bugbot Autofix
gh pr view <PR_NUMBER> --json statusCheckRollup \
  --jq '.statusCheckRollup[] | {name: .name, status: .status, conclusion: .conclusion}'
```

**Do not proceed until:**
- All CI checks are `COMPLETED`
- `Cursor Bugbot` is `COMPLETED`
- `Cursor Bugbot Autofix` is `COMPLETED` (or absent)

Also check:
```bash
# Check unresolved thread count
gh api graphql -f query='query {
  repository(owner: "togathernyc", name: "togather") {
    pullRequest(number: <PR_NUMBER>) {
      reviewThreads(first: 100) {
        nodes { isResolved }
      }
    }
  }
}' --jq '[.data.repository.pullRequest.reviewThreads.nodes[] | select(.isResolved == false)] | length'
```

### 5.4 Pull After Autofix Completes

After Bugbot Autofix finishes, always pull to get any new commits it pushed:

```bash
git pull origin $BRANCH
```

### 5.5 Re-Check Everything

After each push, go back to Phase 1 and re-fetch EVERYTHING. Don't assume previous state. Increment `bugbot_review_round` counter.

---

## Phase 6: Final Merge Check

Before attempting merge, verify ALL conditions:

```bash
# 1. No merge conflicts
gh pr view <PR_NUMBER> --json mergeable --jq '.mergeable'
# Must be: MERGEABLE

# 2. CI passing
gh pr checks <PR_NUMBER> --json conclusion --jq 'all(.conclusion == "success" or .conclusion == "neutral" or .conclusion == "skipped")'
# Must be: true

# 3. No unresolved threads
gh api graphql -f query='query {
  repository(owner: "togathernyc", name: "togather") {
    pullRequest(number: <PR_NUMBER>) {
      reviewThreads(first: 100) {
        nodes { isResolved }
      }
    }
  }
}' --jq '[.data.repository.pullRequest.reviewThreads.nodes[] | select(.isResolved == false)] | length'
# Must be: 0

# 4. Merge state is clean
gh pr view <PR_NUMBER> --json mergeStateStatus --jq '.mergeStateStatus'
# Should be: CLEAN or HAS_HOOKS
```

---

## Phase 7: Merge

### 7.1 Update Branch if Behind

```bash
MERGE_STATUS=$(gh pr view <PR_NUMBER> --json mergeStateStatus --jq '.mergeStateStatus')
if [ "$MERGE_STATUS" = "BEHIND" ]; then
  git fetch origin main
  git merge origin/main --no-edit
  git push
  # Wait for CI to pass again
fi
```

### 7.2 Attempt Merge

```bash
# Try direct merge
gh pr merge <PR_NUMBER> --squash --delete-branch

# If that fails, try with auto-merge
gh pr merge <PR_NUMBER> --squash --delete-branch --auto
```

### 7.3 Verify Merge

```bash
gh pr view <PR_NUMBER> --json state --jq '.state'
# Should be: MERGED
```

---

## Phase 8: Post-Merge CI Verification

**CRITICAL:** A merged PR can break the main branch CI even if PR CI passed. Always verify CI after merge.

### 8.1 Wait for Main Branch CI to Start

After merge, wait for the main branch CI to trigger:

```bash
# Wait 30 seconds for CI to start
sleep 30

# Get the latest workflow run on main
gh run list --branch main --limit 1 --json databaseId,status,conclusion,createdAt
```

### 8.2 Poll Main Branch CI Status

Poll every 30 seconds until CI completes:

```bash
# Get the run ID from the latest main run
RUN_ID=$(gh run list --branch main --limit 1 --json databaseId --jq '.[0].databaseId')

# Check status
gh run view $RUN_ID --json status,conclusion --jq '{status: .status, conclusion: .conclusion}'
```

**Status meanings:**
- `status: completed` + `conclusion: success` → Continue to completion report
- `status: completed` + `conclusion: failure` → Fix CI (see below)
- `status: in_progress` / `queued` → Keep polling

**Max wait time:** 15 minutes (30 polls × 30 seconds)

### 8.3 Handle Main Branch CI Failure

If main branch CI fails after merge:

1. **Get the failed run details:**
   ```bash
   RUN_ID=$(gh run list --branch main --limit 1 --json databaseId --jq '.[0].databaseId')
   gh run view $RUN_ID --log-failed 2>&1 | head -200
   ```

2. **Invoke the fix-ci skill:**
   ```
   Use Skill tool: /fix-ci $RUN_ID
   ```

   This will:
   - Investigate the failure
   - Create a fix branch
   - Add regression tests to prevent recurrence
   - Create a PR
   - Run review-cycle on that PR
   - Merge the fix

3. **Wait for the fix to merge and verify main CI again:**
   - After /fix-ci completes, go back to step 8.1
   - Poll main branch CI again
   - Repeat until CI passes

### 8.4 Max Fix Attempts

If main branch CI fails 3 times in a row after fixes:
1. Stop the cycle
2. Report the persistent failure
3. Flag for human intervention

```markdown
## MAIN BRANCH CI FAILURE - Manual Intervention Required

**Original PR:** #<number>
**Main CI Runs Failed:** 3
**Last Error:** <error summary>

Attempted fixes:
1. PR #<fix-1> - <description>
2. PR #<fix-2> - <description>
3. PR #<fix-3> - <description>

The issue persists. Please investigate manually.
```

---

## Phase 9: Completion Report

```markdown
## Review Cycle Complete

**PR:** #<number>
**Final State:** MERGED / BLOCKED
**Total Cycles:** X
**Total Comments Fixed:** Y
**Total PR CI Fixes:** Z
**Staging CI:** PASSED / FIXED (N attempts)

### Issues Resolved
| Type | Count | Details |
|------|-------|---------|
| Merge Conflicts | X | Resolved with main |
| PR CI Failures | Y | Type errors, test fixes |
| Review Comments (manual fix) | Z | See list below |
| Bugbot Autofix commits | A | Issues auto-resolved by Bugbot |
| Low-severity resolved without fix | L | Resolved after round cap |
| Main CI Fixes | N | Post-merge fixes via /fix-ci |

### Comments Addressed
1. `path/file.ts:42` - [cursor] Fixed type annotation
2. `path/other.ts:15` - [greptile] Added error handling
3. `path/file.ts:100` - [cursor/autofix] Fixed automatically by Bugbot

### Post-Merge CI Fixes (if any)
1. PR #<fix-pr> - <description of fix>
   - Root cause: <explanation>
   - Test added: `<test-file.ts>`

### Final Verification
- [x] No merge conflicts
- [x] All PR CI checks passing
- [x] All review threads resolved
- [x] PR merged to main
- [x] Main branch CI passing
- [x] Regression tests added (if CI was fixed)
```

---

## Error Recovery

### Thread Won't Resolve

Sometimes the GraphQL mutation fails silently. Force resolve:

```bash
# Get all thread IDs
THREADS=$(gh api graphql -f query='query {
  repository(owner: "togathernyc", name: "togather") {
    pullRequest(number: <PR_NUMBER>) {
      reviewThreads(first: 100) {
        nodes { id isResolved }
      }
    }
  }
}' --jq '.data.repository.pullRequest.reviewThreads.nodes[] | select(.isResolved == false) | .id')

# Resolve each one
for THREAD in $THREADS; do
  gh api graphql -f query="mutation { resolveReviewThread(input: {threadId: \"$THREAD\"}) { thread { isResolved } } }"
  sleep 1
done
```

### CI Keeps Failing

If CI fails repeatedly:
1. Read the FULL error log
2. Check if it's a flaky test (re-run once)
3. If still failing, investigate more deeply
4. Consider if the fix is actually correct

### Bot Doesn't Review

If bot review doesn't appear after 15 minutes:
1. Check if the bot is configured for this repo
2. Try re-requesting review:
   ```bash
   gh pr edit <PR_NUMBER> --add-reviewer cursor
   ```
3. Continue with other checks anyway

### Merge Still Blocked

If merge is blocked after all fixes:
```bash
# Check what's blocking
gh pr view <PR_NUMBER> --json mergeStateStatus,reviewDecision,mergeable

# Check branch protection rules
gh api repos/togathernyc/togather/branches/main/protection
```

Report the specific blocker for manual intervention.

---

## Safety Rules

1. **Fetch fresh state EVERY cycle** - Never trust cached data
2. **Fix merge conflicts FIRST** - Before any other work
3. **Wait for Bugbot Autofix BEFORE fixing comments** - It may already fix the issue for you
4. **Always pull before push** - Bugbot Autofix pushes concurrently; `git pull --rebase` prevents rejections
5. **Check if already fixed before fixing** - Read the code at the thread location; if Autofix already addressed it, just resolve the thread
6. **Always resolve threads** - Unresolved threads block merge
7. **Verify fixes compile** - Run type-check before committing
8. **Don't skip CI** - Wait for it to pass
9. **Commit atomically** - One fix per commit when possible
10. **Push after each batch of fixes** - Let CI and bots re-check
11. **Cap Bugbot rounds at 3** - After 3 rounds, resolve Low severity threads without fixing to prevent infinite loops
12. **Log everything** - Track what was fixed for the report
