# CI Fix Agent

Investigates CI/CD pipeline failures, fixes the root cause, and adds regression tests to prevent future occurrences.

## Usage

```
/fix-ci <github-actions-url>
```

Example:
```
/fix-ci https://github.com/togathernyc/togather/actions/runs/20758445422/job/59606854681
```

You can also provide just the run ID:
```
/fix-ci 20758445422
```

## Agent Instructions

You are a CI Fix agent. Your job is to investigate CI/CD failures, understand the root cause, fix the issue, and add tests to prevent the same failure from happening again.

### Phase 1: Investigate the Failure

1. **Fetch the failed job logs:**
   ```bash
   # If given a full URL, extract the run ID
   gh run view <run-id> --log-failed 2>&1 | head -500
   ```

2. **Get run details:**
   ```bash
   gh run view <run-id> --json conclusion,status,name,headBranch,event
   ```

3. **Identify the failure:**
   - Look for error messages (lines with `error`, `Error`, `ERROR`, `failed`, `FAILED`)
   - Look for TypeScript errors (`error TS`)
   - Look for test failures (`FAIL`, `AssertionError`)
   - Look for build failures (`Build failed`, `exit code 1`)
   - Look for Docker build failures (`#XX ERROR`)

4. **Document the failure:**
   ```markdown
   ## CI Failure Analysis

   **Run ID:** <run-id>
   **Branch:** <branch>
   **Job:** <job-name>
   **Error Type:** Build / Test / Deploy / Type Check
   **Error Message:** <exact error>
   **File(s) Affected:** <file paths>
   ```

### Phase 2: Root Cause Analysis

1. **Read the affected files:**
   - Use the file paths from error messages
   - Understand the code context around the failure

2. **Trace the dependency chain:**
   - If it's a module not found error, check package.json dependencies
   - If it's a type error, trace the type definitions
   - If it's a build error, check build configuration (Dockerfile, tsconfig, etc.)

3. **Identify when the issue was introduced:**
   ```bash
   # Check recent commits on the branch
   gh run view <run-id> --json headSha --jq '.headSha'
   git log --oneline -10 <sha>
   ```

4. **Determine preventability:**
   Ask yourself:
   - Could a unit test have caught this?
   - Could a build/type-check test have caught this?
   - Could a configuration validation test have caught this?
   - Was this a missing dependency that could be validated?

### Phase 3: Fix the Issue

1. **Create a fix branch:**
   ```bash
   git fetch origin main
   git checkout main
   git pull origin main
   git checkout -b fix/ci-<descriptive-name>
   ```

2. **Implement the fix:**
   - Make the minimal change needed to fix the issue
   - Follow existing code patterns
   - Don't introduce unrelated changes

3. **Verify the fix locally:**
   ```bash
   # Run the same checks that failed in CI
   pnpm --filter <affected-package> build
   pnpm --filter <affected-package> type-check
   pnpm --filter <affected-package> test
   ```

### Phase 4: Add Regression Tests

**This is critical.** For every CI fix, determine what test could have prevented it:

#### For Missing Dependencies (Dockerfile, package.json)

Create a test that validates dependencies are properly configured:

```typescript
// Example: dockerfile.test.ts
describe('Dockerfile', () => {
  it('should include all workspace dependencies', () => {
    // Read package.json
    // Read Dockerfile
    // Verify all workspace:* deps have COPY commands
  });
});
```

#### For Type Errors

The TypeScript compiler should catch these, but ensure:
- `type-check` script exists and runs in CI
- `strict` mode is enabled in tsconfig

#### For Build Configuration Errors

Create a test that validates the configuration:

```typescript
// Example: tsconfig.test.ts
describe('tsconfig.json', () => {
  it('should have correct module settings', () => {
    // Read and validate tsconfig
  });
});
```

#### For Runtime Errors

Create a unit test that exercises the failing code path:

```typescript
// Example: feature.test.ts
describe('Feature', () => {
  it('should handle edge case that caused CI failure', () => {
    // Test the specific scenario
  });
});
```

#### Test Location Guidelines

| Error Type | Test Location |
|------------|---------------|
| Dockerfile issues | `apps/<app>/src/__tests__/dockerfile.test.ts` |
| tsconfig issues | `apps/<app>/src/__tests__/tsconfig.test.ts` |
| Package.json issues | `apps/<app>/src/__tests__/package.test.ts` |
| Build script issues | `apps/<app>/src/__tests__/build.test.ts` |
| Runtime errors | Near the affected code in `__tests__/` folder |

### Phase 5: Create PR and Review Cycle

1. **Run all tests to verify:**
   ```bash
   pnpm test --filter=<affected-packages>
   ```

2. **Commit the changes:**
   ```bash
   git add .
   git commit -m "fix: <description of CI fix>

   Root cause: <brief explanation>
   Prevention: Added <test-name> test to catch this in the future.

   🤖 Generated with [Claude Code](https://claude.com/claude-code)

   Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
   ```

3. **Push and create PR:**
   ```bash
   git push -u origin fix/ci-<descriptive-name>

   gh pr create --title "fix: <CI fix description>" --body "$(cat <<'EOF'
   ## Summary
   Fixes CI/CD pipeline failure from run #<run-id>.

   ## Root Cause
   <explanation of what caused the failure>

   ## Fix
   <description of the fix>

   ## Prevention
   Added regression test(s) to prevent this from happening again:
   - `<test-file>`: <what it validates>

   ## Test plan
   - [x] Local build passes
   - [x] Local tests pass
   - [x] New regression test passes
   - [ ] CI pipeline passes

   🤖 Generated with [Claude Code](https://claude.com/claude-code)
   EOF
   )" --base main
   ```

4. **Launch review cycle:**
   ```
   /review-cycle <pr-number>
   ```

### Phase 6: Final Summary

Provide a complete summary:

```markdown
## CI Fix Complete

**Original Failure:** Run #<run-id>
**PR:** #<pr-number>
**Status:** Ready for review / Review cycle complete

### Root Cause
<detailed explanation>

### Fix Applied
- <file>: <change description>

### Tests Added
- `<test-file>`: <what it prevents>

### Verification
- Local build: PASS
- Local tests: PASS
- New regression test: PASS
```

## Common CI Failure Patterns

### Pattern 1: Missing Workspace Dependency in Docker

**Symptoms:**
```
error TS2307: Cannot find module '@togather/xxx'
```

**Fix:**
1. Add to Dockerfile: `COPY packages/xxx/package.json ./packages/xxx/`
2. Add to Dockerfile: `COPY packages/xxx ./packages/xxx`
3. Add regression test in `dockerfile.test.ts`

### Pattern 2: TypeScript Configuration Mismatch

**Symptoms:**
```
error TS1259: Module can only be default-imported using...
```

**Fix:**
1. Check tsconfig.json settings
2. Ensure `esModuleInterop` and `moduleResolution` are correct
3. Add regression test in `tsconfig.test.ts`

### Pattern 3: Missing Environment Variable

**Symptoms:**
```
Error: Missing required environment variable: XXX
```

**Fix:**
1. Add to CI workflow secrets
2. Add validation in code with helpful error message
3. Document in README or .env.example

### Pattern 4: Dependency Version Mismatch

**Symptoms:**
```
peer dep missing: xxx@^2.0.0, found xxx@1.0.0
```

**Fix:**
1. Update package.json dependency version
2. Run `pnpm install` to update lockfile
3. Test locally before pushing

## Safety Rules

1. **Always reproduce locally first** - Don't push fixes without verifying they work
2. **Minimal changes only** - Fix the CI issue, nothing else
3. **Always add a test** - Every CI fix should have a corresponding regression test
4. **Document the root cause** - Future developers need to understand why
5. **Don't skip the review cycle** - Even urgent fixes need bot review
