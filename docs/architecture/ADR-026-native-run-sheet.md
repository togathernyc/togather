# ADR-026: Native Run Sheet

> **Terminology.** This ADR follows ADR-023's rule. **Event Plan** is the dated
> rostering entity (`eventPlans`); user-facing copy always says "event plan",
> never "event" or "service". A run sheet is the ordered order-of-items for an
> event plan. PCO's product is still called "PCO Services".

## Status
Accepted

## Date
2026-06-08

## Context

Togather's only run sheet today is **read-only and PCO-derived**. The
`pcoServices/runSheet.ts` actions fetch a Planning Center plan live on every
view, transform its items into a `RunSheetItem[]` shape, compute each item's
clock time by cascading durations, resolve `{{Team > Position}}` placeholders,
and render the result in `features/leader-tools/components/RunSheetScreen.tsx`.
Nothing is persisted in Convex — the run sheet exists only as long as PCO does.

ADR-023 ("PCO Independence") flipped Togather to system-of-record for
rostering and explicitly deferred the run sheet: *"a native `eventItems` table
is **Phase 2** — Phase 1 event plans are rostering containers only. Run Sheet
keeps reading PCO during transition."* This ADR is that Phase 2 cutover for the
order-of-items.

The rostering foundation already exists: `eventPlans` carries an inline
`times: [{ label, startsAt }]` array (the "10am + 12pm, same schedule"
structure), and `teams` → `teamRoles` → `roleAssignments` model who serves
which role on a plan (ADR-025). A native run sheet is a thin, ordered child of
`eventPlans`.

## Decision

Add a native, editable run sheet attached to each event plan. One run sheet per
`eventPlans` row, **shared across all of the plan's `times`** — a plan with a
10am and a 12pm service runs the same ordered list; clock times re-base
automatically per service time. Authoring is native (no PCO). The existing
PCO run sheet stays runnable and read-only for churches still on PCO; the two
are separate data paths that coexist (per ADR-024's no-forced-migration rule).

### Data model: a new `eventItems` table

Run sheet items are a separate table (not an array on `eventPlans`) so each
item is independently queryable, reorderable, and patchable — the last matters
for cross-device editing, where whole-document array rewrites would clobber
concurrent edits.

```ts
eventItems: defineTable({
  planId: v.id("eventPlans"),
  communityId: v.id("communities"),
  sequence: v.number(),                // ordering; reorder rewrites these
  type: v.string(),                    // "song" | "header" | "media" | "item"
  title: v.string(),
  description: v.optional(v.string()),
  durationSec: v.number(),             // drives the cascading clock times
  notes: v.optional(v.array(v.object({ category: v.string(), content: v.string() }))),
  // Links the item to roles rostered on this plan. Role-only by design: the
  // row displays "whoever currently fills this role", resolved live from the
  // plan's roleAssignments — never a copied name, so there is no second
  // source of truth to drift.
  assignments: v.optional(v.array(v.object({ roleId: v.id("teamRoles") }))),
  // Lightweight song metadata. No CCLI / library / chord charts (ADR-023 Phase 3).
  songDetails: v.optional(v.object({
    key: v.optional(v.string()),
    bpm: v.optional(v.number()),
    author: v.optional(v.string()),
  })),
  createdAt: v.number(),
  createdById: v.id("users"),
  updatedAt: v.number(),
}).index("by_plan", ["planId"]),
```

`type` mirrors PCO's vocabulary so leaders migrating off PCO see familiar
words. A `header` is a section divider (typically `durationSec: 0`); it inherits
the clock time of the next non-header item.

### Item timing is computed, never stored

Each item carries a `durationSec`; an item's clock time is the selected service
`time.startsAt` plus the cumulative duration of all preceding items. This is the
same model as the PCO run sheet, simplified: **forward cascade only** — no
pre/during/post service positions (a deferred PCO concept that Phase 1 native
plans don't model). Switching the displayed service time (10am ↔ 12pm) re-bases
the whole sheet with no writes.

The cascade lives in **one pure function**, `computeItemClockTimes(items,
serviceStartMs)`, in `apps/mobile/features/scheduling/utils/runSheetTiming.ts`.
It runs client-side for instant service-time switching. The backend stores and
returns only `durationSec` + `sequence`; it does not compute times. (This
deliberately does not reuse the PCO `computeItemStartTimes`, which is coupled to
PCO's pre/post positions and lives in the PCO action path.)

### People linkage reuses rostering

An item's `assignments` reference the plan's roles by `roleId` only — never a
specific user. The run sheet does not introduce a second source of truth for
who serves: each "Who's involved" chip resolves live from the plan's
`roleAssignments`, so "Song 1 — Lead Vocal: Sarah" stays correct as the roster
changes (and shows just the role until someone is assigned). `listItems` joins
role name/color; the assigned names are resolved client-side from the plan's
roster.

### Permissions reuse the event-plan guards

No new permission concept. Viewing a run sheet requires `requireGroupMember`
(an active member of the plan's group); editing requires
`requirePlanScheduler` (group leader / community admin / team channel
admin-moderator) — the exact guards `events.ts` already uses. Item mutations
resolve the owning plan from the item and delegate to `requirePlanScheduler`.

### Lifecycle integration

- **`deleteEvent` cascades** to `eventItems` (alongside `neededRoles` /
  `roleAssignments`), matching ADR-023's "deletion must cascade" rule.
- **`duplicateEvent` copies** run sheet items (structure copy, like
  `neededRoles`), including their role-only `assignments` links — those
  reference shared `teamRoles`, so they stay valid and resolve to the new
  plan's (initially empty) roster.

### Cross-device editing

Convex reactive queries + the Expo app's web build give "edit on mobile, edit
on laptop" for free — same component, same live-synced data, no extra surface.
Conflict handling is Convex's per-field last-write-wins, which is sufficient at
item granularity; no collaborative-cursor / OT layer. Reordering is a single
`reorderItems(planId, orderedIds)` mutation that rewrites `sequence` atomically.

Drag-to-reorder is implemented with up/down controls rather than a native
drag-and-drop dependency — this keeps the feature OTA-updatable (no
`runtimeVersion` bump, ADR-013) and sidesteps the React-Native-Web `Pressable`
gesture pitfalls.

### Frontend surface

- New route `rostering/[group_id]/run-sheet/[plan_id]` → `RunSheetScreen`.
- An entry row on `EventEditorScreen` ("Run sheet — N items") navigates to it.
- The screen reuses the PCO run sheet's *display* conventions (time column,
  collapsible headers) but is backed by native data with inline add / edit /
  delete / reorder and a service-time toggle.

## Deliberately out of scope (v1)

- **Per-time item variations** (e.g. baptism only at 10am): one shared list.
- **Song library / CCLI / chord charts / arrangements** (ADR-023 Phase 3).
- **PCO import**: PCO run sheets stay read-only and coexist; native is
  greenfield. A one-time importer can map a PCO plan's items → `eventItems`
  later.
- **Pre/during/post service positions**: forward cascade only.
- **Attachments on items**: deferred; notes cover most leader needs.

## Consequences

- Churches can build and run an order-of-items entirely in Togather, removing
  the last live PCO dependency for a service.
- The run sheet stays in sync with rostering because item→person links point at
  `roleAssignments` rather than copying names.
- `eventItems` is a child of `eventPlans`; plan deletion must (and does) cascade
  to it.
- Two run sheet implementations exist during the transition (native
  `eventItems` and read-only PCO). They are intentionally separate; the PCO one
  retires per-community as churches migrate, like the auto-channel rotation.

## Open questions

1. Should a published plan's run sheet be viewable by all assigned volunteers
   (read-only) on their My Schedule, not just schedulers? Likely yes; deferred
   to a follow-up once the editor lands.
2. Per-time item variations may become real for churches whose 10am and 12pm
   genuinely differ. Revisit only if requested — the shared-list default covers
   the stated need.
