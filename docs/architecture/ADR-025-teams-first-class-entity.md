# ADR-025: Teams as a First-Class Entity — Decoupling Team from Channel

> **Terminology.** Inherits ADR-023 / ADR-024 vocabulary. **Event** = a
> community event on the Events tab (`meetings`). **Event Plan** = a dated thing
> volunteers are rostered to (`eventPlans`). A **team** has **roles**, not
> "positions". No "service" language user-facing. This ADR changes what a
> *team* **is** at the data layer: it is no longer a chat channel.

## Status
Accepted

## Date
2026-05-22

## Context

ADR-023 chose **channel-as-team**: a serving team *is* a `chatChannels` row
with `isServingTeam: true`. `teamRoles`, `neededRoles`, and `roleAssignments`
are all keyed by `channelId`; cross-team selectors reference `sourceChannelId`.
ADR-024 kept that model verbatim — it was explicitly "a navigation/UX
reorganization — no schema changes are required."

ADR-023's reasoning was sound at the time: the PCO integration already created
a channel per team, `chatChannelMembers` already half-modelled a roster, and
channels gave membership + chat + permissions "for free."

But ADR-024's UX work — making **Team** a first-class *concept* in the
Rostering hub — plus a backend-free clickable prototype built to validate that
UX, surfaced a mismatch the model cannot express:

1. **Not every team needs a chat channel.** Per product direction: *"some teams
   may not need channels."* A Communion Prep team that only needs a
   setup/cleanup roster should not be forced to spawn a chat room nobody posts
   in. Under channel-as-team there is no team without a channel — the team *is*
   the channel.

2. **The stated identity contradicts the schema.** ADR-024 §3 already says the
   chat channel is "an *attribute*, not the identity" of a team — but the
   schema says the exact opposite. `teamRoles.channelId`,
   `neededRoles.channelId`, `roleAssignments.channelId`, and
   `crossTeamSync.selectors[].sourceChannelId` all use a channel id *as* the
   team identifier. The doc and the data model disagree.

3. **A team's lifecycle is laundered through a channel's.** Creating a team
   means creating a channel and then calling `markChannelAsTeam`. The team has
   no name of its own, no archive state of its own, no creation event of its
   own — every team operation is a channel operation in disguise.

The prototype modelled a team with an explicit `hasChannel: boolean` and an
identity independent of any channel. The UX held up across team creation,
inline role definition, and assignment. This ADR makes the data model match
the concept the prototype validated.

## Decision

Introduce a first-class **`teams`** table. A team **optionally** has a chat
channel (`teams.channelId`). Re-key `teamRoles`, `neededRoles`,
`roleAssignments`, and cross-team selectors from `channelId` to `teamId`.

This **supersedes ADR-023's "channel-as-team" core model** and the "no schema
changes" claim in ADR-024. The *UX / information-architecture* decisions in
ADR-024 (Rostering hub, Custom-only Create Channel, the three hub views) stand
unchanged — this ADR is the data-layer foundation they always implied.

### 1. The `teams` table

A team is a roster of volunteers that owns roles and is scheduled onto event
plans. It belongs to a campus `group`. It *may* point at a chat channel.

```ts
teams: defineTable({
  groupId: v.id("groups"),                      // campus group the team belongs to
  communityId: v.id("communities"),
  name: v.string(),
  description: v.optional(v.string()),
  channelId: v.optional(v.id("chatChannels")),  // the team's chat channel, if any
  isArchived: v.optional(v.boolean()),
  createdAt: v.number(),
  createdById: v.id("users"),
  updatedAt: v.number(),
}).index("by_group", ["groupId"])
  .index("by_community", ["communityId"])
  .index("by_channel", ["channelId"]),          // resolve a team from its channel
```

### 2. A team optionally has a channel

- **Most teams have a channel.** That is where the team chats; `channelId` is
  set, and that channel still appears in the inbox `ChannelsSection` (ADR-024
  §3 — chat lives in the inbox, the roster is managed in the hub).
- **A team can exist with `channelId: undefined`** — a pure roster, no chat
  surface. Its roster is *only* the derived set of role assignments.
- **A channel-less team can gain a channel later** (and vice versa) — the link
  is a single mutable field, not the team's identity.
- **`isServingTeam` on `chatChannels` is kept but redefined.** It no longer
  *makes* a channel a team; it is a denormalized convenience flag meaning "this
  channel is some team's chat channel," used for cheap inbox rendering. It is
  set when a team links a channel and cleared when it unlinks. The authoritative
  link is `teams.channelId` + the `by_channel` index.

### 3. Re-key the dependent tables

| Table             | Was                          | Becomes                    |
| ----------------- | ---------------------------- | -------------------------- |
| `teamRoles`       | `channelId` · `by_channel`   | `teamId` · `by_team`       |
| `neededRoles`     | `channelId` · `by_plan_channel` | `teamId` · `by_plan_team` |
| `roleAssignments` | `channelId` · `by_channel_eventDate` | `teamId` · `by_team_eventDate` |
| `chatChannels.crossTeamSync.selectors[]` | `sourceChannelId` | `sourceTeamId`  |

`roleAssignments.channelId` was a denormalization (copied from the role) powering
the same-day double-booking query; `teamId` serves that role identically via
`by_team_eventDate`. `eventPlans` is unaffected — it is already keyed by
`groupId`, never by channel.

### 4. Membership reconciliation

`reconcileTeamChannel` keeps its job — mirroring `roleAssignments` into
`chatChannelMembers` (`syncSource: "event_plan"`) — but is now keyed by team:

- The reconcile entrypoint takes a **`teamId`**. It resolves `team.channelId`.
  **If the team has no channel, reconcile is a no-op and returns early** — a
  channel-less team has assignments but no chat roster to sync.
- Cross-team channels: selectors reference `sourceTeamId`.
  `reconcileTeamChannelImpl` reads each source team's `roleAssignments` via the
  new `by_team_eventDate` index.
- The daily `reconcileAllTeamChannels` cron iterates `teams` (with a channel)
  plus cross-team channels, instead of iterating `isServingTeam` channels.

### 5. PCO teams stay out of the `teams` table

Per the product clarification — *"PCO channels are by definition cross-team
already; PCO has its own concept of teams"* — Planning Center is **not**
modelled as a native team. The `teams` table is **native-only**; every row in
it is a Togather-native team by construction.

This refines ADR-024 §6, which framed "schedule source" as a per-team attribute
(Native vs Planning Center). With the `teams` table native-only, *source* is
**not a field** on `teams`. PCO serving teams remain `chatChannels` rows with
`channelType: "pco_services"`, synced by the separate `pcoServices/` subsystem
and `autoChannelConfigs` — exactly as today, untouched.

ADR-024's **UX** is unchanged: the **Teams view** still shows both. It unions
native `teams` rows with the group's `pco_services` channels *at the
presentation layer* and source-badges each. The two data models stay fully
separate; only the view merges them.

### 6. Team creation becomes a real operation

`createServingTeam` — left as "an implementation detail, not a requirement" by
ADR-024 §4 — is promoted to a first-class mutation:

1. Insert the `teams` row (name, description, group).
2. If a channel is requested (**default yes**), create a `custom`
   `chatChannels` row, set `teams.channelId`, and set the channel's
   `isServingTeam: true`.
3. Seed starter roles (ADR-023's name-inferred suggestions), keyed by `teamId`.

A channel-less team simply skips step 2. `markChannelAsTeam` and the
"convert an existing channel" path (already removed from the UI by ADR-024 §4
decision 4) are **deleted** — teams are created only through `createServingTeam`.

`addPermanentMember` / `removePermanentMember` / `listPermanentMembers` operate
on a team's channel membership; they require `team.channelId` to be set and
error cleanly on a channel-less team.

Permission gates are unchanged: native team creation = group leader or
community admin.

## Schema (final state)

```ts
// teams — see §1 above.

teamRoles: defineTable({
  teamId: v.id("teams"),                 // was: channelId
  communityId: v.id("communities"),
  name: v.string(),
  color: v.optional(v.string()),
  sortOrder: v.number(),
  defaultNeeded: v.optional(v.number()),
  isArchived: v.optional(v.boolean()),
  createdAt: v.number(),
  createdById: v.id("users"),
}).index("by_team", ["teamId"]),

neededRoles: defineTable({
  planId: v.id("eventPlans"),
  teamId: v.id("teams"),                 // was: channelId
  roleId: v.id("teamRoles"),
  count: v.number(),
}).index("by_plan", ["planId"])
  .index("by_plan_team", ["planId", "teamId"]),

roleAssignments: defineTable({
  planId: v.id("eventPlans"),
  teamId: v.id("teams"),                 // was: channelId
  roleId: v.id("teamRoles"),
  userId: v.id("users"),
  eventDate: v.number(),
  status: v.string(),                    // "unconfirmed" | "confirmed" | "declined"
  timeLabel: v.optional(v.string()),
  declineNote: v.optional(v.string()),
  assignedById: v.id("users"),
  assignedAt: v.number(),
  respondedAt: v.optional(v.number()),
  pcoAssignmentId: v.optional(v.string()),
}).index("by_plan", ["planId"])
  .index("by_user", ["userId"])
  .index("by_user_status", ["userId", "status"])
  .index("by_plan_role", ["planId", "roleId"])
  .index("by_role", ["roleId"])
  .index("by_team_eventDate", ["teamId", "eventDate"]),

// chatChannels.crossTeamSync.selectors[].sourceChannelId  ->  sourceTeamId
```

## Migration

This is a breaking re-key of live `teamRoles` / `neededRoles` /
`roleAssignments` rows. Convex has no `ALTER TABLE`; the safe path is three
deploys.

**Phase M1 — additive.** Add the `teams` table. Add `teamId` as an *optional*
field next to the existing `channelId` on `teamRoles` / `neededRoles` /
`roleAssignments`; add `sourceTeamId` as optional next to `sourceChannelId` in
`crossTeamSync.selectors`. Deploy. Nothing reads the new fields yet — safe to
ship any time.

**Phase M2 — backfill.** A one-off internal mutation `migrateChannelsToTeams`,
batched and idempotent (safe to re-run):
- For each `chatChannels` row with `isServingTeam: true`, insert a `teams` row
  (`channelId` = that channel; `name` / `groupId` / `communityId` copied) —
  deduped via the `by_channel` index.
- For each `teamRoles` / `neededRoles` / `roleAssignments` row, set `teamId`
  from the team owning its `channelId`.
- For each cross-team channel, map every selector's `sourceChannelId` to
  `sourceTeamId`.

**Phase M3 — cutover.** Switch every scheduling function to read/write
`teamId`, and make `teamId` / `sourceTeamId` **required**. The legacy
`channelId` / `sourceChannelId` columns are made `optional` and left in place
as unused dead fields — Convex cannot drop a field while rows still carry a
value for it, and stripping the values needs its own deploy. No code reads the
legacy fields after M3. The `migrateChannelsToTeams` mutation is removed from
the tree at M3 (it is a pre-M3 tool; it lives on in git history at the M1
commit for environments still being migrated).

**Phase M4 — strip (follow-up).** A trivial cleanup once M3 is everywhere:
clear the legacy `channelId` / `sourceChannelId` values and drop the columns.
Pure hygiene, no behaviour change — deliberately deferred so M3 is a single
safe deploy.

**Deploy order.** M3 makes `teamId` required, so it only validates against
backfilled data. Each environment must: deploy M1 (additive — safe any time),
run `migrateChannelsToTeams` until `done: true`, *then* deploy M3. If native
scheduling never reached an environment with data, its M2 is a no-op — but the
sequence is followed regardless so staging and production are identical.

## Phasing (implementation)

- **Backend Phase 1.** Schema M1 (additive). The `teams` table with `listTeams`
  / `getTeam` readers, and the `migrateChannelsToTeams` backfill mutation (M2).
  Tests first (TDD).
- **Backend Phase 2.** Schema M3. `createServingTeam` / `updateTeam` /
  `archiveTeam` / `listCommunityTeams` and team-keyed permanent-member
  functions; `permissions.ts` cut to team-keyed helpers; `roles.ts`,
  `events.ts`, `assignments.ts`, `teamChannelSync.ts`, `crossTeamChannels.ts`
  re-keyed to `teamId`; re-keyed indexes. `markChannelAsTeam` /
  `listTeamChannels` deleted.
- **Frontend.** Follows ADR-024's Phase A/B/C — the hub's `RosteringTeamsScreen`
  and team-detail screen move from `listTeamChannels` to `listTeams`; the
  create-team flow calls `createServingTeam` with a "give this team a chat
  channel" toggle (default on), exactly as the prototype demonstrated.

## Consequences

- A team is finally its own thing: own name, own archive state, own lifecycle.
  A team without a channel is a first-class, supported case.
- The decoupling adds one indirection — code resolves `team.channelId` rather
  than treating the channel id *as* the team. The `by_channel` index keeps the
  reverse lookup (channel → team) cheap.
- A breaking re-key of three tables; mitigated by the three-phase migration.
- `reconcileTeamChannel` gains an early-return for channel-less teams — its
  desired-set logic is otherwise unchanged.
- Cross-team channels now select from `teams`, not channels — their dependency
  on teams (ADR-024 §5) becomes literal in the data model.
- `isServingTeam` survives only as a denormalized rendering hint; the source of
  truth is `teams.channelId`.

## Resolved decisions

1. **`teams` is native-only.** PCO is not a `teams` row; it stays a
   `pco_services` channel. The Teams *view* unions the two for display (§5).
2. **`channelId` is optional and mutable.** A team may have zero or one
   channel, and may link/unlink over its lifetime (§2).
3. **`isServingTeam` is kept**, redefined as a denormalized "this channel
   belongs to a team" hint, not the team-defining flag (§2).
4. **No runtime compatibility shim.** After M3 no code reads the legacy
   `channelId` / `sourceChannelId` columns. They linger only as unused
   `optional` schema fields — Convex cannot drop a populated field in one
   deploy — and a follow-up `M4` strips them (§Migration).

## Open questions

1. Should a team be allowed **more than one** channel (e.g. a leaders-only
   sub-channel)? Out of scope — `channelId` is single-valued for now; revisit
   only if a concrete need appears.
2. When a team **unlinks** its channel, does the channel get archived, become a
   plain custom channel, or stay as-is? Phase 2 implementation decision; the
   conservative default is "becomes a plain custom channel" (`isServingTeam`
   cleared, channel otherwise untouched).
