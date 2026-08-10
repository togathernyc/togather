# Agent Instructions

Guidelines for AI agents (Claude, Cursor, Copilot, etc.) working on this codebase. Specialized guidance lives in on-demand skills — see **Skills Index** at the bottom; load the relevant skill *before* you start that kind of work, not after.

## Native Safety (distilled — full details in the `native-deps-safety` skill)

JS-only changes can break **native** rendering on real devices. These bugs are
invisible to typecheck, tests, and CI (native modules are mocked, the bundle
builds fine). Learned from PRs #548, #619, #629. Non-negotiable rules:

- **Never bump `runtimeVersion`** — it must stay in sync with production native builds.
- **Never add a web-only React UI/CSS-in-JS library to `apps/mobile`** (MUI,
  `@emotion/*`, `styled-components`, `react-datepicker`, …) — even behind a
  `.web.tsx`. It pulls a second React into the lockfile and blanks native video/GIF.
  A `pnpm.overrides` pin does NOT save you. Web-only UI must be dependency-free.
- New native deps must be **gated** behind `NativeModules` runtime checks and
  classified in `apps/mobile/native-deps.json`.
- **When adding a dependency, use a scoped install** (`pnpm add -D <pkg> --filter mobile`),
  never a bare workspace-root `pnpm install` — the latter re-resolves and can
  non-deterministically re-key the Expo/react-native graph onto a second React or a
  second native instance. (A bare `pnpm install` to bootstrap a fresh clone from the
  committed lockfile is fine — the rule is about *adding* deps.)
- **After ANY dependency change** run `check-react-consistency` **and**
  `node scripts/check-native-instance.js`. Never paper over a failure with `pnpm.overrides`.
- The `react: "19.1.0"` **and** `react-dom: "19.1.0"` devDependency pins in
  `apps/convex/package.json` are **load-bearing** — do not remove either, keep them
  the same exact version.
- **Don't attach effects/listeners to a native view's player/lifecycle** — prop-only changes. A `player.addListener('sourceLoad', …)` on `ExpoVideoPlayer` crashed the native `VideoView`, and a crashed native view corrupts the Fabric registry: **"video and GIF break together" is ONE bug, not two.**
- Any change touching native media/views (video, GIF, blur, `expo-*` native views) or the mobile dependency graph **MUST be device/staging-OTA verified before merge**.

Read the `native-deps-safety` skill for the mechanisms, war stories, and CI guards.

## Development Workflow

### Test-Driven Development

- **Write tests first** - Create failing tests before implementing features
- Tests are the spec and prevent regressions; run them after implementing to verify

### Visual Verification

- **Use Playwright** to confirm UI changes look correct
- Don't assume - verify components render as expected; screenshot complex UI changes
- **Act autonomously** - don't ask permission for each Playwright action; use the seeded test credentials (phone + OTP bypass) from the seed script

### Commands

- `pnpm dev` (Convex + Expo) · `pnpm dev --mobile` · `pnpm dev --convex`
- **Maintainer CI agents: pick a backend FIRST** (`pnpm dev:backend --backend=<choice>`,
  never a bare `pnpm dev`) — concurrent agents **must** use different backends or they
  corrupt each other's data. Load `secrets-and-backends` before any backend command.
- Expo/Metro: http://localhost:8081 · `pnpm convex:dashboard` · `pnpm convex:logs`
- No data / "Demo Community not found"? `npx convex run functions/seed:seedDemoData`

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

### Prefer Framework Features Over Custom Solutions

- **Always prefer built-in framework features** over custom implementations
  (Expo Router tabs over custom tab bars; React Navigation patterns over custom wrappers)
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

- Add JSDoc/docstrings for non-obvious functions; document **"why"** not "what";
  link frontend types to backend schemas where applicable
- ADRs (Architecture Decision Records) live in `/docs/architecture/`; feature
  folders may have an `ARCHITECTURE.md` explaining their structure
- **Update documentation when implementing features** - don't leave stale docs. Change an API → update its contracts and types. Refactor a feature → update its ARCHITECTURE.md. If docs are wrong, fix them - don't just work around them.
- User-facing changes may need an `apps/web` guide update — see `guides-and-link-previews`

## File and Project Hygiene

- **Put docs in proper folders** - never leave analysis/planning docs in root:
  `/docs/architecture/` (ADRs), `/docs/archive/` (historical analysis, completed
  migrations), feature folders (feature-specific docs). Only `README.md` and
  `CLAUDE.md` belong in root. Delete temporary/one-off analysis files after use.
- **Leave code better than you found it** - simplify complex code you encounter or document why it's complex; add `// TODO: Investigate - [reason]` for suspicious patterns; remove dead code, unused imports, and commented-out blocks; fix small issues you notice (typos, formatting) while working on related code
- **Document complexity** you can't remove, and leave breadcrumbs:
  `// NOTE: This workaround is needed because [reason]  // See: [link]`.
  Flag technical debt explicitly rather than hiding it.

## Working Style

### Front-Load Questions

- **Ask all questions before implementing** - don't start then realize you need more info
- Tell the user how many questions you have (e.g., "I have 3 questions before starting")
- Ask questions one at a time for easier answering
- Once all questions are answered, execute without interruption

### Orchestrator Pattern

- **Act as an orchestrator**, not a doer for large tasks: scope the work, break it
  into pieces, delegate to subagents
- Prepare clear, self-contained prompts so subagents finish without asking questions
- Flow: user requests feature → YOU ask all clarifying questions upfront → user
  answers → YOU create the implementation plan → YOU spawn a subagent per piece
  (`Task("Write tests for X", subagent_type="general-purpose")`, likewise backend
  and frontend) → YOU review and commit

### Protect Context

- **Context is precious** - don't pollute it with exploration
- Use subagents for: searching code, reading files, investigating issues
- Keep main conversation focused on decisions and coordination
- If you need to read 10 files to understand something, spawn a subagent
- Return concise summaries from subagents, not raw data

## Tech Stack Quick Reference

- **Backend**: Convex (serverless functions + DB). Functions in `/apps/convex/functions/`
  (queries, mutations, actions); background jobs via Convex crons (`apps/convex/crons.ts`)
  and `ctx.scheduler`; real-time via reactive queries/messaging; Convex validators for
  schemas/type safety; auth via `@convex-dev/auth` (phone OTP + email OTP)
- **Frontend**: React Native + Expo; Expo Router (file-based); state via Convex hooks
  (`useQuery`/`useMutation`/`useAction`); chat via Convex real-time messaging;
  Sentry for error tracking; PostHog for analytics / feature flags
- **Integrations**: Twilio (SMS: OTP verification, notifications), Resend
  (transactional email: attendance confirmations, notifications), Expo Push API
  (push notifications), Mapbox (maps), Cloudflare R2 (file storage, image transformations)
- **Shared**: Convex generates types from schema (`apps/convex/_generated/`);
  API client `@services/api/convex` (Convex React client)

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

## Skills Index

Specialized rules live in `.claude/skills/<name>/SKILL.md`. Load one **before** doing the work it covers:

| Skill | Load it before… |
| --- | --- |
| `native-deps-safety` | adding/removing/upgrading ANY dependency (`pnpm add`/`install`/`update`), touching native media or `expo-*` native views, changing `runtimeVersion` / `native-deps.json` / the lockfile, or debugging blank video/GIF or a second-React/native-instance CI failure |
| `secrets-and-backends` | adding/rotating/reading any secret or env var (1Password → GitHub → Convex/Expo), editing `ee/secrets-allowlist.json`, or (maintainer CI agents) running any backend-affecting command |
| `onboarding-new-dev` | helping someone set up the repo locally, create their own Convex deployment, seed demo data, or troubleshoot an empty app |
| `guides-and-link-previews` | changing user-facing behavior documented by the `apps/web` guides (communities, branding, group types, groups/channels, events, prayer), adding a marketing page, or adding OG/link-preview metadata |
| `offline-support` | adding/changing a mobile data-loading feature, or touching connectivity detection, `stores/*Cache.ts` caches, or the write queues |
| `supa-framework` | changing behavior owned by a `@supa-media/*` package, shared bin, or reusable workflow (upstream-first rule), or debugging GitHub Packages auth |
| `code-review` | reviewing a completed chunk of work against the plan and these standards (`/code-review`) |
