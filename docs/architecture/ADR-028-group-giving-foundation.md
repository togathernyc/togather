# ADR-028: Group Giving Foundation — Stripe Connect Onboarding, Giving Gate & Designated-Giving Schema (Phases 0–1)

> **Terminology.**
> - **Connected account** — a Stripe account, one per community, under Togather's
>   Connect *platform*. This is how money flows **in** to a community. Distinct
>   from the community's role as a Stripe **Customer** of Togather (how the
>   community pays its subscription — money **out**). These two never share fields.
> - **Fund** — a designation bucket a gift can target. A **group fund** is a
>   designation/restriction *inside the community's 501c3*, not a separate legal
>   entity or bank account.
> - **Designated gift** — a tax-deductible charitable gift to the community's
>   501c3, restricted to a fund's purpose (usually a group's).
> - **`givingStatus`** — the per-community gate that unlocks the Give UI. Only
>   `active` allows giving.
> - **Donee of record** — the community (its EIN), never Togather.

## Status

Proposed

## Date

2026-06-24

## Context

See `docs/plans/nonprofit-financial-features-prd.md` for the full PRD. This ADR
makes **Phase 0 (compliance + Connect foundation)** and **Phase 1 (group funds +
designated giving)** concrete. Statements (Phase 3), budgets/cards (Phases 2/4–5),
and community-wide giving (Phase 7) are **out of scope here** and get their own
ADRs.

Two facts about the current codebase shape this design:

1. **Stripe is already integrated, but only for platform billing.** The community
   is a Stripe **Customer** of the Togather platform account; it pays a monthly
   subscription (`apps/convex/functions/ee/billing.ts`). The community fields
   `stripeCustomerId` / `stripeSubscriptionId` / `subscriptionStatus` on the
   `communities` table (`apps/convex/schema.ts`) all describe **money flowing OUT**
   of the community to Togather. **No Stripe Connect is used anywhere yet.**

2. **Giving is the opposite direction and a different Stripe relationship.** Money
   flows **IN** to the community. Per the PRD, each community is its **own 501c3**
   and the **donee of record**; Togather is the platform. The correct primitive is
   a Stripe **connected account** per community. This is brand-new Stripe surface
   and must be kept rigorously separate from the existing subscription billing —
   separate identifiers, separate webhook endpoint, separate signing secret.

Conflating the two (e.g. reusing `stripeCustomerId`, or routing Connect events
through the existing `/stripe-webhook`) would be a correctness and security hazard.

## Decision

### 1. Money-movement topology (the load-bearing separation)

| | Money OUT (existing) | Money IN (this ADR) |
| --- | --- | --- |
| Community's Stripe role | **Customer** of Togather platform | **Connected account** under Togather Connect platform |
| Identifier | `communities.stripeCustomerId` | `communityGiving.stripeConnectedAccountId` (new table) |
| Webhook endpoint | `/stripe-webhook` (unchanged) | `/stripe-connect-webhook` (new) |
| Signing secret | `STRIPE_WEBHOOK_SECRET` | `STRIPE_CONNECT_WEBHOOK_SECRET` (new) |
| Merchant of record | Togather | **The community** |

We use **direct charges on the connected account** (not destination/transfer
charges). The PaymentIntent is created *on* the connected account
(`{ stripeAccount: connectedAccountId }`), so the **community is unambiguously the
merchant of record and donee** — consistent with the PRD's liability model
(Togather never holds donor funds). Togather may still take a cut via
`application_fee_amount` (default **0** for v1 — see PRD open question on
monetization). Funds settle to the community's own bank on its payout schedule.

> **Apple Pay note:** direct charges require the **Apple Pay domain to be
> registered on each connected account**. This is an onboarding task (§5), not a
> code-time constant.

### 2. New schema (mirrors existing `defineTable` style in `apps/convex/schema.ts`)

Giving state lives in **separate tables keyed by `communityId`**, not bolted onto
the wide `communities` table — this keeps money-IN cleanly separated from money-OUT
and avoids growing an already-large table.

```ts
// Per-community giving configuration + Connect state (1:1 with a community).
communityGiving: defineTable({
  communityId: v.id("communities"),

  // Stripe Connect (money IN) — never reuse stripeCustomerId here.
  stripeConnectedAccountId: v.optional(v.string()),
  connectChargesEnabled: v.boolean(),   // from account.charges_enabled
  connectPayoutsEnabled: v.boolean(),   // from account.payouts_enabled
  connectDetailsSubmitted: v.boolean(), // from account.details_submitted

  // Nonprofit / Apple gates (v1: ops-set booleans; see §4 + open questions).
  nonprofitVerified: v.boolean(),       // EIN + 501c3 determination confirmed
  appleNonprofitApproved: v.boolean(),  // Apple nonprofit program approval

  // Donee-of-record identity used on receipts/statements later.
  legalName: v.optional(v.string()),
  ein: v.optional(v.string()),

  // Derived gate. pending → onboarding → active → suspended.
  givingStatus: v.union(
    v.literal("pending"),
    v.literal("onboarding"),
    v.literal("active"),
    v.literal("suspended"),
  ),

  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_community", ["communityId"])
  .index("by_connectedAccount", ["stripeConnectedAccountId"]),

// A designation bucket. Group funds reference a group; the General fund does not.
funds: defineTable({
  communityId: v.id("communities"),
  groupId: v.optional(v.id("groups")),   // null = community-level (e.g. General)
  name: v.string(),
  purpose: v.optional(v.string()),
  goalAmount: v.optional(v.number()),    // cents; optional campaign goal
  isRestricted: v.boolean(),             // must be spent on this purpose
  isGeneral: v.boolean(),                // the community's default fund
  donorVisible: v.boolean(),             // shown in the Give UI
  createdById: v.id("users"),
  archivedAt: v.optional(v.number()),
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_community", ["communityId"])
  .index("by_group", ["groupId"])
  .index("by_community_visible", ["communityId", "donorVisible"]),

// Append-only donation ledger. One row per (successful) gift.
donations: defineTable({
  communityId: v.id("communities"),
  donorUserId: v.id("users"),
  fundId: v.id("funds"),
  groupId: v.optional(v.id("groups")),   // denormalized for group reporting

  grossAmount: v.number(),               // cents charged
  feeAmount: v.number(),                 // processing fees
  netAmount: v.number(),                 // settled to community
  coveredFees: v.boolean(),              // donor opted to cover fees

  method: v.union(
    v.literal("apple_pay"),
    v.literal("card"),
    v.literal("ach"),
  ),
  stripePaymentIntentId: v.string(),
  recurringGiftId: v.optional(v.id("recurringGifts")),

  status: v.union(
    v.literal("succeeded"),
    v.literal("refunded"),
    v.literal("failed"),
  ),

  // Tax metadata captured now so statements (Phase 3) need no backfill.
  goodsOrServicesProvided: v.boolean(),  // default false → fully deductible
  goodsValue: v.optional(v.number()),    // good-faith estimate if quid pro quo

  anonymousToGroup: v.boolean(),         // hide donor from leaders, not from us
  createdAt: v.number(),
})
  .index("by_community", ["communityId"])
  .index("by_donor", ["donorUserId"])
  .index("by_fund", ["fundId"])
  .index("by_group", ["groupId"])
  .index("by_paymentIntent", ["stripePaymentIntentId"]),

// Recurring giving plans (Stripe subscriptions on the connected account).
recurringGifts: defineTable({
  communityId: v.id("communities"),
  donorUserId: v.id("users"),
  fundId: v.id("funds"),
  amount: v.number(),                    // cents per interval
  interval: v.union(v.literal("week"), v.literal("month")),
  stripeSubscriptionId: v.string(),
  status: v.union(
    v.literal("active"),
    v.literal("paused"),
    v.literal("canceled"),
  ),
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_donor", ["donorUserId"])
  .index("by_community", ["communityId"])
  .index("by_subscription", ["stripeSubscriptionId"]),
```

> Tables deferred to later ADRs: `givingStatements`, `groupBudgets`, `issuedCards`,
> `cardTransactions`. The `donations` ledger already carries every field statements
> will need, so introducing them later requires no data migration.

### 3. The `givingStatus` gate

`givingStatus` is the single source of truth for "can this community receive
gifts." It flips to `active` **only** when all three are true:

```ts
// apps/convex/lib/giving.ts (new)
export function computeGivingStatus(g: {
  connectChargesEnabled: boolean;
  nonprofitVerified: boolean;
  appleNonprofitApproved: boolean;
  givingStatus: string;
}): "pending" | "onboarding" | "active" | "suspended" {
  if (g.givingStatus === "suspended") return "suspended";
  const ready =
    g.connectChargesEnabled && g.nonprofitVerified && g.appleNonprofitApproved;
  if (ready) return "active";
  return g.connectDetailsSubmitted ? "onboarding" : "pending";
}
```

Every giving entry point (`getGiveScreen`, `createGiftIntent`) calls a guard that
throws unless status is `active`, and the Give query returns a structured
**gating reason** so the client can show "this community isn't set up for giving
yet" / "verification pending" instead of a dead end.

### 4. Phase 0 — Connect onboarding & verification (functions)

Mirrors the existing billing action/internal-mutation split and the `http.ts`
webhook switch. Lives under `apps/convex/functions/ee/giving/` (ELv2, alongside
billing).

```ts
// onboarding.ts
export const createConnectAccount = action({
  args: { communityId: v.id("communities") },
  handler: async (ctx, args): Promise<{ accountId: string }> => {
    // requireCommunityAdmin (via internal query — actions have no ctx.db)
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
      apiVersion: "2026-02-25.clover",
    });
    const account = await stripe.accounts.create({
      // Modern Connect: controller properties, not legacy Standard/Express/Custom.
      controller: {
        losses: { payments: "stripe" },
        fees: { payer: "application" },
        stripe_dashboard: { type: "none" },
        requirement_collection: "application",
      },
      business_type: "non_profit",
      metadata: { communityId: args.communityId },
    });
    await ctx.runMutation(internal.functions.ee.giving.onboarding.saveConnectAccount, {
      communityId: args.communityId,
      stripeConnectedAccountId: account.id,
    });
    return { accountId: account.id };
  },
});

export const createConnectOnboardingLink = action({ /* stripe.accountLinks.create → { url } */ });

export const saveConnectAccount = internalMutation({ /* upsert communityGiving, status "pending" */ });

// Webhook handler (Connect events), called from http.ts:
export const handleConnectAccountUpdated = internalMutation({
  args: {
    stripeConnectedAccountId: v.string(),
    chargesEnabled: v.boolean(),
    payoutsEnabled: v.boolean(),
    detailsSubmitted: v.boolean(),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("communityGiving")
      .withIndex("by_connectedAccount", (q) =>
        q.eq("stripeConnectedAccountId", args.stripeConnectedAccountId))
      .first();
    if (!row) return;
    const next = { ...row, connectChargesEnabled: args.chargesEnabled,
      connectPayoutsEnabled: args.payoutsEnabled,
      connectDetailsSubmitted: args.detailsSubmitted };
    await ctx.db.patch(row._id, {
      connectChargesEnabled: args.chargesEnabled,
      connectPayoutsEnabled: args.payoutsEnabled,
      connectDetailsSubmitted: args.detailsSubmitted,
      givingStatus: computeGivingStatus(next),
      updatedAt: Date.now(),
    });
  },
});
```

**Nonprofit + Apple verification (v1):** modeled as **ops-set booleans**
(`nonprofitVerified`, `appleNonprofitApproved`) toggled by a staff/superuser
mutation, each flip re-running `computeGivingStatus`. Self-serve EIN verification
and the actual Apple nonprofit-program enrollment are **out of scope for v1** and
tracked as PRD open questions (#1). This keeps the gate real and auditable without
blocking the build on the (long-lead) Apple process.

### 5. Phase 1 — Group funds & designated giving (functions)

```ts
// funds.ts
export const createGroupFund = mutation({   // group leader (own group) or admin
  args: { communityId, groupId: v.optional(v.id("groups")), name, purpose?, goalAmount?, isRestricted, donorVisible },
  // requireGroupLeaderOrAdmin (§6); insert into `funds`.
});
export const listGiveTargets = query({       // gated on givingStatus === "active"
  // returns donorVisible funds for the community/group + gating reason if not active.
});

// give.ts
export const createGiftIntent = action({
  args: { communityId, fundId, amountCents, coverFees, frequency, anonymousToGroup },
  handler: async (ctx, args) => {
    // 1. guard: giving active; load connected account id.
    // 2. one-time → PaymentIntent ON the connected account (direct charge):
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: "2026-02-25.clover" });
    const pi = await stripe.paymentIntents.create(
      {
        amount: grossAmount,
        currency: "usd",
        automatic_payment_methods: { enabled: true }, // Apple Pay
        application_fee_amount: 0,                     // v1: no platform cut
        metadata: { communityId, fundId, donorUserId, anonymousToGroup },
      },
      { stripeAccount: connectedAccountId },           // ← direct charge
    );
    // recurring → Stripe Subscription on the connected account + recurringGifts row.
    return { clientSecret: pi.client_secret, connectedAccountId };
  },
});

// Ledger write happens from the webhook, never optimistically client-side.
export const recordDonation = internalMutation({ /* insert into donations on payment_intent.succeeded */ });
export const recordRefund   = internalMutation({ /* patch status → refunded on charge.refunded */ });

// myGiving.ts
export const myGivingHistory = query({ /* donations by_donor, grouped, YTD total */ });
export const fundProgress    = query({ /* sum netAmount by_fund vs goalAmount */ });
```

Recurring gifts use **Stripe subscriptions on the connected account** (donor
self-service pause/edit/cancel maps to subscription updates), recorded in
`recurringGifts`. Each successful invoice produces a `donations` row via the same
webhook path, tagged with `recurringGiftId`.

### 6. Webhook routing additions (`apps/convex/http.ts`)

Add a **second route**, leaving `/stripe-webhook` untouched. Reuse the existing
`verifyStripeSignature` helper with the **new** secret.

```ts
http.route({
  path: "/stripe-connect-webhook",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const body = await request.text();
    const signature = request.headers.get("stripe-signature");
    const secret = process.env.STRIPE_CONNECT_WEBHOOK_SECRET;
    // verifyStripeSignature(body, signature, secret) — same helper as billing.
    const event = JSON.parse(body);
    switch (event.type) {
      case "account.updated":            /* → handleConnectAccountUpdated */ break;
      case "payment_intent.succeeded":   /* → recordDonation */ break;
      case "charge.refunded":            /* → recordRefund */ break;
      case "invoice.payment_succeeded":  /* recurring → recordDonation */ break;
      case "invoice.payment_failed":     /* recurring dunning (later) */ break;
      default: /* log unhandled */ break;
    }
    return new Response(JSON.stringify({ received: true }), { status: 200 });
  }),
});
```

> Connect webhooks deliver the connected account id in `event.account`; handlers
> resolve the community via `communityGiving.by_connectedAccount`.

### 7. Permissions (`apps/convex/lib/permissions.ts`)

- **Reuse existing checks; do not invent a role for v1.** Finance-admin actions
  (create connected account, toggle verification, manage any group's fund) gate on
  `requireCommunityAdmin` (roles ≥ `ADMIN` = 3).
- **Group-fund management** by a group's own leader: add a small helper.

```ts
export async function requireGroupLeaderOrAdmin(ctx, communityId, groupId, userId) {
  if (await isCommunityAdmin(ctx, communityId, userId)) return;
  const m = await ctx.db.query("groupMembers")
    .withIndex("by_group_user", q => q.eq("groupId", groupId).eq("userId", userId))
    .first();
  if (!m || !isLeaderRole(m.role)) throw new Error("Group leader or community admin required");
}
```

**Deliberate deferral:** the PRD suggested a dedicated **treasurer/finance** role.
But `userCommunities.roles` is used as an **ordinal ladder**
(`MEMBER=1 … PRIMARY_ADMIN=4`) with threshold comparisons, **not** a true bitmask —
a treasurer role doesn't slot into that ladder cleanly (a treasurer is "admin for
money but not for everything else," which is orthogonal to the ladder). Forcing it
now would muddy the model. v1 uses the admin threshold; a proper treasurer role
(likely requiring a real permission-bits refactor) is its own ADR. Tracked as an
open question.

### 8. Env / secrets (`.env.example` + `docs/secrets.md`)

| Secret | Description | Degradation |
| --- | --- | --- |
| `STRIPE_CONNECT_WEBHOOK_SECRET` | Signing secret for the **Connect** webhook endpoint (`whsec_…`) | Giving webhooks rejected |

Reuses `STRIPE_SECRET_KEY` (same platform account; Connect calls pass
`stripeAccount`). No new product id needed for Phase 1.

## Consequences

- **First Connect integration.** Ops must enable Stripe Connect on the platform
  account and register each connected account's Apple Pay domain. Two webhook
  endpoints and two signing secrets now exist.
- **Clean money-in/money-out separation** at the schema, webhook, and secret level
  — the existing subscription billing is untouched and cannot collide.
- **Giving is gated and auditable** from day one; nothing is chargeable until a
  community is genuinely verified. v1 verification is ops-driven (not self-serve).
- **The ledger is forward-compatible.** Statements, budgets, and cards build on
  `donations`/`funds` without migrating Phase 1 data.
- **No statements, budgets, cards, or community-wide giving yet** — those are
  explicitly later ADRs. Group leaders can raise designated, deductible gifts; the
  community sees money land in its own Stripe account.
- **Treasurer role is not delivered** in v1 (admin-gated instead), pending a
  permission-model refactor.

## Alternatives Considered

- **Destination / transfer charges** (charge on platform, transfer to community)
  instead of direct charges. Rejected: keeps Togather closer to merchant-of-record
  and muddies the "community is the donee/liable party" model. Direct charges make
  the community unambiguously the donee.
- **Storing giving fields on the `communities` table** (like the existing
  subscription fields). Rejected: would mix money-in with money-out on one wide
  table and invite reuse/confusion of identifiers. Separate `communityGiving` table
  enforces the boundary.
- **Reusing the single `/stripe-webhook` endpoint** for Connect events. Rejected:
  Connect events need a distinct signing secret and isolation; mixing them risks
  cross-wiring platform and connected-account events.
- **Togather as merchant-of-record / fund holder** (single platform account holding
  donor money). Rejected by the PRD — maximizes Togather's compliance/liability and
  breaks the per-community-501c3 model.
- **A dedicated treasurer role now.** Deferred — doesn't fit the current ordinal
  role model; would need a permission-bits refactor (own ADR).
- **Self-serve nonprofit/Apple verification in v1.** Deferred — Apple's
  multi-tenant nonprofit-approval process is a long-lead, partly-manual unknown
  (PRD open question #1); ops-set booleans unblock the build without faking
  approval.

## Open Questions (carried from PRD)

1. Apple nonprofit-approval mechanics for a multi-tenant platform — **blocks moving
   verification from ops-toggle to self-serve.** Needs legal/AppStore counsel.
2. Platform monetization — keep `application_fee_amount = 0`, or take a cut?
3. Treasurer/finance role — schedule the permission-bits refactor.
4. Stripe Connect + Issuing enablement review on the platform account (start early).
5. State charitable-solicitation registration — surface per community, or treat as
   the community's responsibility?

## References

- PRD: `docs/plans/nonprofit-financial-features-prd.md`
- Existing billing patterns: `apps/convex/functions/ee/billing.ts`,
  `apps/convex/http.ts`, `apps/convex/lib/permissions.ts`
- Schema: `apps/convex/schema.ts`
- Stripe Connect (controller properties): https://stripe.com/connect
- Stripe direct charges & application fees: https://docs.stripe.com/connect/direct-charges
- Apple App Review Guidelines 3.2.1(vi): https://developer.apple.com/app-store/review/guidelines/
