#!/usr/bin/env node
/**
 * TEMPORARY LOCAL COPY of gate #4 from @supa-media/native-safety's
 * `check-react-consistency` ("single native instance").
 *
 * The canonical implementation, with its test suite, lives in the framework
 * repo. This repo is on @supa-media/native-safety@1.1.0, which has gates #1-#3
 * only — so until that release lands this script runs the gate locally. Delete
 * it then and drop the `--importer` flag onto the existing
 * `npx check-react-consistency` step, exactly as #628 did for
 * check-react-consistency.js after #619 added it locally.
 *
 * Do NOT fix bugs here only — fix them upstream and re-sync (CLAUDE.md's
 * upstream-first rule).
 *
 * ---------------------------------------------------------------------------
 * What this catches (and why gate #1 can't)
 * ---------------------------------------------------------------------------
 * `pnpm-lock.yaml` holds TWO peer-keyed instances of react-native, and always
 * has — apps/mobile's, and the one the workspace-root `react-native` dependency
 * resolves:
 *
 *   react-native@0.81.5(@babel/core@7.29.0)(@types/react@19.1.17)(react@19.1.0)
 *   react-native@0.81.5(@babel/core@7.29.0)(react@19.1.0)
 *
 * Both are keyed `(react@19.1.0)`, so `check-react-consistency`'s gate #1 sees a
 * clean single-React graph and passes. What matters is WHICH instance the Expo
 * native chain points at. When a workspace re-resolution flips
 * `expo-modules-core` & friends onto the other one, pnpm materialises two
 * physical react-native copies in one bundle — two Fabric view/module registries.
 * expo-modules-core registers views into its copy while the app's components
 * resolve through the other, so `requireNativeViewManager('ExpoVideo','VideoView')`
 * returns undefined: chat video falls back to the download card and animated GIFs
 * render blank, while static images (no native view needed) keep working.
 *
 * That is exactly what #629 shipped — a dependency bump for the dev-assistant,
 * nothing to do with react-native, re-keyed nine Expo blocks. See ADR-013's
 * postmortem addendum.
 *
 * Usage:
 *   node scripts/check-native-instance.js --pkg package.json \
 *     --lockfile ../../pnpm-lock.yaml --importer apps/mobile \
 *     --config native-deps.json
 */

const fs = require("fs");
const path = require("path");

// Kept identical to @supa-media/native-safety's definitions.
const NATIVE_PREFIX = /^\/(@expo\/|@react-native\/|expo-|expo@|react-native-|react-native@)/;
const EXCLUDED_NAMES = new Set(["react-native-web"]);

/**
 * Dependency names whose resolved instance decides who owns the Fabric
 * view/module registry.
 */
const SHARED_NATIVE_RUNTIMES = ["react-native", "expo"];

function packageNameFromKey(key) {
  const body = key.slice(1);
  const m = body.match(/^(@[^/]+\/[^@]+|[^@]+)@/);
  return m ? m[1] : body;
}

function parseArgs(argv) {
  const args = { pkg: null, lockfile: null, importer: null, config: null };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--pkg") args.pkg = argv[++i];
    else if (argv[i] === "--lockfile") args.lockfile = argv[++i];
    else if (argv[i] === "--importer") args.importer = argv[++i];
    else if (argv[i] === "--config") args.config = argv[++i];
  }
  return args;
}

/** Native package names from native-deps.json (core + gated). */
function loadNativeDepNames(configPath) {
  if (!configPath) return new Set();
  const nd = JSON.parse(fs.readFileSync(configPath, "utf-8"));
  return new Set([...(nd.core || []), ...(nd.gated || [])]);
}

/**
 * Parse `packages:` entries into { key, deps }, reading ONLY each entry's real
 * `dependencies:` block — never `peerDependencies:`, which holds ranges (`'*'`).
 */
function parsePackageDependencies(lockLines) {
  const entries = [];
  let current = null;
  let section = null;

  for (const line of lockLines) {
    const keyMatch = line.match(/^ {2}(\/.+):$/);
    if (keyMatch) {
      current = { key: keyMatch[1], deps: {} };
      entries.push(current);
      section = null;
      continue;
    }
    if (!current) continue;

    const sectionMatch = line.match(/^ {4}(\w+):\s*$/);
    if (sectionMatch) {
      section = sectionMatch[1];
      continue;
    }
    if (/^ {4}\S/.test(line)) section = null;

    if (section === "dependencies") {
      const depMatch = line.match(/^ {6}('?[^':]+'?): (\S.*)$/);
      if (depMatch) current.deps[depMatch[1].replace(/'/g, "")] = depMatch[2];
    }
  }

  return entries;
}

/** Importer keys, scoped to the `importers:` section. */
function parseImporterKeys(lockLines) {
  const keys = new Set();
  let inImporters = false;
  for (const line of lockLines) {
    const topLevel = line.match(/^(\S+):/);
    if (topLevel) {
      inImporters = topLevel[1] === "importers";
      continue;
    }
    if (!inImporters) continue;
    const m = line.match(/^ {2}(\S+):$/);
    if (m) keys.add(m[1]);
  }
  return keys;
}

/** One importer's resolved dependency versions. */
function parseImporterVersions(lockLines, importerPath) {
  const out = {};
  let inImporters = false;
  let inTarget = false;
  let depName = null;

  for (const line of lockLines) {
    const topLevel = line.match(/^(\S+):/);
    if (topLevel) {
      inImporters = topLevel[1] === "importers";
      inTarget = false;
      depName = null;
      continue;
    }
    if (!inImporters) continue;

    const importerMatch = line.match(/^ {2}(\S+):$/);
    if (importerMatch) {
      inTarget = importerMatch[1] === importerPath;
      depName = null;
      continue;
    }
    if (!inTarget) continue;

    const nameMatch = line.match(/^ {6}'?([^':]+)'?:$/);
    if (nameMatch) {
      depName = nameMatch[1];
      continue;
    }
    const versionMatch = line.match(/^ {8}version: (\S.*)$/);
    if (versionMatch && depName) {
      out[depName] = versionMatch[1];
      depName = null;
    }
  }

  return out;
}

function main() {
  const args = parseArgs(process.argv);
  if (!args.pkg || !args.lockfile) {
    console.error("Error: --pkg and --lockfile are required.");
    process.exit(1);
  }

  const lockfilePath = path.resolve(args.lockfile);
  if (!fs.existsSync(lockfilePath)) {
    console.error(`❌ Lockfile not found at ${lockfilePath}`);
    process.exit(1);
  }

  const importerPath =
    args.importer ||
    path
      .relative(path.dirname(lockfilePath), path.dirname(path.resolve(args.pkg)))
      .split(path.sep)
      .join("/") ||
    ".";

  const lockLines = fs.readFileSync(lockfilePath, "utf-8").split("\n");
  const nativeDepNames = loadNativeDepNames(args.config ? path.resolve(args.config) : null);
  const importerKeys = parseImporterKeys(lockLines);

  // Fail closed: an anchor we can't find means the gate can't do its job, and a
  // guard that quietly passes in that state is the hole it exists to close.
  if (importerKeys.size === 0) {
    console.error("❌ Lockfile has no importers block — cannot anchor the comparison.");
    process.exit(1);
  }
  if (!importerKeys.has(importerPath)) {
    console.error(
      `❌ Importer "${importerPath}" is not in the lockfile. Available: ${[...importerKeys].sort().join(", ")}`
    );
    process.exit(1);
  }

  const appVersions = parseImporterVersions(lockLines, importerPath);
  const expected = {};
  for (const runtime of SHARED_NATIVE_RUNTIMES) {
    if (appVersions[runtime]) expected[runtime] = appVersions[runtime];
  }
  if (Object.keys(expected).length === 0) {
    console.error(
      `❌ Importer "${importerPath}" declares neither react-native nor expo — wrong --importer?`
    );
    process.exit(1);
  }

  const entries = parsePackageDependencies(lockLines);

  // Only SHARED packages (exactly one copy) are checked. A multi-copy package has
  // one copy per instance family, and each correctly points at its own family's
  // runtime (the workspace root's own expo, its @react-native/virtualized-lists,
  // a build-time second @expo/cli). Flagging those would fire on a healthy graph.
  const copies = new Map();
  for (const entry of entries) {
    const name = packageNameFromKey(entry.key);
    copies.set(name, (copies.get(name) || 0) + 1);
  }

  const offenders = [];
  for (const entry of entries) {
    const name = packageNameFromKey(entry.key);
    if (EXCLUDED_NAMES.has(name)) continue;
    if (!NATIVE_PREFIX.test(entry.key) && !nativeDepNames.has(name)) continue;
    if (copies.get(name) !== 1) continue;

    for (const runtime of SHARED_NATIVE_RUNTIMES) {
      const actual = entry.deps[runtime];
      if (!actual || !expected[runtime]) continue;
      if (actual !== expected[runtime]) offenders.push({ key: entry.key, runtime, actual });
    }
  }

  if (offenders.length === 0) {
    console.log(
      `✅ Native instance check passed — every shared native package resolves ${importerPath}'s react-native/expo instance.`
    );
    process.exit(0);
  }

  console.error(
    `\n❌ Split native graph — ${offenders.length} shared native package reference(s) resolve a different runtime instance than ${importerPath} does.\n`
  );
  console.error(
    "   pnpm will materialise two physical copies in one bundle, which means separate"
  );
  console.error(
    "   Fabric view/module registries: views registered by one copy are invisible to"
  );
  console.error(
    "   components resolving through the other. Chat video falls back to the download"
  );
  console.error(
    "   card and animated GIFs render blank on the installed binary (static images keep"
  );
  console.error(
    "   working), while typecheck, jest and the JS bundle all stay green. This is the"
  );
  console.error("   #629 regression — see ADR-013's postmortem addendum.\n");

  const byRuntime = new Map();
  for (const o of offenders) {
    if (!byRuntime.has(o.runtime)) byRuntime.set(o.runtime, []);
    byRuntime.get(o.runtime).push(o);
  }
  for (const [runtime, list] of byRuntime) {
    console.error(`   ${importerPath} resolves:`);
    console.error(`     ${runtime}: ${expected[runtime]}`);
    console.error("   but these shared native packages resolve:");
    for (const o of list) {
      console.error(`     ${o.key}`);
      console.error(`       ${runtime}: ${o.actual}`);
    }
    console.error("");
  }

  console.error("   How to fix:");
  console.error(
    "     Almost always fallout from a bare workspace-root `pnpm install` re-resolving"
  );
  console.error(
    "     the expo/react-native peer group — often in a PR unrelated to react-native."
  );
  console.error(
    "     Point the offending entries' dependency back at the app's instance above (a"
  );
  console.error(
    "     surgical lockfile edit), or redo the dependency change with a scoped"
  );
  console.error(
    "     `pnpm add <pkg> --filter mobile` so the group isn't disturbed. Do NOT paper"
  );
  console.error(
    "     over it with pnpm.overrides — that hides the split without collapsing the"
  );
  console.error("     duplicate copies.\n");

  process.exit(1);
}

main();
