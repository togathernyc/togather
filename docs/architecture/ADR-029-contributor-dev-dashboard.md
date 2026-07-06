# ADR-029: Contributor Dev Dashboard (in-house AI-driven contribution pipeline)

## Status

Proposed

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

What's missing for the contributor dashboard: a non-staff contributor role and
surface, feature requests (not just bugs), an explicit spec-approval step,
risk-level triage, GitHub issue mirroring beyond a bare `prUrl` string,
contributor GitHub attribution, and shipped notifications.

## Decision

Promote the existing `devBugs` pipeline into a contributor-facing feature
rather than building a parallel system. Numbered decisions:

### 1. Access model — new `dev_contributor` role on `users.platformRoles`

Reuse the existing granular-role mechanism (no new table). Add
`DEV_CONTRIBUTOR_ROLE = "dev_contributor"` alongside `dev_maintainer` in
`apps/convex/functions/devAssistant/maintainers.ts`, with superuser-only
`grantContributor` / `revokeContributor` mutations mirroring the maintainer
ones.

- **Contributors** can: submit bugs/feature ideas, see their own items and
  statuses, review and approve specs for their own items.
- **Maintainers** keep everything they have today (see all items, dispatch to
  the Routine, mark ready).
- **Merging** stays a human maintainer decision (superuser) until Phase 3.

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
dashboard-originated items have no chat thread. (Convex allows loosening
required → optional without migration.)

### 3. Mobile surface — `features/contribute/` + `app/(user)/contribute/`

New feature folder per ADR-002 conventions, modeled on `features/settings/`:

- `app/(user)/contribute/index.tsx` — "My contributions" list with status
  chips, plus submit CTA. Entry point in the profile/settings screen, visible
  only to users with `dev_contributor` (or maintainer/staff).
- `app/(user)/contribute/submit.tsx` — bug/feature form: title, what happened
  vs. expected, why it matters, screenshots (reuse existing upload → R2 flow).
- `app/(user)/contribute/[id].tsx` — detail screen: status timeline, the
  AI-drafted spec with an **Approve spec** action (the contributor's product
  review), risk badge, and deep links to the GitHub issue/PR.

Maintainer screens (`features/admin`) gain the same new fields (risk badge,
spec, kind) but keep their existing role gates.

### 4. Pipeline mapping — reuse the status machine, add a spec gate

- Contributor submits → `DRAFT`.
- Spec agent (same Routine trigger/callback pattern as `dispatchBug`, new
  "spec-only" mode) investigates and writes `spec` + proposed `riskLevel` →
  `IN_REVIEW`.
- Contributor approves the spec (`specApprovedAt`) → item becomes eligible for
  dispatch. In v1 a maintainer still triggers implementation
  (`READY_FOR_IMPL`); Phase 3 can auto-dispatch low-risk items.
- Implementation, PR, and merge statuses flow exactly as today via the signed
  callback (`IN_PROGRESS → CODE_REVIEW → READY_TO_MERGE → MERGED`).

### 5. Risk levels — blast radius, assigned by AI, human-overridable

`low` = single-screen UI/copy only; `medium` = one feature's logic on one side
of the stack, nothing shared; `high` = shared components, frontend + backend
together, schema/auth/notifications/offline. The spec agent proposes the
level; maintainers can override in the admin UI. In v1 the level is
informational (drives review depth). It becomes a merge-policy input only in
Phase 3.

### 6. GitHub mirroring and contributor attribution

GitHub stays the source of truth for code and review; the dashboard mirrors
just enough state:

- **`users.githubUsername`** (new optional field) — self-entered in the
  contribute section. No OAuth in v1; it's attribution, not authentication.
- **Issue mirroring** — on dispatch, a Convex action creates a GitHub issue
  via the REST API (fine-grained PAT, issues read/write, stored as
  `GITHUB_MIRROR_TOKEN` in Convex env) and stores
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
| 1 — Dashboard MVP | `dev_contributor` role, schema extensions, contribute screens (submit/list/detail), spec gate, push notifications. PR link only, no GitHub API. | Mobile + Convex only |
| 2 — GitHub mirroring | `githubUsername`, issue mirroring, `/github/webhook`, co-author attribution, deep links | GitHub PAT + webhook |
| 3 — Risk-gated automation | Auto-dispatch approved low-risk items; optional auto-merge of `risk:low` PRs when CI is green (behind an env flag; branch protection stays the backstop) | Merge policy |

## Deliberately out of scope (v1)

- GitHub OAuth / verified account linking (`githubUsername` is honor-system).
- Auto-merge of any PR (Phase 3, and only `risk:low` behind a flag).
- Bounties/payments, public leaderboards.
- A separate web dashboard — the Expo web build covers desktop.
- Migrating or changing the existing chat-originated maintainer bug flow.

## Consequences

### Positive

- Non-coders contribute with the account and app they already have; zero
  GitHub onboarding for the core loop.
- Reuses a proven pipeline (status machine, Routine dispatch, signed
  callbacks) instead of duplicating it — the new work is mostly UI, one role,
  and GitHub mirroring.
- Contributors build a real public GitHub track record via co-author
  attribution.
- Push notifications close the motivation loop ("your fix shipped").

### Negative

- We own state sync with GitHub (webhook + mirroring) — a second source of
  truth to keep consistent; the webhook must be idempotent.
- A PAT with write access to the repo lives in Convex env; needs rotation
  policy and least-privilege scoping (issues only — the Routine, not Convex,
  pushes code).
- Contributor-facing surface widens the audience of `devAssistant` — auth
  checks must be airtight (contributors may only read/write their own items).

### Neutral

- The public `/contribute/ai` page describes the process in GitHub terms; its
  mechanics sections should be reworded to dashboard terms when Phase 1 ships.
- Anthropic/Routine costs scale with contributor count; the role grant is the
  throttle.

## Open questions

1. Should approving a spec auto-dispatch implementation for `risk:low` items
   even in v1, or always wait for a maintainer?
2. PAT vs. GitHub App for mirroring — App is cleaner (short-lived tokens,
   per-repo install) but more setup. Start with PAT?
3. Do dashboard items need a `communityId` at all (e.g. for community-scoped
   contributor programs), or are they platform-level?
4. Should chat-originated `devBugs` show up in the originator's dashboard list
   too (unified history), or keep the surfaces separate?

## References

- `apps/convex/schema.ts` — `devBugs` table
- `apps/convex/functions/devAssistant/` — `actions.ts`, `maintainers.ts`
- `apps/convex/http.ts` — `/dev-assistant/callback`, Stripe HMAC pattern
- `apps/mobile/features/admin/components/` — existing maintainer UI
- `apps/web/src/pages/ContributeAI.tsx` — public workflow explainer
- ADR-002 (feature-based organization), ADR-010 (role hierarchy)
