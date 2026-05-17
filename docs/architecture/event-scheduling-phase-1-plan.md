# Event Scheduling — Phase 1 Implementation Plan

Companion to **ADR-023**. Phase 1 goal: a church can schedule its volunteers
to events entirely in Togather, without Planning Center.

Terminology: a dated thing volunteers are rostered to is an **event**; a team
has **roles**. No "service" language.

Scope is **rostering only**. No order-of-items editing, no songs, no PCO
importer — those are Phase 2+. Events in Phase 1 are dated containers that
assignments hang off.

## Definition of done

A channel admin can:
1. Mark a team channel as a serving team and define its roles.
2. Create a dated event and declare needed roles ("2 Drums, 4 Vocals").
3. Assign channel members to roles, seeing who filled each before.
4. Publish the event, sending push + SMS requests to assigned volunteers.

A volunteer can:
5. See their upcoming assignments in a "My Schedule" view.
6. Accept or decline each request; declines reopen the slot for the scheduler.

A scheduler sees a double-booking warning when assigning someone already
scheduled elsewhere the same day.

## Tracks

Tracks A–B are sequential (schema first). C–E can run in parallel once B lands.
F depends on C/D. Each track is sized for one subagent.

### Track A — Schema

- Add the four tables from ADR-023 (`teamRoles`, `eventPlans`, `neededRoles`,
  `roleAssignments`) to `apps/convex/schema.ts` with the listed indexes.
- Add `isServingTeam: v.optional(v.boolean())` to `chatChannels`.
- No data migration; all tables start empty.

### Track B — Backend: teams & roles

New module `apps/convex/functions/scheduling/` (mirror `pcoServices/` layout).

- `teams.ts`
  - `markChannelAsTeam` (mutation) — set `isServingTeam`. Auth: channel
    admin/moderator or group leader.
  - `listTeamChannels` (query) — serving channels for a group.
- `roles.ts`
  - `createRole`, `updateRole`, `archiveRole`, `reorderRoles` (mutations).
  - `listRoles` (query) — by channel, non-archived, sorted.
  - `suggestStarterRoles` (query) — given a channel name, return a suggested
    role set (keyword map, e.g. "worship"/"band" → Vocals/Drums/Keys/Guitar/
    Bass; "tech"/"production" → Sound/Lights/ProPresenter/Camera; "usher"/
    "host" → Greeter/Usher). `markChannelAsTeam` offers these; leader edits
    or dismisses before they are written as `teamRoles`.
- Shared auth helper `requireScheduler(ctx, channelId)` — channel
  admin/moderator OR campus group leader OR community admin. Must throw
  `ConvexError` (not `Error`) so the client `AuthErrorBoundary` can recover.

### Track C — Backend: events & needed roles

- `events.ts`
  - `createEvent`, `updateEvent`, `deleteEvent` (mutations) — `deleteEvent`
    cascades to `neededRoles` + `roleAssignments`.
  - `setNeededRoles` (mutation) — declare counts per role. Seed from
    `teamRoles.defaultNeeded` on event creation.
  - `listEvents` (query) — by group, upcoming, with fill summary
    (filled vs. needed per role).
  - `getEvent` (query) — full event: needed roles, assignments grouped by role,
    each assignment's status.

### Track D — Backend: assignments & lifecycle

- `assignments.ts`
  - `assignRole` (mutation) — create `unconfirmed` assignment. Denormalize
    `eventDate`. Returns a double-booking flag if the user has another
    assignment on the same `eventDate`.
  - `unassign` (mutation).
  - `respondToAssignment` (mutation) — volunteer sets `confirmed` / `declined`
    (+ optional `declineNote`), stamps `respondedAt`. A `declined` assignment
    is left in place but the slot counts as open (fill summary counts
    `confirmed` + `unconfirmed` only).
  - `publishEvent` (action) — set event `published`, then for every
    `unconfirmed` assignment send a request notification (push + SMS) via the
    existing event-invite notification path, with accept/decline deep links.
  - `previousFillers` (query) — for a `roleId`, distinct `userId`s from
    `roleAssignments.by_role` where `status === "confirmed"`, ordered by
    `eventDate` desc. Powers the assign-UI quicklink.
- `mySchedule.ts`
  - `myAssignments` (query) — `roleAssignments.by_user`, upcoming, joined with
    event + role + channel display info.

### Track E — Mobile: scheduler UI

Under `apps/mobile/features/scheduling/` (new feature folder).

- Team setup: a "Set up as serving team" affordance in channel settings; roles
  editor (add/rename/reorder/archive, color, default count).
- Event list screen for a campus group — upcoming events with fill progress.
- Event editor screen:
  - Date + time(s).
  - Needed-roles editor per team.
  - Assignment view: per role, slots with assigned people and status; an
    assign sheet listing channel members with "previously filled by" names
    surfaced first; double-booking warning badge.
  - Publish button.
- Route: `app/(user)/leader-tools/[group_id]/scheduling/...`.

### Track F — Mobile: volunteer experience

- "My Schedule" screen — upcoming assignments grouped by date, status pills.
- Per-assignment Accept / Decline (and bulk accept-all per event); decline
  prompts an optional one-line note.
- Deep-link target so push/SMS request links open straight to the assignment.
- Surface pending requests in the existing Inbox/notification UI.

### Track G — Tests

- Convex unit tests under `tests/apps/convex/__tests__/scheduling/`:
  - assignment state machine (unconfirmed → confirmed/declined; reassign).
  - fill summary math (declined does not count as filled).
  - double-booking detection.
  - `previousFillers` ordering and de-duplication.
  - `requireScheduler` auth (admin/moderator/leader pass; member rejected).
- Write tests first per the repo's TDD guidance.

## Reused infrastructure (do not rebuild)

- **Notifications** — Expo push + Twilio SMS via the event-invite path
  (#390/#393). `publishEvent` calls into it; no new notification system.
- **Channel membership & roles** — `chatChannelMembers` is the roster;
  `role` gives scheduler permission.
- **Serving history pattern** — `previousFillers` follows the derived-query
  approach already used for `groups.pcoServingCounts`.
- **Leader-tools routing** — new screens live beside the run-sheet tool.

## Explicitly deferred to Phase 2+

Matrix grid, auto-schedule, templates, recurring events, native order-of-items
+ Run Sheet cutover, PCO importer, song library, blockouts, role
qualifications.

## Risks / watch-items

- **Channel deletion** must cascade to `teamRoles` / `roleAssignments`.
- **Permission consistency** — every scheduling mutation goes through
  `requireScheduler`; `respondToAssignment` must verify the caller owns the
  assignment.
- **Notification volume** — `publishEvent` can fan out many requests; batch
  through the existing job worker rather than sending inline.
- **Naming collision** — "event" maps to two tables (`meetings` and
  `eventPlans`); keep `eventPlans` internal naming explicit in code per
  ADR-023.
