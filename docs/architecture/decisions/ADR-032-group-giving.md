# ADR-032: Group Giving, Spending, Receipting & Reimbursements

## Status

Proposed (2026-07)

## Context

Groups today handle money through a leader's personal Cash App/Venmo, linked
via a generic `linkUrl` on `groupResources` (the seeded "Partner with us"
pattern). That means: no receipts from the church's EIN, no visibility into
where money went, personal tax/liability exposure for leaders, and nothing
first-class in the product for spending or reimbursements.

We want giving, spending, receipting, and reimbursements to be first-class
tools inside a group, with a finance permission model that group leaders
control. Two design goals dominate every choice below:

1. **Simple for communities to set up** — one form, one identity-verification
   redirect, no direct relationship with any banking vendor.
2. **Simple for us to implement and roll out** — reuse the live Stripe
   plumbing (`http.ts` webhook receiver, secrets pipeline,
   `@supa-media/payments`), phase the build so each phase ships value alone,
   and keep the product logic vendor-agnostic behind our own `funds`
   abstraction.

What already exists and is reused:

- Stripe is live for SaaS billing (`functions/ee/billing.ts`,
  `STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET` synced, verified webhook
  receiver in `http.ts` with HMAC + replay protection).
- Idempotency patterns: source-key dedupe, nonce debouncing, webhook retry
  drops.
- `churchFeatures` flags on `communities`; `requireGroupLeaderOrCommunityAdmin`
  / `requireCommunityAdmin` permission helpers; R2 uploads; Resend email;
  Expo push.

### Providers considered

- **Stripe end-to-end (Connect + Treasury + Issuing).** One vendor, but the
  banking side is access-gated: Treasury requires platform approval and
  per-connected-account supportability review, and Issuing is similarly
  closed. We'd be building against a program we might not get, on Stripe's
  timeline.
- **Increase end-to-end.** Excellent banking primitives (Entities → Accounts →
  Cards/Transfers, free full-featured sandbox, API-driven onboarding), but
  Increase does not do card *acquiring* — no Apple Pay donation flow, which is
  the donor experience that makes in-app giving beat a Cash App link.
- **Stripe (thin, acquiring) + Increase (core, banking).** Chosen. The two
  honest costs — dual onboarding and the bulk-payout allocation seam — are
  bounded, build-once costs, detailed below.

## Decision

**Stripe Connect collects donations; Increase holds and moves the money;
Togather's ledger attributes and audits. One Increase Entity per community,
one Increase Account per group.**

### 1. Account topology

```
Stripe:   1 connected account per community (church)      — acquiring only
Increase: 1 Entity per community (church, KYB'd once)
          ├─ 1 receiving Account   (Stripe payout destination)
          ├─ 1 General Account     (community-wide fund)
          └─ 1 Account per group with giving enabled
Convex:   funds + append-only ledgerEntries               — attribution/audit
```

- KYB happens **once per community, at the Entity**. Accounts under an entity
  are instant, free API calls, so per-group accounts survive group churn
  (semester small groups create/archive constantly).
- A group is never its own banking customer. Leaders never onboard
  personally — group money is legally the church's money, restricted by
  purpose, which is how church fund accounting already works.
- **Segregation is enforced by the bank**: a card is bound to its group's
  Account and cannot overdraw it or touch another group's balance. No custom
  real-time authorization decisioner sits on the critical path (Increase's
  real-time decisions remain available later for merchant-category rules).
- The Convex ledger is **not** the authoritative balance. It attributes
  in-flight donations to funds (pre-payout), drives the allocation job, and
  powers receipts/statements/transparency. Invariant, reconciled nightly and
  alarmed on drift:

  ```
  funds.balanceCents === Increase Account balance + pending allocations
  ```

### 2. Community onboarding (one form, one redirect)

Communities never talk to Increase or Stripe directly. The platform-level
Increase program (contract, underwriting) is a **one-time Togather ops task**;
after that, community onboarding is fully API-driven.

Admin flow — Community Settings → Finance → "Set up giving":

1. **One form**: legal name, EIN, address, website. Collected once, stored on
   `communityFinance`, submitted to *both* providers.
2. **One redirect**: Stripe hosted onboarding verifies the representative's
   identity (Stripe requires this anyway; it's the most battle-tested KYC UI
   in existence — we do not rebuild it).
3. **Everything else is automatic**, driven by webhooks:
   - Increase Entity created from the same form data; receiving + General
     Accounts created under it.
   - Stripe connected account's external payout account set to the receiving
     Account's routing/account number (we mint it, so we can attach it
     directly).
   - `communityFinance.onboardingStatus` advances through a monotonic status
     machine: `collecting → verifying → live` (with `stripe_blocked` /
     `increase_blocked` side states surfaced as "needs attention" with the
     provider's remediation reason).
4. The admin sees a two-item checklist (Payments verification / Bank
   accounts) that completes on its own; push + email when live. Target admin
   time: **under ten minutes**.

Per-group enablement is a single toggle (community admin), which creates the
group's Increase Account and `funds` row. **The group's current leaders are
granted `finance_admin` on the fund automatically** — no second setup step —
and can delegate from there.

### 3. Money flows

- **Donation in**: PaymentIntent on the community's connected account, tagged
  `metadata.fundId`; Apple Pay first, cards, optional voluntary fee-cover
  (a donor choice, not a surcharge — see ADR-031 for why we never label card
  fees as a charge), ACH debit offered for large gifts. `payment_intent.
  succeeded` writes `donations` + a credit `ledgerEntries` row and sends the
  Resend receipt from the church's name/EIN.
- **Allocation**: Stripe pays out in bulk (T+2) to the receiving Account,
  **net** of processing fees. An allocation job asks Stripe which charges
  composed the payout and at what net (balance transactions), then splits
  those nets into group Accounts via Increase AccountTransfers;
  `donations.allocationStatus` tracks it and the `gross − net` fee is posted
  to the ledger as the transfer lands. This is the one place the seam between
  vendors shows, and it is a background job, not a user-facing flow.
- **Card spend**: Increase Card bound to the group's Account, spend limit,
  digital wallet token (Apple/Google Pay). Authorization is scoped by the
  Account balance natively. The card-transaction webhook writes the debit
  entry and triggers the receipt-nudge push.
- **Reimbursement**: member submits amount + receipt (R2) → manager approves →
  Increase ACH transfer from the group's Account to the member's linked bank.
  Idempotency key = expense id.
- **Group archive**: hooks into the existing `update({ isArchived: true })`
  cascade in `groups/mutations.ts` — freeze the fund's cards, AccountTransfer
  the remainder to the General Account (or a successor group the admin
  picks), close the Account, write paired sweep entries, set
  `funds.status = "closed"`. History is retained for receipts and audit.
  Unarchiving mints a fresh Account at zero.

### 4. Permissions

Finance roles are **separate from group roles** and scoped to the fund, so a
trusted treasurer doesn't need to be a leader and a leader can't automatically
move money. Granted by group leaders and finance admins; community admins
retain override; every grant/limit/freeze is audit-logged.

| Capability                                   | Member | Cardholder | Manager | Finance admin | Community admin |
| -------------------------------------------- | :----: | :--------: | :-----: | :-----------: | :-------------: |
| Give; see transparency summary               |   ✓    |     ✓      |    ✓    |       ✓       |        ✓        |
| Submit an expense / reimbursement            |   ✓    |     ✓      |    ✓    |       ✓       |        ✓        |
| Hold a card; receipt own charges             |        |    own     |   own   |      own      |       own       |
| View full activity & all receipts            |        |            |    ✓    |       ✓       |        ✓        |
| Approve/deny expenses & reimbursements       |        |            |    ✓    |       ✓       |        ✓        |
| Issue/freeze cards; set spend limits         |        |            |         |       ✓       |        ✓        |
| Assign finance roles (with group leaders)    |        |            |         |       ✓       |        ✓        |
| Transfer between funds; close/sweep          |        |            |         |               |        ✓        |
| Enable giving; community onboarding          |        |            |         |               |        ✓        |

Guardrails enforced by the backend, not convention: no self-approval ever; a
configurable two-approver threshold (default $200); receipt-required policy
with push nudges. Enforcement via `requireFundRole(ctx, fundId, userId,
minRole)` in `lib/helpers.ts`, mirroring `requireGroupLeaderOrCommunityAdmin`.

The leader row of the "Assign finance roles" line is a **grant to others,
not to self**. `requireFundRoleOrGroupLeader`'s carve-out ignores the
required role level — that's what makes the bootstrap possible — so a leader
allowed to name themselves would have a one-tap path to `finance_admin`, a
card, and the fund's balance with no second human involved. `grantFundRole`
therefore refuses a self-targeted grant from a caller whose only standing is
"leads this group". Finance admins and community admins are unaffected.

### 5. Schema (new tables, `apps/convex/schema.ts`)

```
communityFinance  communityId, stripeConnectedAccountId, increaseEntityId,
                  increaseReceivingAccountId, onboardingStatus,
                  statementDescriptor, legalName, ein, address
funds             communityId, groupId?, name, type: "group" | "general",
                  increaseAccountId, status: "active" | "frozen" | "closed",
                  balanceCents  (mirror of Increase + pending allocations)
ledgerEntries     append-only. fundId, direction, amountCents,
                  kind: "donation" | "allocation" | "card_capture" | "refund"
                      | "reimbursement" | "transfer" | "sweep" | "fee",
                  stripeObjectId?, increaseObjectId?, counterpartFundId?,
                  idempotencyKey, actorUserId?, createdAt
fundRoles         fundId, userId, role: "finance_admin" | "manager"
                      | "cardholder", grantedBy, grantedAt, revokedAt?
donations         fundId, donorUserId?, amountCents, feeCoverCents,
                  stripePaymentIntentId, allocationStatus, recurringId?,
                  receiptEmailStatus,
                  allocationPayoutId?, payoutNetCents?  (the payout this gift
                  was matched into and the NET it delivered — see §3
                  Allocation and Phase-2 requirement 6)
cards             fundId, holderUserId, increaseCardId, status,
                  spendLimitCents, controls
expenses          fundId, submitterId, amountCents,
                  kind: "card_charge" | "reimbursement", receiptKey (R2),
                  status: "pending" | "approved" | "denied" | "paid",
                  approverId?, secondApproverId?, increaseTransferId?
```

Balances are derived from entries (cached on `funds`), never mutated in place.
All money is integer cents. Every external write carries an idempotency key
(existing source-key pattern); every webhook handler is an upsert keyed on the
provider object id.

### 6. Integration surface

- **Webhooks** (`http.ts`, same signature-verification pattern as the existing
  Stripe route): extend `/stripe-webhook` for `payment_intent.succeeded`,
  `account.updated`, `payout.paid`; add `/increase-webhook` for entity/account
  status, card transactions, transfer settlement (Increase webhooks are
  HMAC-signed; verify with constant-time comparison like the Slack/Stripe
  routes).
- **Secrets** (follow `docs/secrets.md` flow exactly): add `INCREASE_API_KEY`
  and `INCREASE_WEBHOOK_SECRET` to 1Password → `ee/secrets-allowlist.json`
  (`required`) → `SECRET_KEYS` in `ee/scripts/sync-secrets-to-convex.sh`.
  Dev/staging use Increase sandbox keys.
- **Crons** (`crons.ts`): allocation job (frequent), nightly reconcile +
  drift alarm, receipt-nudge digest, January statements batch.
- **Mobile**: giving section slots into `GroupDetailScreen` between Check-in
  and Rostering, gated like Rostering (`isLeader || isAdmin` for management
  surfaces; everyone sees Give + transparency). New routes under
  `app/(user)/leader-tools/[group_id]/giving/` and a public
  `groups/[group_id]/give` sheet. **No new native dependencies** — payment
  sheet via `@stripe/stripe-react-native` must be classified in
  `native-deps.json` and gated per ADR-013 if added; Phase 1 can launch with
  a web-based Stripe Checkout sheet to avoid any native-graph change.
- **Feature gating**: `churchFeatures.givingEnabled` (community) + per-group
  fund existence. Everything is dark until both are true.

### 7. Rollout (each phase ships value alone)

1. **Donations + ledger + receipts** — Stripe only (already live in the
   codebase): community onboarding form + Stripe hosted verification, funds,
   in-app giving, instant receipts, member transparency view. Replaces the
   Cash App link outright. Start Increase underwriting; build Phases 2–3
   against the free sandbox in parallel.
2. **Increase live + reimbursements** — Entities, receiving/General/group
   Accounts, payout destination switch, allocation job, nightly reconcile,
   finance roles + guardrails, approval queue, ACH reimbursements.
3. **Cards** — virtual cards to wallets, limits, freeze-on-archive, receipt
   nudges; physical cards on request.
4. **Statements & scale** — January giving statements, budgets, CSV export,
   per-fund Increase account numbers for self-attributing inbound ACH
   (payroll giving), evaluate ACH-debit rails for large recurring gifts.

Pilot with one real community per phase before opening the toggle wider.
A new onboarding guide (`apps/web/src/pages/guides/`) ships with Phase 1 per
the guides policy in CLAUDE.md.

### Non-goals (v1)

Text-to-give, pledge/campaign mechanics, physical check deposit, QuickBooks
sync, multi-currency, interest/yield on balances, and donor-advised-fund
semantics are all explicitly out of scope until the core loop is proven.

## Consequences

- Communities get bank-grade group finance with a sub-ten-minute setup and no
  vendor relationships of their own; leaders get out of the personal-Cash-App
  liability business; members get receipts and transparency Cash App can't
  offer.
- We take on: a program-level relationship with Increase (contract +
  underwriting, one-time), the payout-allocation job and nightly reconcile
  (bounded, build-once), and correctness duty on an append-only ledger —
  though the bank, not our ledger, holds authoritative balances, which caps
  the blast radius of a bookkeeping bug.
- Dual onboarding (Stripe + Increase) is hidden from users but doubles the
  webhook-driven state machine we must keep monotonic and observable.
- The product logic depends only on our `funds` abstraction, so the acquiring
  side (Stripe) and the banking side (Increase) each remain independently
  swappable.

## Phase 2 requirements (named, so they don't get lost)

Committed product requirements for the Increase-live phase, beyond the seams
already flagged in `functions/finance/ARCHITECTURE.md`:

1. **Community withdrawal (self-serve).** A community admin can ACH money
   from the **General fund's Increase Account only** to the church's own
   verified external bank account. Withdrawals never draw from the receiving
   Account (holds money still attributed to groups pre-allocation) or from
   group Accounts. Fully audit-logged.
2. **Solvency warning on withdrawal.** The withdrawal UX must distinguish
   the General fund's *ledger* balance from what the bank will actually
   honor (donations in the Stripe→Increase pipeline inflate the former;
   holds and unsettled outbound ACH inflate the settled balance) and cap
   the withdrawable amount at **min(non-negative ledger balance, Increase
   `availableBalanceCents`)**, explaining the difference.
3. **Explicit, loud group sweeps.** Taking money a group fund holds requires
   an explicit per-fund transfer with: a double confirmation stating the
   fund's leaders/managers currently see that balance and will watch it
   drop ("you have the legal right — it's the church's money — but this is
   visible"), a typed-amount confirmation, an immutable audit event, and a
   push/in-app notification to that fund's finance admins and managers.
   Group segregation is bank-enforced (a card or withdrawal cannot touch
   another account); this requirement makes the *authorized* override
   transparent rather than silent.
4. **Payout-destination drift monitoring.** If a church changes its Stripe
   payout bank away from the managed Increase receiving Account (possible
   via the Express Dashboard), detect it by subscribing to the dedicated
   Connect events `account.external_account.created` / `.updated` /
   `.deleted` (`account.updated` alone does not observe every external-
   account change), alert ops, and surface an in-app "group banking
   disconnected" state — Phase 1 attribution keeps working;
   cards/allocation do not.
5. **Offboarding runbook.** A church leaving Togather gets its full balance
   ACH'd to its verified bank and its Increase accounts closed — tooling +
   terms-of-service clause, not a support ticket.
6. **Net-amount allocation.** ✅ **Done** — allocation matching now reads
   Stripe balance-transaction per-PaymentIntent NET amounts for the payout
   (`getPayoutComposition`) instead of gross donation totals, which also
   means the payout tells us exactly which donations it contained rather
   than the job inferring membership from a running total. Falls out of
   that: allocation is retried per (payout, donation) rather than dropped
   whole on a redelivered webhook, so one failed Increase transfer no longer
   strands the rest of the batch; and the fee Stripe kept is posted as a
   `fee` ledger debit when the transfer lands, which is what makes the
   §3 invariant satisfiable and a stalled allocation visible as drift.
   Reversals (refunds and chargeback `adjustment`s) are netted against their
   own charge rather than discarded, so a gift refunded before its payout
   contributes nothing and is never transferred into a group's spendable
   Account; a fully refunded gift is additionally flipped to a terminal
   `donations.allocationStatus: "refunded"`. Concurrency between an
   in-flight payout webhook and the hourly retry cron is closed by a
   per-donation transfer lease taken in the selection mutation. See
   `functions/finance/ARCHITECTURE.md` → "Known Seams & TODOs" for the full
   recovery semantics, the refund/dispute states, and the one case that is
   deliberately left drifting (a refund arriving after allocation needs a
   bank-side clawback that is not designed yet).

## Open questions

- Increase program structure: confirm during underwriting that
  churches-as-Entities under a Togather platform program is the shape their
  compliance team wants for donated funds.
- Counsel review of receipting language, FBO/pass-through framing, and any
  state-level charitable-solicitation registration implications.
- Whether Phase 1 uses web-based Stripe Checkout (zero native-dep risk) or
  the native payment sheet (better Apple Pay conversion) — decide with a
  device test per ADR-013/ADR-030 rules.
- Extraction timing: build app-local in `apps/convex/functions/finance/`
  first; extract the generic core (ledger, roles, provider glue) to a
  `@supa-media/giving` package with dev-assistant-style seams once the shape
  stabilizes (upstream-first rule applies from that point).
