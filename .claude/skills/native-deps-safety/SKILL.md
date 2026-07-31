---
name: native-deps-safety
description: MUST be read before adding, removing, or upgrading ANY dependency in apps/mobile or apps/convex (including `pnpm install`/`pnpm add`/`pnpm update`), before touching native media or native views (video, GIF, blur, any `expo-*` native view), and before changing `runtimeVersion`, `native-deps.json`, or the pnpm lockfile. Also read when debugging blank/broken video or GIF rendering on a device, a "second React" or native-instance CI failure, or a Fabric/ViewManagerAdapter crash. These bugs are invisible to typecheck, tests, and CI.
---

# Native Dependency Safety (Togather)

The hard rules are summarized in `CLAUDE.md`. This file is the full version:
the mechanisms, the war stories, and the exact CI guards. Read it in full before
you change anything in the mobile dependency graph or in native media code.

## Native Dependency Safety

- **Never bump `runtimeVersion`** — it must stay in sync with production native builds
- New native dependencies must be **gated** behind `NativeModules` runtime checks
- Add detection functions in `features/chat/utils/fileTypes.ts` (see `isLinearGradientSupported()`)
- Create safe wrapper components (see `components/ui/SafeLinearGradient.tsx`)
- Classify all native deps in `apps/mobile/native-deps.json` as `core` or `gated`
- CI enforces this via `scripts/check-native-imports.js` — static imports of gated deps fail
- See `docs/architecture/ADR-013-mobile-versioning-and-ota-updates.md` for full details

## JS Changes Can Break Native Rendering (read before touching deps or native media)

Learned the hard way from PRs #548 and #619 (see the postmortem in
`docs/architecture/ADR-013`). These bugs are **invisible to typecheck, tests,
and the JS bundle** (native modules are mocked; the bundle builds fine) and only
appear on a real device — so CI cannot catch them. Rules:

- **NEVER add a web-only React UI/CSS-in-JS library to `apps/mobile`** — MUI,
  `@emotion/*`, `@material-ui/*`, `styled-components`, `react-datepicker`, etc.
  Even when imported only from a `.web.tsx` file, its mere presence in the mobile
  package pulls a **second React** into the shared pnpm lockfile (via
  `autoInstallPeers`) and re-keys the Expo native-module graph
  (`expo-modules-core`, `react-native`) to that React. On the installed native
  binary this **breaks native Fabric rendering — video and animated GIFs render
  blank**. A `pnpm.overrides` React pin does NOT save you (MUI/react-datepicker
  broke it even pinned). Web-only UI must be **dependency-free** (a native
  `<input>`) — do not reach for a component library.
- **CI guard:** `check-react-consistency` (from `@supa-media/native-safety`, run
  via `npx check-react-consistency --pkg package.json --lockfile
  ../../pnpm-lock.yaml --config native-deps.json` in `apps/mobile`'s CI job)
  fails a PR if a second React is keyed onto any native package, or if a
  denylisted lib enters `apps/mobile`. Do not weaken or remove it. If a
  `<second React>` shows up, find and remove the offending dependency — do not
  paper over it with an override.
- **`pnpm install` can itself trigger a false second-React** even when adding a
  totally unrelated devDependency with no relation to React/Expo — pnpm's peer
  dedup for the expo/react-native chain is order-sensitive, and a full
  workspace-root `pnpm install` re-resolution can non-deterministically re-key
  `expo`/`expo-modules-core`/`react-native` etc. onto a second React version
  that already exists elsewhere in the graph (e.g. the one `react-native-web`
  legitimately uses). **Use a scoped `pnpm add -D <pkg> --filter mobile`** (or
  `--filter <workspace>`) instead of a bare `pnpm install` when adding a new
  dependency — it resolves surgically and doesn't disturb this dedup group.
  Always run `check-react-consistency` **and**
  `node scripts/check-native-instance.js` after any dependency change to confirm.
- **A second React VERSION is not the only way to break the native graph — a
  second react-native/expo INSTANCE does it too, and gate #1 can't see it.** The
  lockfile permanently holds two peer-keyed `react-native` instances (apps/mobile's
  `(@types/react@19.1.17)(react@19.1.0)` and the workspace root's plain
  `(react@19.1.0)`). Both are `react@19.1.0`, so `check-react-consistency`
  passes either way. What breaks native rendering is the Expo chain
  (`expo-modules-core`, `expo-asset`, `expo-constants`, `expo-file-system`,
  `expo-font`, …) pointing at the root instance instead of apps/mobile's: two
  physical copies, two Fabric registries, video → download card and GIFs blank.
  #629 shipped exactly this while bumping the **dev-assistant** — a package with
  no relation to react-native. **CI enforces it now:** the `Check native
  instance` step in `ci.yml` (`scripts/check-native-instance.js`, gate #4 of
  native-safety's `check-react-consistency` upstream) fails the PR. Fix a split
  by re-pointing the offending lockfile entries at apps/mobile's instance — never
  with `pnpm.overrides`, which can collapse the keys while leaving two copies
  installed.
- **Date a native regression by the production OTA history, not `git log`.** #629
  merged 2026-07-17 but only reached users with the 2026-07-27 production deploy,
  so video "worked for two weeks" after the previous fix. Bisect deploys, not
  commits.
- **The `react: "19.1.0"` AND `react-dom: "19.1.0"` devDependency pins in
  `apps/convex/package.json` are load-bearing — do not remove either, and keep
  them the same exact version.** `apps/convex` ships no React code, but
  without the react pin, `@react-email/components`' react range pulls
  `react@19.2.4` and pnpm keys a SECOND peer-keyed `convex` instance onto it;
  the `@supa-media/dev-assistant` re-exports then resolve against the wrong
  `convex` copy and Convex's type machinery silently drops every re-exported
  function from the generated `api`/`internal` types (the mount smoke test
  `__tests__/devAssistant-mount.test.ts` is the CI backstop for this). The
  react-dom pin exists because the react pin alone re-keys the react-email
  tree onto react@19.1.0 while react-dom — if left undeclared — is
  auto-installed as a transitive peer at the latest in-range version, and
  react-dom/server hard-errors at render time on any react/react-dom version
  skew (React 19's `ensureCorrectIsomorphicReactVersion` — present in 19.1.0's
  server builds too). That skew shipped once: verification emails (the one
  backend path that executes react-dom, via `@react-email/render` in
  `functions/auth/emailOtp.ts`) threw in production while all of CI stayed
  green. Backstop: `__tests__/email-render.test.ts` renders the real template
  through the real react-dom, so a skew fails CI. (A static lockfile gate for
  `react-dom@X(react@Y)` pairs lands in `@supa-media/native-safety` 1.2.0;
  this repo is on 1.1.0 — until that's released and bumped, the render test
  is the only guard.)
- **Native Fabric view crashes cascade.** When an Expo native *view* crashes
  (e.g. `ViewManagerAdapter_ExpoVideo_VideoView … must be a function (received
  undefined)`), it corrupts the Fabric view registry and **breaks other native
  rendering too** — a crashing chat video will blank out the RSVP GIF. **"Video
  and GIF break together" is this signature**, not two separate bugs.
- **Do not attach effects/listeners to a native view's player/lifecycle
  casually.** A `player.addListener('sourceLoad', …)` effect added to
  `ExpoVideoPlayer` (to read dimensions for aspect ratio) *deterministically
  crashed* the native `VideoView`. Prefer prop-only changes (e.g. `contentFit`)
  for native video views.
- **Any change touching native media/views (video, GIF, blur, `expo-*` native
  views) or the mobile dependency graph MUST be verified on a real device /
  staging OTA before merging** — CI is blind to it. See ADR-030 (native media
  smoke test). When debugging a suspected regression, **bisect OTA bundles on a
  device** (`eas update:republish` / dispatch `deploy-mobile-update.yml` on a
  branch) and **change one variable at a time** — do not stack multiple fixes.
