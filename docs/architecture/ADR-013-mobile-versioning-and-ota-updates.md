# ADR-013: Mobile Versioning and OTA Updates

## Status
Accepted

## Context
The Togather mobile app needs a robust versioning system that:
1. Distinguishes between binary releases and OTA (Over-The-Air) updates
2. Prevents JS updates from using native features not yet in the installed binary
3. Provides clear version identification for debugging and user support
4. Works seamlessly across staging and production environments

## Decision

### Version Format

We use a **5-segment versioning scheme**:

```
1.0.16.010426.1432
├─┬──┘ └──┬──┘ └─┬─┘
│ │       │      └── Time (HHMM in UTC)
│ │       └───────── Date (MMDDYY)
│ └───────────────── Binary version (X.Y.Z)
└─────────────────── Major version
```

| Segment | Purpose | When It Changes |
|---------|---------|-----------------|
| `X.Y.Z` | Binary/native version | Native code changes, app store releases |
| `MMDDYY` | OTA deployment date | Each OTA deployment |
| `HHMM` | OTA deployment time (UTC) | Each OTA deployment |

### Examples

```
1.0.16              Fresh binary install (no OTA yet)
1.0.16.010426.1432  OTA update deployed Jan 4, 2026 at 14:32 UTC
1.0.16.010426.1815  Second OTA same day at 18:15 UTC
1.0.17.010726.0900  First OTA after binary bump to 1.0.17
```

---

## What Are OTA Updates?

**OTA (Over-The-Air) updates** allow shipping JavaScript/TypeScript code changes directly to users without going through app store review.

### How They Work

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  Code Change    │────▶│  EAS Update      │────▶│  User's Device  │
│  (JS/TS only)   │     │  (expo.dev)      │     │  Auto-downloads │
└─────────────────┘     └──────────────────┘     └─────────────────┘
```

1. Developer pushes code to `main` or `staging` branch
2. CI builds a JS bundle and uploads to Expo's servers
3. App checks for updates on launch (or manually)
4. If compatible update exists, downloads and applies on next restart

### OTA vs Binary Updates

| Aspect | OTA Update | Binary Update |
|--------|------------|---------------|
| **What changes** | JS/TS code only | Native code, dependencies, config |
| **Delivery** | Direct from Expo servers | App Store / Play Store |
| **Review time** | Instant | 1-3 days (iOS), hours (Android) |
| **User action** | Auto-install on restart | Manual app store update |
| **Use for** | Bug fixes, UI tweaks, new screens | New native features, SDK updates |

### When OTA Is NOT Safe

OTA updates are **blocked** when they require native code not in the user's installed binary:

```
❌ Adding a new native dependency (e.g., react-native-maps)
❌ Changing native config (Info.plist, AndroidManifest.xml)
❌ Updating Expo SDK version
❌ Adding new Expo plugins
```

The **fingerprint system** (see below) prevents these mistakes.

---

## Version Locations

Versions must be synchronized across these files:

| File | Field | Purpose |
|------|-------|---------|
| `app.config.js` | `version` | App store display version |
| `app.config.js` | `runtimeVersion` | OTA compatibility check |
| `app.config.js` | `extra.otaVersion` | Full version with date/time |
| `app.json` | `version` | Legacy fallback (must match) |
| `ios/.../Expo.plist` | `EXUpdatesRuntimeVersion` | iOS OTA compatibility |
| `.fingerprint` | `RUNTIME_VERSION` | CI verification baseline |

### Keeping Versions in Sync

Use the automated bump script (recommended):

```bash
# Bump patch version: 1.0.16 -> 1.0.17
pnpm version:bump patch

# Bump minor version: 1.0.16 -> 1.1.0
pnpm version:bump minor

# Bump major version: 1.0.16 -> 2.0.0
pnpm version:bump major

# Set specific version
pnpm version:bump 1.0.17

# Preview changes without applying
pnpm version:bump --dry-run 1.0.17
```

This script automatically updates all 4 locations:
- `app.config.js` (version, runtimeVersion, otaVersion fallback)
- `app.json` (version)
- `ios/Togather/Supporting/Expo.plist` (EXUpdatesRuntimeVersion)
- `.fingerprint` (regenerates hash)

---

## Fingerprint System

The fingerprint system detects when native code changes and **enforces** a version bump.

### What It Tracks

```javascript
// Native code directories
'ios/',
'android/',

// Native-relevant config
'app.config.js' (plugins, ios/android sections only),
'eas.json',

// Native dependencies only
'react-native-*',
'expo-*',
'@stream-io/react-native-*',
// ... etc
```

### What It Ignores

```javascript
// JS-only code (safe for OTA)
'src/**/*.ts',
'features/**/*.tsx',

// JS-only config
'trpcUrl', 'streamApiKey', 'extra.*',

// JS-only dependencies
'lodash', 'zod', '@trpc/*',
```

### How It Works

```
Code Push → CI runs fingerprint check
                    │
    ┌───────────────┴───────────────┐
    │                               │
    ▼                               ▼
Native changed?                 No change?
    │                               │
    ▼                               ▼
runtimeVersion updated?         ✅ PASS
    │                           (OTA safe)
    ├── NO  → ❌ FAIL
    │         "Must bump runtimeVersion!"
    │
    └── YES → ✅ PASS
              (Needs new binary)
```

### Running Fingerprint Check

```bash
# Check if fingerprint matches (CI runs this)
pnpm fingerprint:check

# Update fingerprint after version bump
pnpm fingerprint:update
# or
node scripts/check-fingerprint.js --update
```

---

## CI/CD Pipeline

### Workflow Overview

**Production is fully protected.** Nothing deploys to production automatically.

```
Feature Branch → Staging → [Manual Promotion] → Production
                    ↓              ↓
              Auto-deploy    "Promote to Production"
              (API, OTA,     workflow in GitHub UI
              Native)             ↓
                            Deploys what changed:
                            - API → Fly.io
                            - Native → App Store
                            - JS → OTA Update
```

### The Protected Production Flow

1. **Development**: Work on feature branches
2. **Merge to staging**: Triggers auto-deployment to staging environment
3. **Test**: Verify the staging app works correctly
4. **Promote**: Manually run "Promote to Production" workflow
5. **Deploy**: Workflow detects changes and deploys appropriate components

### Staging Workflows (Auto-Deploy)

These workflows trigger automatically when code is pushed to the `staging` branch:

| Workflow | Trigger | What It Does |
|----------|---------|--------------|
| `deploy-mobile-update.yml` | JS/TS changes | OTA update to staging channel |
| `build-mobile-native.yml` | Native changes | Build & submit to TestFlight |
| `deploy-api.yml` | API changes | Deploy to staging API server |

### Promote to Production Workflow

**File:** `.github/workflows/promote-to-production.yml`

**Trigger:** Manual only (workflow_dispatch)

**How to use:**
1. Go to **Actions** in GitHub
2. Select **"Promote to Production"**
3. Click **"Run workflow"**
4. Type `promote` to confirm
5. Click **"Run workflow"**

The workflow will:
1. Compare staging to main to detect what changed
2. Deploy only the components that changed:
   - **API changes** → Deploy to Fly.io production
   - **Native changes** → Build & submit to App Store
   - **JS-only changes** → Publish OTA to production channel
3. Merge staging into main after successful deployment

### Setting Up GitHub Environments

For the promotion workflow to work correctly, configure GitHub Environments:

1. Go to **Settings → Environments** in your GitHub repo
2. Create two environments: `staging` and `production`
3. For `production`, optionally add **Required reviewers** for extra safety
4. Save

### Manual Build Workflow (Fallback)

**Trigger:** Manual dispatch OR version tag (`v*`)

**File:** `.github/workflows/build-mobile.yml`

Use for:
- Building specific platforms (iOS only, Android only)
- Rebuilding after a failed submission
- Emergency deployments (bypasses normal flow)

```yaml
Manual options:
- Platform: ios, android, or all
- Profile: staging or production
- Submit: yes or no
```

**Version tag validation:**
When triggered by a tag (e.g., `v1.0.17`), the workflow validates that the tag version matches the code version.

---

## Update Channels

Expo uses **channels** to route updates to the correct app variant.

| Channel | Target | Branch | Bundle ID |
|---------|--------|--------|-----------|
| `staging` | Togather Staging | `staging` | `life.togather.staging` |
| `production` | Togather | `main` | `app.gatherful.mobile` |

### How Channels Work

```
Staging app (life.togather.staging)
    │
    └── Checks channel: "staging"
            │
            └── Gets updates from staging branch only

Production app (app.gatherful.mobile)
    │
    └── Checks channel: "production"
            │
            └── Gets updates from main branch only
```

---

## Runtime Version Compatibility

The `runtimeVersion` is the **key** to OTA safety.

### How It Prevents Crashes

```
Scenario: App has runtimeVersion 1.0.16
          OTA update has runtimeVersion 1.0.17

Result: ❌ Update REJECTED
        App stays on current version
        User must update from app store
```

### Why This Matters

```
Without runtimeVersion protection:
1. User has app v1.0.16 (no camera permission)
2. Dev pushes OTA with camera feature
3. App crashes on camera access! 💥

With runtimeVersion protection:
1. User has app v1.0.16 (no camera permission)
2. Dev bumps to 1.0.17, adds camera, ships binary
3. OTA with 1.0.17 only goes to users with 1.0.17 binary
4. Users on 1.0.16 don't see the update ✅
```

---

## Displaying Version in App

The version is displayed in **Settings > App Info**:

```
┌────────────────────────────────┐
│ App Info                       │
├────────────────────────────────┤
│ Version      1.0.16.010426.1432│
│ Environment  Production        │
│ Update Status OTA update installed│
│ Last Updated 2 hours ago       │
│ Update ID    a1b2c3d4...       │
├────────────────────────────────┤
│ [Check for Updates]            │
│ [Send Logs to Developer]       │
└────────────────────────────────┘
```

### Version Display Logic

```typescript
// In AppInfoSection.tsx
const otaVersion = Constants.expoConfig?.extra?.otaVersion || appVersion;

// Shows:
// - "1.0.16.010426.1432" after OTA update
// - "1.0.16" for fresh binary install
// - "1.0.16" in development mode
```

---

## Common Scenarios

### Scenario 1: Bug Fix (OTA Safe)

```bash
# 1. Fix the bug in TypeScript on a feature branch
git checkout staging
git checkout -b fix/login-bug
# ... fix the bug ...

# 2. Push and merge to staging
git push origin fix/login-bug
# Create and merge PR to staging

# 3. CI automatically deploys to staging:
#    - Checks fingerprint (passes - no native changes)
#    - Generates version: 1.0.16.010426.1432
#    - Runs: eas update --channel staging

# 4. Test in Togather Staging app

# 5. Run "Promote to Production" workflow
#    - OTA deployed to production
#    - Users get update within minutes
```

### Scenario 2: New Native Feature (Full Flow)

```bash
# 1. Create feature branch from staging
git checkout staging
git checkout -b feature/camera-support

# 2. Add new dependency
pnpm add react-native-camera

# 3. Update native config (permissions, etc.)

# 4. Try to push - CI FAILS!
#    "Native code changed but runtimeVersion not updated"

# 5. Bump version using the script
pnpm version:bump patch
# Updates all 4 files: 1.0.16 → 1.0.17

# 6. Commit and push
git add -A
git commit -m "feat: add camera support"
git push origin feature/camera-support

# 7. Create PR to staging, merge

# 8. CI AUTOMATICALLY:
#    - Detects fingerprint change
#    - Builds iOS + Android (staging profile)
#    - Submits to TestFlight
#    - You receive notification when ready

# 9. Test in Togather Staging app (~30 min after merge)

# 10. When tested and ready:
#     - Go to GitHub Actions
#     - Run "Promote to Production" workflow
#     - Type "promote" to confirm
#     - Workflow builds and submits to App Store
#     - Main branch is automatically updated
```

### Scenario 3: OTA Update Flow

```bash
# 1. Make JS/TS changes on feature branch
git checkout staging
git checkout -b feature/new-screen

# 2. Make changes, commit, push
git add -A
git commit -m "feat: add new screen"
git push origin feature/new-screen

# 3. Create PR to staging, merge

# 4. CI AUTOMATICALLY:
#    - Checks fingerprint (passes - no native changes)
#    - Generates OTA version: 1.0.16.010426.1432
#    - Deploys to staging channel

# 5. Test in Togather Staging app

# 6. When tested and ready:
#     - Go to GitHub Actions
#     - Run "Promote to Production" workflow
#     - Type "promote" to confirm
#     - OTA update deployed to production
#     - Main branch updated automatically
```

### Scenario 4: Emergency Hotfix

```bash
# For emergencies, you can still use the manual workflow:

# 1. Fix the bug on a hotfix branch
git checkout staging
git checkout -b hotfix/critical-bug
# ... fix the bug ...

# 2. Merge to staging quickly
git push origin hotfix/critical-bug
# Create and merge PR

# 3. Verify fix works in staging

# 4. Immediately promote to production
#    GitHub Actions → "Promote to Production" → Run

# Note: For truly critical fixes, you can use the manual
# build-mobile.yml workflow to bypass the staging-first flow
```

---

## Troubleshooting

### "Native code changed but runtimeVersion not updated"

The fingerprint check detected native changes. Fix:

```bash
# Use the bump script (recommended)
pnpm version:bump patch

# Commit and push
git add -A
git commit -m "chore: bump version to 1.0.17"
```

### User Not Seeing OTA Update

1. **Check runtimeVersion match** - User's binary must match OTA's runtimeVersion
2. **Check channel** - Staging app only sees staging channel
3. **Force check** - User can tap "Check for Updates" in settings
4. **Restart app** - Updates apply on app restart

### Version Shows Without Date/Time

This means the user is on an embedded build (fresh install) without any OTA updates yet. The date/time portion is only added by CI during OTA deployment.

---

## Implemented Features

The following capabilities are now fully implemented:

- **Automatic staging builds** - Native changes on staging branch trigger auto-build
- **Production approval gate** - Native changes on main require manual approval
- **Version validation** - Versions must always increase (no downgrades)
- **Tag validation** - Git tags must match code version
- **Automatic version bumping** - `pnpm version:bump` updates all 4 locations

### Future Improvements

1. **Rollback mechanism**
   - Easy way to revert to previous OTA update
   - Could use `eas update:rollback` or channel republishing

2. **Slack/Discord notifications**
   - Notify team when builds complete or need approval

3. **Automated release notes**
   - Generate changelog from commits between versions

---

## References

- [Expo Updates Documentation](https://docs.expo.dev/versions/latest/sdk/updates/)
- [EAS Update Guide](https://docs.expo.dev/eas-update/getting-started/)
- [Runtime Versions Explained](https://docs.expo.dev/eas-update/runtime-versions/)

### Project Files

- Version bump script: `apps/mobile/scripts/bump-version.js`
- Fingerprint script: `apps/mobile/scripts/check-fingerprint.js`
- OTA workflow: `.github/workflows/deploy-mobile-update.yml`
- Manual build workflow: `.github/workflows/build-mobile.yml`
- Auto build workflow: `.github/workflows/build-mobile-native.yml`
