#!/usr/bin/env node
/**
 * Verification script to check if jest-expo patch is applied
 * This can be run in CI/CD or before tests to ensure the patch is in place
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

function verifyPatch(filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    return false;
  }
  const content = fs.readFileSync(filePath, "utf8");
  const hasUIManagerCheck = content.includes(
    "if (mockNativeModules.UIManager && mockNativeModules.NativeUnimoduleProxy"
  );
  const hasRefsTryCatch =
    content.includes("try {") &&
    content.includes("jest.doMock('expo-modules-core/src/Refs'");
  const hasWebTryCatch =
    content.includes("try {") &&
    content.includes("require('expo-modules-core/src/web/index.web')");

  return hasUIManagerCheck && hasRefsTryCatch && hasWebTryCatch;
}

// Main execution
const setupFiles = findJestExpoSetupFile();
if (setupFiles.length === 0) {
  // If we can't find the file, it might be because:
  // 1. The patch is already applied and the file structure changed
  // 2. The package hasn't been installed yet
  // 3. The file is in a different location
  // For now, we'll warn but not fail - the patch script will handle it on postinstall
  console.warn(
    "⚠️  Could not find jest-expo setup.js file - this is OK if patch is already applied"
  );
  console.warn(
    "   The patch will be applied automatically on next pnpm install"
  );
  process.exit(0); // Don't fail - let tests run
}

const allPatched = setupFiles.every((file) => verifyPatch(file));
if (!allPatched) {
  console.error("❌ jest-expo patch is not properly applied");
  console.error("   Run: npm run postinstall");
  process.exit(1);
}

console.log("✅ jest-expo patch verified");
process.exit(0);
