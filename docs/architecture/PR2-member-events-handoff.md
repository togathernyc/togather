# PR 2 Handoff: Member-Created Events + Moderation + Profile → My Events

**Status:** ready to start. PR 1 (#315) is merged. PR #316 (events tab bug fixes, follow-up to PR 1) is **open and unmerged** — the new agent is responsible for landing it first. Delete this doc once PR 2 lands.

## Step 0: land PR #316 before starting PR 2

PR #316 (`fix/events-token-stability`) contains follow-up fixes on top of PR 1. You MUST land this before starting PR 2 so your PR 2 branch picks up the fixes and doesn't regress them.

**PR link:** https://github.com/togathernyc/togather/pull/316

What's in #316:
- Token-refresh re-render fix across 5 events hooks — every one now uses `useAuthenticatedQuery` (ref-stable across JWT refresh)
- Map view re-scoped to "this week" events, including community-wide children as distinct markers (uses `communityEvents` query which doesn't collapse CWE)
- CWE sheet locked to a single 90% snap point on native, `top: 80` gap on web, `enableOverDrag={false}`
- Dark-mode Map/List toggle button, GroupCard, CreateEventScreen + VisibilitySelector + ShareToChatModal
- "Now" refresh switched from `setInterval(30s)` to `useFocusEffect` (eliminated second flicker source)
- Source-level regression test at `apps/mobile/features/events/__tests__/query-patterns.test.ts` enforcing the `useAuthenticatedQuery` pattern
- Empty-state render when map has zero geocodeable markers

**How to land it:**
1. Run the `/review-cycle` skill on PR #316. It'll check CI, resolve any outstanding codex bot comments (only P2 level remaining, previous P1s resolved), merge to main, verify main CI.
2. Then pull main locally: `git checkout main && git pull origin main`
3. Branch PR 2 from fresh main: `git checkout -b feat/member-created-events`

**If you add new hooks in PR 2 that fetch Convex data, they MUST use `useAuthenticatedQuery`.** If they live outside `features/events/`, also extend the regression test to cover the new directory — otherwise future agents can regress the flicker pattern elsewhere.

## Read these first
- [`docs/architecture/ADR-022-member-created-events.md`](./ADR-022-member-created-events.md) — full decision record
- [`CLAUDE.md`](../../CLAUDE.md) — repo conventions (test-driven, no `runtimeVersion` bump, ask before architectural decisions)
- Memory: `/Users/lilseyi/.claude/projects/-Users-lilseyi-Code-togather/memory/project_events_tab_split.md`

## Goal
Let regular community members create events (not just leaders). Add moderation (reports, lifecycle), notifications, and a Profile → My Events surface.

## Locked decisions (do not re-open)
1. **Any active member** of a group can create events in that group (including the announcement group which all members auto-join, per ADR-008).
2. **1-future-event cap** for non-leaders. Enforced via `meetings.by_createdBy` index. Definition: `status ∈ {scheduled, confirmed}` AND `scheduledAt > now`. Cancelled don't count. Leaders unthrottled.
3. **Community events** leverage the existing `isAnnouncementGroup` flag — NO schema migration, NO new `communityWideEvents` usage. Label "Community · Hosted by [Name]" when announcement group, "[Group] · Hosted by [Name]" otherwise.
4. **Location**: required-but-flexible. Add `locationMode: v.optional(v.union(v.literal("address"), v.literal("online"), v.literal("tbd")))` enum on `meetings`. Validate at mutation time. Apply uniformly to members AND leaders.
5. **Reports**: new `meetingReports` table mirroring `chatMessageFlags` pattern. Reports route to the event's **group leaders** (not community admins).
6. **Notifications on creation**: fire when non-leader creates → notify **group leaders** of that group. **Default OFF for the announcement group** so admins aren't spammed.
7. **Series toggle hidden** (not disabled) for members.
8. **Ownership on leave**: if creator leaves community, future meetings' `createdById` patches to the **primary admin** (ADR-010). Silent side-effect in leave-community handler.
9. **Profile → My Events**: two segments (Hosted / Attended), upcoming above past, newest-first. CWE render as one row per parent.

## Scope

### Backend (apps/convex)
- **Schema** (`schema.ts`):
  - New table `meetingReports` — `{ meetingId, reportedById, reason, details?, status, reviewedById?, reviewedAt?, actionTaken?, createdAt }` with indexes `by_meeting`, `by_reportedBy`, `by_status`, `by_reviewedBy`.
  - Add `locationMode` optional enum on `meetings`.
- **Permissions helper** — new `apps/convex/lib/meetingPermissions.ts` with `canEditMeeting(ctx, userId, meeting)` and `canCreateInGroup(ctx, userId, group)`.
- **`functions/meetings/index.ts`**:
  - `create` (line ~131): replace `isActiveLeader` check with "active member OR leader", enforce 1-future-event cap for non-leaders, reject `seriesId` for non-leaders, validate `locationMode`.
  - `update` (line ~270), `cancel` (line ~499): allow `userId === meeting.createdById` OR leader OR admin.
  - `createSeriesEvents` (line ~620): leave leader-only.
  - Schedule `notifyEventCreatedByMember` via `ctx.scheduler.runAfter(0, ...)` when creator is not a leader.
- **`functions/meetings/reports.ts`** (new): `createReport` mutation, stub `listReportsForGroup` + `resolveReport`.
- **`functions/notifications/senders.ts`**: add `notifyEventCreatedByMember` internalAction modelled on `notifyRsvpReceived` (line ~380). Add type `event_created_by_member` to registry + default preferences.
- **`functions/groups/members.ts::myCreatableGroups`** (new): returns groups user is an active member of (includes leader flag per group). Replaces `useLeaderGroups` usage in CreateEventScreen.
- **`functions/meetings/myEvents.ts`** (new): `myHostedEvents({ includePast })`, `myAttendedEvents({ includePast })`. Both return the same grouped-CWE shape as `listForEventsTab` (reuse the enrichment helpers from `events.ts`).
- **Leave-community hook**: wherever users leave a community (`functions/groupMembers.ts` or `functions/communities.ts`), patch `createdById` on their future meetings to the primary admin.

### Frontend (apps/mobile)
- **`features/leader-tools/components/CreateEventScreen.tsx`** (biggest LOC risk — 2000+ lines):
  - Replace `useLeaderGroups` with `useCreatableGroups` (new hook).
  - Default group dropdown to announcement group; relabel as "Community · Hosted by [you]".
  - Conditionally hide (not disable): Series toggle, Community-wide toggle, leader-only warnings — when `userRole !== 'leader' && userRole !== 'admin'`.
  - Add `locationMode` selector: address / online / TBD. Wire validation.
  - Disable "+ Create Event" button when member already has 1 future event; show reason.
- **`features/events/components/ReportEventSheet.tsx`** (new): 4 reason options + optional details textarea. Opened from event detail overflow menu.
- **`app/(user)/my-events.tsx`** + **`features/profile/components/MyEventsScreen.tsx`** (new): segmented Hosted/Attended, upcoming + past sections per segment.
- **Hooks**: `useCreatableGroups`, `useMyHostedEvents`, `useMyAttendedEvents` — **use `useAuthenticatedQuery`**, never raw `useQuery` + token (PR #316 regression test enforces this in `features/events/__tests__/query-patterns.test.ts` — extend it if the new hooks live under a different path).

### Analytics (PostHog)
- `event_created_by_member` — `group_id`, `is_announcement_group`, `location_type`
- `event_reported` — `event_id`, `group_id`, `reporter_role`
- `event_deleted_by_leader` — `event_id`, `deleter_role`

### Tests
- **Convex**: member-create-allowed, 1-future-event cap (incl race — two concurrent creates), update/cancel permissions for creator/leader/admin/other, reports round-trip, location validation enforced on leaders too.
- **Component**: `MyEventsScreen` (segment switching), `ReportEventSheet`, `CreateEventScreen` member view (hidden toggles).
- **E2E** (Playwright): member creates an event, second create blocked with clear message, report flow.
- **Seed** (`apps/convex/functions/seed.ts`): add a non-leader, non-admin member in "Demo Community".

## Patterns to keep intact
- **Token-refresh re-render fix** (PR #316): ALWAYS `useAuthenticatedQuery` from `@services/api/convex`, never raw `useQuery` + spread token. See `apps/mobile/features/events/__tests__/query-patterns.test.ts` for the enforcement test.
- **No screen-title headers** on tab-level screens. Tab bar already labels the view.
- **Dark mode**: use `useTheme().colors.surface/text/textSecondary/...`, never hardcode `#fff`, `#000`, `COLORS.text`.
- **Don't bump `runtimeVersion`**. No new native deps — existing deps (`@gorhom/bottom-sheet`, `@components/ui`) are enough.

## Suggested phasing
1. **Run `/review-cycle` on PR #316 first.** Don't skip this — PR 2 depends on those fixes.
2. Read ADR-022 + this handoff.
3. Front-load clarifying questions (CLAUDE.md style: ask all upfront).
4. Pull `main` (now contains PR 1 + PR #316), cut branch `feat/member-created-events`.
4. Schema + backend permission changes + tests (small, atomic commits).
5. `CreateEventScreen` frontend changes — iterate with iOS simulator.
6. `meetingReports` backend + `ReportEventSheet` frontend.
7. `myEvents` backend + Profile → My Events frontend.
8. Analytics wiring.
9. Extend `seed.ts` with a non-leader member.
10. Playwright + component tests.
11. Manual iOS sim verification (phone `2025550123` / code `000000`).
12. Open PR, run `/review-cycle`.

## What NOT to do
- Don't regress the flicker fix. Every new hook must use `useAuthenticatedQuery`.
- Don't add the "View all" pill back without a real destination (Profile → My Events is the natural one — wire it explicitly, no stub onPress).
- Don't make members' events approval-gated. Events go live immediately; reports are the moderation path.
- Don't hardcode any colors or bg. Dark mode was a separate painful round of fixes.
- Don't ship without a seeded non-leader member — reviewers can't test otherwise.

## Done criteria
- [ ] Schema deployed to dev + prod-ready
- [ ] Member can create an event in announcement group and in a regular group (if member of it)
- [ ] 1-future-event cap enforced (+ tested under concurrent creates)
- [ ] Location validation applies uniformly to leaders and members
- [ ] Report flow end-to-end: submit → group leaders notified → leader can resolve
- [ ] Profile → My Events renders Hosted/Attended with correct counts
- [ ] Notifications suppressed for announcement-group member events
- [ ] Ownership transfers to primary admin on leave
- [ ] Analytics events firing
- [ ] All locked decisions respected (grep for drift)
- [ ] Regression test extended if new hooks live outside `features/events/`
- [ ] Verified in iOS sim
