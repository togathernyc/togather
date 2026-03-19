#!/usr/bin/env node
/**
 * CI enforcement: catch ungated static imports of native dependencies.
 *
 * Gated native deps must be imported dynamically behind a NativeModules
 * check (see fileTypes.ts and SafeLinearGradient.tsx for the pattern).
 * Static imports bypass that safety net and crash on older native builds.
 *
 * This script:
 * 1. Reads native-deps.json (core vs gated classification)
 * 2. Scans all .ts/.tsx source files for static imports of gated deps
 * 3. Checks that every native dep in package.json is classified
 * 4. Fails CI if violations are found
 *
 * See docs/architecture/ADR-013-mobile-versioning-and-ota-updates.md
 *
 * Usage:
 *   node scripts/check-native-imports.js
 */

const fs = require("fs");
const path = require("path");

const PROJECT_ROOT = path.join(__dirname, "..");

// Files that are allowed to use dynamic require() for gated deps
const ALLOWLISTED_FILES = new Set([
  // The gating utility itself
  "features/chat/utils/fileTypes.ts",
  // The safe wrapper components
  "components/ui/SafeLinearGradient.tsx",
  // Voice recorder (dynamic require of expo-av)
  "features/chat/hooks/useVoiceRecorder.ts",
  // VoiceRecorderBar (uses useVoiceRecorder, may trigger expo-av via preview)
  "features/chat/components/VoiceRecorderBar.tsx",
]);

/**
 * Patterns that match native dependency package names in package.json.
 * Used to detect new native deps that aren't classified yet.
 */
const NATIVE_PACKAGE_PATTERNS = [
  /^react-native$/,
  /^react-native-/,
  /^@react-native\//,
  /^@react-native-community\//,
  /^@react-native-picker\//,
  /^@react-native-async-storage\//,
  /^expo$/,
  /^expo-/,
  /^@expo\//,
  /^@sentry\/react-native/,
  /^@shopify\/flash-list/,
  /^@gorhom\/bottom-sheet/,
  /^@rnmapbox\//,
  /^@mapbox\//,
];

function isNativePackage(name) {
  return NATIVE_PACKAGE_PATTERNS.some((p) => p.test(name));
}

/**
 * Recursively find all .ts and .tsx files, skipping node_modules and hidden dirs
 */
function findSourceFiles(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || entry.name === "node_modules") continue;

    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      findSourceFiles(fullPath, files);
    } else if (/\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith(".d.ts")) {
      files.push(fullPath);
    }
  }
  return files;
}

function main() {
  // 1. Load config
  const configPath = path.join(PROJECT_ROOT, "native-deps.json");
  if (!fs.existsSync(configPath)) {
    console.error("❌ native-deps.json not found");
    process.exit(1);
  }

  const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
  const coreDeps = new Set(config.core);
  const gatedDeps = new Set(config.gated);
  const allClassified = new Set([...coreDeps, ...gatedDeps]);

  // 2. Check that all native deps in package.json are classified
  const packageJson = JSON.parse(
    fs.readFileSync(path.join(PROJECT_ROOT, "package.json"), "utf-8")
  );
  const allDeps = Object.keys(packageJson.dependencies || {});
  const nativeDeps = allDeps.filter(isNativePackage);

  const unclassified = nativeDeps.filter((dep) => !allClassified.has(dep));
  if (unclassified.length > 0) {
    console.error("❌ Unclassified native dependencies found in package.json:");
    console.error("");
    for (const dep of unclassified) {
      console.error(`   ${dep}`);
    }
    console.error("");
    console.error(
      "   Add each dependency to either 'core' or 'gated' in native-deps.json."
    );
    console.error(
      "   - core: present in the baseline native build (safe for static import)"
    );
    console.error(
      "   - gated: requires runtime NativeModules check before import"
    );
    console.error("");
    console.error(
      "   See docs/architecture/ADR-013-mobile-versioning-and-ota-updates.md"
    );
    process.exit(1);
  }

  // 3. Scan source files for static imports of gated deps
  const sourceFiles = findSourceFiles(PROJECT_ROOT);
  const violations = [];

  // Match: import ... from 'dep' or import ... from "dep" or import 'dep'
  // Also match: export ... from 'dep'
  const importRegex =
    /(?:import\s+(?:[\s\S]*?\s+from\s+)?|export\s+(?:[\s\S]*?\s+from\s+)?)['"]([^'"]+)['"]/g;

  for (const filePath of sourceFiles) {
    const relativePath = path.relative(PROJECT_ROOT, filePath);

    // Skip allowlisted files (they contain the gating logic itself)
    if (ALLOWLISTED_FILES.has(relativePath)) continue;

    const content = fs.readFileSync(filePath, "utf-8");
    let match;

    importRegex.lastIndex = 0;
    while ((match = importRegex.exec(content)) !== null) {
      const importedPackage = match[1];

      // Check if this is a static import of a gated dep
      if (gatedDeps.has(importedPackage)) {
        // Determine line number
        const beforeMatch = content.substring(0, match.index);
        const lineNumber = (beforeMatch.match(/\n/g) || []).length + 1;

        violations.push({
          file: relativePath,
          line: lineNumber,
          dep: importedPackage,
        });
      }
    }
  }

  if (violations.length > 0) {
    console.error("❌ Static imports of gated native dependencies found:\n");
    for (const v of violations) {
      console.error(`   ${v.file}:${v.line}`);
      console.error(`   Static import of: ${v.dep}\n`);
    }
    console.error(
      "   Gated native dependencies must be imported dynamically behind a"
    );
    console.error("   NativeModules check. Use the SafeLinearGradient pattern:\n");
    console.error("   1. Add a detection function in features/chat/utils/fileTypes.ts");
    console.error("   2. Use dynamic require() only when the native module exists");
    console.error("   3. Provide a fallback for when it's not available\n");
    console.error(
      "   See docs/architecture/ADR-013-mobile-versioning-and-ota-updates.md"
    );
    process.exit(1);
  }

  // All checks passed
  console.log("✅ Native import gating check passed");
  console.log(`   Scanned ${sourceFiles.length} source files`);
  console.log(`   Core deps: ${coreDeps.size}, Gated deps: ${gatedDeps.size}`);
}

main();
