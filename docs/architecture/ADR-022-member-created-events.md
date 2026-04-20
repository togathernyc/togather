# ADR-022: Member-Created Events & Events-First Navigation

## Status
Accepted

## Date
2026-04-16

## Context

Today only group leaders can create events. Regular members have no way to
propose something to their community — they can only browse groups and RSVP
to leader-hosted events. The result is a passive experience for the majority
of our users.

Separately, the current "Explore" tab bundles both group discovery and event
discovery behind a view toggle (see
`apps/mobile/features/explore/components/ExploreScreen.tsx`). Events are a
second-class citizen: you must tap into Explore, flip the toggle, and then
scroll. For a product whose value proposition centers on gathering, that
hides the primary action.

We previously consolidated events into a unified page (see
`UNIFIED-EVENTS-PAGE-REFACTOR.md`, March 2026) which got us to today's
toggle-inside-Explore state. This ADR is the next step: promote events to a
first-class tab and loosen event creation to members.

## Decision

Two coordinated changes, shipped as two PRs to keep review surface small:

### PR 1 — Navigation split

- Rename the "Explore" tab → **Groups** (map + list of groups only).
- Add a new **Events** tab (list-first, optional map toggle in a follow-up).
- Final tab bar: Groups · Events · Inbox · [Admin] · Profile.
- Rename `ExploreScreen.tsx` → `GroupsScreen.tsx`.
- New Convex query `functions/meetings/events.ts::listForEventsTab`
  returns four pre-sliced buckets: *Happening now → Your RSVPs → This week
  → Later*. Empty buckets are hidden in the UI.
- Community-wide events (events sharing a `communityWideEventId`) are
  collapsed **server-side** into a single grouped card (e.g., "Easter
  Sunday Service · 5 locations · 142 going"). Server-side grouping is
  required because client-side grouping breaks pagination — the same
  parent could otherwise appear on multiple pages.
- Tapping a grouped card opens a sheet with per-group children; there is
  no separate "parent view" because the parent is a conceptual grouping,
  not a real place or time.
- `app/(tabs)/search.tsx` is retained with a one-release redirect for
  `?view=events` to avoid breaking deep links in existing push
  notifications, chat messages, and emails. Removed in a follow-up.

### PR 2 — Member creation, moderation, Profile → My Events

- **Permissions.** `meetings.create` loosens from `isActiveLeader`-only to
  "active member of the group." Updates/cancels allowed for creator +
  group leaders + community admin. Series creation, RSVP-leader-notify
  toggle, chat posting, and community-wide-event creation remain
  leader/admin-only.
- **Guardrail.** Non-leaders capped at 1 future event at a time across
  all groups. Enforced at mutation time via the existing
  `meetings.by_createdBy` index. "Future event" = `status ∈ {scheduled,
  confirmed}` AND `scheduledAt > now`. Cancelled events do not count.
  Convex mutation atomicity covers the race — a concurrent second create
  reads the just-inserted row and rejects.
- **Community events leverage the announcement group** (ADR-008). The
  "community event" UI treatment triggers off
  `groups.isAnnouncementGroup === true`, so no schema migration is
  required. Default the create-event group dropdown to the announcement
  group for members; label attribution as "Community · Hosted by [Name]"
  vs "[Group] · Hosted by [Name]" for regular groups.
- **Location.** Required but flexible. New optional `locationMode` enum
  on `meetings`: `"address" | "online" | "tbd"`. Validation applies
  uniformly to members AND leaders (tightens leader UX for consistency).
- **Reports.** New `meetingReports` table mirrors the `chatMessageFlags`
  pattern. Reports route to the event's group leaders (not community
  admins). `createReport`, stub `listReportsForGroup` and
  `resolveReport`.
- **Notifications.** New `notifyEventCreatedByMember` sender mirrors
  `notifyRsvpReceived`. Fires only when the creator is not a leader.
  **Default OFF for the announcement group** to prevent every community
  admin getting pinged for every member event. Per-user opt-out can be
  added in a follow-up.
- **Ownership on leave.** If a creator leaves their community, their
  future events stay; `createdById` is patched to the primary admin
  (ADR-010). This is a silent side effect on leave-community.
- **Profile → My Events.** New route `/(user)/my-events` with two
  segments: *Hosted* / *Attended*. Upcoming above past within each,
  newest-first. Accessible from the Profile menu and from a link at the
  bottom of the Events tab.
- **Series toggle hidden** (not disabled+tooltip) for non-leaders —
  disabled-with-tooltip is confusing and feels patronizing.
- **Analytics.** Three PostHog events:
  `event_created_by_member` (group_id, is_announcement_group,
  location_type), `event_reported` (event_id, group_id, reporter_role),
  `event_deleted_by_leader` (event_id, deleter_role).

## Alternatives Considered

- **Make `meetings.group_id` nullable** for community-wide events
  (instead of using the announcement-group flag). Rejected: requires
  schema migration and backfill, and the announcement group already
  exists in every community with all members pre-joined (ADR-008).
- **Approval workflow** for member events. Rejected for v1: approval
  creates friction and a moderation burden. Reports + easy leader delete
  is the lighter-weight moderation path. Can add an opt-in moderation
  queue later if abuse materializes.
- **No per-user cap** on member events. Rejected: unlimited creation
  invites spam. A per-user cap of 1 future event is easy to reason about
  and easy to relax later.
- **Disabled series toggle with tooltip** for members. Rejected: hiding
  is cleaner. The toggle reappears automatically if the member becomes a
  leader.
- **Group under single PR.** Rejected: navigation rename and permission
  model are independently reviewable and independently risky.

## Consequences

**Positive**
- Members have a concrete way to contribute; engagement surface area
  grows beyond RSVP.
- Events become a first-class destination, matching their product
  weight.
- Community-wide events stop being represented as N duplicate rows in
  the list view.
- Existing `isAnnouncementGroup` flag does double duty — no new concept.

**Negative / risks**
- `CreateEventScreen.tsx` (2024 lines, currently in `features/leader-tools/`)
  gains conditional UI for members. Carries regression risk. We leave
  the folder location as-is for PR 2 and rename in a follow-up cleanup.
- Location-validation tightening on leaders means existing legacy rows
  with empty locations stay valid, but leaders can no longer *create*
  new events without a location choice. Minor UX change; no data
  impact.
- If members abuse the feature despite the 1-event cap, we need a fast
  path to add per-user or per-community disable. Leaders' delete power
  is the primary mitigation.
- Deep links containing `?view=events` break after the one-release
  redirect. Tracking doc (this ADR) flags the removal window.

## References
- ADR-008: Community Announcement Groups
- ADR-010: Primary Admin Role
- `UNIFIED-EVENTS-PAGE-REFACTOR.md` (prior refactor that produced
  today's Explore-tab toggle state)
- `UNIFIED-EVENTS-REFACTOR-STATUS.md`
- `EVENTS-UI-IMPROVEMENTS.md`
