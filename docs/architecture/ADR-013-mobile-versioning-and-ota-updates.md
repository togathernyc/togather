# ADR-013: Mobile Versioning and OTA Updates

## Status
Accepted (revised)

## Context
The Togather mobile app uses Expo's OTA (Over-The-Air) update system to ship JavaScript changes without app store review. This requires careful handling of native dependencies — if a JS bundle references a native module that doesn't exist in the user's installed binary, the app crashes.

Previously, we bumped `runtimeVersion` whenever native code changed, which blocked OTA delivery to users on older builds. This created a problem: adding *any* native dependency — even an optional one — cut off all existing users until they updated from the app store.

## Decision

### Never bump `runtimeVersion`

`runtimeVersion` is set to `"1.0.21"` and matches the current production native build. It will only change when we do a new native build submission, at which point it should be set to a permanent value like `"1"`.

OTA updates are delivered to all users on builds with matching `runtimeVersion`. By keeping it stable, we ensure all users continue to receive updates.

### Gate new native dependencies

Instead of blocking OTA delivery, new native dependencies are **gated** behind runtime `NativeModules` checks. The JS bundle works on any native build:

- If the native module exists → use it
- If the native module is missing → use a fallback (plain View, disabled feature, etc.)

### Two-layer enforcement

1. **`check-native-imports.js`** (CI enforcement) — Fails CI if a gated dependency is statically imported. Forces developers to use the dynamic require pattern.

2. **`check-fingerprint.js`** (informational) — Warns when the native fingerprint changes, so the team knows a new native build is needed. Does NOT fail CI.

---

## How It Works

### Dependency Classification

All native dependencies are classified in `native-deps.json`:

```json
{
  "core": ["react-native", "expo", "expo-router", ...],
  "gated": ["expo-linear-gradient", "expo-av", "expo-document-picker"]
}
```

- **Core**: Present in the baseline native build. Safe to import statically.
- **Gated**: May not be in the user's native build. Must use dynamic `require()` behind a `NativeModules` check.

### Gating Pattern

Detection function in `features/chat/utils/fileTypes.ts`:

```typescript
export function isLinearGradientSupported(): boolean {
  // On web, the module is JS-only and always available
  if (Platform.OS === 'web') { /* try require */ }

  // On native, check if the native module is registered
  const hasNativeModule = !!NativeModules.ExpoLinearGradient;
  if (!hasNativeModule) return false;

  // Safe to require — native module exists
  const mod = require('expo-linear-gradient');
  return !!mod?.LinearGradient;
}
```

Safe wrapper component (e.g., `components/ui/SafeLinearGradient.tsx`):

```typescript
export function SafeLinearGradient({ colors, style, children, ...props }) {
  const RealGradient = getLinearGradient(); // lazy dynamic require

  if (RealGradient) {
    return <RealGradient colors={colors} style={style} {...props}>{children}</RealGradient>;
  }

  // Fallback: solid color background
  return <View style={[{ backgroundColor: colors[colors.length - 1] }, style]}>{children}</View>;
}
```

### CI Flow

```
Code Push → CI
             │
             ├── check-native-imports.js
             │   ├── Any static import of gated dep? → ❌ FAIL
             │   ├── Unclassified native dep in package.json? → ❌ FAIL
             │   └── All good → ✅ PASS
             │
             └── check-fingerprint.js
                 ├── Fingerprint changed? → ⚠️ WARNING (informational)
                 └── No change → ✅ PASS
```

---

## How to Add a New Native Dependency

### Step 1: Install the package

```bash
pnpm add expo-new-feature
```

### Step 2: Classify it in `native-deps.json`

Add the package name to the `"gated"` list:

```json
{
  "gated": ["expo-linear-gradient", "expo-av", "expo-document-picker", "expo-new-feature"]
}
```

### Step 3: Add a detection function

In `features/chat/utils/fileTypes.ts`, add:

```typescript
let _newFeatureSupported: boolean | null = null;

export function isNewFeatureSupported(): boolean {
  if (_newFeatureSupported !== null) return _newFeatureSupported;

  if (Platform.OS === 'web') {
    // Handle web case if applicable
  }

  const hasNativeModule = !!NativeModules.ExpoNewFeature;
  if (!hasNativeModule) {
    _newFeatureSupported = false;
    return false;
  }

  try {
    const mod = require('expo-new-feature');
    _newFeatureSupported = !!mod;
    return _newFeatureSupported;
  } catch {
    _newFeatureSupported = false;
    return false;
  }
}
```

Don't forget to add the cache variable to `resetModuleDetectionCache()`.

### Step 4: Create a safe wrapper or guard usage

Either create a `SafeNewFeature` component (like `SafeLinearGradient`) or guard the feature in the UI:

```typescript
if (isNewFeatureSupported()) {
  // Show the feature
} else {
  // Hide it or show alternative
}
```

### Step 5: Add to the allowlist (if needed)

If your detection function or wrapper uses `require('expo-new-feature')`, add the file to `ALLOWLISTED_FILES` in `scripts/check-native-imports.js`.

### Step 6: Verify

```bash
node scripts/check-native-imports.js  # Should pass
```

---

## Version Format

### OTA Version (5-segment)

```
1.0.21.031526.1432
├─┬──┘ └──┬──┘ └─┬─┘
│ │       │      └── Time (HHMM in UTC)
│ │       └───────── Date (MMDDYY)
│ └───────────────── Binary version (X.Y.Z)
└─────────────────── Major version
```

The date/time segments are added by CI during OTA deployment. Fresh binary installs show just `X.Y.Z`.

### Version Locations

| File | Field | Purpose |
|------|-------|---------|
| `app.config.js` | `version` | App store display version |
| `app.config.js` | `runtimeVersion` | OTA compatibility check |
| `app.config.js` | `extra.otaVersion` | Full version with date/time |
| `.fingerprint` | `RUNTIME_VERSION` | CI verification baseline |

---

## Update Channels

| Channel | Target | Branch | Bundle ID |
|---------|--------|--------|-----------|
| `staging` | Togather Staging | `staging` | `life.togather.staging` |
| `production` | Togather | `main` | `app.gatherful.mobile` |

---

## OTA Delivery Modes (silent vs forced)

Not every OTA needs to interrupt the user. Delivery is governed by a monotonic
**forced floor** serial that `OTAUpdateProvider` reads off the update manifest
(`extra.otaForcedSerial`):

| Mode | What the user sees | When to use |
|------|--------------------|-------------|
| `silent` (default) | Nothing. The bundle downloads in the background and applies on the **next cold start**. | Routine frontend changes that don't break the frontend↔backend contract. |
| `forced` | The full-screen, non-dismissible "Updating" modal, then an immediate `reloadAsync`. | Breaking frontend↔backend contract changes (avoid errors on stale clients) **or** a big feature you want everyone on at once. |

**The decision rule:** the app force-reloads when an incoming update's
`otaForcedSerial` is **greater than the serial of the running bundle**;
otherwise it stages the update silently. A missing/garbled serial reads as `0`,
so it can never spuriously trigger a forced reload.

**Why a serial and not a boolean.** `checkForUpdateAsync()` only ever returns
the *latest* manifest. A plain `forced` flag on one release would be lost the
moment a later silent release superseded it, so a device that missed the forced
window would never reload. The floor is **sticky**: a forced deploy bumps it,
and every later silent deploy carries the same value forward — so a stale device
sees the higher floor even on a silent update and still force-reloads.

**How the floor is set:** the `Deploy to Production` workflow has an
`update_mode` input (`silent` | `forced`, default `silent`). The OTA job reads
the current floor from the annotated `production-forced-floor` git tag; a
`forced` deploy bumps it to the deploy timestamp and moves the tag, a `silent`
deploy carries it forward. The value is exported as `OTA_FORCED_SERIAL` to the
`eas update` step, where `app.config.js` bakes it into `extra.otaForcedSerial`.
No backend coordination required. (Native store releases use the separate
`NativeUpdateModal` path and don't touch this floor.)

**Backend-only deploys publish nothing.** The deploy workflow tags each
production release as `production-latest` and diffs `apps/mobile` +
`packages/shared` + root dependency files (`package.json`, `pnpm-lock.yaml`)
against it. If nothing mobile changed, no OTA is published at all — a Convex-only
deploy no longer shows users any update UI.

---

## Common Scenarios

### Bug Fix (OTA Safe)

1. Fix the bug in TypeScript
2. Push and merge to staging → CI auto-deploys OTA
3. Test in staging app
4. Promote to production

No version bump needed. No native build needed.

### New Native Feature

1. Install package, classify as `gated` in `native-deps.json`
2. Add detection function and safe wrapper
3. Use the wrapper in your UI code
4. Push → CI passes (imports are gated, fingerprint warns)
5. OTA deploys to all users (feature hidden on old builds, visible on new builds)
6. Submit new native build when ready (feature becomes available to all users)

### Moving a Dep from Gated to Core

After a new native build is submitted and adopted by users:
1. Move the dep from `"gated"` to `"core"` in `native-deps.json`
2. Optionally replace safe wrappers with direct imports
3. Remove detection function and cache variable

---

## Troubleshooting

### "Static import of gated native dependency"

The CI check found a direct `import` of a gated package. Use the dynamic require pattern instead:

1. Check the native module with `NativeModules.ModuleName`
2. Only `require()` the package if the module exists
3. Provide a fallback

### "Unclassified native dependencies"

A new native package was added to `package.json` but not to `native-deps.json`. Add it to either `core` or `gated`.

### User Not Seeing OTA Update

1. Check `runtimeVersion` matches between build and update
2. Check the update channel (staging vs production)
3. User can tap "Check for Updates" in settings
4. Updates apply on app restart

---

## Guarding against JS changes that break native rendering

A distinct failure class from the OTA/gating rules above: a **pure-JS
dependency change** that silently breaks **native** rendering on the installed
binary, while every automated check stays green.

**Motivating incident (#548).** PR #548 added `@mui/*` + `@emotion/*` to
`apps/mobile` for a *web-only* datepicker. Those emotion/CSS-in-JS packages
dragged a second React into the shared pnpm lockfile (`autoInstallPeers`), which
re-keyed the Expo native-module graph. On the installed binary this broke Fabric
view/module registration and **chat video + animated GIFs rendered blank** —
yet typecheck, jest, and the web build all passed (jest mocks native modules;
web never touches Fabric).

We defend this with **three layers**:

1. **React-consistency check** (`scripts/check-react-consistency.js`, gate #1) —
   fails CI if any Expo/React-Native native package in `pnpm-lock.yaml` is keyed
   to a React version other than the one `apps/mobile` pins. Catches the #548
   *mechanism* (a second React in the native graph). Runs per-PR.

2. **Native-unsafe dependency denylist** (same script, gate #2) — fails CI if
   `apps/mobile` `dependencies`/`devDependencies` contain an emotion/CSS-in-JS/
   MUI-family package (`@mui/`, `@emotion/`, `@material-ui/`,
   `styled-components`). Catches the #548 *libraries* directly, before they can
   pull a second React. Web-only date/UI needs should use a dependency-free
   approach or an emotion-free library (e.g. `react-datepicker`); adding a
   denylisted package requires deliberately updating the list with
   justification. Runs per-PR.

3. **Native media smoke test** (ADR-030) — the real backstop. Static checks 1–2
   only catch *known* mechanisms/libraries; a novel way to break native
   rendering would slip past both. Only driving the real app on a real native
   build (simulator + EAS dev build) and asserting media renders non-blank
   catches that. It cannot run per-PR (needs a simulator + build), so it runs on
   a schedule / pre-release. An interim jest test
   (`features/chat/components/__tests__/VideoPlayer.tier.test.tsx`) asserts
   `VideoPlayer` never degrades to blank tier selection — but, because jest
   mocks native views, it explicitly *cannot* catch native view-registration
   failures. See ADR-030 for the full spec.

## References

- [Expo Updates Documentation](https://docs.expo.dev/versions/latest/sdk/updates/)
- [EAS Update Guide](https://docs.expo.dev/eas-update/getting-started/)
- [Runtime Versions Explained](https://docs.expo.dev/eas-update/runtime-versions/)

### Project Files

- Detection functions: `apps/mobile/features/chat/utils/fileTypes.ts`
- Safe wrappers: `apps/mobile/components/ui/SafeLinearGradient.tsx`
- Dependency config: `apps/mobile/native-deps.json`
- Import check script: `apps/mobile/scripts/check-native-imports.js`
- Fingerprint script: `apps/mobile/scripts/check-fingerprint.js`
- Version bump script: `apps/mobile/scripts/bump-version.js`
- OTA workflow: `.github/workflows/deploy-mobile-update.yml`
- Build workflow: `.github/workflows/build-mobile.yml`
