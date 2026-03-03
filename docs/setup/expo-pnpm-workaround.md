# EAS Build Issue: Yarn Auto-Detection in pnpm Monorepo

## Problem Summary

EAS Build is failing during the "Install dependencies" step because it's auto-detecting yarn workspaces and trying to use yarn, but the project uses pnpm. EAS installs dependencies **before** the `prebuildCommand` runs, so we can't enable corepack in time.

## Error Message

```
We detected that 'apps/mobile' is a yarn workspace
Running "yarn install --frozen-lockfile" in /home/expo/workingdir/build directory
error This project's package.json defines "packageManager": "yarn@pnpm@8.15.0". However the current global version of Yarn is 1.22.22.
Presence of the "packageManager" field indicates that the project is meant to be used with Corepack, a tool included by default with all official Node.js distributions starting from 16.9 and 14.19.
Corepack must currently be enabled by running corepack enable in your terminal.
yarn install --frozen-lockfile exited with non-zero code: 1
```

## Key Details

- **Project Structure**: Monorepo with pnpm workspaces
- **Package Manager**: pnpm@8.15.0 (specified in both root and `apps/mobile/package.json`)
- **Node Version**: 20.0.0 (includes corepack)
- **EAS Configuration**: `eas.json` has `prebuildCommand` to enable corepack, but it runs AFTER dependencies are installed
- **Issue**: EAS auto-detects workspaces and assumes yarn, then tries to install dependencies with yarn before `prebuildCommand` runs
- **Error**: EAS misreads `packageManager` field as `"yarn@pnpm@8.15.0"` (invalid format)

## What We've Tried

1. ✅ Set `packageManager: "pnpm@8.15.0"` in both root and `apps/mobile/package.json`
2. ✅ Added `prebuildCommand` to enable corepack and prepare pnpm
3. ✅ Set `COREPACK_ENABLE_STRICT: "0"` in environment variables
4. ❌ Created `.yarnrc.yml` (didn't help - EAS still detects yarn)
5. ❌ Created empty `yarn.lock` (didn't help - EAS still tries yarn)
6. ✅ Added `EXPO_USE_PNPM: "1"` environment variable to `eas.json` (should force EAS to use pnpm)
7. ✅ Removed `workspaces` field from root `package.json` (prevents EAS from detecting yarn workspaces)
8. ✅ Created `apps/mobile/.npmrc` with `use-pnpm=true` and `shamefully-hoist=true` (based on [GitHub issue #1941](https://github.com/expo/eas-cli/issues/1941))
9. ✅ Added `eas-build-pre-install` script to both root and `apps/mobile/package.json` (runs BEFORE dependency installation, based on [GitHub issue #2978](https://github.com/expo/eas-cli/issues/2978))

## Root Cause

EAS Build installs dependencies **before** `prebuildCommand` runs. The build process is:

1. EAS detects workspace structure → assumes yarn (checks yarn first, then pnpm)
2. EAS tries to run `yarn install --frozen-lockfile` → **FAILS HERE**
3. `prebuildCommand` would run (but never gets there)

**Key Insight from [Issue #2978](https://github.com/expo/eas-cli/issues/2978)**: The detection logic in `@expo/package-manager/src/utils/nodeManagers.ts` checks yarn first, then pnpm. The `eas-build-pre-install` script runs BEFORE the dependency installation step, allowing us to enable corepack before EAS tries to detect the package manager.

## What We Need

- EAS to respect the `packageManager` field and enable corepack **before** installing dependencies
- OR a way to tell EAS to skip auto-detection and use pnpm from the start
- OR a way to configure EAS to enable corepack before the dependency installation step

## Files Involved

- `apps/mobile/eas.json` - EAS build configuration (has `EXPO_USE_PNPM: "1"`)
- `apps/mobile/package.json` - Has `"packageManager": "pnpm@8.15.0"` and `eas-build-pre-install` script
- `apps/mobile/.npmrc` - Forces pnpm usage with `use-pnpm=true` and `shamefully-hoist=true`
- `apps/mobile/metro.config.js` - Has `unstable_enableSymlinks: true` for pnpm support
- `package.json` (root) - Has `"packageManager": "pnpm@8.15.0"` (removed `workspaces` field) and `eas-build-pre-install` script
- `pnpm-workspace.yaml` - Defines pnpm workspace structure
- `pnpm-lock.yaml` - pnpm lockfile (exists)

## Related Issues

- [GitHub Issue #1941: EAS fails to install pnpm dependencies for Android](https://github.com/expo/eas-cli/issues/1941) - Similar issue with pnpm in monorepo setups
- [GitHub Issue #2978: EAS mistakes pnpm for yarn workspace](https://github.com/expo/eas-cli/issues/2978) - **CRITICAL**: Same issue - EAS detects yarn first, then pnpm. Solution: Use `eas-build-pre-install` script to enable corepack BEFORE dependency installation

## Search Terms for Google

- "EAS build pnpm monorepo yarn workspace detection"
- "EAS build disable yarn auto-detection use pnpm"
- "EAS build corepack enable before dependencies install"
- "Expo EAS build pnpm workspace yarn error"
- "EAS build packageManager field not respected"
- "EAS build install dependencies before prebuildCommand"

## Solutions to Try

### Solution 1: EXPO_USE_PNPM Environment Variable (✅ Implemented)

Added `EXPO_USE_PNPM: "1"` to the environment variables in `eas.json` for both `preview` and `production` build profiles. This should instruct EAS to use pnpm instead of auto-detecting yarn.

**Status**: Implemented - needs testing

### Solution 2: Remove workspaces field from root package.json (✅ Implemented)

The root `package.json` had a `workspaces` field which EAS was interpreting as yarn workspaces. Since pnpm uses `pnpm-workspace.yaml` for workspace configuration, the `workspaces` field in `package.json` is only for npm/yarn compatibility. Turbo doesn't need it as it auto-discovers workspaces.

**Status**: ✅ Implemented - removed from root `package.json`

### Solution 3: Create .npmrc in mobile app directory (✅ Implemented)

Based on [GitHub issue #1941](https://github.com/expo/eas-cli/issues/1941), created `apps/mobile/.npmrc` with:

- `use-pnpm=true` - Forces EAS to use pnpm
- `shamefully-hoist=true` - Helps resolve dependency issues in EAS builds with pnpm monorepos

**Status**: ✅ Implemented

### Solution 4: Add eas-build-pre-install script (✅ Implemented - CRITICAL)

Based on [GitHub issue #2978](https://github.com/expo/eas-cli/issues/2978), the key solution is to add the `eas-build-pre-install` script to both root and `apps/mobile/package.json`. This script runs **BEFORE** EAS tries to detect the package manager and install dependencies, allowing us to enable corepack first.

**Script added:**

```json
"eas-build-pre-install": "corepack enable && corepack prepare pnpm@8.15.0 --activate"
```

This runs before the dependency installation step, unlike `prebuildCommand` which runs after. This is the critical fix that should resolve the issue.

**Status**: ✅ Implemented in both `package.json` files

### Solution 5: Ensure pnpm-lock.yaml and pnpm-workspace.yaml are NOT ignored (✅ Implemented - CRITICAL)

**CRITICAL**: Both `pnpm-lock.yaml` and `pnpm-workspace.yaml` must be included in the build artifact. These files are required for EAS to properly detect and use pnpm.

**Changes made:**

- Removed `pnpm-lock.yaml` from `.gitignore` (was on line 144)
- Added `pnpm-lock.yaml` to git tracking
- Verified `pnpm-workspace.yaml` is already tracked
- No `.easignore` file exists (good - no additional exclusions)

**Status**: ✅ Implemented - both files are now tracked and will be included in EAS builds

### Solution 6: Ensure yarn.lock is not committed

The `yarn.lock` file is already in `.gitignore`, but if it exists in the repository, it might confuse EAS. Ensure it's not committed to git.

**Status**: Already in `.gitignore` - verify it's not in the repo

## Questions for EAS Support

1. How can we configure EAS to use pnpm instead of yarn in a monorepo?
2. Is there a way to enable corepack before the dependency installation step?
3. Why is EAS misreading the `packageManager` field as `"yarn@pnpm@8.15.0"`?
4. Is there a configuration option to skip auto-detection of package managers?
5. Can we configure EAS to respect the `packageManager` field in monorepos?
6. Does the `EXPO_USE_PNPM` environment variable work before the dependency installation step?
