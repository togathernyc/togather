/**
 * Self-tests for `scripts/check-navigator-screens.js`.
 *
 * The static check is enforced by CI; if its regex ever rots into being
 * permissive, we'd silently lose coverage for the "Maximum update depth
 * exceeded" navigator class of bugs. These tests run the script against
 * tiny synthetic _layout.tsx files in a tmp dir and assert it catches the
 * known anti-patterns and ignores known-safe forms.
 *
 * Plain Node + child_process so this runs without pulling jest into the
 * scripts/ tree.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const SCRIPT = path.join(__dirname, "check-navigator-screens.js");

function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nav-screens-test-"));
  const appRoot = path.join(root, "app");
  fs.mkdirSync(appRoot, { recursive: true });
  return { root, appRoot };
}

function writeLayout(appRoot, dir, contents) {
  const target = path.join(appRoot, dir);
  fs.mkdirSync(target, { recursive: true });
  fs.writeFileSync(path.join(target, "_layout.tsx"), contents, "utf-8");
}

function runCheck(root) {
  // Stage a copy of the script in the tmp project root so the script's
  // PROJECT_ROOT resolves to our synthetic project (it derives from
  // __dirname/..). We mirror the layout: scripts/check-navigator-screens.js
  // and app/<file>/_layout.tsx
  const stagedScripts = path.join(root, "scripts");
  fs.mkdirSync(stagedScripts, { recursive: true });
  fs.copyFileSync(SCRIPT, path.join(stagedScripts, "check-navigator-screens.js"));
  try {
    execFileSync(
      "node",
      [path.join(stagedScripts, "check-navigator-screens.js")],
      { stdio: "pipe", encoding: "utf-8" },
    );
    return { code: 0, stdout: "", stderr: "" };
  } catch (e) {
    return {
      code: e.status,
      stdout: e.stdout?.toString() ?? "",
      stderr: e.stderr?.toString() ?? "",
    };
  }
}

function assert(cond, msg) {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
  }
}

let passed = 0;

// ---------------------------------------------------------------------------
// 1. Always-on Screens are allowed.
// ---------------------------------------------------------------------------
{
  const { root, appRoot } = setup();
  writeLayout(
    appRoot,
    "ok",
    `import { Stack } from 'expo-router';
     export default function L() {
       return (
         <Stack>
           <Stack.Screen name="index" />
           <Stack.Screen name="info" />
         </Stack>
       );
     }`,
  );
  const result = runCheck(root);
  assert(result.code === 0, "Expected pass on unconditional screens, got fail");
  passed++;
}

// ---------------------------------------------------------------------------
// 2. Ternary-guarded Screen is rejected.
// ---------------------------------------------------------------------------
{
  const { root, appRoot } = setup();
  writeLayout(
    appRoot,
    "ternary",
    `import { Stack } from 'expo-router';
     export default function L({ flag }: any) {
       return (
         <Stack>
           <Stack.Screen name="index" />
           {flag ? <Stack.Screen name="conditional" /> : null}
         </Stack>
       );
     }`,
  );
  const result = runCheck(root);
  assert(
    result.code !== 0,
    "Expected fail on ternary-guarded screen, got pass",
  );
  assert(
    /ternary/i.test(result.stderr) || /\?/.test(result.stderr),
    `Expected stderr to mention the ternary; got: ${result.stderr}`,
  );
  passed++;
}

// ---------------------------------------------------------------------------
// 3. && -guarded Screen is rejected.
// ---------------------------------------------------------------------------
{
  const { root, appRoot } = setup();
  writeLayout(
    appRoot,
    "and",
    `import { Tabs } from 'expo-router';
     export default function L({ user }: any) {
       return (
         <Tabs>
           <Tabs.Screen name="home" />
           {user.isAdmin && <Tabs.Screen name="admin" />}
         </Tabs>
       );
     }`,
  );
  const result = runCheck(root);
  assert(result.code !== 0, "Expected fail on && -guarded screen, got pass");
  assert(
    result.stderr.includes("&&"),
    `Expected stderr to mention &&; got: ${result.stderr}`,
  );
  passed++;
}

// ---------------------------------------------------------------------------
// 4. options.href-null is allowed (registration is unconditional).
// ---------------------------------------------------------------------------
{
  const { root, appRoot } = setup();
  writeLayout(
    appRoot,
    "href-null",
    `import { Tabs } from 'expo-router';
     export default function L({ hasCommunity }: any) {
       return (
         <Tabs>
           <Tabs.Screen
             name="chat"
             options={{ href: hasCommunity ? '/(tabs)/chat' : null }}
           />
         </Tabs>
       );
     }`,
  );
  const result = runCheck(root);
  assert(
    result.code === 0,
    `Expected pass on href:null toggle (unconditional registration); got fail: ${result.stderr}`,
  );
  passed++;
}

// ---------------------------------------------------------------------------
// 5. Comments mentioning <Stack.Screen> are ignored.
// ---------------------------------------------------------------------------
{
  const { root, appRoot } = setup();
  writeLayout(
    appRoot,
    "commented",
    `import { Stack } from 'expo-router';
     export default function L() {
       // Don't write: cond ? <Stack.Screen ... /> : null — see the static check.
       /* Was previously: cond && <Stack.Screen name="x" /> */
       return (
         <Stack>
           <Stack.Screen name="index" />
         </Stack>
       );
     }`,
  );
  const result = runCheck(root);
  assert(
    result.code === 0,
    `Expected pass when violations are inside comments; got: ${result.stderr}`,
  );
  passed++;
}

// ---------------------------------------------------------------------------
// 6. Drawer.Screen is also covered (defensive — we don't use Drawer today,
//    but if/when someone adds one the same rule applies).
// ---------------------------------------------------------------------------
{
  const { root, appRoot } = setup();
  writeLayout(
    appRoot,
    "drawer",
    `import { Drawer } from 'expo-router/drawer';
     export default function L({ flag }: any) {
       return (
         <Drawer>
           <Drawer.Screen name="index" />
           {flag && <Drawer.Screen name="x" />}
         </Drawer>
       );
     }`,
  );
  const result = runCheck(root);
  assert(result.code !== 0, "Expected fail on guarded Drawer.Screen, got pass");
  passed++;
}

// ---------------------------------------------------------------------------
// 7. Parenthesized && — `{flag && (<Stack.Screen .../>)}` — must still fail.
//    Codex caught this gap on the initial PR; the immediate char before the
//    Screen tag is `(`, not the operator, so a naive preceding-char check
//    silently passes the conditional registration.
// ---------------------------------------------------------------------------
{
  const { root, appRoot } = setup();
  writeLayout(
    appRoot,
    "and-paren",
    `import { Stack } from 'expo-router';
     export default function L({ flag }: any) {
       return (
         <Stack>
           <Stack.Screen name="index" />
           {flag && (<Stack.Screen name="x" />)}
         </Stack>
       );
     }`,
  );
  const result = runCheck(root);
  assert(
    result.code !== 0,
    `Expected fail on parenthesized && Screen; got pass: ${result.stdout}`,
  );
  assert(
    result.stderr.includes("&&"),
    `Expected stderr to mention &&; got: ${result.stderr}`,
  );
  passed++;
}

// ---------------------------------------------------------------------------
// 8. Parenthesized ternary — `{flag ? (<Stack.Screen .../>) : null}` — fail.
// ---------------------------------------------------------------------------
{
  const { root, appRoot } = setup();
  writeLayout(
    appRoot,
    "ternary-paren",
    `import { Stack } from 'expo-router';
     export default function L({ flag }: any) {
       return (
         <Stack>
           <Stack.Screen name="index" />
           {flag ? (<Stack.Screen name="x" />) : null}
         </Stack>
       );
     }`,
  );
  const result = runCheck(root);
  assert(
    result.code !== 0,
    `Expected fail on parenthesized ternary Screen; got pass: ${result.stdout}`,
  );
  passed++;
}

// ---------------------------------------------------------------------------
// 9. Doubly-parenthesized — `{flag && ((<Stack.Screen .../>))}` — fail.
// ---------------------------------------------------------------------------
{
  const { root, appRoot } = setup();
  writeLayout(
    appRoot,
    "double-paren",
    `import { Stack } from 'expo-router';
     export default function L({ flag }: any) {
       return (
         <Stack>
           <Stack.Screen name="index" />
           {flag && ((<Stack.Screen name="x" />))}
         </Stack>
       );
     }`,
  );
  const result = runCheck(root);
  assert(
    result.code !== 0,
    `Expected fail on doubly-parenthesized && Screen; got pass: ${result.stdout}`,
  );
  passed++;
}

// ---------------------------------------------------------------------------
// 10. Bare grouping parens (no operator) are still allowed — guards against
//     over-broad paren-skipping.
// ---------------------------------------------------------------------------
{
  const { root, appRoot } = setup();
  writeLayout(
    appRoot,
    "bare-paren",
    `import { Stack } from 'expo-router';
     export default function L() {
       return (
         <Stack>
           {(<Stack.Screen name="index" />)}
         </Stack>
       );
     }`,
  );
  const result = runCheck(root);
  assert(
    result.code === 0,
    `Expected pass on bare-paren grouping (no operator); got fail: ${result.stderr}`,
  );
  passed++;
}

// ---------------------------------------------------------------------------
// 11. Empty-fragment wrapped — `{flag && (<><Stack.Screen .../></>)}` — fail.
//     Codex caught this as a bypass on the first round-trip fix. The token
//     immediately before `<Stack.Screen>` is `>` (from the `<>` opener),
//     not the operator, so the previous version returned null.
// ---------------------------------------------------------------------------
{
  const { root, appRoot } = setup();
  writeLayout(
    appRoot,
    "fragment",
    `import { Stack } from 'expo-router';
     export default function L({ flag }: any) {
       return (
         <Stack>
           <Stack.Screen name="index" />
           {flag && (<><Stack.Screen name="x" /></>)}
         </Stack>
       );
     }`,
  );
  const result = runCheck(root);
  assert(
    result.code !== 0,
    `Expected fail on fragment-wrapped && Screen; got pass: ${result.stdout}`,
  );
  passed++;
}

// ---------------------------------------------------------------------------
// 12. Named-Fragment wrapped — `{flag && <Fragment><Stack.Screen .../></Fragment>}` — fail.
// ---------------------------------------------------------------------------
{
  const { root, appRoot } = setup();
  writeLayout(
    appRoot,
    "named-fragment",
    `import { Stack } from 'expo-router';
     import { Fragment } from 'react';
     export default function L({ flag }: any) {
       return (
         <Stack>
           <Stack.Screen name="index" />
           {flag && <Fragment><Stack.Screen name="x" /></Fragment>}
         </Stack>
       );
     }`,
  );
  const result = runCheck(root);
  assert(
    result.code !== 0,
    `Expected fail on Fragment-wrapped && Screen; got pass: ${result.stdout}`,
  );
  passed++;
}

// ---------------------------------------------------------------------------
// 13. Namespaced-Fragment wrapped —
//     `{flag ? <React.Fragment><Stack.Screen .../></React.Fragment> : null}` — fail.
// ---------------------------------------------------------------------------
{
  const { root, appRoot } = setup();
  writeLayout(
    appRoot,
    "namespaced-fragment",
    `import { Stack } from 'expo-router';
     import * as React from 'react';
     export default function L({ flag }: any) {
       return (
         <Stack>
           <Stack.Screen name="index" />
           {flag ? <React.Fragment><Stack.Screen name="x" /></React.Fragment> : null}
         </Stack>
       );
     }`,
  );
  const result = runCheck(root);
  assert(
    result.code !== 0,
    `Expected fail on React.Fragment-wrapped ternary Screen; got pass: ${result.stdout}`,
  );
  passed++;
}

// ---------------------------------------------------------------------------
// 14. Sibling self-closed Screen does NOT trigger false positive when the
//     current Screen is unconditional. The previous self-closing `/>` of a
//     sibling should NOT be mistaken for a wrapping fragment.
// ---------------------------------------------------------------------------
{
  const { root, appRoot } = setup();
  writeLayout(
    appRoot,
    "siblings",
    `import { Stack } from 'expo-router';
     export default function L() {
       return (
         <Stack>
           <Stack.Screen name="a" />
           <Stack.Screen name="b" />
           <Stack.Screen name="c" />
         </Stack>
       );
     }`,
  );
  const result = runCheck(root);
  assert(
    result.code === 0,
    `Expected pass on unconditional sibling screens; got fail: ${result.stderr}`,
  );
  passed++;
}

console.log(`✅ check-navigator-screens self-tests: ${passed}/14 passed`);
