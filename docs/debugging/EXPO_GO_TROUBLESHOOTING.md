# Expo Go Troubleshooting Guide

This guide covers common issues when running the Togather mobile app in Expo Go, particularly related to our pnpm monorepo setup.

## Quick Start

```bash
# Start the app in Expo Go with local API
pnpm dev --local

# Or start just the mobile app (connects to production API)
cd apps/mobile && npx expo start
```

## Table of Contents

1. [SHA-1 Hash Errors](#sha-1-hash-errors)
2. [Watchman Issues](#watchman-issues)
3. [Metro Bundler Issues](#metro-bundler-issues)
4. [Environment Configuration](#environment-configuration)
5. [Expo Go Version Mismatch](#expo-go-version-mismatch)
6. [Development Build vs Expo Go](#development-build-vs-expo-go)

---

## SHA-1 Hash Errors

### Symptom

```
ERROR  Error: Failed to get the SHA-1 for: /Users/.../node_modules/.pnpm/expo-router@.../entry.js
      Potential causes:
        1) The file is not watched. Ensure it is under the configured `projectRoot` or `watchFolders`.
        2) Check `blockList` in your metro.config.js and make sure it isn't excluding the file path.
        3) The file may have been deleted since it was resolved - try refreshing your app.
        4) Otherwise, this is a bug in Metro or the configured resolver - please report it.
```

### Root Cause

This error occurs when Metro bundler can't compute the SHA-1 hash for a file because **watchman isn't tracking it**. In pnpm monorepos, this typically happens because:

1. **`.watchmanconfig` ignores `node_modules`** - The most common cause
2. **Metro's symlink resolution** - pnpm uses symlinks in `node_modules/.pnpm`, which Metro may not follow correctly
3. **Missing `unstable_enableSymlinks`** - Metro needs explicit symlink support for pnpm

### Solution

#### Step 1: Check `.watchmanconfig`

The root `.watchmanconfig` must NOT ignore `node_modules`:

```json
// WRONG - causes SHA-1 errors
{"ignore_dirs": ["node_modules", ".git", "ios", "android"]}

// CORRECT - allows watchman to track pnpm store
{"ignore_dirs": [".git", "ios", "android"]}
```

#### Step 2: Enable symlinks in `metro.config.js`

Ensure `unstable_enableSymlinks: true` is set in the resolver:

```javascript
config.resolver = {
  ...config.resolver,
  unstable_enableSymlinks: true,  // CRITICAL for pnpm
  // ... other config
};
```

#### Step 3: Reset watchman

After changing `.watchmanconfig`, reset watchman:

```bash
# Delete the watch and re-create it
watchman watch-del '/path/to/Togather'
watchman watch-project '/path/to/Togather'

# Verify new config is loaded
watchman get-config '/path/to/Togather'
```

#### Step 4: Clear Metro cache and restart

```bash
# Kill all Metro processes
pkill -f "node.*Togather" || true

# Clear caches
rm -rf apps/mobile/.expo
rm -rf /tmp/metro-*

# Restart with cache clear
cd apps/mobile && npx expo start --clear
```

### Verification

Check that watchman is now tracking `node_modules`:

```bash
# Should return 100k+ files (not just ~1,700)
watchman query '/path/to/Togather' '["exists"]' | grep -c "name"
```

---

## Watchman Issues

### "Recrawled this watch N times"

```
Recrawled this watch 15 times, most recently because:
MustScanSubDirs UserDroppedTo resolve, please review...
```

**Solution:**

```bash
watchman watch-del '/path/to/Togather'
watchman watch-project '/path/to/Togather'
```

### Watchman not finding files

If watchman can't find files that definitely exist:

```bash
# Check what watchman is configured to ignore
watchman get-config '/path/to/Togather'

# Check if file is being watched
watchman find '/path/to/Togather' 'entry.js' | grep expo-router
```

### Watchman performance issues

If watchman is slow after removing `node_modules` from ignore list:

1. This is expected - watchman now tracks 100k+ files instead of ~1,700
2. Initial indexing takes 10-30 seconds
3. Subsequent watches are cached and fast

---

## Metro Bundler Issues

### Multiple React instances

See [METRO_REACT_MULTIPLE_INSTANCES.md](./METRO_REACT_MULTIPLE_INSTANCES.md) for detailed guidance.

**Quick fix:** Ensure `extraNodeModules` in `metro.config.js` points to the correct React version:

```javascript
extraNodeModules: {
  react: path.resolve(projectRoot, 'node_modules/react'),
  'react-dom': path.resolve(projectRoot, 'node_modules/react-dom'),
}
```

### Port already in use

```
Port 8081 is running this app in another window
```

**Solution:**

```bash
# Find and kill process on port 8081
lsof -i :8081 | grep LISTEN | awk '{print $2}' | xargs kill -9

# Or kill all node processes
pkill -f "node.*Togather"
```

### Bundling hangs or fails silently

```bash
# Clear all caches
rm -rf apps/mobile/.expo
rm -rf node_modules/.cache
watchman watch-del-all

# Reinstall and restart
pnpm install
cd apps/mobile && npx expo start --clear
```

---

## Environment Configuration

### Understanding Environment Labels

When running in Expo Go, you may see environment labels like "Production" or "Staging".

- **"Production" label** = No `APP_VARIANT=staging` set (default in Expo Go)
- **"Staging" label** = `APP_VARIANT=staging` set during build

### Environment Determination Order

1. Build-time `APP_VARIANT` (staging builds only)
2. Bundle identifier check (`.staging` in name)
3. Default to production

### Stream Channel Prefixes

- `p_` = Production channels
- `s_` = Staging channels

The prefix is determined by `APP_VARIANT`.

---

## Expo Go Version Mismatch

### Symptom

```
Project is incompatible with this version of Expo Go
The project you requested requires a newer version of Expo Go
```

### Solution

#### Option 1: Update Expo Go on Simulator

Let Expo install the correct version:

```bash
cd apps/mobile
npx expo start --ios  # Will download and install correct Expo Go
```

#### Option 2: Manual Installation

```bash
# Get simulator UDID
xcrun simctl list devices | grep Booted

# Download Expo Go for your SDK version
# Check SDK version in package.json: "expo": "~54.0.23" = SDK 54
curl -L "https://expo.dev/client-download/eas-build-client?platform=ios&buildType=simulator&sdkVersion=54" -o ExpoGo.tar.gz

# Extract and install
tar -xzf ExpoGo.tar.gz
mkdir -p "Expo Go.app"
tar -xf ExpoGo.tar -C "Expo Go.app"
xcrun simctl install booted "Expo Go.app"
```

---

## Development Build vs Expo Go

### When to Use Expo Go

- Quick iteration during development
- Testing UI changes
- Features that don't require native modules not in Expo Go

### When You Need a Development Build

You MUST use a development build (`expo-dev-client`) when using:

- Custom native modules
- `expo-notifications` with push notifications on Android
- Native code modifications
- EAS Build features

### Common Mistake: Installing expo-dev-client

**DO NOT** install `expo-dev-client` if you want to use Expo Go. Adding it:

1. Breaks Expo Go compatibility
2. Requires running `expo prebuild` and building native code
3. Creates `ios/` and `android/` folders

If you accidentally installed it:

```bash
# Revert package.json
git checkout apps/mobile/package.json

# Remove generated native folders
rm -rf apps/mobile/ios apps/mobile/android

# Reinstall dependencies
pnpm install
```

---

## Complete Reset Procedure

If all else fails, do a complete reset:

```bash
# 1. Kill all processes
pkill -f "node.*Togather" || true
pkill -f "expo" || true
pkill -f "metro" || true

# 2. Reset watchman
watchman watch-del-all
watchman shutdown-server

# 3. Clear all caches
rm -rf apps/mobile/.expo
rm -rf apps/mobile/ios apps/mobile/android  # If generated
rm -rf node_modules/.cache
rm -rf /tmp/metro-*
rm -rf /tmp/haste-map-*

# 4. Reinstall dependencies
pnpm install

# 5. Re-initialize watchman
watchman watch-project '/path/to/Togather'

# 6. Start fresh
cd apps/mobile && npx expo start --clear --ios
```

---

## Diagnostic Commands

```bash
# Check watchman status
watchman watch-list
watchman get-config '/path/to/Togather'

# Check what files watchman tracks
watchman query '/path/to/Togather' '["exists"]' | grep -c "name"

# Find expo-router entry file
find node_modules -name "entry.js" -path "*/expo-router/*" 2>/dev/null

# Check symlink resolution
realpath node_modules/expo-router

# Verify port availability
lsof -i :8081 | head -5

# Check installed Expo Go
xcrun simctl listapps booted | grep -A2 "Exponent\|Expo"
```

---

## Related Documentation

- [METRO_REACT_MULTIPLE_INSTANCES.md](./METRO_REACT_MULTIPLE_INSTANCES.md) - React version conflicts
- [JEST_EXPO_PATCH_ISSUE.md](./JEST_EXPO_PATCH_ISSUE.md) - Jest configuration issues
- [Expo Monorepo Guide](https://docs.expo.dev/guides/monorepos/) - Official Expo documentation
- [Metro GitHub Issues](https://github.com/facebook/metro/issues/1496) - pnpm symlink tracking
