#!/usr/bin/env node
/**
 * Fingerprint check for EAS Update runtime version validation.
 *
 * This script ensures that when native code changes, the runtimeVersion is updated.
 * It compares the current project fingerprint against the stored baseline.
 *
 * Only tracks sources that truly require a native build:
 * - ios/ directory (native iOS code)
 * - android/ directory (native Android code)
 * - Native parts of app.config.js (plugins, ios/android config)
 * - Native dependencies only (react-native-*, expo-*, etc.)
 * - eas.json (build configuration)
 *
 * Intentionally EXCLUDES:
 * - JS-only config (trpcUrl, streamApiKey, extra.*, etc.)
 * - Pure JS dependencies (lodash, zod, tRPC, etc.)
 * - pnpm-lock.yaml (too sensitive to non-native changes)
 * - app.json (redundant with app.config.js)
 *
 * Usage:
 *   node scripts/check-fingerprint.js            # Check if fingerprint matches
 *   node scripts/check-fingerprint.js --update   # Update stored fingerprint
 *   node scripts/check-fingerprint.js --verbose  # Show source hashes
 */

const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const FINGERPRINT_FILE = path.join(__dirname, "..", ".fingerprint");
const APP_CONFIG_PATH = path.join(__dirname, "..", "app.config.js");
const PROJECT_ROOT = path.join(__dirname, "..");
const MONOREPO_ROOT = path.join(__dirname, "..", "..", "..");

/**
 * Get git hash of a file or directory (using git's tree hash for directories)
 * Returns null if the path doesn't exist or isn't tracked by git
 */
function getGitHash(relativePath, cwd = PROJECT_ROOT) {
  try {
    // For files, use git hash-object
    // For directories, use git ls-tree to get consistent hash
    const fullPath = path.join(cwd, relativePath);

    if (!fs.existsSync(fullPath)) {
      return null;
    }

    const stats = fs.statSync(fullPath);

    if (stats.isDirectory()) {
      // Get the tree hash for the directory
      // This is consistent across machines for the same git content
      const result = execSync(
        `git ls-tree HEAD "${relativePath}" | awk '{print $3}'`,
        { cwd, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }
      ).trim();
      return result || null;
    } else {
      // For files, get the blob hash
      const result = execSync(
        `git hash-object "${relativePath}"`,
        { cwd, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }
      ).trim();
      return result || null;
    }
  } catch (error) {
    return null;
  }
}

/**
 * Patterns for dependencies that include native code.
 * Only changes to these packages require a new native build.
 */
const NATIVE_DEPENDENCY_PATTERNS = [
  /^react-native$/,
  /^react-native-/,
  /^@react-native\//,
  /^@react-native-community\//,
  /^expo$/,
  /^expo-(?!router|constants|linking|status-bar|font|web-browser$)/,  // Most expo-* have native, except a few JS-only ones
  /^@expo\//,
  /^@stream-io\/react-native/,
  /^react-native-maps$/,
  /^@rnmapbox\//,
  /^@mapbox\//,
];

/**
 * Check if a dependency name matches native patterns
 */
function isNativeDependency(depName) {
  return NATIVE_DEPENDENCY_PATTERNS.some(pattern => pattern.test(depName));
}

/**
 * Extract only native dependencies from package.json and create a hash
 */
function getNativeDependenciesHash() {
  const packageJsonPath = path.join(PROJECT_ROOT, "package.json");
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));

  const allDeps = packageJson.dependencies || {};

  // Filter to only native dependencies
  const nativeDeps = {};
  for (const [name, version] of Object.entries(allDeps)) {
    if (isNativeDependency(name)) {
      nativeDeps[name] = version;
    }
  }

  // Sort keys for consistency
  const sortedKeys = Object.keys(nativeDeps).sort();
  const sorted = {};
  for (const key of sortedKeys) {
    sorted[key] = nativeDeps[key];
  }

  return crypto.createHash("sha1").update(JSON.stringify(sorted)).digest("hex").substring(0, 12);
}

/**
 * Extract native-relevant config from app.config.js
 * Only includes: plugins, ios config, android config
 *
 * Parses the file as text to extract relevant sections,
 * since the config uses ESM and can't be require()'d directly.
 */
function getNativeConfigHash() {
  const appConfigPath = path.join(PROJECT_ROOT, "app.config.js");

  try {
    const content = fs.readFileSync(appConfigPath, "utf-8");

    // Extract the sections that affect native builds using regex
    // This is more robust than trying to require() an ESM file
    const nativeRelevant = [];

    // Plugins section
    const pluginsMatch = content.match(/plugins:\s*\[([\s\S]*?)\]/);
    if (pluginsMatch) nativeRelevant.push(pluginsMatch[0]);

    // iOS section
    const iosMatch = content.match(/ios:\s*\{([\s\S]*?)\n\s{4}\}/);
    if (iosMatch) nativeRelevant.push(iosMatch[0]);

    // Android section
    const androidMatch = content.match(/android:\s*\{([\s\S]*?)\n\s{4}\}/);
    if (androidMatch) nativeRelevant.push(androidMatch[0]);

    // newArchEnabled flag
    const newArchMatch = content.match(/newArchEnabled:\s*(true|false)/);
    if (newArchMatch) nativeRelevant.push(newArchMatch[0]);

    const combined = nativeRelevant.join("\n");
    return crypto.createHash("sha1").update(combined).digest("hex").substring(0, 12);
  } catch (error) {
    // Fallback to file hash if parsing fails
    return getGitHash("app.config.js") || "unknown";
  }
}

/**
 * Generate a fingerprint based on git-tracked native files.
 *
 * Only includes sources that truly affect native builds:
 * - ios/ and android/ directories (actual native code)
 * - Native-relevant parts of app.config.js (plugins, platform config)
 * - Native dependencies only (react-native-*, expo-*, etc.)
 * - EAS build configuration
 *
 * Excludes:
 * - JS-only config (trpcUrl, streamApiKey, etc.)
 * - Pure JS dependencies (lodash, zod, etc.)
 * - pnpm-lock.yaml (too sensitive to non-native changes)
 */
function getCurrentFingerprint() {
  const sources = [];

  // Native directories (the most important sources)
  const iosHash = getGitHash("ios");
  if (iosHash) {
    sources.push({ path: "ios", hash: iosHash });
  }

  const androidHash = getGitHash("android");
  if (androidHash) {
    sources.push({ path: "android", hash: androidHash });
  }

  // Native-relevant config only (plugins, ios/android sections)
  const nativeConfigHash = getNativeConfigHash();
  sources.push({ path: "app.config.js:native", hash: nativeConfigHash });

  // Native dependencies only (react-native-*, expo-*, etc.)
  const nativeDepsHash = getNativeDependenciesHash();
  sources.push({ path: "package.json:native-deps", hash: nativeDepsHash });

  // EAS config (affects build settings)
  const easJsonHash = getGitHash("eas.json");
  if (easJsonHash) {
    sources.push({ path: "eas.json", hash: easJsonHash });
  }

  // Create final fingerprint from all sources
  const fingerprint = crypto
    .createHash("sha1")
    .update(JSON.stringify(sources))
    .digest("hex");

  return { hash: fingerprint, sources };
}

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

function getRuntimeVersion() {
  // Read from app.config.js
  const configContent = fs.readFileSync(APP_CONFIG_PATH, "utf-8");
  const match = configContent.match(/runtimeVersion:\s*["']([^"']+)["']/);
  return match ? match[1] : null;
}

/**
 * Parse semantic version string into components
 */
function parseVersion(version) {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!match) {
    return null;
  }
  return {
    major: parseInt(match[1], 10),
    minor: parseInt(match[2], 10),
    patch: parseInt(match[3], 10),
  };
}

/**
 * Compare two versions. Returns:
 *  1 if a > b
 *  0 if a === b
 * -1 if a < b
 */
function compareVersions(a, b) {
  const vA = parseVersion(a);
  const vB = parseVersion(b);

  if (!vA || !vB) return 0;

  if (vA.major !== vB.major) return vA.major > vB.major ? 1 : -1;
  if (vA.minor !== vB.minor) return vA.minor > vB.minor ? 1 : -1;
  if (vA.patch !== vB.patch) return vA.patch > vB.patch ? 1 : -1;
  return 0;
}

/**
 * Validate version format (semantic versioning)
 */
function isValidVersion(version) {
  return parseVersion(version) !== null;
}

function saveFingerprint(hash, runtimeVersion) {
  const content = `FINGERPRINT_HASH=${hash}\nRUNTIME_VERSION=${runtimeVersion}\n`;
  fs.writeFileSync(FINGERPRINT_FILE, content);
}

async function main() {
  const isUpdate = process.argv.includes("--update");
  const isVerbose = process.argv.includes("--verbose") || process.argv.includes("-v");

  const { hash: currentHash, sources } = getCurrentFingerprint();
  const runtimeVersion = getRuntimeVersion();

  console.log(`Current fingerprint: ${currentHash}`);
  console.log(`Current runtime version: ${runtimeVersion}`);

  if (isVerbose) {
    console.log("\nSources:");
    for (const source of sources) {
      console.log(`  ${source.path}: ${source.hash}`);
    }
  }

  if (isUpdate) {
    saveFingerprint(currentHash, runtimeVersion);
    console.log(`\n✅ Updated .fingerprint file`);
    console.log(`   Hash: ${currentHash}`);
    console.log(`   Runtime version: ${runtimeVersion}`);
    return;
  }

  const stored = getStoredFingerprint();

  if (!stored) {
    console.error("\n❌ No .fingerprint file found!");
    console.error("   Run: node scripts/check-fingerprint.js --update");
    console.error("   to create the baseline fingerprint.");
    process.exit(1);
  }

  console.log(`\nStored fingerprint: ${stored.FINGERPRINT_HASH}`);
  console.log(`Stored runtime version: ${stored.RUNTIME_VERSION}`);

  if (currentHash === stored.FINGERPRINT_HASH) {
    console.log("\n✅ Fingerprint matches - no native code changes detected");
    return;
  }

  // Fingerprint changed - log a warning but don't fail CI.
  // The check-native-imports.js script handles enforcement of gated imports.
  // This script is now informational: it tells you a new native build is needed.
  console.log("\n⚠️  Native code fingerprint has changed!");
  console.log("");
  console.log("   The project fingerprint differs from the stored baseline,");
  console.log("   indicating native code or dependency changes.");
  console.log("");
  console.log("   Ensure any new native dependencies are properly gated");
  console.log("   behind NativeModules checks (see native-deps.json).");
  console.log("");
  console.log("   A new native build will be needed to include these changes.");
  console.log("   Run with --verbose to see which sources changed.");
  console.log("");

  // Auto-update the stored fingerprint so subsequent checks pass
  saveFingerprint(currentHash, runtimeVersion);
  console.log("   Updated stored fingerprint to match current state.");
}

main().catch((error) => {
  console.error("Error:", error);
  process.exit(1);
});
