# ADR-029: Contributor Dev Dashboard (in-house AI-driven contribution pipeline)

## Status

Accepted — Phase 1 implementation in progress (2026-07-06); Phase 1.5
(conversation-first dashboard) accepted 2026-07-07; Phase 3 (policy
auto-merge + fix loop) accepted 2026-07-07

## Date

2026-07-06

## Context

We want people with little coding experience — but good product and tech sense —
to contribute to Togather. The division of labor: contributors own the product
thinking (what to change and why, acceptance criteria, verifying results), AI
owns the implementation, and a maintainer owns the merge decision. The public
explainer for this model already ships at `/contribute/ai`
(`apps/web/src/pages/ContributeAI.tsx`).

The original plan was to run this on GitHub (issues, labels, Actions). We are
instead building an **in-house dev dashboard** inside the Togather app, because:

- Contributors already have Togather accounts (phone OTP). Requiring GitHub
  accounts, issue templates, and label conventions is the biggest onboarding
  cliff for non-coders.
- In-app we get push notifications ("your fix shipped") and a friendly spec
  review UI for free.
- GitHub stays involved — it holds the code, PRs, CI, and branch protection —
  but as plumbing that the dashboard links out to, not as the front door.

**Most of the pipeline already exists.** The `devAssistant` module was built for
maintainers reporting bugs from chat:

- `devBugs` table (`apps/convex/schema.ts` ~L2135) with the status machine
  `DRAFT → IN_REVIEW → READY_FOR_IMPL → IN_PROGRESS → CODE_REVIEW → READY_TO_MERGE → MERGED | REJECTED`.
- `dispatchBug` (`apps/convex/functions/devAssistant/actions.ts`) fires a
  Claude Code Routine (`CLAUDE_ROUTINES_TRIGGER_URL` + token) with the bug
  brief; the Routine implements the change and opens a PR.
- A signed HMAC callback (`/dev-assistant/callback` in `apps/convex/http.ts`,
  `DEV_ASSISTANT_CALLBACK_SECRET`) reports status and `prUrl` back into Convex.
- Access control via `users.platformRoles` and the `dev_maintainer` role
  (`apps/convex/functions/devAssistant/maintainers.ts`).
- Staff-only mobile screens: `apps/mobile/features/admin/components/`
  (`AdminDashboardScreen`, `BugDetailScreen`) and `app/(user)/admin/bugs/`.

What's missing for the contributor dashboard: a contributor-facing surface,
feature requests (not just bugs), an explicit spec-approval step, risk-level
triage, GitHub issue mirroring beyond a bare `prUrl` string, contributor
GitHub attribution, and shipped notifications.

## Decision

Promote the existing `devBugs` pipeline into a contributor-facing feature
rather than building a parallel system. Numbered decisions:

### 1. Access model — reuse the existing `dev_maintainer` role

Contributors and maintainers are **the same role**. There is no new
`dev_contributor` role: dashboard access reuses the existing `dev_maintainer`
platform role and the `canUseDevAssistant()` gate in
`apps/convex/functions/devAssistant/maintainers.ts`, with the existing
superuser-only grant/revoke mutations.

Rationale: the owner wants one unified contributor==maintainer role rather
than a tiered permission model. Everyone trusted enough to contribute is
trusted with the full dashboard — submit bugs/feature ideas, review and
approve specs, and start builds. The role grant remains the throttle on who
can contribute (and therefore on Routine/Anthropic costs).

- **Everyone with `dev_maintainer`** can: submit bugs/feature ideas, see
  items and statuses, review and approve specs, and start builds.
- **Merging** stays a human decision made on GitHub (branch protection is the
  backstop) until Phase 3.

### 2. Data model — extend `devBugs`, don't fork it

Add optional fields to `devBugs` (backward compatible; existing rows and the
chat-originated flow keep working):

```ts
kind: v.optional(v.union(v.literal("bug"), v.literal("feature"))), // default "bug"
source: v.optional(v.union(v.literal("chat"), v.literal("dashboard"))),
riskLevel: v.optional(v.union(v.literal("low"), v.literal("medium"), v.literal("high"))),
spec: v.optional(v.string()),            // AI-drafted spec, markdown
specApprovedAt: v.optional(v.number()),  // contributor sign-off
githubIssueNumber: v.optional(v.number()),
githubIssueUrl: v.optional(v.string()),
shippedAt: v.optional(v.number()),
```

Loosen `communityId` / `channelId` / `threadRootMessageId` to optional —
dashboard-originated items are **platform-level** (no `communityId`) and have
no chat thread. (Convex allows loosening required → optional without
migration.) Chat-originated items keep their chat fields and also appear in
the originator's dashboard list (unified history — see resolved question 5).

### 3. Mobile surface — `features/contribute/` + `app/(user)/contribute/`

New feature folder per ADR-002 conventions, modeled on `features/settings/`:

- `app/(user)/contribute/index.tsx` — "My contributions" list with status
  chips, plus submit CTA. Entry point in the profile/settings screen, visible
  only to users with `dev_maintainer` (the `canUseDevAssistant()` gate).
- `app/(user)/contribute/submit.tsx` — bug/feature form: title, what happened
  vs. expected, why it matters, screenshots (reuse existing upload → R2 flow).
- `app/(user)/contribute/[id].tsx` — detail screen: status timeline, the
  AI-drafted spec with an **Approve spec** action (the contributor's product
  review), risk badge, and deep links to the GitHub issue/PR.

Maintainer screens (`features/admin`) gain the same new fields (risk badge,
spec, kind) but keep their existing role gates.

> **Superseded in part by Phase 1.5:** the submit form and detail screen
> become a conversation thread, and the list becomes a turn-based inbox —
> see [Phase 1.5](#phase-15--conversation-first-dashboard-accepted). The
> folder layout and role gate above are unchanged.

### 4. Pipeline mapping — reuse the status machine, add a spec gate

- Contributor submits → `DRAFT`.
- Spec agent (same Routine trigger/callback pattern as `dispatchBug`, new
  "spec-only" mode) investigates and writes `spec` + proposed `riskLevel` →
  `IN_REVIEW`.
- Contributor approves the spec (`specApprovedAt`). For `risk:low` items,
  approval **auto-dispatches** implementation (`READY_FOR_IMPL` →
  `IN_PROGRESS`). For `medium`/`high` risk items, approval makes the item
  eligible and an explicit **Start build** action triggers implementation.
- Implementation, PR, and merge statuses flow exactly as today via the signed
  callback (`IN_PROGRESS → CODE_REVIEW → READY_TO_MERGE → MERGED`).

> **Phase 1.5 adds two gates around this flow:** a scope verdict before any
> spec can be approved, and reporter staging verification before merge for
> interactive changes — see
> [Phase 1.5](#phase-15--conversation-first-dashboard-accepted).

### 5. Risk levels — blast radius, assigned by AI, human-overridable

`low` = single-screen UI/copy only; `medium` = one feature's logic on one side
of the stack, nothing shared; `high` = shared components, frontend + backend
together, schema/auth/notifications/offline. The spec agent proposes the
level; maintainers can override in the admin UI. In v1 the level drives
dispatch policy (spec approval auto-dispatches `low`; `medium`/`high` need an
explicit Start build) and review depth. It becomes a merge-policy input only
in Phase 3.

### 6. GitHub mirroring and contributor attribution

GitHub stays the source of truth for code and review; the dashboard mirrors
just enough state:

- **`users.githubUsername`** (new optional field) — self-entered in the
  contribute section. No OAuth in v1; it's attribution, not authentication.
- **Issue mirroring** — on dispatch, a Convex action creates a GitHub issue
  via the REST API. Phase 2 starts with a **fine-grained PAT** (issues
  read/write, stored as `GH_MIRROR_TOKEN` in Convex env; the legacy
  `GITHUB_MIRROR_TOKEN` name still works as a fallback), not a GitHub
  App — see resolved question 2. The action stores
  `githubIssueNumber`/`githubIssueUrl`. The Routine references the issue in
  its PR so GitHub auto-closes it on merge.
- **Inbound webhook** — `POST /github/webhook` in `apps/convex/http.ts`,
  verifying `X-Hub-Signature-256` HMAC with the same Web Crypto pattern as the
  Stripe handler. PR merged → `MERGED` + `shippedAt`; PR closed unmerged →
  maintainer attention. This replaces polling and covers merges done directly
  on GitHub.
- **Attribution** — the Routine's commit instructions include
  `Co-authored-by: <name> <githubUsername@users.noreply.github.com>` for the
  originating contributor. Their contributions then appear on their GitHub
  profile and in the repo's contributor graph — real open-source work they can
  show employers. The dashboard deep-links each item's issue and PR for the
  curious.

### 7. Notifications

Call `internal.functions.notifications.actions.sendPushNotification` on the
transitions contributors care about: spec ready for review (`IN_REVIEW`), PR
opened (`CODE_REVIEW`), and shipped (`MERGED`). The callback handler
(`handleRoutineCallback`) already computes the originator; it just doesn't
push yet.

### Rollout phases

| Phase | Scope | New surface area |
|-------|-------|------------------|
| 1 — Dashboard MVP | Schema extensions, contribute screens (submit/list/detail) behind the existing `dev_maintainer` gate, spec gate (auto-dispatch `risk:low` on approval, Start build for medium/high), push notifications. PR link only, no GitHub API. | Mobile + Convex only |
| 2 — GitHub mirroring | `githubUsername`, issue mirroring (fine-grained PAT), `/github/webhook`, co-author attribution, deep links | GitHub PAT + webhook |
| 3 — Risk-gated automation | Optional auto-merge of `risk:low` PRs when CI is green (behind an env flag; branch protection stays the backstop) | Merge policy |

## Phase 1.5 — conversation-first dashboard (Accepted)

Accepted by the owner on 2026-07-07, while Phase 1 was still being built.
Phase 1.5 reshapes the contributor surface — the pipeline underneath (status
machine, Routine dispatch, signed callbacks, role gate) is unchanged.

Rationale: non-coders already know how to read a chat, so the pipeline
becomes messages instead of a form-shaped detail screen; the scope gate turns
"too big" into momentum by answering with buildable slices instead of a bad
build; staging verification puts the reporter's hands on the change before
merge, closing the loop the way decision 4's spec gate opened it.

### 1. Conversation-first — every contribution is a thread

Every contribution IS a conversation with the @Togather AI. New
`devBugMessages` table holding `user` / `assistant` / `system` messages:

- The contributor's report is the **first message** of the thread.
- The AI's spec arrives as an **assistant message**.
- Status changes ("Build started", "Shipped 🎉") are **system messages**.
- Replying while a spec is in review (`IN_REVIEW`) triggers an AI **spec
  revision** — the revision loop replaces a separate "request changes"
  affordance.

### 2. AI-generated headlines and the turn-based list

The spec agent returns `aiTitle` — a short imperative headline (e.g. "Fix
RSVP message after tapping Going") — regenerated as the work evolves. The
sidebar/list shows `aiTitle` + a last-message snippet, grouped by whose turn
it is: **Your turn / AI working / Shipped**, with a **Mine / Everyone**
toggle. Everyone can read the whole team's conversations — one role, one team
(consistent with decision 1).

### 3. Scope gate — the spec agent's first verdict

The spec agent's **first** verdict is
`scope: "buildable" | "split" | "design_needed"`. Too-large asks (e.g.
"build video chat") are not specced as-is:

- `split` — the spec body proposes 2–3 smaller buildable slices.
- `design_needed` — the spec explains which architectural decisions a
  maintainer must make first, and the item parks in a **design queue**.

`approveSpec` rejects non-`buildable` scopes.

### 4. Two more triage fields — area and staging verification

- `area: "events" | "chat" | "groups" | "prayer" | "settings" | "other"` —
  items file themselves; used as a filter/tag.
- `verifyOnStaging: boolean` — anything **interactive** requires the reporter
  to test the change on the staging app and tap **"Works — ship it"** before
  merge, even at low risk. Pure copy/color changes skip it.

New `devBugs` fields: `aiTitle`, `area`, `scope`, `verifyOnStaging`,
`stagingVerifiedAt`. New functions: `getThread`, `postMessage`,
`confirmStaging`, `reportStagingIssue`.

### 5. Desktop surface and visual spec approval

The desktop shape lives at **`togather.nyc/dev`**, routing into the Expo web
app (same phone-OTP sign-in) — still no separate web dashboard. UI specs must
include a **before/after mock image** so spec approval is a visual decision.

## Phase 1.6 — subagent code review on GitHub (Accepted)

@codex is replaced as the PR reviewer by a Claude review run. When an
implementation callback reports `CODE_REVIEW` with a `prUrl`, Convex
auto-dispatches a `mode: "review"` Routine run (`dispatchReview`). That run
reviews the diff against the approved spec with parallel subagents
(correctness, security, spec-fidelity, tests), adversarially verifies
findings, and posts the survivors as a **real GitHub PR review with inline
comments** — the review trail stays public on the PR. The verdict returns via
the signed callback as `reviewVerdict: "approved" | "changes_requested"` plus
a plain-language `reviewSummary`; approval advances the item to
`READY_TO_MERGE`, requested changes land in the conversation thread as a
system message. New `devBugs` fields: `reviewVerdict`, `reviewSummary`
(cleared when a new PR revision re-enters `CODE_REVIEW`).

Reviews must be posted from a different GitHub identity than the PR author
(GitHub forbids reviewing your own PR); the Phase 2 bot account covers this
with **Pull requests: read/write** added to its PAT. The Routine prompt
covering all modes lives at `docs/dev-assistant/ROUTINE-PROMPT.md`.

## Phase 3 — policy auto-merge and the fix loop (Accepted)

Phase 3 closes the pipeline end-to-end: review findings are fixed
automatically, and PRs that pass every gate merge themselves.

### The review → fix → re-review loop

When a review run reports `reviewVerdict: "changes_requested"`, Convex
dispatches the Routine in **`mode: "fix"`** (`dispatchFix`, using the
implement Routine's credentials since fixing needs push access). The fix run
reads the PR's review comments, addresses every finding (or replies on the
comment explaining why not), pushes to the **same branch**, gets CI green,
and reports back with a `CODE_REVIEW` callback — which clears the stale
verdict and dispatches a **fresh review round** (thread line: "Fixes pushed —
running code review again").

The loop is budgeted by a new `devBugs.fixRounds` counter, **capped at 3**
fix dispatches per item. Each dispatch logs "AI is addressing the review
feedback (round N of 3)" in the thread; when a `changes_requested` verdict
lands with the budget spent, no fix is dispatched — the thread gets "Code
review still failing after 3 fix rounds — needs a human" and the originator
is pushed.

### Policy auto-merge

A single self-gating action, `attemptAutoMerge`, is scheduled whenever a gate
might have just been satisfied: on a genuine entry into `READY_TO_MERGE` and
after `confirmStaging` stamps `stagingVerifiedAt`. It re-reads the bug and
merges the PR via the GitHub REST API **only when every gate holds**:

- `AUTO_MERGE_ENABLED === "true"` — master safety switch; anything else means
  the feature is off (double-scheduling is harmless because the action
  re-checks everything itself).
- `status === "READY_TO_MERGE"`, `riskLevel === "low"`,
  `reviewVerdict === "approved"`.
- Staging verified (`stagingVerifiedAt`) whenever `verifyOnStaging` is set.
- A `prUrl` to merge.

The merge uses `GH_MIRROR_TOKEN` (the Phase 2 mirroring PAT, which now needs
**Contents read/write** in addition to Issues) and the merge method from
`AUTO_MERGE_METHOD` (default `"squash"`; a 405 method-not-allowed retries
once with `"merge"`). On success the thread gets "Auto-merged ✓ — all gates
passed (…)"; the action never sets `MERGED` itself — the `/github/webhook`
(and the Routine callback) already apply that transition idempotently. On
failure (branch protection, conflict, auth) the thread gets "Auto-merge
blocked: <reason> — needs a maintainer" and nothing retries — branch
protection remains the backstop.

## Deliberately out of scope (v1)

- GitHub OAuth / verified account linking (`githubUsername` is honor-system).
- Bounties/payments, public leaderboards.
- A separate web dashboard — the Expo web build covers desktop (Phase 1.5
  pins the desktop entry point to `togather.nyc/dev`, still routing into the
  Expo web app).
- Migrating or changing the existing chat-originated maintainer bug flow.

## Consequences

### Positive

- Non-coders contribute with the account and app they already have; zero
  GitHub onboarding for the core loop.
- Reuses a proven pipeline (status machine, Routine dispatch, signed
  callbacks) and a proven role gate instead of duplicating them — the new
  work is mostly UI and GitHub mirroring.
- Contributors build a real public GitHub track record via co-author
  attribution.
- Push notifications close the motivation loop ("your fix shipped").

### Negative

- We own state sync with GitHub (webhook + mirroring) — a second source of
  truth to keep consistent; the webhook must be idempotent.
- Staging verification (Phase 1.5) adds a human wait state before merge:
  interactive changes sit in `READY_TO_MERGE` until the reporter confirms on
  staging, so stale items need nudges (push reminders) or a maintainer
  override.
- A PAT with write access to the repo lives in Convex env; needs rotation
  policy and least-privilege scoping (issues only — the Routine, not Convex,
  pushes code).
- Everyone with `dev_maintainer` gets the full dashboard (submit, approve,
  start builds) — there is no lower-trust tier, so the role must only be
  granted to people trusted with all of it. Auth checks on the new endpoints
  must be airtight regardless.

### Neutral

- The public `/contribute/ai` page now describes the dashboard as the front
  door, with GitHub as the linked engine room; keep it in sync as phases ship.
- Anthropic/Routine costs scale with contributor count; the role grant is the
  throttle.

## Resolved questions

All open questions were resolved by the owner on 2026-07-06:

1. Should there be a separate, lower-trust `dev_contributor` role, or one
   unified role?
   **Resolved: one unified role.** Contributors and maintainers are the same
   role — everyone with the existing `dev_maintainer` platform role gets the
   full dashboard (submit, review/approve specs, start builds). Merge
   decisions still happen on GitHub. The role grant remains the throttle on
   who can contribute.
2. Should approving a spec auto-dispatch implementation for `risk:low` items
   even in v1, or always wait for a maintainer?
   **Resolved: auto-dispatch `risk:low` on spec approval.** Medium- and
   high-risk items require an explicit "Start build" action after approval.
3. PAT vs. GitHub App for mirroring — App is cleaner (short-lived tokens,
   per-repo install) but more setup. Start with PAT?
   **Resolved: start with a fine-grained PAT** (Phase 2). A GitHub App can
   replace it later if rotation/scoping becomes a burden.
4. Do dashboard items need a `communityId` at all (e.g. for community-scoped
   contributor programs), or are they platform-level?
   **Resolved: platform-level.** Dashboard items carry no `communityId`.
5. Should chat-originated `devBugs` show up in the originator's dashboard list
   too (unified history), or keep the surfaces separate?
   **Resolved: unified history.** Chat-originated devBugs appear in the
   originator's dashboard list.

## References

- `apps/convex/schema.ts` — `devBugs` table
- `apps/convex/functions/devAssistant/` — `actions.ts`, `maintainers.ts`
- `apps/convex/http.ts` — `/dev-assistant/callback`, Stripe HMAC pattern
- `apps/mobile/features/admin/components/` — existing maintainer UI
- `apps/web/src/pages/ContributeAI.tsx` — public workflow explainer
- ADR-002 (feature-based organization), ADR-010 (role hierarchy)
