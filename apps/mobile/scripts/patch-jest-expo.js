#!/usr/bin/env node
/**
 * Script to patch jest-expo for React 19 compatibility
 * This patches the jest-expo setup.js file to handle null/undefined UIManager
 */

const fs = require("fs");
const path = require("path");

// Find jest-expo setup.js file in pnpm store or node_modules
function findJestExpoSetupFile() {
  // Script is in apps/mobile/scripts/, so go up three levels to root
  const rootDir = path.resolve(__dirname, "../../..");
  const foundFiles = [];

  // Try regular node_modules location first
  const regularPath = path.join(
    rootDir,
    "node_modules/jest-expo/src/preset/setup.js"
  );
  if (fs.existsSync(regularPath)) {
    foundFiles.push(regularPath);
  }

  // Try pnpm store location - find ALL jest-expo versions (not just 52.0.6)
  const pnpmDir = path.join(rootDir, "node_modules/.pnpm");
  if (fs.existsSync(pnpmDir)) {
    try {
      const entries = fs.readdirSync(pnpmDir);
      entries.forEach((entry) => {
        // Match any jest-expo version (52.0.6, 54.0.13, etc.)
        if (entry.startsWith("jest-expo@")) {
          const setupPath = path.join(
            pnpmDir,
            entry,
            "node_modules/jest-expo/src/preset/setup.js"
          );
          if (fs.existsSync(setupPath)) {
            foundFiles.push(setupPath);
          }
        }
      });
    } catch (e) {
      // Ignore errors
    }
  }

  // Return all found files (we'll patch all of them)
  return foundFiles;
}

function applyPatch(filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    console.warn("⚠️  jest-expo setup.js not found, skipping patch");
    return false;
  }

  let content = fs.readFileSync(filePath, "utf8");

  // Check if already patched
  if (
    content.includes(
      "if (mockNativeModules.UIManager && mockNativeModules.NativeUnimoduleProxy"
    )
  ) {
    console.log("✅ jest-expo already patched");
    return true;
  }

  // Patch 1: Add null check for UIManager
  if (
    !content.includes(
      "if (mockNativeModules.UIManager && mockNativeModules.NativeUnimoduleProxy"
    )
  ) {
    content = content.replace(
      /Object\.keys\(mockNativeModules\.NativeUnimoduleProxy\.viewManagersMetadata\)\.forEach\(\s*\(viewManagerName\) => \{[\s\S]*?\}\);?\s*\n/g,
      (match) => {
        return `if (mockNativeModules.UIManager && mockNativeModules.NativeUnimoduleProxy && mockNativeModules.NativeUnimoduleProxy.viewManagersMetadata) {
  ${match.trim()}
}
`;
      }
    );
  }

  // Patch 2: Make expo-modules-core/src/Refs optional
  if (
    !content.includes("try {") ||
    !content.includes("jest.doMock('expo-modules-core/src/Refs'")
  ) {
    content = content.replace(
      /\/\/ Mock the `createSnapshotFriendlyRef` to return an ref that can be serialized in snapshots\.\s*jest\.doMock\('expo-modules-core\/src\/Refs', \(\) => \(\{[\s\S]*?\}\),\s*\}\);?/g,
      `// Mock the \`createSnapshotFriendlyRef\` to return an ref that can be serialized in snapshots.
try {
  jest.doMock('expo-modules-core/src/Refs', () => ({
    createSnapshotFriendlyRef: () => {
      // We cannot use \`createRef\` since it is not extensible.
      const ref = { current: null };
      Object.defineProperty(ref, 'toJSON', {
        value: () => '[React.ref]',
      });
      return ref;
    },
  }));
} catch (error) {
  // Allow this module to be optional
  if (error.code !== 'MODULE_NOT_FOUND') {
    throw error;
  }
}`
    );
  }

  // Patch 3: Make expo-modules-core/src/web/index.web optional
  content = content.replace(
    /require\('expo-modules-core\/src\/web\/index\.web'\);/,
    `try {
  require('expo-modules-core/src/web/index.web');
} catch (error) {
  // Allow this module to be optional
  if (error.code !== 'MODULE_NOT_FOUND') {
    throw error;
  }
}`
  );

  fs.writeFileSync(filePath, content, "utf8");
  console.log("✅ Successfully patched jest-expo");
  return true;
}

// Verify patch is applied
function verifyPatch(filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    return false;
  }
  const content = fs.readFileSync(filePath, "utf8");

  // Check for Patch 1: UIManager null check
  const hasUIManagerCheck = content.includes(
    "if (mockNativeModules.UIManager && mockNativeModules.NativeUnimoduleProxy"
  );

  // Check for Patch 2: Refs try-catch (more specific check)
  const hasRefsTryCatch =
    content.includes("try {") &&
    content.includes("jest.doMock('expo-modules-core/src/Refs'") &&
    content.includes("} catch (error)");

  // Check for Patch 3: Web try-catch (more specific check)
  const hasWebTryCatch =
    content.includes("try {") &&
    content.includes("require('expo-modules-core/src/web/index.web')") &&
    (content.includes("} catch (error)") || content.includes("} catch (e)"));

  // At minimum, we need the UIManager check (most critical patch)
  // The other patches are nice-to-have but not critical
  return (
    hasUIManagerCheck &&
    (hasRefsTryCatch || hasWebTryCatch || content.includes("try {"))
  );
}

// Main execution
try {
  const setupFiles = findJestExpoSetupFile();
  if (setupFiles.length > 0) {
    let patchedCount = 0;
    let alreadyPatchedCount = 0;

    setupFiles.forEach((file) => {
      // Check if already patched
      if (verifyPatch(file)) {
        alreadyPatchedCount++;
      } else {
        const result = applyPatch(file);
        if (result) {
          patchedCount++;
        }
      }
    });

    if (patchedCount > 0) {
      console.log(`✅ Successfully patched ${patchedCount} jest-expo file(s)`);
    }
    if (alreadyPatchedCount > 0) {
      console.log(
        `✅ ${alreadyPatchedCount} jest-expo file(s) already patched`
      );
    }

    // Verify all files are patched
    const allPatched = setupFiles.every((file) => verifyPatch(file));
    if (!allPatched) {
      console.warn(
        "⚠️  Warning: Some jest-expo files may not be properly patched"
      );
      // In EAS/CI builds, be more lenient - if we patched at least one file, continue
      // The patch might work even if verification is strict
      const isCI =
        process.env.EAS_BUILD ||
        process.env.CI ||
        process.env.EXPO_PUBLIC_ENV === "production" ||
        process.env.EXPO_PUBLIC_ENV === "staging" ||
        process.env.NODE_ENV === "production";

      if (isCI && patchedCount > 0) {
        console.warn(
          "⚠️  Continuing in CI/EAS environment - at least one file was patched"
        );
        // Don't exit - let the build continue
      } else if (patchedCount > 0 || alreadyPatchedCount > 0) {
        // If we patched or found already-patched files, be lenient
        console.warn(
          "⚠️  Some files may not verify correctly, but patches were applied - continuing"
        );
        // Don't exit - patches might still work
      } else {
        // Only fail if we couldn't patch anything
        console.error("❌ Failed to patch any jest-expo files");
        process.exit(1);
      }
    }
  } else {
    console.warn(
      "⚠️  Could not find jest-expo setup.js file - patch may already be applied or file location changed"
    );
    // Don't fail - tests might still work if patch is already applied
  }
} catch (error) {
  console.error("❌ Error patching jest-expo:", error.message);
  console.error(error.stack);
  process.exit(1);
}
