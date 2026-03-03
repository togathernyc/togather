#!/usr/bin/env node
/**
 * Safe EAS Update Script
 *
 * Prevents pushing OTA updates when native code has changed.
 * This catches the case where a new native module was added but
 * can't be delivered via OTA (e.g., expo-mail-composer incident).
 *
 * Usage:
 *   node scripts/safe-update.js --branch production --message "Your message"
 *
 * Or via npm script:
 *   pnpm update:ota --branch production --message "Your message"
 */

const { execSync, spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const PROJECT_ROOT = path.join(__dirname, "..");
const ENV_FILE = path.join(PROJECT_ROOT, ".env");

/**
 * Load .env file as fallback for environment variables.
 * EAS Secrets take precedence (they're already in process.env),
 * so we only set variables that aren't already defined.
 */
function loadEnvFallback() {
  if (!fs.existsSync(ENV_FILE)) {
    console.log("ℹ️  No .env file found, using EAS Secrets only\n");
    return;
  }

  const content = fs.readFileSync(ENV_FILE, "utf-8");
  const lines = content.split("\n");
  let loaded = 0;

  for (const line of lines) {
    // Skip comments and empty lines
    if (!line.trim() || line.trim().startsWith("#")) continue;

    const match = line.match(/^([^=]+)=(.*)$/);
    if (match) {
      const [, key, value] = match;
      const trimmedKey = key.trim();
      // Only set if not already defined (EAS Secrets take precedence)
      if (!process.env[trimmedKey]) {
        process.env[trimmedKey] = value.trim();
        loaded++;
      }
    }
  }

  if (loaded > 0) {
    console.log(`📦 Loaded ${loaded} env variable(s) from .env as fallback\n`);
  }
}
const FINGERPRINT_FILE = path.join(PROJECT_ROOT, ".fingerprint");

// Known native modules that will crash if not in the build
// Add modules here as we discover them
const NATIVE_MODULES = [
  "expo-mail-composer",
  "expo-camera",
  "expo-contacts",
  "expo-calendar",
  "expo-barcode-scanner",
  "expo-sensors",
  "expo-local-authentication",
  "expo-brightness",
  "expo-battery",
  "expo-cellular",
  "expo-print",
  "expo-sharing", // Different from Share API
  "expo-speech",
  "expo-sms",
  "expo-store-review",
  "expo-task-manager",
  "expo-background-fetch",
  "expo-location", // If not already in build
  "react-native-maps", // If not already in build
];

function getStoredFingerprint() {
  if (!fs.existsSync(FINGERPRINT_FILE)) {
    return null;
  }
  const content = fs.readFileSync(FINGERPRINT_FILE, "utf-8");
  const lines = content.trim().split("\n");
  const data = {};
  for (const line of lines) {
    const [key, value] = line.split("=");
    if (key && value) {
      data[key.trim()] = value.trim();
    }
  }
  return data;
}

function getCurrentDependencies() {
  const packageJsonPath = path.join(PROJECT_ROOT, "package.json");
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));
  return Object.keys(packageJson.dependencies || {});
}

function getLastBuildDependencies() {
  // Get dependencies from the commit that matches the stored fingerprint
  // For now, we'll compare against the known native modules list
  // In the future, we could store a list of deps at build time
  return [];
}

function checkForNewNativeModules() {
  const currentDeps = getCurrentDependencies();
  const newNativeModules = [];

  for (const dep of currentDeps) {
    if (NATIVE_MODULES.includes(dep)) {
      // Check if this was in the last production build
      // For now, we'll flag any native module in the list
      // that might not be in the build
      newNativeModules.push(dep);
    }
  }

  return newNativeModules;
}

function runFingerprintCheck() {
  console.log("🔍 Checking fingerprint...\n");

  const result = spawnSync("node", ["scripts/check-fingerprint.js"], {
    cwd: PROJECT_ROOT,
    stdio: "inherit",
  });

  return result.status === 0;
}

function checkPackageJsonChanges() {
  console.log("📦 Checking for new native dependencies...\n");

  const stored = getStoredFingerprint();
  if (!stored) {
    console.error("❌ No .fingerprint file found!");
    console.error("   Cannot verify native dependencies.");
    console.error("   Run: pnpm fingerprint:update after a native build");
    return false;
  }

  // Get current package.json deps
  const packageJsonPath = path.join(PROJECT_ROOT, "package.json");
  const currentPackageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));
  const currentDeps = Object.keys(currentPackageJson.dependencies || {});

  // Check for known problematic native modules
  const problematicModules = currentDeps.filter(dep => NATIVE_MODULES.includes(dep));

  if (problematicModules.length > 0) {
    console.log("⚠️  Found native modules in dependencies:");
    for (const mod of problematicModules) {
      console.log(`   - ${mod}`);
    }
    console.log("");
    console.log("   These modules require a native build to work.");
    console.log("   Make sure they were included in the last production build.");
    console.log("");
  }

  return true;
}

function runEasUpdate(args) {
  console.log("\n🚀 Running EAS Update...\n");

  const result = spawnSync("npx", ["eas-cli@latest", "update", ...args], {
    cwd: PROJECT_ROOT,
    stdio: "inherit",
  });

  return result.status === 0;
}

async function main() {
  const args = process.argv.slice(2);

  // Check for --force flag
  const forceIndex = args.indexOf("--force");
  const force = forceIndex !== -1;
  if (force) {
    args.splice(forceIndex, 1);
  }

  console.log("╔════════════════════════════════════════════════════════╗");
  console.log("║           Safe EAS Update                              ║");
  console.log("║  Checks for native code changes before OTA update      ║");
  console.log("╚════════════════════════════════════════════════════════╝\n");

  // Load .env as fallback (EAS Secrets take precedence)
  loadEnvFallback();

  // Step 0: Verify required environment variables
  const requiredEnvVars = []; // StreamChat env vars removed - migration to Convex-native messaging complete
  const missingVars = requiredEnvVars.filter((v) => !process.env[v]);
  if (missingVars.length > 0) {
    console.error("❌ Missing required environment variables:");
    for (const v of missingVars) {
      console.error(`   - ${v}`);
    }
    console.error("");
    console.error("   Set these via EAS Secrets or in .env file:");
    console.error("   eas env:create --name VAR_NAME --value \"value\"");
    console.error("");
    process.exit(1);
  }
  console.log("✅ Required environment variables are set\n");

  // Step 1: Run fingerprint check
  const fingerprintOk = runFingerprintCheck();

  if (!fingerprintOk) {
    console.error("\n❌ Fingerprint check failed!");
    console.error("");
    console.error("   Native code has changed since the last build.");
    console.error("   You cannot push this as an OTA update.");
    console.error("");
    console.error("   Options:");
    console.error("   1. Create a new native build: eas build --platform all");
    console.error("   2. Revert the native code changes");
    console.error("   3. Use --force to skip this check (DANGEROUS!)");
    console.error("");

    if (!force) {
      process.exit(1);
    }
    console.log("⚠️  --force flag used, continuing anyway...\n");
  }

  // Step 2: Check for problematic native modules
  checkPackageJsonChanges();

  // Step 3: Run the actual EAS update
  if (args.length === 0) {
    console.error("❌ No arguments provided for eas update");
    console.error("   Usage: pnpm update:ota --branch production --message \"Your message\"");
    process.exit(1);
  }

  const success = runEasUpdate(args);

  if (!success) {
    console.error("\n❌ EAS Update failed!");
    process.exit(1);
  }

  console.log("\n✅ OTA update published successfully!");
}

main().catch((error) => {
  console.error("Error:", error);
  process.exit(1);
});
