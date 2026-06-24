# ADR-032: Community-wide Giving (Phase 7, Optional)

## Status

Proposed

## Date

2026-06-24

## Context

The PRD pivoted **group-first** because communities don't want to route their
*primary* donations (tithes/offerings) through the app. But some communities
**do** want an in-app general-fund channel. This ADR specifies that mode as a
small, **opt-in** addition that reuses everything already built — explicitly **not**
positioned as a replacement for a church's primary giving platform.

This is intentionally the **last** phase: the group-giving stack (ADRs 028–031)
must be solid first, and community-wide giving is mostly a *toggle plus a CTA*.

## Decision

Community-wide giving is **the existing designated-giving flow targeting the
community's General fund** (the `funds` row with `isGeneral: true`, `groupId:
null`, from ADR-028). No new money plumbing, ledger, statement logic, or webhook —
all of that already handles a fund with no group.

### 1. The only new state: an explicit enablement flag

```ts
// add to communityGiving (ADR-028) — already listed there:
//   communityWideGivingEnabled: v.boolean()
```

- Defaults to **false**. A community can run **group giving only** and never
  surface a "Give to the church" CTA.
- Flipping it on (admin action) reveals: the General fund in the Give target list,
  and a community-level **Give** entry point (e.g. on the community home).

### 2. Reuse map (what we do NOT rebuild)

| Concern | Reused from |
| --- | --- |
| Charge flow (Apple Pay, direct charge, application fee) | ADR-028 §5 (`createGiftIntent`, `fundId` = General) |
| Ledger | ADR-028 `donations` (just `groupId: null`) |
| Recurring | ADR-028 `recurringGifts` |
| Statements | ADR-029 (already aggregates across all funds, incl. General) |
| Reporting | ADR-030 (General fund appears in fund balances/rollups) |
| Gate | ADR-028 `givingStatus` (must be `active`) |

### 3. Positioning guardrails (product, not code)

- Onboarding copy frames this as **"optional"** and does **not** push communities
  to move their main giving here.
- The default-off flag ensures group-first communities never see it.

## Consequences

- Minimal new surface: one boolean + one CTA + listing the General fund as a Give
  target. Lowest-risk phase by far.
- Communities that want a unified in-app giving experience can opt in; those that
  don't are unaffected.
- Statements automatically include General-fund gifts (no change to ADR-029).

## Alternatives Considered

- **Build community-wide giving first / as the headline.** Rejected — directly
  contradicts the user feedback that drove the group-first pivot (PRD revision
  note).
- **A separate "offering" entity distinct from funds.** Rejected: the General fund
  already models this; a second concept would fragment the ledger and statements.
- **Always-on community-wide giving.** Rejected: must be opt-in so group-first
  communities aren't pushed toward replacing their primary platform.

## References

- ADR-028 (General fund, charge flow, gate), ADR-029 (statements), ADR-030
  (reporting), PRD §9 + revision note
