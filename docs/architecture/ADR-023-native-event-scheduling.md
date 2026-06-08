# ADR-023: Native Event Scheduling & Rostering (PCO Independence)

> **Terminology.** No "service" language anywhere user-facing. Togather has two
> distinct concepts that both relate to dated activity, and they must never be
> conflated in user-facing copy:
>
> - **Event** — a community event on the Events tab, backed by the `meetings`
>   table. The user-facing word "event" is reserved for this.
> - **Event Plan** — a dated thing volunteers are rostered to, backed by the
>   `eventPlans` table. This is the volunteer scheduling/rostering feature. All
>   user-facing copy for this concept says "event plan", never just "event".
>
> An Event Plan can be added to one or more Events (via the optional
> `eventPlans.meetingIds` array). A team has **roles** (not "positions"). PCO's
> product is still referred to as "PCO Services" because that is its proper
> name.

## Status
Proposed

## Date
2026-05-17

## Context

Togather integrates with Planning Center Online (PCO) Services as a **read-only
consumer**. The `pcoServices/` backend pulls PCO's volunteer schedule into
Togather: it creates one channel per PCO team, syncs scheduled people into
channel membership (`chatChannelMembers.syncSource === "pco_services"`), and
renders the order of items via the Run Sheet tool.

PCO remains the system of record. Leaders still log into PCO to do the actual
work — defining teams, declaring how many volunteers each role needs, assigning
people, and chasing confirmations. Togather only mirrors the result.

For a church to drop PCO entirely, the last missing product is **event
scheduling and volunteer rostering**: the recurring act of getting the right
volunteers scheduled to serve. This ADR defines a Togather-native replacement.

## Decision

Build a native scheduling engine. Flip Togather from PCO **consumer** to
**system of record**. PCO becomes an optional one-time **importer** for churches
migrating off it — not a live dependency.

### Core model: channel-as-team

Churches already organize Togather around physical campuses, and the existing
PCO integration already treats a team as a channel. We make that explicit:

| Real-world concept            | Togather entity                          |
| ----------------------------- | ---------------------------------------- |
| Campus ("Brooklyn Team")      | `groups`                                 |
| Serving team (Worship, Tech)  | `chatChannels` (`isServingTeam`)         |
| Team channel membership       | `chatChannelMembers` — auto-synced       |
| Role on a team (Drums)        | `teamRoles` *(new)*                      |
| A dated event plan needing volunteers | `eventPlans` *(new — see open Q1)* |
| Roles to fill on an event plan | `neededRoles` *(new)*                   |
| A person scheduled to a role  | `roleAssignments` *(new)*                |

Rationale for reusing channels rather than a dedicated `serviceTeams` table:

- The PCO integration **already** creates a channel per team.
- `chatChannelMembers` already carries `syncMetadata.position` /
  `syncMetadata.teamName` — channel membership is *already* half-modeling teams.
- Channels give us roster membership, chat, and a permission/role system for
  free. A separate table would re-implement all three.
- It matches how churches already use Togather (campus group → team channels).

A channel opts into being a serving team via `isServingTeam` on `chatChannels`.
Non-serving channels (`main`, `leaders`, `dm`, custom) are unaffected.

### Team channel membership is auto-synced

A team channel's membership is **not manually managed** — it is **derived from
event-plan assignments**, exactly like a PCO auto-channel. This is the native
equivalent of the `pcoServices/rotation.ts` rotation engine.

- `reconcileTeamChannel` computes the channel's members as the **union** of
  every non-declined `roleAssignment` across *all* event plans whose
  `eventDate` falls in a rotation window (~5 days before .. ~1 day after).
  Multiple concurrent event plans simply union together; a volunteer on two
  plans is added once and leaves after their latest in-window event.
- It diffs that desired set against existing `syncSource: "event_plan"`
  members and adds/removes. Manually-added members are never touched.
- `reconcileAllTeamChannels` runs daily via cron (handles dates rolling into
  and out of the window); `publishEvent` / `assignRole` / `unassign` /
  `respondToAssignment` trigger an immediate reconcile of affected channels.
- Because membership is derived, the **assign UI picks assignees from the
  campus group's members**, not the channel's (picking from the channel would
  be circular).

### How roles are defined

**Roles are free-form labels scoped to a team channel.** There is no global role
taxonomy and no qualification system — anyone in the campus group can be
assigned to any of that team's roles.

- A team's roles live in `teamRoles`, keyed by `channelId`. Each role has a
  name, a color, a sort order, and a `defaultNeeded` count.
- Roles are managed in the channel's team settings (see the UX flow doc).
- `defaultNeeded` seeds the `neededRoles` of a new event plan; it stays
  editable per-event-plan.
- The same role name on two different teams is two independent rows — roles do
  not cross team boundaries.
- Archiving a role keeps it on past event plans but removes it from new ones.
- **Starter sets.** When a channel is first marked as a team, Togather offers a
  suggested role set inferred from the channel name (e.g. a "Worship" channel
  → Vocals / Drums / Keys / Guitar / Bass). The set is fully editable and
  dismissable — pure setup convenience, no behavior depends on it.

### Permissions

No new role field. `chatChannelMembers.role` already distinguishes
`admin` / `moderator` / `member`.

- **Schedulers** (define team roles, build event plans, assign people): channel
  `admin` or `moderator`, plus campus group leaders and community admins.
- **Volunteers** (accept/decline their own assignments): any channel member.

### Assignment lifecycle

`roleAssignments.status` is the state machine:

```
            assign                  volunteer responds
  (none) ─────────────▶ unconfirmed ─────────┬────────▶ confirmed
                              ▲              └────────▶ declined
                              │
                       reassign / re-request
```

A declined slot returns to the scheduler as an open `neededRole` to refill.
Notification of new requests and reminders reuses the **existing event-invite
infrastructure** (push via Expo, SMS via Twilio) shipped in #390/#393.

### Deliberately out of scope

Per product direction, these PCO features are **not** replicated:

- **Role qualifications.** Anyone in the campus group can fill any role.
  Instead of a qualification table, the assign UI surfaces a derived
  "previously filled by" quicklink — a query over `roleAssignments` history.
- **Blockout dates / availability.** No availability system *in Phase 1*. A
  lightweight **double-booking warning** (same person, two teams, same calendar
  day) is kept because it is a free derived query — no blockout table.
  **Update (follow-up):** intentional availability collection has since shipped
  — see "Availability collection (follow-up)" below. There is still no blockout
  *calendar*; members opt in per event plan.
- **Song library, arrangements, keys, CCLI reporting.** Deferred; rostering is
  the priority.

### Schema (new tables)

```ts
// A role within a team channel. e.g. "Drums", "Greeter".
teamRoles: defineTable({
  channelId: v.id("chatChannels"),
  communityId: v.id("communities"),
  name: v.string(),
  color: v.optional(v.string()),
  sortOrder: v.number(),
  defaultNeeded: v.optional(v.number()),
  isArchived: v.optional(v.boolean()),
  createdAt: v.number(),
  createdById: v.id("users"),
}).index("by_channel", ["channelId"]),

// A dated event plan volunteers are rostered to. Belongs to a campus group.
eventPlans: defineTable({
  groupId: v.id("groups"),
  communityId: v.id("communities"),
  title: v.string(),
  eventDate: v.number(),                 // event date (ms)
  times: v.array(v.object({              // one or many times that day
    label: v.string(),                   // "9:00 AM"
    startsAt: v.number(),
  })),
  status: v.string(),                    // "draft" | "published"
  notes: v.optional(v.string()),
  meetingIds: v.optional(v.array(v.id("meetings"))), // optional links to Events-tab events
  pcoPlanId: v.optional(v.string()),     // migration link
  createdAt: v.number(),
  createdById: v.id("users"),
  updatedAt: v.number(),
}).index("by_group", ["groupId"])
  .index("by_community_date", ["communityId", "eventDate"]),

// "We need N of role X on this event plan."
neededRoles: defineTable({
  planId: v.id("eventPlans"),
  channelId: v.id("chatChannels"),       // the team
  roleId: v.id("teamRoles"),
  count: v.number(),
}).index("by_plan", ["planId"])
  .index("by_plan_channel", ["planId", "channelId"]),

// A person scheduled to a role on an event plan.
roleAssignments: defineTable({
  planId: v.id("eventPlans"),
  channelId: v.id("chatChannels"),
  roleId: v.id("teamRoles"),
  userId: v.id("users"),
  eventDate: v.number(),                 // denormalized for conflict queries
  status: v.string(),                    // "unconfirmed" | "confirmed" | "declined"
  timeLabel: v.optional(v.string()),
  declineNote: v.optional(v.string()),   // optional free-text on decline
  assignedById: v.id("users"),
  assignedAt: v.number(),
  respondedAt: v.optional(v.number()),
  pcoAssignmentId: v.optional(v.string()),
}).index("by_plan", ["planId"])
  .index("by_user", ["userId"])
  .index("by_user_status", ["userId", "status"])
  .index("by_plan_role", ["planId", "roleId"])
  .index("by_role", ["roleId"]),         // powers "previously filled by"
```

### Relationship to existing systems

- **PCO integration.** `pcoServices/` stays runnable for churches still on PCO.
  A Phase 2 import flow maps PCO plans/teams/assignments into the native tables
  (`pcoPlanId` / `pcoAssignmentId` carry the linkage). The daily
  `pco-auto-channel-rotation` cron retires per-community as churches migrate.
- **Run Sheet.** Currently reads the order of items from PCO. A native
  `eventItems` table is **Phase 2** — Phase 1 event plans are rostering
  containers only. Run Sheet keeps reading PCO during transition.

## Phasing

- **Phase 1 — Rostering MVP.** Team roles, event plans, needed roles, manual
  assignment, accept/decline, volunteer "My Schedule", double-booking warning,
  "previously filled by" quicklink. *(See `event-scheduling-phase-1-plan.md`.)*
- **Phase 2 — Leader efficiency + agenda.** Matrix grid, auto-schedule
  (rotation by longest-since-served), templates, recurring event plans, native
  order-of-items + Run Sheet cutover, PCO importer.
- **Phase 3 — Worship depth.** Song library, arrangements, keys, CCLI.

## Consequences

- Togather owns the scheduling workflow; churches can fully drop PCO.
- A volunteer on two teams must be a member of two channels — matches PCO and
  Togather today.
- No availability data means schedulers may assign someone who is away; the
  accept/decline loop absorbs this. Acceptable trade for a simpler Phase 1.
- Channel deletion must cascade to `teamRoles` and `roleAssignments`.

## Resolved decisions

- **`eventPlans` stays separate from `meetings`.** Togather has two related
  but distinct concepts: user-facing **Events** (community events on the
  Events tab, `meetings`) and user-facing **Event Plans** (rostered event
  plans, `eventPlans`). They stay distinct tables — the rostering lifecycle
  (draft → publish → assign → confirm) differs materially from RSVP — joined
  by an optional `eventPlans.meetingIds` array when one event plan maps to
  one or more Events-tab events (e.g. multi-service day, multi-campus). Code
  keeps `eventPlans` naming explicit, and user-facing copy always says
  "event plan", to avoid the collision.

## Availability collection (follow-up)

Phase 1 shipped without any way to gather "who can serve which date". This
follow-up adds **intentional availability** — a member opts in ("I'm available
to serve this date"), never a blockout calendar. Availability is an *input* to
the leader's assignment decision; it never schedules anyone.

**Model.** One new table, `eventAvailability`, keyed per `(planId, userId)` with
`status: "available" | "unavailable"`. Availability is collected at the
event-plan level (not per time-slot — a deliberate v1 simplification). The
absence of a row is "no response", rendered distinctly from an explicit
"unavailable". A second table, `availabilityRequests`, backs the in-chat card
(mirrors `polls`): a `chatMessages` row with
`contentType: "availability_request"` + `availabilityRequestId`.

**Backend** (`functions/scheduling/availability.ts`,
`functions/messaging/availabilityRequests.ts`):
- `setMyAvailability` / `clearMyAvailability` — a member writes only their own
  row (userId from the token).
- `myUpcomingAvailability(groupId)` — upcoming plans + the viewer's response;
  powers both the dedicated page and the card.
- `availabilityForPlan(planId)` — leader view: every active group member tagged
  available / unavailable / no-response, available-first; powers the assign grid.
- `sendAvailabilityRequest(channelId, …)` — posts the card; the owning group is
  derived from `channel.groupId` and the sender must be a group scheduler.

**Surfaces.** (1) An in-chat card (composer attachment) where members toggle
availability inline; (2) a dedicated "My Availability" page at
`/rostering/[group_id]/availability`; (3) availability badges on each candidate
in `AssignSheet`, plus a one-line tally on the event editor. **Qualifications
are still derived** from the existing `previousFillers` "previously served"
signal — no qualification table (consistent with the non-goal above). Leaders
still make the final call.

**Public, app-optional link.** A leader can share a standalone link
(`https://<domain>/a/<publicToken>`) so people can mark availability **without
the app**. `availabilityRequests.channelId` is optional (standalone requests
have no host message) and every request carries an unguessable `publicToken`.

- `scheduling/publicAvailability.ts` exposes `createAvailabilityLink` (leader)
  plus two **unauthenticated** functions — `getPublicAvailabilityRequest` and
  `submitPublicAvailability`. The token is the capability; submits are
  rate-limited.
- **Matching, the RSVP way:** a submission find-or-creates a *placeholder* user
  keyed by the normalized phone (exactly like `inviteAndAssign`) and writes
  availability against that stable `_id`. When the person later signs up and
  **verifies that phone**, the existing `claimPlaceholderByPhoneInternal` path
  activates the same account — their availability (and any assignments) become
  theirs with no separate reconciliation step. The submit returns `matched`
  when the phone already belonged to a claimed account.
- **Surfaces:** a public web page at `apps/web` `/a/:token` (the web app's first
  Convex integration; Vite + React Router) that works in any browser and
  deep-links into the app when installed; and a mobile `/a/[token]` route that
  forwards app users to the in-app My Availability page. App Links: `/a/` added
  to Android intent filters; iOS `applinks:togather.nyc` already covers it.
  Leaders generate/share the link from the rostering hub (`EventListScreen`).

**Still out of scope:** a blockout calendar, per-time-slot availability,
automatic placement / suggestions, and SMS verification *on the web form*
(verification happens at app signup, RSVP-style).

## Open questions

1. Should a published event plan auto-create an event-plan-scoped chat, or
   reuse the team channel? Defer to Phase 1 implementation.
2. Multi-campus event plans (one event plan, several campuses) — one
   `eventPlans` row per campus for now; revisit in Phase 2.
3. Where should the "My Availability" page surface for members who never
   received a chat request? Today it's reachable from the card footer link and
   the direct route; a persistent entry (e.g. a rostering-hub tab) is a
   follow-up.
