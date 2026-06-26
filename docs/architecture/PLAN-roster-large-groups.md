# Plan: Rostering at 10k+ member groups

**Status:** Draft for review · **Owner:** Scheduling · **Branch:** `claude/rostering-large-groups-0vz95v`

## Problem

`functions/scheduling/roster.ts:rosterMatrix` crashes on large groups:

```
Uncaught Error: Too many reads in a single function execution (limit: 4096).
  at async <anonymous> (apps/convex/functions/scheduling/roster.ts:346:36)   // per-member by_user scan
  at async Promise.all (index 4072)                                          // ~4072 members in
  at async handler   (apps/convex/functions/scheduling/roster.ts:332:24)     // activeMembers.map(...)
```

This is **architectural, not a one-line bug**. A single Convex query may read at most
**4096 documents**, and `rosterMatrix` loads an entire group in one execution. The
**People view** of the grid is the unbounded dimension; the **Roles view** is not.

### Why it exceeds the limit (each of these is independently fatal at 10k members)

| # | Location | Reads | Bound |
|---|----------|-------|-------|
| 1 | `roster.ts:342` — `roleAssignments.by_user.collect()` **inside `activeMembers.map`** | one full per-user assignment scan **× N members** | group size (the crash point) |
| 2 | `roster.ts:280` — `groupMembers.by_group.collect()` | one read per member | group size (10k+) |
| 3 | `roster.ts:335` — `ctx.db.get(m.userId)` fallback **per member** | one read per member | group size |
| 4 | `roster.ts:84` — `eventAvailability.by_plan.collect()` × ≤10 plans | one read per availability response | total responders × plans |
| 5 | `roster.ts:62` — `eventPlans.by_group.collect()` (then sliced to 10) | one read per plan ever created | group event history |

Items **1–3 alone** guarantee failure for any group whose active membership exceeds
~4096, regardless of how the rest is tuned. **The People view cannot be served by a
single query at this scale.** The Roles view, by contrast, is bounded by *how many
people are assigned to ~10 events* (dozens–low hundreds), not by group size — it is
fine once decoupled from the member load.

## Design principle (from review feedback)

> "Can't availability and what groups people are in already be queried on the server side?"

Yes — and that is the core of the fix. Today the grid downloads the **whole** member
array and does availability sorting, name search, and the "also in group" filter
**client-side** (`RosterGridScreen.tsx` lines ~366–397, 706–718). At 10k members the
client should never hold the whole roster. So **availability ordering, name search, and
the group-membership filter all move server-side** as inputs to a **paginated** member
query. The client asks for "page N of members, sorted by availability, filtered to group
X, matching search 'jo'" and renders what comes back.

This is already a solved pattern in this repo: `memberFollowupScores` / `communityPeople`
(`schema.ts:1206`, `schema.ts:2483`) are **denormalized per-(group, member) rows with a
fan of sort indexes** (`by_group_firstName`, `by_group_lastAttendedAt`, …) maintained
specifically "for paginated list reads," consumed via `paginationOptsValidator`
(`functions/memberFollowups.ts:750`). We follow the same shape.

## Proposed architecture

Split the one monolithic query into **two** bounded queries, plus targeted denormalized
counters.

### 1. Slim `rosterMatrix` → Roles view only (bounded for any group size)

Keep: `events`, `teams`, `roles`, `roleCells`, `eventCounts`, `summary`.
**Remove** the entire `members[]` computation (current `roster.ts:279–419`) and the
per-member `by_user` scan. Remaining group-size-dependent reads get bounded:

- **Total member count (for `summary` / `noResponse`):** stop collecting `groupMembers`.
  Reuse the proven O(1) trick from `functions/groups/queries.ts:89–102` — read the
  group's **main channel `memberCount`** (`chatChannels.by_group_type`, `channelType:
  "main"`). Every active member is in the main channel by design.
- **Per-event availability tally (`eventCounts.available/unavailable`):** item #4 above.
  Add **denormalized counters on `eventPlans`** (`availableCount`, `unavailableCount`)
  maintained by the availability write mutations (`functions/scheduling/availability.ts`,
  `publicAvailability.ts`). `rosterMatrix` then reads counts off the ≤10 plan docs
  instead of scanning every response. (Interim option if we defer counters: cap the
  per-plan availability scan and mark the tally "approximate" past the cap — but counters
  are the right answer and match how `chatChannels.memberCount` already works.)
- **Event-plan history (item #5):** add index `eventPlans.by_group_date
  [groupId, eventDate]` and fetch the ≤10 columns with a bounded ranged `.take()` /
  ordered query instead of `collect()`-then-slice, so a group with years of history
  doesn't read its whole plan table.

Result: `rosterMatrix` reads ≈ `(plans ≤10) × (roles + assignments per event)` +
`teams + teamRoles + referenced user/role docs` — all bounded by event/team size, never
by group size. **Roles view works at any scale.**

### 2. New paginated `rosterMembers` → People view

```ts
rosterMembers({
  token, groupId,
  paginationOpts,                       // paginationOptsValidator (cursor + numItems ~50)
  includePast?: boolean,
  sort?: "availability" | "name",       // default "availability"
  search?: string,                      // server-side name match
  alsoInGroupId?: Id<"groups">,         // server-side "also in group" intersection
  limit?: number,                       // event-column cap, mirrors rosterMatrix
}) => { page: MemberRow[], isDone, continueCursor }
```

Each page (~50 members) makes every previously-fatal per-member read **page-bounded**
(50×, not 10k×):

- **Member rows:** paginate over `groupMembers.by_group` (cursor-stable), filtered to
  active (`leftAt == undefined`, `requestStatus` accepted/undefined).
- **Per-member availability cells:** point lookups via `eventAvailability.by_plan_user`
  (or `by_group_user`) for the page's members across the ≤10 plans.
- **Per-member assignment cells:** `roleAssignments.by_user` **per page member** — same
  query as today but 50×, not N×.
- **Double-booking:** tighten to `roleAssignments.by_user_eventDate` ranged against the
  ≤10 plan-day buckets, instead of scanning the member's entire assignment history
  (current `roster.ts:342`). Bounded by page size × plan days.

**Server-side sort/filter/search (the review point):**

- `sort: "availability"` — "most available first" across the **whole** group. Two-tier,
  bounded for the common case: rank the **responder set** (users with availability rows
  in the horizon) by available-count desc, then name; non-responders follow in
  `groupMembers` order. The responder scan is bounded by total responses (≪ members in
  practice). **If we need true 10k-responder scale**, promote this to a denormalized
  per-(group, member) roster row with a `by_group_availabilityScore` sort index —
  exactly the `memberFollowupScores` precedent — and paginate the index directly.
- `sort: "name"` — paginate `groupMembers` joined to `users` (or a denormalized name on
  the roster row per the precedent).
- `search` — server-side name match. Use the `users` `search_users` index intersected
  with group membership (`groupMembers.by_group_user` point checks), or a denormalized
  `searchText` on the roster row (precedent: `communityPeople.search_communityPeople`).
- `alsoInGroupId` — server-side intersection against the other group's membership
  (`groupMembers.by_group_user`), replacing the client-side `rosterFilterMemberIds`
  set-intersection. `rosterFilterGroups` (the dropdown source) stays as-is.

### 3. Frontend (`RosterGridScreen.tsx`, ~3,700 lines)

- **Roles view:** unchanged data source (slim `rosterMatrix`); no UI change.
- **People view:** consume `rosterMembers` via Convex `usePaginatedQuery` with infinite
  scroll; **virtualize** the member rows (`FlashList`/`FlatList` — currently a plain
  mapped `ScrollView`, `RosterGridScreen.tsx:1713`) so 10k rows don't all mount.
- Move the now-server-side controls to query args: availability sort, name search
  (debounced → `search`), "also in group" (→ `alsoInGroupId`). Remove the corresponding
  client-side filtering and the whole-roster assumptions (lines ~366–397, 706–718).
- `eventCounts.noResponse` comes from `rosterMatrix` summary (main-channel count −
  responders), independent of how many member rows are currently loaded.

## Schema / data changes

| Change | Table | Why |
|--------|-------|-----|
| Add `availableCount`, `unavailableCount` | `eventPlans` | O(1) per-event availability tally (item #4) |
| Maintain those counters | `availability.ts`, `publicAvailability.ts` mutations | keep counters correct on every availability write/clear |
| Add index `by_group_date [groupId, eventDate]` | `eventPlans` | bounded event-column fetch (item #5) |
| *(escape hatch, only if responder-scan sort proves too big)* denormalized per-(group,member) roster row + sort/search indexes | new table | true 10k-responder server-side availability sort, per `memberFollowupScores` precedent |

No `runtimeVersion` / native-dependency impact (backend + JS only).

## Migration / rollout

1. Land slim `rosterMatrix` + counters + index first → **stops the crash**, Roles view
   works at any size, People view temporarily empty/loading. Backfill the new `eventPlans`
   counters with a one-off migration over existing plans.
2. Land `rosterMembers` + frontend People-view pagination.
3. Remove dead client-side filter/sort code and `rosterFilterMemberIds` once the
   server-side filter replaces it (or keep `rosterFilterMemberIds` if other callers use it
   — verify before deleting).

## Testing (TDD per CLAUDE.md)

- Convex unit tests: a seeded group with **>4096 active members** + assignments +
  availability across 10 plans must let both queries return without hitting the read
  limit. Add cases for double-booking across events beyond the column cap, archived
  teams/roles still resolving, and non-responders’ `no_response` cells.
- Assert read-bound: each query stays well under 4096 regardless of group size.
- Playwright/visual check of the grid in both views at large scale (seeded).

## Open questions for review

1. **Counters vs. interim cap** for per-event availability tally — add `eventPlans`
   counters now (recommended), or ship an approximate-past-cap tally first and add
   counters later?
2. **Availability sort fidelity** — is the two-tier responder-ranked sort acceptable, or
   do we want the denormalized roster-row table (full `memberFollowupScores`-style
   precedent) from day one?
3. **People view at 10k — product intent:** should it list *every* active group member
   (a 10k congregation), or only members of the teams being rostered? The latter is
   smaller and arguably the real use case; it's a product decision, not just perf.
4. **`rosterFilterMemberIds` / `rosterFilterGroups`** — confirm no other consumers before
   refactoring the "also in group" filter server-side.
