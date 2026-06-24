# ADR-031: Budget Spending Cards via Stripe Issuing (Phases 4–5)

> **Terminology.**
> - **Issuing balance** — funds reserved on a connected account that issued cards
>   draw from. Separate from the account's payouts/earnings balance.
> - **Authorization** — Stripe's real-time approve/decline request when a card is
>   used. We can respond synchronously (≤ ~2s) to apply budget rules.
> - **Cardholder** — the person a card is issued to (per-person model). Requires
>   some KYC.

## Status

Proposed

## Date

2026-06-24

## Context

ADRs 028/030 established funds, the donations ledger, and group budgets — but
budgets were inert on the *spend* side. This ADR adds **spending**: authorized
people use **Stripe Issuing** cards to spend a group's budget, with per-card
limits, real-time budget enforcement, receipt capture, and full attribution.

This is the **highest-risk, highest-compliance** phase: it requires Stripe
Issuing enablement, cardholder/business KYC, funded Issuing balances, and a
fast-path authorization webhook. Per the PRD recommendation, **v1 is per-person
cards** (clean attribution); shared cards are a discouraged fast-follow.

## Decision

### 1. Phasing within this ADR

- **Phase 4 (v1):** per-person **virtual** cards, limits, Issuing-balance funding,
  receipt capture, reconciliation to ledger/budget.
- **Phase 5 (fast-follow):** **physical** cards, **shared** card option,
  **budget-aware decline** at authorization.

### 2. Stripe prerequisites (per community)

- Connected account needs the **`card_issuing`** capability (and **`treasury`** if
  cards draw on a Stripe **financial-account** balance) — requested during/after
  ADR-028 onboarding.
- An **Issuing balance must be funded** before a card transacts. US default is
  **pull funding** (from the community's verified bank, ~≤5 business days); **push
  funding** is in beta. This is the "funded card balance" layer from ADR-030 §
  budget vs. money — distinct from the accounting budget.

### 3. Schema (`apps/convex/schema.ts`)

```ts
issuedCards: defineTable({
  communityId: v.id("communities"),
  groupId: v.id("groups"),
  fundId: v.id("funds"),                 // the fund this card spends from
  model: v.union(v.literal("per_person"), v.literal("shared")),
  holderUserId: v.optional(v.id("users")), // null for shared
  stripeCardId: v.string(),
  stripeCardholderId: v.string(),
  cardType: v.union(v.literal("virtual"), v.literal("physical")),
  last4: v.string(),
  spendingLimitCents: v.optional(v.number()),
  spendingLimitInterval: v.optional(v.union(
    v.literal("per_authorization"), v.literal("daily"),
    v.literal("weekly"), v.literal("monthly"))),
  allowedCategories: v.optional(v.array(v.string())), // MCC allow-list
  status: v.union(
    v.literal("active"), v.literal("frozen"), v.literal("canceled")),
  createdById: v.id("users"),
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_group", ["groupId"])
  .index("by_holder", ["holderUserId"])
  .index("by_stripeCard", ["stripeCardId"]),

cardTransactions: defineTable({          // append-only spend ledger
  communityId: v.id("communities"),
  cardId: v.id("issuedCards"),
  groupId: v.id("groups"),
  fundId: v.id("funds"),
  spenderUserId: v.optional(v.id("users")), // null for shared-card txns
  amountCents: v.number(),
  merchantName: v.optional(v.string()),
  mcc: v.optional(v.string()),
  stripeAuthorizationId: v.string(),
  stripeTransactionId: v.optional(v.string()),
  status: v.union(
    v.literal("pending"),   // authorized, not captured
    v.literal("posted"),    // captured
    v.literal("declined"),
    v.literal("reversed")),
  declineReason: v.optional(v.string()),
  receiptR2Key: v.optional(v.string()),
  createdAt: v.number(),
})
  .index("by_card", ["cardId"])
  .index("by_group", ["groupId"])
  .index("by_fund", ["fundId"])
  .index("by_authorization", ["stripeAuthorizationId"]),
```

### 4. Card lifecycle (functions)

```ts
// apps/convex/functions/ee/giving/cards.ts
export const issueCard = action({         // requireGroupLeaderOrAdmin
  // 1. ensure card_issuing enabled + Issuing balance funded (else guide funding)
  // 2. create/reuse Stripe Issuing cardholder for holderUserId (collect KYC)
  // 3. stripe.issuing.cards.create({ ... }, { stripeAccount })  → virtual|physical
  // 4. set spending_controls (limits + allowed_categories) from args
  // 5. insert issuedCards row
});
export const setCardControls = mutation({ /* update limits/categories */ });
export const freezeCard = mutation({ /* status "inactive" on Stripe + frozen here */ });
export const cancelCard = mutation({ /* status "canceled" */ });
export const getProvisioningData = action({ /* Apple Wallet push-provisioning payload */ });
export const attachReceipt = mutation({ /* set receiptR2Key on a cardTransactions row */ });
```

- **Apple Wallet**: virtual cards are added via push provisioning (Stripe supplies
  the provisioning payload).
- **Receipt capture**: after a transaction posts, prompt the spender to photograph
  a receipt → R2 → `attachReceipt`. Required above a configurable threshold; the
  dashboard surfaces a **missing-receipt queue** (ADR-030 §4).

### 5. Real-time authorization (the budget enforcement path)

Stripe sends `issuing_authorization.request` and expects an approve/decline
**within ~2 seconds**. We handle it on a dedicated fast endpoint.

```ts
// apps/convex/http.ts (append) — separate from the other Stripe routes.
http.route({
  path: "/stripe-issuing-webhook",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    // verifyStripeSignature with STRIPE_ISSUING_WEBHOOK_SECRET
    const event = JSON.parse(await request.text());
    if (event.type === "issuing_authorization.request") {
      const auth = event.data.object;
      // fast runQuery: card → group/fund → budget remaining + restricted balance
      const decision = await ctx.runQuery(
        internal.functions.ee.giving.cards.evaluateAuthorization,
        { stripeCardId: auth.card.id, amountCents: auth.pending_request.amount });
      // Phase 4: approve if card active (record only). Phase 5: budget-aware decline.
      return new Response(JSON.stringify({
        approved: decision.approve,
        metadata: { fundId: decision.fundId },
      }), { status: 200 });
    }
    // issuing_authorization.created / issuing_transaction.created →
    //   record/patch cardTransactions; refresh fundRollups (ADR-030).
    return new Response(JSON.stringify({ received: true }), { status: 200 });
  }),
});
```

- **Phase 4** approves any authorization on an `active` card and **records** the
  transaction (attribution + reconciliation), but does **not** decline on budget —
  keeps the fast path simple while we validate latency.
- **Phase 5** turns on **budget-aware decline**: decline if the authorization would
  exceed the group's remaining budget or a restricted fund's balance. The decision
  query must be fast (indexed reads on `issuedCards` + `fundRollups`); we keep a
  `periodSpentCents` rollup so we don't scan `cardTransactions` inline.

### 6. Reconciliation

Every posted transaction reduces the fund balance and the budget's
`periodSpentCents` (via `fundRollups` refresh), so ADR-030's budget-vs-actual and
the leader/treasurer dashboards become live. Reversals/refunds post compensating
`cardTransactions` rows.

### 7. Shared cards (Phase 5)

- `model: "shared"`, `holderUserId: null`. Same plumbing; **attribution is weak**
  (transaction maps to the group, not a person). The UI **discourages** this and
  requires receipt + a manual "who spent" note. Offered only because some small
  groups insist on one physical card in a shared space (PRD §7.3).

## Consequences

- Unlocks the full "raise → budget → spend accountably" loop entirely in-app.
- **Compliance/risk heavy**: cardholder + business KYC, fraud/dispute surface,
  funded balances. Needs treasurer-facing **freeze** tooling and alerting.
- Adds a **third Stripe webhook endpoint** + secret (`STRIPE_ISSUING_WEBHOOK_SECRET`)
  and a **latency-sensitive** authorization path (≤2s) — must be measured.
- Issuing-balance **funding latency** (~5 business days pull) means budgets aren't
  instantly spendable; onboarding must set expectations (open question: push
  funding).
- Per-person model means collecting cardholder identity data (privacy/PII).

## Alternatives Considered

- **Shared card as the default.** Rejected (PRD §7.3): nonprofits need
  per-transaction attribution; virtual cards are free/instant, so per-person is
  cheap. Shared remains a discouraged option.
- **Reimbursement model** (people pay, submit expenses, get paid back) instead of
  issued cards. Rejected as the primary: reimbursements are exactly the friction
  cards remove; could exist later as a fallback for non-cardholders.
- **Async authorization approval** (approve via API after the fact) instead of the
  synchronous ≤2s response. We default to **synchronous** for budget-aware decline
  in Phase 5; async is a fallback if latency proves problematic.
- **Treasury financial accounts for every community.** Only required if cards draw
  on a financial-account balance; we start with the simpler Issuing-balance
  funding and add Treasury where needed.
- **Deferring budget-aware decline indefinitely** (record-only forever). Rejected:
  the decline is the point of "budget" cards; we just stage it to Phase 5 after
  validating latency.

## References

- ADR-028 (connected accounts, webhook pattern), ADR-030 (budgets, fundRollups),
  PRD §7
- Stripe Issuing: https://stripe.com/issuing
- Fund Issuing balances with Connect: https://docs.stripe.com/issuing/connect/funding
- Real-time authorizations: https://docs.stripe.com/issuing/controls/real-time-authorizations
- Treasury for platforms: https://docs.stripe.com/treasury/connect
