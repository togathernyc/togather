# ADR-029: Giving Statements — IRS-Compliant Receipts (Phase 3)

> **Terminology.**
> - **Statement** — a year-end (or on-demand) tax receipt a community issues to a
>   donor, aggregating all their charitable gifts for a tax year.
> - **Contemporaneous written acknowledgment** — the IRS-required receipt a donor
>   needs for any single gift ≥ $250 (Pub. 1771).
> - **Quid pro quo** — a gift where the donor received goods/services in return;
>   only the excess over fair value is deductible.

## Status

Proposed

## Date

2026-06-24

## Context

ADR-028 established the append-only `donations` ledger and deliberately captured
the tax fields statements need (`goodsOrServicesProvided`, `goodsValue`) so this
phase requires **no backfill**. This ADR specifies generating, storing,
delivering, and versioning **IRS-compliant giving statements**.

Statements are a core differentiator and a **compliance surface** — they must
satisfy IRS Pub. 1771 substantiation/disclosure rules (see PRD §6). They are
issued by the **community (its EIN)**, never Togather (ADR-028 donee-of-record
model). A statement aggregates a donor's gifts across **all funds/groups** within
one community.

## Decision

### 1. Schema (`apps/convex/schema.ts`)

```ts
givingStatements: defineTable({
  communityId: v.id("communities"),
  donorUserId: v.id("users"),
  taxYear: v.number(),                  // e.g. 2025
  r2Key: v.string(),                    // PDF object key in Cloudflare R2
  totalGross: v.number(),               // cents, all gifts in year
  totalDeductible: v.number(),          // cents, after quid-pro-quo reductions
  giftCount: v.number(),
  version: v.number(),                  // bumped on regeneration (refunds/edits)
  status: v.union(
    v.literal("generating"),
    v.literal("issued"),
    v.literal("superseded"),            // an older version replaced by a newer
  ),
  issuedAt: v.optional(v.number()),
  createdAt: v.number(),
})
  .index("by_community_year", ["communityId", "taxYear"])
  .index("by_donor_year", ["donorUserId", "taxYear"])
  .index("by_community_donor_year", ["communityId", "donorUserId", "taxYear"]),
```

### 2. Statement content (what the PDF must contain)

Per Pub. 1771, each statement renders:

- Community **legal name + EIN** (from `communityGiving.legalName` / `.ein`).
- Donor name + address; tax year.
- **Itemized list** of gifts: date, amount, fund/group designation, method.
- **Total deductible** amount.
- The **goods-or-services statement**, computed from the gifts:
  - If no gift had `goodsOrServicesProvided` → *"No goods or services were
    provided in exchange for these contributions."*
  - If any did → itemize the good-faith value (`goodsValue`) and state the
    deductible excess (quid pro quo).
  - **Intangible-religious-benefits** option (community setting): *"Any goods or
    services provided consisted solely of intangible religious benefits."*
- Note that the receipt is for gifts of **$250+** where applicable (the
  aggregated year-end statement satisfies the contemporaneous requirement).

### 3. Generation pipeline

PDF generation runs in a **Node-runtime Convex action** (`"use node"`) using
**`pdf-lib`**, then uploads to **Cloudflare R2** (already the app's storage — same
path as profile photos / receipts).

```ts
// apps/convex/functions/ee/giving/statements.ts  ("use node")
export const generateStatement = internalAction({
  args: { communityId, donorUserId, taxYear: v.number() },
  handler: async (ctx, args) => {
    // 1. mark/insert givingStatements row → status "generating"
    // 2. runQuery: load community legal name/EIN + all donor donations in year
    //    (status "succeeded", minus refunds) via donations.by_donor + filter
    // 3. compute totalGross, totalDeductible (subtract goodsValue), goods stmt
    // 4. render PDF with pdf-lib (community branding: name, logo, primaryColor)
    // 5. upload PDF to R2 → r2Key
    // 6. runMutation: patch row → status "issued", issuedAt, totals, version
    // 7. schedule delivery (push + Resend email)
  },
});
```

### 4. Auto-issue cron + on-demand

```ts
// apps/convex/crons.ts (append)
crons.cron("annual-giving-statements", "0 14 15 1 *", // Jan 15, 14:00 UTC
  internal.functions.ee.giving.statements.issueAnnualStatements, {});
```

- `issueAnnualStatements` enumerates, per active-giving community, every donor with
  ≥1 succeeded gift in the prior tax year and schedules `generateStatement` for
  each (fan-out via `ctx.scheduler`, throttled to respect rate limits).
- **On-demand**: a `requestStatement` action lets a donor (or admin) generate/fetch
  any year's statement immediately from **My Giving** (ADR-028 §5).
- **Download**: `getStatementUrl` query returns a short-lived signed R2 URL.

### 5. Versioning & corrections

- Statements are **immutable once issued**. A refund or admin correction after
  issuance triggers regeneration: the old row → `superseded`, a new row with
  `version + 1` and `status "issued"`. Donors are notified of a corrected
  statement. Both versions retain their R2 objects (audit trail).

### 6. Delivery

- **Push** (Expo) + **email** (Resend): "Your {year} giving statement from
  {community} is ready," linking to an in-app My Giving download (signed URL).
- No PDF is emailed as an attachment (keeps PII out of mail; download is
  authenticated in-app).

## Consequences

- Communities can satisfy IRS substantiation for their donors with zero manual
  work; the statement is correct by construction (their EIN, aggregated gifts).
- Introduces a **Node-runtime action** + `pdf-lib` dependency (gate per native-dep
  rules if it reaches mobile; here it's server-only, so no mobile concern).
- Annual cron is a **fan-out**; must throttle generation + delivery.
- Quid-pro-quo support exists but depends on gifts being correctly tagged at
  capture time (ADR-028 default is `false` → fully deductible).
- Statements depend on `communityGiving.ein` / `legalName` being set — added to
  the onboarding checklist (it's already on the table from ADR-028).

## Alternatives Considered

- **HTML email receipt only** (no PDF). Rejected: donors expect a downloadable,
  archival PDF for tax filing; a stored PDF is also the cleaner audit artifact.
- **Per-gift receipts instead of annual aggregation.** We do both conceptually,
  but the **annual aggregate** is the headline (IRS accepts it and it's far less
  noisy); per-gift confirmation already exists as the in-app receipt.
- **Third-party statement service.** Rejected for v1: content rules are simple
  enough to own, and keeping donor data in-house (R2) avoids another processor.
- **Generating PDFs in the V8 (non-Node) runtime.** Rejected: PDF libraries need
  Node APIs; an isolated `"use node"` action is the supported path.

## References

- ADR-028 (foundation, donations ledger), PRD §6
- IRS Pub. 1771: https://www.irs.gov/pub/irs-pdf/p1771.pdf
- IRS written acknowledgments:
  https://www.irs.gov/charities-non-profits/charitable-organizations/charitable-contributions-written-acknowledgments
