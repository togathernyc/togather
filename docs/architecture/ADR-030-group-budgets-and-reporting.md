# ADR-030: Group Budgets & Financial Reporting (Phases 2 & 6)

> **Terminology.**
> - **Budget** — an admin-set spending *allowance* for a group over a period. A
>   plan/cap, not money. Distinct from a fund *balance* (actual money available).
> - **Actual** — realized spend against a group's fund. Fully realized only once
>   cards exist (ADR-031); until then, "actual outflow" is zero and reporting
>   focuses on giving-in and balances.
> - **Rollover** — whether unspent budget carries into the next period.

## Status

Proposed

## Date

2026-06-24

## Context

ADR-028 gave us `funds` and the `donations` ledger (money in). This ADR adds the
**budget** layer (spending plan per group) and the **reporting/dashboards** that
sit on top of giving, balances, and—once ADR-031 lands—card spend.

A key sequencing reality: **budget "actual" spend comes from cards** (ADR-031).
So Phase 2 delivers the *accounting* budget (allocation, balances, budget-vs-plan
visibility) and Phase 6 delivers *reporting depth*; spend-vs-budget becomes fully
meaningful when card transactions flow. We design budgets so they're useful
immediately (caps, goals, fund balances) and light up further with cards.

## Decision

### 1. Schema (`apps/convex/schema.ts`)

```ts
groupBudgets: defineTable({
  communityId: v.id("communities"),
  groupId: v.id("groups"),
  fundId: v.id("funds"),                 // the fund this budget governs
  amount: v.number(),                    // cents allowed for the period
  period: v.union(v.literal("monthly"), v.literal("annual")),
  rolloverPolicy: v.union(
    v.literal("none"),                   // unspent expires
    v.literal("rollover"),               // unspent carries forward
  ),
  startsAt: v.number(),
  endsAt: v.optional(v.number()),
  createdById: v.id("users"),
  archivedAt: v.optional(v.number()),
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_group", ["groupId"])
  .index("by_community", ["communityId"])
  .index("by_fund", ["fundId"]),

// Pre-computed financial rollups (perf), refreshed by cron — mirrors the
// existing memberFollowupScores pattern rather than scanning ledgers per request.
fundRollups: defineTable({
  communityId: v.id("communities"),
  fundId: v.id("funds"),
  groupId: v.optional(v.id("groups")),
  totalGivenCents: v.number(),           // sum donations.netAmount (succeeded)
  totalSpentCents: v.number(),           // sum cardTransactions (ADR-031); 0 for now
  balanceCents: v.number(),              // given - spent
  giftCount: v.number(),
  donorCount: v.number(),
  periodSpentCents: v.number(),          // spend in current budget period
  computedAt: v.number(),
})
  .index("by_community", ["communityId"])
  .index("by_fund", ["fundId"]),
```

### 2. Budget management (functions)

```ts
// apps/convex/functions/ee/giving/budgets.ts
export const setGroupBudget = mutation({   // requireGroupLeaderOrAdmin (ADR-028 §7)
  args: { communityId, groupId, fundId, amount, period, rolloverPolicy, startsAt },
});
export const getGroupBudgetStatus = query({ // budget vs balance vs (future) spend
  // returns { amount, balanceCents, periodSpentCents, remainingCents, pctUsed }
});
```

- **Guardrails** (enforced where money moves — at card auth in ADR-031): spend
  against a **restricted** fund can't exceed its balance; spend can't exceed
  remaining budget when `budget-aware decline` is on.
- **Rollover** computed at period boundary by the rollup cron.

### 3. Reporting / rollups

- **Reactive queries** (Convex `useQuery`) power live dashboards over `donations`,
  `funds`, `groupBudgets`, and (later) `cardTransactions`.
- **Heavy aggregates** use `fundRollups`, refreshed by a cron (e.g. every 15 min)
  and opportunistically on write — same approach as `memberFollowupScores`. This
  avoids full-ledger scans on every dashboard load.

```ts
// apps/convex/crons.ts (append)
crons.interval("refresh-fund-rollups", { minutes: 15 },
  internal.functions.ee.giving.budgets.refreshFundRollups, {});
```

### 4. Dashboards (queries; UI in wireframes doc)

- **Admin / treasurer** (`requireCommunityAdmin`): giving over time (by group/fund/
  method), fund balances (restricted vs unrestricted), budget-vs-actual per group,
  recurring vs one-time mix, statement issuance status (ADR-029), and—once
  ADR-031 lands—card spend + missing-receipt queue.
- **Group leader** (`requireGroupLeaderOrAdmin`): our budget remaining, fund
  balance, goal progress, recent gifts, recent card spend, missing receipts.
- **Donor**: My Giving (already in ADR-028 §5).

### 5. CSV export

`exportFinancials` action (admin only) streams a CSV of the ledger for a date
range (for the community's accountant / QuickBooks import). No new storage; the
action returns a signed R2 URL or a direct download payload.

## Consequences

- Budgets are useful immediately (caps, goals, balances) and become
  spend-aware once cards land (ADR-031) — no rework, just `totalSpentCents`
  starts being non-zero.
- `fundRollups` adds a cron + a denormalized table to keep dashboards fast; it is
  derived data (safe to rebuild from the ledger at any time).
- Restricted-fund and budget guardrails are **declared here** but **enforced at the
  spend boundary** (card authorization), so they're inert until ADR-031.
- CSV export gives communities an accountant-friendly bridge without us becoming a
  general ledger.

## Alternatives Considered

- **Compute all dashboard aggregates on-read** (no rollup table). Rejected for the
  treasurer dashboard: ledger scans get expensive as giving volume grows; the
  rollup pattern is already proven in this codebase.
- **Budget as a field on the `groups` table.** Rejected: budgets are periodic and
  fund-scoped (a group could have multiple funds); a dedicated table models
  periods/rollover cleanly.
- **Enforcing budget caps at giving time.** Wrong layer — budgets cap *spending*,
  not *giving*. Enforcement belongs at card authorization (ADR-031).
- **Full double-entry/GAAP ledger.** Out of scope (PRD non-goal); CSV export to
  real accounting software is the pragmatic bridge.

## References

- ADR-028 (funds, donations, permissions), ADR-031 (cards — the spend side),
  ADR-029 (statements status in dashboards), PRD §5–§8
- Rollup precedent: `memberFollowupScores` in `apps/convex/schema.ts`
