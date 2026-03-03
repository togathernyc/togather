# Branch Protection Setup Guide

This guide explains how to configure GitHub branch protection rules to require tests to pass before allowing merges to `main` and `staging` branches.

## Overview

Branch protection rules ensure that:
- All tests must pass before code can be merged
- Pull requests are required (no direct pushes)
- Status checks must pass before merging

## Step-by-Step Setup

### 1. Navigate to Repository Settings

1. Go to your GitHub repository
2. Click on **Settings** (top navigation bar)
3. Click on **Branches** (left sidebar)

### 2. Add Branch Protection Rule for `main` Branch

1. Click **Add rule** or **Add branch protection rule**
2. In the **Branch name pattern** field, enter: `main`
3. Configure the following settings:

#### Required Settings

- ✅ **Require a pull request before merging**
  - Check this box
  - Optionally: Require approvals (recommended: 1 approval)
  - Optionally: Dismiss stale pull request approvals when new commits are pushed

- ✅ **Require status checks to pass before merging**
  - Check this box
  - Check **Require branches to be up to date before merging**
  - In the search box, search for and select the following status checks:
    - `Test All / test-shared`
    - `Test All / test-web`
    - `Test All / test-mobile`
    - `Test All / test-backend`
    - `Test All / test-summary`
    - `Mobile Tests (Main) / test` (if mobile changes are made)
    - `Web CI / test` (if web changes are made)

- ✅ **Require conversation resolution before merging**
  - Check this box (recommended)

#### Optional but Recommended Settings

- ✅ **Do not allow bypassing the above settings**
  - Check this box to prevent administrators from bypassing protection rules

- ✅ **Restrict who can push to matching branches**
  - Check this box
  - Add specific teams/users who should have push access (or leave empty to require PRs for everyone)

- ✅ **Allow force pushes**
  - **Uncheck** this box (force pushes should be disabled)

- ✅ **Allow deletions**
  - **Uncheck** this box (prevent accidental branch deletion)

### 3. Add Branch Protection Rule for `staging` Branch

Repeat the same steps as above, but:
- **Branch name pattern**: `staging`
- **Status checks** to require:
  - `Test All / test-shared`
  - `Test All / test-web`
  - `Test All / test-mobile`
  - `Test All / test-backend`
  - `Test All / test-summary`
  - `Mobile Tests (Staging) / test` (if mobile changes are made)
  - `Web CI / test` (if web changes are made)

### 4. Verify Status Check Names

After creating the branch protection rules, you may need to verify the exact names of the status checks:

1. Create a test pull request targeting `main` or `staging`
2. Wait for the workflows to run
3. Go to the **Checks** tab in the pull request
4. Note the exact names of the status checks
5. Update the branch protection rules with the correct status check names

## How It Works

### When a Pull Request is Created

1. Developer creates a pull request targeting `main` or `staging`
2. GitHub Actions automatically runs the test workflows:
   - `Test All` workflow runs all tests (shared, web, mobile, backend)
   - Specific workflows may also run based on changed files (e.g., `Mobile Tests` if mobile files changed)
3. Status checks appear in the pull request
4. If any test fails, the status check shows as ❌ (failed)
5. The pull request cannot be merged until all required status checks pass ✅

### Required Status Checks

The following status checks must pass before merging:

#### Always Required (from `Test All` workflow):
- `Test All / test-shared` - Tests for shared package
- `Test All / test-web` - Tests for web application
- `Test All / test-mobile` - Tests for mobile application
- `Test All / test-backend` - Tests for backend API
- `Test All / test-summary` - Summary check that all tests passed

#### Conditionally Required (based on changed files):
- `Mobile Tests (Main) / test` - Mobile-specific tests (if `apps/mobile/**` files changed)
- `Mobile Tests (Staging) / test` - Mobile-specific tests (if `apps/mobile/**` files changed)
- `Web CI / test` - Web-specific tests (if `apps/web/**` or `packages/shared/**` files changed)

## Troubleshooting

### Status Checks Not Appearing

If status checks don't appear in the branch protection settings:

1. **First, trigger the workflows**: Create a test PR and let the workflows run
2. **Wait for workflows to complete**: Status checks only appear after they've run at least once
3. **Check workflow names**: Ensure the workflow file names match what's configured
4. **Check job names**: Ensure the job names in the workflows match what you're trying to require

### Workflow Not Running

If workflows don't run on pull requests:

1. Check that the workflow files are in `.github/workflows/` directory
2. Verify the `on:` section includes `pull_request` trigger
3. Check that the branch names match (e.g., `branches: [main, staging]`)
4. Ensure the workflow file has valid YAML syntax

### Tests Pass Locally But Fail in CI

Common causes:
- Different Node.js/Python versions
- Missing environment variables
- Different dependency versions
- Platform-specific issues (macOS vs Linux)

## Testing the Setup

To verify branch protection is working:

1. Create a feature branch
2. Make a change that breaks a test
3. Create a pull request targeting `main` or `staging`
4. Verify that:
   - The pull request shows failed status checks
   - The "Merge" button is disabled
   - You cannot merge the PR until tests pass

## Additional Resources

- [GitHub Branch Protection Documentation](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches)
- [GitHub Status Checks Documentation](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/collaborating-on-repositories-with-code-quality-features/about-status-checks)

## Notes

- Branch protection rules apply to all users, including administrators (if "Do not allow bypassing" is enabled)
- Status checks must run at least once before they can be added to branch protection rules
- You can temporarily disable branch protection if needed for emergency fixes, but this should be rare

