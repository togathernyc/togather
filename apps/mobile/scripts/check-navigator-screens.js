#!/usr/bin/env node
/**
 * CI enforcement: catch conditional `<Stack.Screen>` / `<Tabs.Screen>` /
 * `<Drawer.Screen>` registrations.
 *
 * # Why this exists
 *
 * In React Navigation v7 (and Expo Router on top of it), each navigator
 * derives `state.routeNames` from the children of `<Stack>` / `<Tabs>` /
 * etc. on every render. `BaseNavigationContainer` runs an effect on
 * commit that compares the previous `routeNames` with the new one. If the
 * set is different — even by one entry, even briefly — it dispatches a
 * state update via `getStateForRouteNamesChange`. That update re-renders
 * the navigator, which produces yet another `routeNames` set. If the
 * children oscillate between renders, the loop never settles and React
 * trips its update-depth ceiling:
 *
 *     "Maximum update depth exceeded. This can happen when a component
 *     repeatedly calls setState inside componentWillUpdate or
 *     componentDidUpdate. React limits the number of nested updates to
 *     prevent infinite loops."
 *
 * That signature has hit our users 100+ times in the last 30 days
 * (Sentry: project supa-media/react-native, group 7450457026 + 13 sibling
 * groups; first identified as a chat-header bug in PR #355, recurred via
 * the DM photo-gate path on 2026-04-29). Every recurrence has been a
 * different setState site at the leaves; the underlying fragility is the
 * navigator's intolerance to children churn.
 *
 * # The rule
 *
 * Inside any `_layout.tsx` (Expo Router treats them as the navigator's
 * children root), every `<Stack.Screen>` / `<Tabs.Screen>` /
 * `<Drawer.Screen>` must be an unconditional sibling. If a screen needs
 * to be hidden, use `options={{ href: null }}` or render the SCREEN body
 * conditionally. Do NOT toggle the registration itself.
 *
 * Anti-patterns this script catches:
 *
 *   - `condition ? <Stack.Screen ... /> : null`
 *   - `condition && <Stack.Screen ... />`
 *   - `<>{condition && <Stack.Screen ... />}</>`
 *
 * Allowed:
 *
 *   - Always-present `<Stack.Screen name="x" />`
 *   - `<Stack.Screen name="x" options={{ href: condition ? "..." : null }} />`
 *     (the registration is unconditional; only the visibility toggles).
 *
 * # When to add an exemption
 *
 * If you genuinely need a conditional registration AND can prove the
 * condition is monotonic (only ever flips from off→on once per app
 * lifetime, e.g. a feature flag that resolves once at boot), add the file
 * path to ALLOWLISTED_FILES below with a one-line rationale.
 *
 * Usage: node scripts/check-navigator-screens.js
 */

const fs = require("fs");
const path = require("path");

const PROJECT_ROOT = path.join(__dirname, "..");
const APP_ROOT = path.join(PROJECT_ROOT, "app");

/**
 * Files where conditional Screen registration is allowed. Add a one-line
 * rationale next to each entry — future maintainers should be able to
 * understand why this case is safe without git-archaeology.
 */
const ALLOWLISTED_FILES = new Set([
  // (no exemptions yet — keep it that way)
]);

function findLayoutFiles(dir, files = []) {
  if (!fs.existsSync(dir)) return files;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      findLayoutFiles(fullPath, files);
    } else if (entry.name === "_layout.tsx" || entry.name === "_layout.jsx") {
      files.push(fullPath);
    }
  }
  return files;
}

/**
 * Strip block comments and line comments so they don't produce false
 * positives. Keeps newlines so reported line numbers stay accurate.
 */
function stripComments(source) {
  // Block comments — replace with same-length whitespace preserving newlines
  let out = source.replace(/\/\*[\s\S]*?\*\//g, (match) =>
    match.replace(/[^\n]/g, " "),
  );
  // Line comments — replace from `//` to end of line with spaces
  out = out.replace(/\/\/[^\n]*/g, (match) => match.replace(/./g, " "));
  return out;
}

const SCREEN_TAG_RE =
  /<\s*(Stack|Tabs|Drawer|MaterialTopTabs|NativeStack)\s*\.\s*Screen\b/g;

/**
 * For a screen-tag match at index `idx` in source `code`, walk backwards
 * past transparent JSX scaffolding (whitespace, parentheses, and
 * attribute-less opening tags like `<>` / `<Fragment>` / `<React.Fragment>`)
 * and check whether the next token is a conditional operator (`?`, `&&`,
 * `||`). Returns the operator if found, else null.
 *
 * Why we keep extending this:
 * - Initial version only checked the immediately preceding char. Missed
 *   `{flag && (<Stack.Screen .../>)}` (codex P2).
 * - Paren-skip added. Missed `{flag && (<><Stack.Screen .../></>)}` —
 *   fragment-wrapped (codex P2 again).
 * - Now: skip past attribute-less opening tags too, which catches
 *   fragment-wrapped registrations and simple `<Container>` wrappers.
 *
 * Limit of the heuristic: tags WITH attributes (`<View style={x}><Stack.
 * Screen/></View>`) are not skipped — the regex stops at `}` / `=` /
 * quotes inside the tag. If codex finds a bypass through attribute-bearing
 * wrappers, switch to a TypeScript JSX AST instead of regex.
 */
function findGuardingOperator(code, idx) {
  let i = idx - 1;
  while (i >= 0) {
    const c = code[i];
    // Skip whitespace and opening parens.
    if (/\s/.test(c) || c === "(") {
      i--;
      continue;
    }
    // Skip an attribute-less opening tag of the form `<>` or `<Identifier>`
    // (Identifier can include dots for namespaces, like `<React.Fragment>`).
    // We require attribute-less so we don't accidentally skip past complex
    // wrappers and over-flag.
    if (c === ">") {
      let j = i - 1;
      while (j >= 0 && /[A-Za-z0-9_$.]/.test(code[j])) j--;
      if (j >= 0 && code[j] === "<") {
        i = j - 1;
        continue;
      }
    }
    break;
  }
  if (i < 1) return null;
  const two = code.slice(i - 1, i + 1);
  const one = code[i];
  if (two === "&&") return "&&";
  if (two === "||") return "||";
  if (one === "?") return "?";
  return null;
}

function checkFile(filePath) {
  const relativePath = path.relative(PROJECT_ROOT, filePath);
  if (ALLOWLISTED_FILES.has(relativePath)) return [];

  const raw = fs.readFileSync(filePath, "utf-8");
  const code = stripComments(raw);
  const violations = [];

  let match;
  SCREEN_TAG_RE.lastIndex = 0;
  while ((match = SCREEN_TAG_RE.exec(code)) !== null) {
    const op = findGuardingOperator(code, match.index);
    if (op !== null) {
      const before = code.substring(0, match.index);
      const lineNumber = (before.match(/\n/g) || []).length + 1;
      violations.push({
        file: relativePath,
        line: lineNumber,
        operator: op,
        navigator: match[1],
      });
    }
  }

  return violations;
}

function main() {
  const layoutFiles = findLayoutFiles(APP_ROOT);
  const violations = [];

  for (const file of layoutFiles) {
    violations.push(...checkFile(file));
  }

  if (violations.length > 0) {
    console.error(
      "❌ Conditional <Stack.Screen> / <Tabs.Screen> registration detected:\n",
    );
    for (const v of violations) {
      const opName = v.operator === "?" ? "ternary" : `${v.operator}`;
      console.error(`   ${v.file}:${v.line}`);
      console.error(
        `   <${v.navigator}.Screen> guarded by ${opName} — registration must be unconditional.\n`,
      );
    }
    console.error(
      "   React Navigation's BaseNavigationContainer reacts to children\n" +
        "   churn by dispatching getStateForRouteNamesChange, which can loop\n" +
        "   into 'Maximum update depth exceeded'. To hide a route from the\n" +
        "   tab bar, use `options={{ href: null }}` instead of conditionally\n" +
        "   rendering the Screen.\n\n" +
        "   See scripts/check-navigator-screens.js for full background.",
    );
    process.exit(1);
  }

  console.log("✅ Navigator screen registration check passed");
  console.log(`   Scanned ${layoutFiles.length} _layout.tsx files`);
}

main();
