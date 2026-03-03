# Jest-Expo Patch for React 19 Compatibility

## Overview

This directory contains scripts to patch `jest-expo@52.0.6` for React 19 compatibility. The patch fixes an issue where `Object.defineProperty` is called on `null`/`undefined`, which React 19 throws an error for.

## What Gets Patched

The patch modifies `jest-expo/src/preset/setup.js` to:

1. **Add null check for UIManager** - Wraps `Object.defineProperty` calls with a null check
2. **Make expo-modules-core/src/Refs optional** - Wraps `jest.doMock` in try-catch
3. **Make expo-modules-core/src/web/index.web optional** - Wraps `require` in try-catch

## How It Works

### Automatic Patching

The patch is automatically applied on `pnpm install` via the `postinstall` script in `package.json`:

```json
{
  "scripts": {
    "postinstall": "node scripts/patch-jest-expo.js && patch-package"
  }
}
```

### Verification

Before running tests, the patch is verified via `scripts/verify-patch.js`:

```json
{
  "scripts": {
    "test": "node scripts/verify-patch.js && node run-tests.js"
  }
}
```

## Files

- **`patch-jest-expo.js`** - Applies the patch to jest-expo setup.js
- **`verify-patch.js`** - Verifies the patch is applied correctly

## Manual Patching

If the automatic patch fails, you can manually run:

```bash
cd apps/mobile
node scripts/patch-jest-expo.js
```

## Troubleshooting

### Patch Not Applied

If tests fail with `Object.defineProperty called on non-object`:

1. Run the patch script manually:
   ```bash
   cd apps/mobile
   node scripts/patch-jest-expo.js
   ```

2. Verify the patch:
   ```bash
   node scripts/verify-patch.js
   ```

3. If verification fails, check that jest-expo is installed:
   ```bash
   pnpm list jest-expo
   ```

### Patch Location Changed

If the patch script can't find the file, it might be because:
- pnpm store location changed
- jest-expo version changed
- node_modules structure changed

Check the actual location:
```bash
find node_modules -name "setup.js" -path "*jest-expo*"
```

## Preventing Regression

To ensure the patch doesn't regress:

1. **Always run `pnpm install`** - The postinstall script will apply the patch
2. **Tests verify the patch** - The test script runs verification before tests
3. **CI/CD should verify** - Add patch verification to CI/CD pipeline
4. **Document in onboarding** - New developers should know about the patch

## Updating the Patch

If jest-expo is updated and the patch needs changes:

1. Update the patch logic in `patch-jest-expo.js`
2. Update the verification logic in `verify-patch.js`
3. Test the patch manually
4. Update this documentation

## Related Issues

- React 19 compatibility with jest-expo
- Object.defineProperty on null/undefined
- pnpm workspace module resolution

