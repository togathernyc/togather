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
