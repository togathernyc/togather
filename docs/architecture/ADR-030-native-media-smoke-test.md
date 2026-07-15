# ADR-030: Native Media Smoke Test

## Status
Proposed

> Full incident writeup: ADR-013 §"Postmortem: #548 / #619 native-media regression (2026-07)".

## Context

PR #548 added `@mui/*` + `@emotion/*` to `apps/mobile` for a **web-only**
datepicker. Those emotion/CSS-in-JS packages pulled a second React into the
shared pnpm graph (via `autoInstallPeers`) and re-keyed the Expo native-module
graph. On the installed native binary this broke Fabric view/module
registration: **chat video attachments and animated GIFs rendered blank**.

The regression shipped because **nothing in per-PR CI exercises native
rendering**:

- **Typecheck** passes — the JS types are unchanged.
- **Jest** passes — `jest-expo` MOCKS every native module (`expo-video`,
  `expo-av`, image/Fabric views). A test can render `VideoPlayer` and see the
  "correct" tier selected while, on the real binary, that same tier's native
  view fails to register and shows nothing.
- **Web E2E / Metro bundle** pass — web uses HTML5 `<video>` and DOM `<img>`,
  never Fabric. The web surface renders fine while native is broken.

We already added two static guards (see ADR-013 and
`scripts/check-react-consistency.js`). Those catch the *known mechanism* (a
second React / a denylisted library). They cannot catch a **novel** mechanism
that breaks native rendering without tripping either heuristic. The only thing
that reliably catches "a JS change broke native rendering" is **driving the real
app on a real native build** and looking at the pixels.

## Decision

Add a scheduled / pre-release **native media smoke test** that runs the real app
on a simulator against an EAS dev build and asserts that native media actually
renders (non-blank). This is layer 3 of the defense (see ADR-013 §"Guarding
against JS changes that break native rendering").

### What it must cover

1. **Chat video renders inline.** Open a chat channel that contains a `.mp4`
   video attachment. Assert the inline `VideoView` (expo-video tier) — or the
   WebView/expo-av fallback tier actually chosen by `VideoPlayer` — is present
   and drawing pixels (not the "Tap to download" fallback, and not a blank
   0-content box).
2. **Local GIF renders animated.** Navigate to the RSVP success screen
   (`app/e/[shortId]/rsvp/success.tsx`), which renders a **bundled** animated
   GIF via `<Image source={require('...star-strike.gif')} />`. Assert the image
   is visible and non-blank.
3. **Remote GIF renders animated.** Open the GIF picker
   (`features/chat/components/GifPicker.tsx`) or a chat message containing a
   remote GIF URL and assert the animated image is visible.

### Exact assertions

For each media element the smoke test must assert BOTH:

- The expected element is **present** in the view hierarchy (e.g. the
  `VideoView` / RSVP GIF `Image` node exists), AND
- It is **non-blank**: a screenshot of the element's frame is not a single flat
  color / not empty. (A registration failure renders a present-but-blank view,
  so presence alone is insufficient — the pixel/screenshot assertion is the part
  that actually catches the #548 class of bug.)

Fail the run if any target element is absent OR blank.

### Recommended tooling

- **Maestro** flows run against an **EAS dev build** (or a locally-built dev
  client) on an iOS simulator. Maestro is chosen over Detox for lower setup
  cost; either works. The non-negotiable requirement is a **real native build**
  — not Expo Go, and not a jest/web environment — because only a real Fabric
  runtime exposes view-registration failures.
- Use Maestro's `assertVisible` for presence and `takeScreenshot` +
  an image-diff/non-blank check (or `assertVisible` on media plus a manual
  screenshot artifact reviewed pre-release) for the non-blank assertion.
- Flows live under `apps/mobile/.maestro/` (create when implemented):
  - `chat-video.yaml` — open channel → assert inline video visible + non-blank.
  - `rsvp-gif.yaml` — open RSVP success → assert bundled GIF visible + non-blank.
  - `remote-gif.yaml` — open GIF picker / remote GIF message → assert visible.

### When it runs (and why not per-PR)

Because it needs a **simulator + a native build**, it is too slow/heavy for
per-PR CI. Run it:

- **On a schedule** (e.g. nightly) against `main`/`staging`, and
- **Pre-release**, gating promotion of a native build / an OTA that touches
  `apps/mobile` dependencies.

Per-PR CI keeps the two cheap static guards (react-consistency + native-unsafe
denylist); this smoke test is the backstop for anything they miss.

## Interim mitigation (shipped now)

Until the Maestro smoke test is implemented, three things stand in for it:

1. **`scripts/check-react-consistency.js`** — fails CI on a second/mismatched
   React in the native graph (the #548 *mechanism*).
2. **Native-unsafe denylist** in the same script — fails CI if `@mui/`,
   `@emotion/`, `@material-ui/`, or `styled-components` enter
   `apps/mobile/package.json` (the #548 *libraries*).
3. **`features/chat/components/__tests__/VideoPlayer.tier.test.tsx`** — a jest
   test asserting `VideoPlayer` always selects a working tier and never
   silently degrades to blank/null for a supported video. **Its documented
   limitation:** native modules/views are mocked, so it validates JS tier
   selection only and CANNOT catch native view-registration failures — that is
   precisely why this ADR's device-level smoke test is still required.

## Consequences

- **Pro:** closes the only gap that per-PR CI structurally cannot cover — a JS
  change that breaks native rendering while all static checks pass.
- **Con:** requires simulator + native-build infra in CI, and screenshot/
  non-blank assertions are more brittle than unit assertions. Mitigated by
  running out-of-band (scheduled / pre-release), not on every PR.

## References

- ADR-013 — Mobile Versioning and OTA Updates (§"Guarding against JS changes
  that break native rendering").
- `apps/mobile/scripts/check-react-consistency.js` — layers 1 & 2.
- `apps/mobile/features/chat/components/VideoPlayer.tsx` — tier chain.
- `apps/mobile/app/e/[shortId]/rsvp/success.tsx` — bundled RSVP GIFs.
- `apps/mobile/features/chat/components/GifPicker.tsx` — remote GIFs.
- MEMORY note: "Expo Modules Native Views (Fabric / New Architecture)".
