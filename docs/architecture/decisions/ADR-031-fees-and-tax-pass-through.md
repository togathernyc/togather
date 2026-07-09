# ADR-031: Fees & Tax Pass-Through (the $1 base stays fee-free)

## Status

Accepted (2026-07)

## Context

Per-active-member billing (ADR-030) prices the software at **$1/month per
billable active member**. ADR-030 noted the fee drag this leaves on the table:
a $30 invoice loses ~3.9% to Stripe's 2.9% + $0.30, and the nonprofit discount
does not apply to our SaaS charges. Absorbing that means the advertised $1 is
really ~$0.96 of margin, and the number gets worse on smaller communities.

The product decision is that the advertised per-member price is the price of the
**software** and should never quietly absorb payment-processor or tax cost. Both
should be visible, itemized, and paid by the customer — the same way most B2B
SaaS handles sales tax, and the way donation platforms surface processing fees.

## Decision

**Keep the base price ($1/active member, or a legacy fixed monthly price)
fee-free. Push both sales tax and card processing to the customer as amounts
layered on top, itemized separately.**

Implementation (`functions/ee/billing.ts`):

- **Sales tax — Stripe Tax.** Every price we create is marked
  `tax_behavior: "exclusive"`, and checkout sessions enable
  `automatic_tax`, collect a billing address, and offer tax-ID collection.
  Tax is computed by Stripe and added on top of the shown price, never baked
  in. Gated behind `BILLING_TAX_ENABLED` because `automatic_tax` errors at
  checkout unless Stripe Tax registrations are configured in the Stripe
  account first.
- **Card processing — a separate disclosed line.** When enabled, a second
  "Payment processing" subscription line is added, priced at
  `PROCESSING_FEE_RATE` (**2.9%**, exactly Stripe's percentage component) of
  the base and carried at the **same quantity** as the base line. It is priced
  with Stripe's fractional-cent `unit_amount_decimal` (e.g. `"2.900000"` per
  $1 member) so the fee is exactly 2.9% of the base at any member count —
  never a coarse per-member rounding that would drift **above** cost on large
  invoices. The fixed $0.30 per-transaction component is deliberately left
  absorbed, which keeps the surcharge strictly at or under the cost of
  acceptance on every invoice size. Mirroring the quantity means the fee
  scales with the member count exactly like the base and the $1 base is never
  inflated. Lines are tagged with price metadata `lineType`
  (`"base"` / `"processing_fee"`) so the monthly sync
  (`syncPerUserSubscriptionQuantities`) updates both quantities in step;
  `selectSubscriptionItems()` does the (unit-tested) split. Legacy
  single-item subscriptions have no `lineType` and are treated as base-only.
- **Disclosure.** The pre-period preview email (`billing.monthly_preview`,
  ADR-030) itemizes the processing line and notes that sales tax is added on
  top, so the fee/tax pass-through is disclosed before the invoice, not
  discovered on it.

### Both are OFF by default

`BILLING_TAX_ENABLED` and `BILLING_PROCESSING_SURCHARGE` both default off, so
shipping this changes nothing in production until ops turns them on. This is
deliberate:

- **Tax** requires Stripe Tax registrations to exist first, or checkout breaks.
- **Card surcharging is legally regulated.** It is **prohibited in some US
  states** (e.g. it has been restricted in Connecticut and Massachusetts),
  **capped at the cost of acceptance** where allowed, and requires
  **card-network registration and ~30-day advance notice** to Visa/Mastercard.
  It must not be enabled without legal sign-off and completed registration.
  The 2.9% rate is chosen to stay at/under cost, but rate is not the only
  compliance requirement.

## Consequences

- The advertised $1/member is honest margin — processing and tax no longer
  erode it. Small communities stop being disproportionately fee-dragged.
- Two moving parts instead of one: the monthly sync now keeps two line-item
  quantities in step, and the preview email itemizes them. Covered by
  `selectSubscriptionItems` / `processingFeeCentsForBase` unit tests.
- The surcharge passes through only Stripe's **2.9% percentage component**, not
  the full 2.9% + $0.30. The fixed $0.30 per invoice is absorbed, so on small
  invoices we recover slightly less than the true processing cost — the
  trade-off for staying provably at/under the cost of acceptance on every
  invoice size (a flat 3% would have exceeded cost on large invoices; see the
  `billing-per-user` cost-of-acceptance test).
- Because surcharging compliance is jurisdictional, the safe path if legal
  review comes back mixed is to enable **tax pass-through only** (leave
  `BILLING_PROCESSING_SURCHARGE` off) and keep absorbing processing fees, or
  fold a flat processing allowance into the base price in a future revision.
