# ADR-029: Per-Active-Member Billing ($1/month, advance-billed, rolling 30 days)

## Status

Accepted (2026-07)

## Context

Community creation is now demo-first (see `functions/demo.ts`): churches
create a community in demo mode and go live by adding payment. The legacy
model — propose a monthly price, staff review, fixed-price Stripe
subscription — doesn't fit a self-serve funnel, and church-market research
shows its tiered/quote-based alternatives are the most resented pricing
patterns in this space.

We researched the main per-user billing patterns in production SaaS before
committing:

| Pattern | Example | Why we didn't pick it |
| --- | --- | --- |
| Mid-cycle prorated credits for inactive users | Slack Fair Billing | Most customer-friendly model, but requires a credits ledger; amount learned after the fact; even Slack tightened it in 2023. Unjustifiable complexity at $1/member. |
| Calendar-month MAU, billed in arrears | Auth0, Intercom | Arrears billing is the root of the "surprise bill" genre; Auth0's pricing cliffs created the "growth penalty" backlash; Intercom's 90-day active-people change caused 5–10× overnight increases and public exits. |
| Metered usage (Stripe Billing Meters) | usage-based SaaS | Truest "pay for what you used" and eliminates sync races, but moves payment after service — bad-debt exposure with volunteer-managed church cards and heavier dunning reliance. |
| Manual seat management | Google Workspace, Notion, Figma | Managing "seats" at congregation scale is absurd; Figma's silent seat true-ups caused viral billing outrage; Mailchimp/ChurchTrac show the resentment of billing on total records rather than activity. |
| High-water-mark (bill on peak) | Datadog | Worst possible fit: church attendance runs ~+50% at Easter/Christmas (NBER), so two Sundays a year would set the bill. |
| Banded tiers / flat | Planning Center, Realm, Breeze | Tier cliffs on growth are the #1 pricing complaint in church software. Flat (Breeze $72) is loved but regressive for small churches. |

Church-market facts that shaped the decision: churches of 100–500 members
typically pay $50–300/month for ChMS; no major church product bills on active
app users (closest precedents: Planning Center Check-Ins' busiest-day
pricing, Realm's attendance tiers); the market rewards flat/predictable and
punishes surprise increases.

## Decision

**$1/month per billable active member, advance-billed, linear, no cliffs,
rolling 30-day activity window, per community.**

- **Billable active member** (`functions/memberActivity.ts`): an active
  membership (`status === 1`) of a real account (not `isPlaceholder`), whose
  `userCommunities.lastLogin` — stamped on login, community switch, and app
  foreground while that community is active (`users.recordActivity`) — is
  within the past 30 days, and who has not been manually marked inactive
  (`userCommunities.billingInactive`, settable by community admins and the
  member's group leaders).
- **Per community, not app-wide**: activity in one community never makes a
  person billable in another.
- **Same number the admin already sees**: the definition intentionally
  matches the admin Stats "Active Members" card, so the Stats tab is the
  bill preview.
- **Advance billing**: a licensed Stripe subscription anchored to the 1st.
  A cron on the 28th (`crons.ts` → `syncPerUserSubscriptionQuantities`)
  recounts each community and updates the subscription quantity with
  `proration_behavior: "none"`; the invoice on the 1st bills the new count
  for the coming month. Mid-month joins/drops simply land in next month's
  count (the 28th→1st drift window is ~3 days and roughly symmetric).
- **Pre-period disclosure**: after each sync, community admins get an email
  (`billing.monthly_preview`) with the count and the amount the 1st will
  bill, while there's still time to mark members inactive. This is stronger
  disclosure than any surveyed model (Slack's customers learn after the
  fact).
- **Ops alerting**: sync failures and >30% month-over-month count swings
  (on baselines ≥10) email `BILLING_ALERT_EMAIL` — silent billing drift is
  the pre-renewal-sync pattern's main operational risk.
- **Demo conversion** (`convertDemoToLive`) starts checkout at the current
  billable count; the webhook stamps `billingModel: "per_active_user"`.
- **Legacy migration** (`migrateToPerUserBilling`, staff-run, dry-run by
  default) swaps existing fixed-price subscriptions to the $1/member price
  at the next renewal and opts them into the sync + preview email.

## Consequences

- Growth is never penalized: member #251 costs $1, same as member #51 — no
  cliffs to resent, no seats to manage, no paying for dead records (dormant
  members age out of the window automatically).
- Seasonal spikes pass through: the invoice after Easter/Christmas will be
  higher, then self-correct a month later. We message this honestly rather
  than smoothing; if it becomes a complaint theme, billing on the median of
  weekly counts is a compatible future refinement.
- Revenue depends on the sync cron; hence the ops alert. A dead-man's-switch
  (alert when the cron *didn't run*) still requires external monitoring.
- Small invoices carry fee drag (a $30 invoice loses ~3.9% to Stripe's
  2.9% + 30¢; the nonprofit discount does not apply to our SaaS charges).
  An annual-prepay option (12 × current count) is the natural future add.
- Stripe's legacy usage-records API is removed in current API versions; if
  we ever move to arrears billing, the path is Billing Meters with `last`
  aggregation.
