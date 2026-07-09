# ADR-031: Sales-Tax Pass-Through (and why not card fees)

## Status

Accepted (2026-07)

## Context

Per-active-member billing (ADR-030) prices the software at **$1/month per
billable active member**, and noted the fee drag it leaves on the table: a $30
invoice loses ~3.9% to Stripe's 2.9% + $0.30, and the nonprofit discount does
not apply to our SaaS charges.

Two costs sit on top of the software price: **sales tax** and **card
processing**. We considered passing both to the customer. They turn out to be
very different problems:

- **Sales tax** is straightforward and expected. SaaS is taxable in a growing
  number of US states, and collecting it on top of the price is standard,
  legal everywhere, and what customers expect. Stripe Tax computes and collects
  it.
- **Card processing** is only passable as a **card surcharge**, which is
  legally regulated. Surcharging is **prohibited outright in a couple of states
  (notably Connecticut and Massachusetts)**, **capped at the cost of
  acceptance** elsewhere, requires **card-network registration + ~30-day
  notice**, and can never apply to debit/prepaid. The regulated thing is a fee
  *identified as a charge for paying by card*. An alternative — folding the
  cost into a single all-in price with no card-fee label — sidesteps the
  surcharge regime entirely, but it means raising the headline number or
  showing processing as part of "the price," which muddies the clean $1 story.

## Decision

**Pass sales tax through to the customer via Stripe Tax. Do not pass card
processing fees through — the $1 base absorbs them.**

Sales-tax implementation (`functions/ee/billing.ts`):

- Every recurring price we create is marked `tax_behavior: "exclusive"`
  (`priceTaxBehavior()`), so tax is added on top of the shown price rather than
  baked into it.
- Checkout sessions enable `automatic_tax`, collect a billing address, and
  offer tax-ID collection (`checkoutTaxParams()`). Stripe computes the tax from
  the customer's address and our registrations.
- Gated behind **`BILLING_TAX_ENABLED`**, defaulting off. This is an
  **operational** gate, not a legal one: `automatic_tax` errors at checkout
  unless Stripe Tax registrations are configured in the Stripe account first.
  Once ops has registered in the states where Togather has nexus, flip the flag.
- The pre-period preview email (`billing.monthly_preview`, ADR-030) notes that
  applicable sales tax is added on top, so it's disclosed before the invoice.

Card processing: **not surcharged.** The $1/member base absorbs Stripe's fee,
as it did before this ADR. Surcharging was scoped out because the compliance
burden (state bans, cost caps, card-network registration, debit exclusion)
outweighs recovering ~2.9% on a $1 line, and the all-in-price alternative
conflicts with keeping $1/member as the clean, quotable headline. If we later
want to recover processing, the low-risk path is an **all-in price** (a single
number the customer pays, no separately-identified card fee), which is outside
the surcharge regime — not a labeled surcharge line.

## Consequences

- Sales tax no longer erodes margin or creates compliance exposure — Stripe
  collects and remits per our registrations. Turning it on is a config step
  (register + flip `BILLING_TAX_ENABLED`), with no code change.
- The advertised $1/member stays clean and unqualified in marketing and the
  pricing guide: it's the software price, tax is the only thing added on top.
- Card processing fee drag remains absorbed (ADR-030's ~3.9%-on-a-$30-invoice
  figure still stands). Accepted as a cost of a simple, legally-clean price.
- No new subscription line items, no surcharge math, no card-network
  registration to maintain — the billing model stays single-line per
  subscription.
