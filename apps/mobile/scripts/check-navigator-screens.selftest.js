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

console.log(`✅ check-navigator-screens self-tests: ${passed}/6 passed`);
