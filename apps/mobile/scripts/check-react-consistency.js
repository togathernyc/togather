#!/usr/bin/env node
/**
 * CI enforcement: keep the mobile native React graph healthy. Two gates:
 *
 *   1. Single-React check — no second/mismatched React in the native module
 *      graph (see the long note below).
 *   2. Native-unsafe dependency denylist — apps/mobile must not depend on
 *      emotion / CSS-in-JS / MUI libraries, which reshape the mobile
 *      React/module graph and break native Fabric rendering even when they are
 *      only imported on web (this is the mechanism behind gate #1's failure —
 *      see the #548 native-media regression).
 *
 * Both gates run every time; the script exits 1 if EITHER fails, and prints a
 * combined OK line only when BOTH pass.
 *
 * CI enforcement: keep a SINGLE React version in the mobile native graph.
 *
 * Why this exists
 * ---------------
 * The mobile app pins `react` to the exact version baked into the installed
 * native binary (apps/mobile/package.json -> dependencies.react, e.g. 19.1.0).
 * Expo/React-Native native modules (expo-modules-core, react-native, the
 * expo-* / @react-native/* packages, etc.) register Fabric views/modules
 * against that React. If a SECOND React sneaks into the shared pnpm lockfile
 * and re-keys those native packages (e.g.
 * `/expo-modules-core@3.0.29(react-native@0.81.5)(react@19.2.7)` instead of
 * `(react@19.1.0)`), Fabric view/module registration breaks AT RUNTIME on the
 * native binary — native video and animated GIFs render blank — while
 * typecheck, tests and the JS bundle all pass (tests mock native modules; JS
 * bundles fine). That is exactly the regression PR #548 shipped: adding
 * @mui/* + @emotion/* for a web datepicker made pnpm's autoInstallPeers pull a
 * second React into the graph.
 *
 * What this checks
 * ----------------
 * Reads the repo-root pnpm-lock.yaml, finds every Expo/React-Native native
 * package entry, and collects the set of `(react@X)` peer versions keyed onto
 * them. That set must be EXACTLY {PINNED}, where PINNED is the `react`
 * specifier from apps/mobile/package.json. Any native package keyed to a
 * different React fails the check.
 *
 * `react-native-web` is intentionally excluded: it is the browser render shim
 * (runs on web, not on the native binary), and it legitimately rides the web
 * React (e.g. 19.2.4). Only React versions keyed onto packages that run on the
 * NATIVE binary matter here.
 *
 * Usage:
 *   node scripts/check-react-consistency.js
 */

const fs = require("fs");
const path = require("path");

const LOCKFILE_PATH = path.join(__dirname, "..", "..", "..", "pnpm-lock.yaml");
const MOBILE_PKG_PATH = path.join(__dirname, "..", "package.json");
const NATIVE_DEPS_PATH = path.join(__dirname, "..", "native-deps.json");

/**
 * Authoritative set of native package NAMES from native-deps.json (core +
 * gated). This covers scoped native packages the NATIVE_PREFIX regex can't
 * express — e.g. @react-native-community/datetimepicker, @react-native-picker/
 * picker, @gorhom/bottom-sheet, @shopify/flash-list, @sentry/react-native — so
 * a second React re-keying any of them is also caught.
 */
function loadNativeDepNames() {
  try {
    const nd = JSON.parse(fs.readFileSync(NATIVE_DEPS_PATH, "utf-8"));
    return new Set([...(nd.core || []), ...(nd.gated || [])]);
  } catch {
    return new Set();
  }
}
const NATIVE_DEP_NAMES = loadNativeDepNames();

/**
 * Package NAME prefixes that identify Expo/React-Native native packages —
 * the ones that register Fabric views/modules against React on the native
 * binary. Applied to the leading-slash lockfile key (e.g. "/expo-modules-core@...").
 */
const NATIVE_PREFIX = /^\/(@expo\/|@react-native\/|expo-|expo@|react-native-|react-native@)/;

/**
 * Native-prefixed packages that do NOT run on the native binary and so must be
 * exempt from the single-React rule. `react-native-web` is the web render shim
 * and legitimately rides the web React (e.g. 19.2.4).
 */
const EXCLUDED_NAMES = new Set(["react-native-web"]);

/** Extract the package name from a lockfile key like "/@expo/foo@1.2.3(peer@x):". */
function packageNameFromKey(key) {
  // key begins with "/"; strip it, then take the name up to the version "@".
  const body = key.slice(1);
  const m = body.match(/^(@[^/]+\/[^@]+|[^@]+)@/);
  return m ? m[1] : body;
}

/**
 * Native-unsafe dependency denylist (Gate #2).
 *
 * Each entry is a package-NAME prefix. Any package in apps/mobile
 * `dependencies` or `devDependencies` whose name starts with one of these is a
 * hard failure. These are emotion / CSS-in-JS / MUI-family libraries: they pull
 * their own React (via pnpm's autoInstallPeers) and reshape the shared
 * React/module graph, which breaks native Fabric view/module registration —
 * native video and animated GIFs render blank on the installed binary — even
 * when the library is only ever imported on web. This is exactly what PR #548
 * shipped (adding @mui/* + @emotion/* for a web datepicker).
 *
 * `react-native-web` is intentionally NOT here: it is the legitimate web render
 * shim and is used throughout the app.
 */
const NATIVE_UNSAFE_DENYLIST = [
  "@mui/",
  "@emotion/",
  "@material-ui/",
  "styled-components",
];

/**
 * Gate #2: fail if apps/mobile depends on any native-unsafe (emotion/MUI/
 * CSS-in-JS) package. Returns true when clean, false when an offender is found.
 */
function checkNativeUnsafeDenylist(mobilePkg) {
  const allDeps = {
    ...(mobilePkg.dependencies || {}),
    ...(mobilePkg.devDependencies || {}),
  };

  const offenders = Object.keys(allDeps)
    .filter((name) =>
      NATIVE_UNSAFE_DENYLIST.some((prefix) =>
        prefix.endsWith("/") ? name.startsWith(prefix) : name === prefix || name.startsWith(prefix)
      )
    )
    .sort();

  if (offenders.length === 0) {
    console.log(
      `✅ Native-unsafe denylist check passed — no emotion/MUI/CSS-in-JS packages in apps/mobile.`
    );
    return true;
  }

  console.error(
    "❌ Native-unsafe dependency in apps/mobile/package.json.\n"
  );
  console.error("   These packages are on the native-unsafe denylist:\n");
  for (const name of offenders) {
    console.error(`   • ${name}  (${allDeps[name]})`);
  }
  console.error("");
  console.error(
    "   Why this is blocked: emotion / CSS-in-JS / MUI-family libraries pull"
  );
  console.error(
    "   their own React in via pnpm's autoInstallPeers and reshape the mobile"
  );
  console.error(
    "   React/module graph. That breaks native Fabric view/module registration"
  );
  console.error(
    "   on the installed binary — native video and animated GIFs render blank —"
  );
  console.error(
    "   even when the library is imported ONLY on web. This is the exact"
  );
  console.error(
    "   #548 native-media regression (@mui/* + @emotion/* added for a web"
  );
  console.error("   datepicker).\n");
  console.error("   How to fix:");
  console.error(
    "     • Web-only date/UI needs should use a dependency-free approach or a"
  );
  console.error(
    "       library WITHOUT emotion (e.g. react-datepicker for a web datepicker)."
  );
  console.error(
    "     • If one of these packages is genuinely, unavoidably required, it must"
  );
  console.error(
    "       be justified in review and this denylist (NATIVE_UNSAFE_DENYLIST in"
  );
  console.error(
    "       scripts/check-react-consistency.js) updated deliberately — do not"
  );
  console.error(
    "       silently remove the guard.\n"
  );
  return false;
}

/** Gate #1: single React in the native graph. Returns true when clean. */
function checkReactConsistency(mobilePkg) {
  // 1. Determine the pinned React version from the mobile package.json.
  const pinned =
    mobilePkg.dependencies && mobilePkg.dependencies.react;
  if (!pinned) {
    console.error(
      "❌ Could not read dependencies.react from apps/mobile/package.json"
    );
    process.exit(1);
  }

  // 2. Read the shared lockfile.
  if (!fs.existsSync(LOCKFILE_PATH)) {
    console.error(`❌ Lockfile not found at ${LOCKFILE_PATH}`);
    process.exit(1);
  }
  const lockLines = fs.readFileSync(LOCKFILE_PATH, "utf-8").split("\n");

  // 3. Scan every package entry key. Package keys live at 2-space indent under
  //    `packages:` and look like `  /pkg@version(peerA@x)(peerB@y):`. The
  //    `(react@X)` we care about is a real react peer — the `(` must sit
  //    immediately before `react@`, which excludes `(@types/react@X)`.
  const offenders = []; // { name, key, react }
  const nativeReactVersions = new Set();

  for (const line of lockLines) {
    const keyMatch = line.match(/^ {2}(\/.+):$/);
    if (!keyMatch) continue;
    const key = keyMatch[1];

    const name = packageNameFromKey(key);
    if (EXCLUDED_NAMES.has(name)) continue;

    // A package counts as native if its key matches the Expo/RN prefix OR its
    // name is classified native in native-deps.json (catches scoped packages
    // like @react-native-community/*, @gorhom/bottom-sheet, @shopify/flash-list).
    if (!NATIVE_PREFIX.test(key) && !NATIVE_DEP_NAMES.has(name)) continue;

    // Real react peer only: "(" immediately before "react@" (not "@types/react@").
    const peerMatch = key.match(/\(react@([0-9][^)]*)\)/);
    if (!peerMatch) continue;

    const reactVersion = peerMatch[1];
    nativeReactVersions.add(reactVersion);
    if (reactVersion !== pinned) {
      offenders.push({ name, key, react: reactVersion });
    }
  }

  // 4. Assert the native-graph React set is exactly {PINNED}.
  if (offenders.length > 0) {
    console.error(
      "❌ Mismatched React version(s) in the mobile NATIVE module graph.\n"
    );
    console.error(
      `   The mobile app pins react@${pinned} to match the installed native binary,`
    );
    console.error(
      "   but these Expo/React-Native native packages are keyed to a DIFFERENT React:\n"
    );
    for (const o of offenders) {
      console.error(`   • ${o.name}  ->  react@${o.react}`);
      console.error(`       ${o.key}`);
    }
    console.error("");
    console.error(
      `   A second/mismatched React (${[...nativeReactVersions]
        .filter((v) => v !== pinned)
        .join(", ")}) entered the native graph — almost always because a newly`
    );
    console.error(
      "   added React-based dependency (e.g. MUI / @emotion, or another web-only"
    );
    console.error(
      "   React lib) dragged its own React in via pnpm's autoInstallPeers, which"
    );
    console.error(
      "   then re-keyed the Expo native-module graph. On the installed native"
    );
    console.error(
      "   binary this breaks Fabric view/module registration (native video and"
    );
    console.error(
      "   animated GIFs render blank) even though typecheck, tests and the JS"
    );
    console.error(
      "   bundle all pass. This is the exact class of failure PR #548 shipped.\n"
    );
    console.error("   How to fix:");
    console.error(
      "     1. Identify the newly added React-based dependency (check the PR's"
    );
    console.error(
      "        apps/mobile/package.json diff) and remove or isolate it, OR"
    );
    console.error(
      `     2. Pin React in the root package.json pnpm.overrides:`
    );
    console.error(
      `          "pnpm": { "overrides": { "react": "${pinned}", "react-dom": "${pinned}" } }`
    );
    console.error(
      "        then re-run `pnpm install` and commit the updated pnpm-lock.yaml.\n"
    );
    return false;
  }

  // Success.
  const versionsSeen =
    nativeReactVersions.size > 0 ? [...nativeReactVersions].join(", ") : pinned;
  console.log(
    `✅ React consistency check passed — native graph uses a single React (react@${versionsSeen}), matching the pinned react@${pinned}.`
  );
  return true;
}

function main() {
  const mobilePkg = JSON.parse(fs.readFileSync(MOBILE_PKG_PATH, "utf-8"));

  // Run BOTH gates (don't short-circuit — report every failure in one pass).
  const reactOk = checkReactConsistency(mobilePkg);
  const denylistOk = checkNativeUnsafeDenylist(mobilePkg);

  if (!reactOk || !denylistOk) {
    process.exit(1);
  }

  console.log(
    "\n✅ Native React graph OK — single React + no native-unsafe dependencies."
  );
  process.exit(0);
}

main();
