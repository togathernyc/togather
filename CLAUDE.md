# Agent Instructions

Guidelines for AI agents (Claude, Cursor, Copilot, etc.) working on this codebase.

## Helping New Developers Onboard

When a new developer asks for help getting started, guide them through these steps:

### Prerequisites Check
First, verify they have:
- Node.js v20+ (`node --version`)
- pnpm v8+ (`pnpm --version`)

If missing, point them to:
- Node: https://nodejs.org or use nvm
- pnpm: `npm install -g pnpm`

### Access Requirements
They need:
1. **Environment variables** - See `docs/secrets.md` for required variables
2. **Convex account** - Free at https://convex.dev (they'll create during setup)

### Step-by-Step Setup

1. **Install dependencies:**
   ```bash
   pnpm install
   ```

2. **Set up environment variables:**
   ```bash
   cp .env.example .env.local
   # Edit .env.local with your values (see docs/secrets.md)
   ```

3. **Create personal Convex deployment:**
   ```bash
   npx convex dev
   ```
   - This opens browser for Convex login
   - Select "Create a new project"
   - Name it "togather-[their-name]-dev"
   - Keep this terminal running

4. **Seed test data (new terminal):**
   ```bash
   npx convex run functions/seed:seedDemoData
   ```

5. **Start development:**
   ```bash
   pnpm dev
   ```

6. **Test the app:**
   - Open iOS Simulator or Expo Go
   - Login with the seeded test phone number and OTP bypass code
   - Search for "Demo Community"

### Troubleshooting

- **Convex auth fails** - Run `npx convex logout` then `npx convex dev` again
- **Empty app / no data** - They forgot to run the seed script
- **"Demo Community not found"** - Run `npx convex run functions/seed:seedDemoData`

## Development Workflow

### Environment Setup
- Environment variables are documented in `docs/secrets.md`
- Depending on what the user is asking, use the relevant keys from the relevant environment (dev, staging, prod)
- Typically you will only make dev or staging related changes, double check if any action you take will affect production

### Secret Update Flow
Secrets flow **1Password → GitHub → Convex/Expo** — never shortcut either hop.
See the full "Secret Update Flow" section in `docs/secrets.md` for the why and
the step-by-step. In short:
- **1Password is the source of truth.** Set/rotate the value there, never
  directly in the GitHub UI (GitHub secrets are write-only; you can't read them
  back, and the next sync overwrites manual edits).
- **Don't push 1Password → Convex/Expo directly** — every deploy re-syncs all
  secrets and would hit 1Password rate limits. GitHub is the buffer.
- To add a new secret: (1) add the item to 1Password vault `Togather` with
  `staging`/`production` fields; (2) add `<KEY>` to the `required` or
  `optional` list in `ee/secrets-allowlist.json` (a key not listed is never
  synced — see the Supa Framework section below for what `required` vs
  `optional` means, including that `optional` gets **pruned** from GitHub when
  absent from 1Password); (3) **only if a Convex function needs it**, also add
  it to `SECRET_KEYS` in `ee/scripts/sync-secrets-to-convex.sh` — CI-only
  tokens stop at GitHub; (4) run
  `gh workflow run sync-secrets.yml -f environment=both` to push it to GitHub
  (the shared `supa-sync-1password-to-github` bin, via the reusable
  `sync-secrets.yml@v1` workflow); deploys forward it onward.

### Agent Backend Selection (Maintainer CI Agents Only)

This section applies **only** to Cursor Cloud Agents and similar CI agents run by project maintainers. Open-source contributors should ignore this section — you create your own personal Convex deployment via `npx convex dev` (see "Helping New Developers Onboard" above).

- Before any backend-affecting command, ask: **"Which backend should I use?"** and list the backends defined in `config/allowed-backends.json`.
- Do not proceed until the user answers.
- Use `pnpm dev:backend --backend=<choice>` only.
- Each concurrent agent **must** use a different backend to avoid data conflicts.

### Multi-Agent Development Isolation (Paperclip)

When running as a Paperclip agent (e.g. Feature Engineer, QA Engineer), your development environment is isolated using git worktrees to prevent conflicts.

1. **Worktrees**: Agents operate in `worktrees/agent-{slot}` instead of the main repository. 
2. **Setup**: If your worktree doesn't exist or needs resetting, run `scripts/setup-worktrees.sh` from the repo root.
3. **Dev Server**: Always ensure your dev server is running before working: `node scripts/agent-dev.js`
4. **Screenshots/Evidence**: Always take screenshots of visual changes using the provided Playwright script:
   ```bash
   node scripts/agent-screenshot.js --port=19002 --path=/some/path --output=/tmp/screenshot.png
   node scripts/agent-attach.js --issue=TOG-XX --file=/tmp/screenshot.png --comment="Implemented XYZ"
   ```
5. **Git Branches**: When working on tasks, pull `main` and create a feature branch (`git checkout -b fix-xyz`). QA Engineer should test against the Feature Engineer's branch.

### Test-Driven Development

- **Write tests first** - Create failing tests before implementing features
- Tests serve as specification and prevent regressions
- Run tests after implementation to verify correctness

### Visual Verification

- **Use Playwright** to confirm UI changes look correct
- Don't assume - verify components render as expected
- Take screenshots for complex UI changes when helpful
- **Act autonomously** - don't ask permission for each Playwright action

### Testing

When testing the app (Playwright, iOS Simulator, etc.), use the seeded test credentials from the seed script. The test phone number and OTP bypass code are configured in the seed data.

> **Note:** If "Demo Community" doesn't exist, run the seed script first:
> ```bash
> npx convex run functions/seed:seedDemoData
> ```

**Development Commands:**

| Command             | What it does                                      |
| ------------------- | ------------------------------------------------- |
| `pnpm dev`          | Run Convex dev + Expo together                    |
| `pnpm dev --mobile` | Run only Expo (if Convex is already running)      |
| `pnpm dev --convex` | Run only Convex dev                               |

**App URLs:**

- Expo/Metro: http://localhost:8081
- Convex Dashboard: Run `pnpm convex:dashboard`
- Convex Logs: Run `pnpm convex:logs`

### Git Discipline

- **Commit frequently** - Make atomic commits after each logical change
- Write descriptive commit messages explaining "why" not just "what"
- Don't batch unrelated changes into single commits

### Branch Protection

- **Never push directly to `main`** - Branch protection will reject it
- **Always create a PR** - Even for small changes
- PRs require passing CI and **all conversations resolved** before merge
- The workflow is: `feature branch` -> PR -> `main`
- **Code review is by Claude review agents, visible on GitHub** — every PR is reviewed by parallel AI subagents (correctness, security, spec-fidelity, tests) whose adversarially-verified findings are posted as real PR review comments, so the review trail lives on the PR. Dev-dashboard PRs dispatch this review automatically when the PR opens (see `docs/dev-assistant/ROUTINE-PROMPT.md`); for hand-opened PRs, trigger the review Routine manually or ask a Claude session to review with inline comments. Findings must be fixed or their threads explicitly resolved before merge (branch protection enforces this).

## Code Philosophy

### Simplicity First

- **Prefer readable code over clever code** - even if it means rewriting
- Three similar lines of code is better than a premature abstraction
- If a solution requires extensive explanation, it's too complex

### Remove, Don't Deprecate

- **Delete old patterns** rather than keeping both old and new
- Don't add backwards-compatibility shims when you can just change the code
- Remove unused code, don't comment it out

### Avoid Over-Engineering

- Only make changes that are directly requested or clearly necessary
- Don't add features, refactoring, or "improvements" beyond what was asked
- Don't design for hypothetical future requirements

### Native Dependency Safety

- **Never bump `runtimeVersion`** — it must stay in sync with production native builds
- New native dependencies must be **gated** behind `NativeModules` runtime checks
- Add detection functions in `features/chat/utils/fileTypes.ts` (see `isLinearGradientSupported()`)
- Create safe wrapper components (see `components/ui/SafeLinearGradient.tsx`)
- Classify all native deps in `apps/mobile/native-deps.json` as `core` or `gated`
- CI enforces this via `scripts/check-native-imports.js` — static imports of gated deps fail
- See `docs/architecture/ADR-013-mobile-versioning-and-ota-updates.md` for full details

### JS Changes Can Break Native Rendering (read before touching deps or native media)

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

### Prefer Framework Features Over Custom Solutions

- **Always prefer built-in framework features** over custom implementations
- Use Expo Router tabs instead of custom tab bar components
- Use React Navigation patterns instead of custom navigation wrappers
- If a framework provides a solution, use it - don't reinvent the wheel
- Custom components should only exist when framework features genuinely can't meet requirements

### Design Decisions Require Consultation

- **ASK before making architectural/design decisions** - don't assume
- When multiple valid approaches exist, present the options with trade-offs
- Always prefer the cleaner, more elegant solution even if it requires more refactoring
- If unsure whether something is a design decision, err on the side of asking
- Examples of decisions that require consultation:
  - Custom components vs framework features
  - State management approaches
  - Navigation patterns
  - API design choices
  - File/folder structure changes

## Documentation Standards

### Code Comments

- Add JSDoc/docstrings for non-obvious functions
- Document "why" not "what" - code shows what, comments explain why
- Link frontend types to backend schemas where applicable

### Architecture Docs

- See `/docs/architecture/` for Architecture Decision Records (ADRs)
- Each feature folder may have an `ARCHITECTURE.md` explaining its structure

### Keep Docs Updated

- **Update documentation when implementing features** - don't leave stale docs
- If you change an API, update the corresponding contracts and types
- If you refactor a feature, update its ARCHITECTURE.md
- If docs are wrong, fix them - don't just work around them

### Onboarding Guides (apps/web)

The public church onboarding guides live in `apps/web/src/pages/guides/` and are
registered in `apps/web/src/guides/registry.ts`. They describe **user-facing app
behavior** (UI labels, flows, and screens), so they go stale whenever a
documented feature changes.

**When a PR changes a documented feature, update its guide in the same PR.** Use
this map to find the guide that covers what you touched:

| If your change touches…                                                                                     | Update this guide                                  |
| ----------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| Community creation / proposals (`apps/convex/functions/ee/proposals.ts`, community switcher / selection)    | `apps/web/src/pages/guides/CreateCommunity.tsx`    |
| Community branding & settings (name, logo, subdomain, primary/secondary color) (`admin/settings.ts`)        | `apps/web/src/pages/guides/Branding.tsx`           |
| Group types (`functions/seed.ts` defaults, `createGroupType`, Explore filtering)                            | `apps/web/src/pages/guides/GroupTypes.tsx`         |
| Groups, channels (general/leaders/announcements), member roles / leaders (`groups/mutations.ts`)            | `apps/web/src/pages/guides/GroupsAndChannels.tsx`  |
| Events & community-wide events (`communityWideEvents.ts`, `meetings/events.ts`, RSVP)                        | `apps/web/src/pages/guides/Events.tsx`             |
| Prayer feature (`functions/prayers.ts`, `churchFeatures.prayerEnabled`)                                     | `apps/web/src/pages/guides/Prayer.tsx`             |

What to update when a guide is affected:

- **Prose & steps** — if a flow, label, or behavior changed.
- **UI mockups** — the in-page mock components (and any quoted in-app strings)
  must match the real screens. If a `<Figure>` uses a real screenshot (`src`),
  recapture it.
- **Deep links** — keep `apps/web/src/guides/appLinks.ts` paths valid.
- **New onboarding-relevant feature?** Add a guide: append an entry to
  `registry.ts`, add a page under `pages/guides/`, and register the route in
  `apps/web/src/main.tsx`.

If you're unsure whether a change is "user-facing enough" to need a guide
update, it probably is — err on the side of updating.

### Link Previews / OG Metadata

**Adding a static marketing page:** Add an entry to `apps/web/src/routes.tsx` with `path`, `element` (JSX component like `<EventsGuide />`), `title`, `description`, and optional `image` and `emoji`. The build script automatically generates OG metadata and images at compile time (satori + resvg for branded cards). Routes are **the only way to add a page** — the router is generated from the registry. For a **new top-level path** (not nested under an existing prefix like `/guides/`), you must also add it to `LANDING_PAGE_PATHS` or `LANDING_PAGE_PREFIXES` in `apps/link-preview/cloudflare-worker.js`, or the Cloudflare worker will misroute it; paths under already-listed prefixes (like `/guides/`) need no worker change.

**Adding a dynamic shareable app route:** Implement a resolver case in `apps/convex/functions/linkPreviewMeta.ts` (typed, unit-tested) to assemble preview metadata (title, description, image fallback chains, timezone formatting, etc.), then add a row to `PREVIEW_ROUTES` in `apps/link-preview/cloudflare-worker.js` to route the pattern. The worker fetches the metadata endpoint and renders the shared HTML template — **no per-type logic in the worker itself.**

See ADR-009 for full architecture.

## File and Project Hygiene

### Keep the Codebase Clean

- **Put docs in proper folders** - never leave analysis/planning docs in root
  - `/docs/architecture/` - ADRs and architectural decisions
  - `/docs/archive/` - historical analysis, completed migrations
  - Feature folders - feature-specific docs (ARCHITECTURE.md)
- Only `README.md` and `CLAUDE.md` belong in root
- Delete temporary or one-off analysis files after they've served their purpose

### Leave Code Better Than You Found It

- If you encounter unnecessarily complex code, simplify it or document why it's complex
- Add `// TODO: Investigate - [reason]` comments for suspicious patterns
- Remove dead code, unused imports, and commented-out blocks
- Fix small issues you notice (typos, formatting) while working on related code

### Document Complexity

- If you can't simplify something, document why it's complex
- Leave breadcrumbs for future investigation:
  ```typescript
  // NOTE: This workaround is needed because [reason]
  // See: [link to issue or discussion]
  ```
- Flag technical debt explicitly rather than hiding it

## Working Style

### Front-Load Questions

- **Ask all questions before implementing** - don't start then realize you need more info
- Tell the user how many questions you have (e.g., "I have 3 questions before starting")
- Ask questions one at a time for easier answering
- Once all questions are answered, execute without interruption

### Orchestrator Pattern

- **Act as an orchestrator**, not a doer for large tasks
- Your role: scope the work, break it into pieces, delegate to subagents
- Prepare clear, self-contained prompts for each subagent
- Subagents should be able to complete their task without asking questions

Example workflow:

```
1. User requests feature
2. YOU ask all clarifying questions upfront
3. User answers
4. YOU create implementation plan
5. YOU spawn subagents for each piece:
   - Task("Write tests for X", subagent_type="general-purpose")
   - Task("Implement backend for X", subagent_type="general-purpose")
   - Task("Implement frontend for X", subagent_type="general-purpose")
6. YOU review and commit
```

### Protect Context

- **Context is precious** - don't pollute it with exploration
- Use subagents for: searching code, reading files, investigating issues
- Keep main conversation focused on decisions and coordination
- If you need to read 10 files to understand something, spawn a subagent
- Return concise summaries from subagents, not raw data

## Tech Stack Quick Reference

### Backend

- **Framework**: Convex (serverless functions + database)
- **Functions**: `/apps/convex/functions/` - queries, mutations, actions
- **Background jobs**: Convex crons (`apps/convex/crons.ts`) and `ctx.scheduler` for scheduled/event-triggered jobs
- **Real-time**: Convex reactive queries and messaging
- **Schemas**: Convex validators for type safety
- **Auth**: `@convex-dev/auth` (phone OTP + email OTP)

### Frontend

- **Mobile**: React Native + Expo
- **Routing**: Expo Router (file-based)
- **State**: Convex hooks (`useQuery`, `useMutation`, `useAction`)
- **Chat**: Convex real-time messaging
- **Error tracking**: Sentry
- **Analytics / Feature flags**: PostHog

### Integrations

- **SMS**: Twilio (OTP verification, notifications)
- **Transactional email**: Resend (attendance confirmations, notifications)
- **Push notifications**: Expo Push API
- **Maps**: Mapbox
- **Storage**: Cloudflare R2 (file storage, image transformations)

### Shared

- **Types**: Convex generates types from schema (`apps/convex/_generated/`)
- **API Client**: `@services/api/convex` - Convex React client

## Supa Framework

This repo consumes packages and reusable workflows from **Supa-Media/supa-framework**
(local checkout: `~/Code/supa-framework`).

- Consumed today: `@supa-media/native-safety` (check-react-consistency CI guard),
  the shared 1Password sync (`supa-sync-1password-to-github` via the reusable
  `sync-secrets.yml@v1` workflow), and `@supa-media/dev-assistant` (the ADR-029
  contribution pipeline — schema, pipeline core, and Convex functions; Togather
  supplies only the app-specific seams in `apps/convex/functions/devAssistant/`).
  More adoption is planned (see the framework repo).
- Private registry: installing `@supa-media/*` needs a `GITHUB_TOKEN` with
  `read:packages` (see `.npmrc`; CI passes `secrets.GITHUB_TOKEN`). EAS remote
  native builds (`eas build`, no `--local`) run their own `pnpm install` on
  Expo's infra, which never sees `secrets.GITHUB_TOKEN` — those workflows
  instead forward the durable `GH_PACKAGES_TOKEN` secret via `eas env:create
  --name GITHUB_TOKEN`. See `docs/secrets.md`'s "GitHub Packages auth for
  native builds" section.
- **Upstream-first rule:** if a change touches behavior that comes from the
  framework (a package, bin, or reusable workflow), do NOT patch or fork it
  here first. Ask: is the change generic? If yes → change it in
  supa-framework (PR there → release → `pnpm update "@supa-media/*"` here).
  Only implement locally when the need is genuinely Togather-specific — and
  leave a comment explaining why it diverges.
- Updating: `pnpm update "@supa-media/*"`; reusable workflows are pinned `@v1`.

## Key Patterns

### API Data Flow

```
Convex Function (TypeScript)        ->  Real-time subscription  ->  Frontend Component
api.functions.groups.list           ->  useQuery()              ->  GroupListScreen
(apps/convex/functions/groups.ts)
```

### Group Types

- **IDs are dynamic per community** - created by `seed_group_types`, differ between environments
- Use `group_type_name` from API for display labels, not hardcoded ID mappings
- `type` field is legacy - prefer `group_type` and `group_type_name`

### Offline Support

The app has hand-built, **native-only** offline support (there is no Convex-level
offline persistence): a connectivity detector (`providers/ConnectionProvider.tsx`,
`useConnectionStatus()`), Zustand+AsyncStorage stale-while-revalidate caches
(`stores/*Cache.ts`), and narrow write queues (chat sends; serving-task completions).

- **Before adding/changing a data-loading feature, decide if it needs offline
  support** using the rubric in `docs/architecture/decisions/ADR-028-offline-support.md`.
  Rule of thumb: data a user needs to *view* where they predictably lack signal
  (e.g. serving mode at a venue) should be read-cached; actions they must *take*
  offline need a write queue **and** an idempotent mutation.
- Every offline module is native-only — add a `.web.ts` no-op stub, a store test,
  and register new caches in `providers/AuthProvider.tsx` logout cleanup.
- Read the ADR before touching offline plumbing; keep it updated when you do.
