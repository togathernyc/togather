# Finance System Architecture (ADR-032)

## Module Map

**functions/finance/onboarding.ts** — Community-level intake and status machine. Exports `startOnboarding` (mutation: one-time intake form — legalName, EIN, address, website, statementDescriptor — triggering `provisionProviders`), `getOnboardingStatus` (read-side for the mobile admin checklist), `enableGroupGiving` (per-group fund provisioning + leader role grants), `applyStripeAccountStatus` (Stripe webhook-driven status machine), `recordProvisioned` (internal: stores provider ids after external provisioning succeeds), `freezeFundForArchivedGroup` (internal: freezes a group's fund on archive — ADR-032 §3, freeze half only), and `isValidEin` (pure validator for EIN format).

**functions/finance/giving.ts** — Donation lifecycle and transparency screen. Exports `getGivingContext` (assembly of donation UI: fund list, suggested amounts, fee-cover toggle), `createDonationIntent` (creates Stripe PaymentIntent on the connected account, with an optional client nonce folded into Stripe's own request idempotency key to prevent a double-tap double-charge), `recordDonationSucceeded` (internal: Stripe webhook handler — writes donation + ledger credit + schedules receipt), `recordDonationRefund` (internal: Stripe `charge.refunded` handler — posts a "refund" ledger debit, replay-safe against Stripe's cumulative `amount_refunded`), `recordDonationDisputed` (internal: Stripe `charge.dispute.created` handler — audit-only), `getFundOverview` (transparency screen with donor-name visibility gating for non-finance roles), and `updateDonationReceipt` (internal: Resend email callback handler).

**functions/finance/expenses.ts** — Member reimbursement submission, approval, and payout. Exports `submitExpense` (mutation: member-submitted reimbursement request; rejects on a non-active fund), `approveExpense` (mutation: first or second approval, respecting the $200 threshold; rejects on a non-active fund), `denyExpense` (mutation: explicit rejection — allowed regardless of fund status), `payReimbursement` (internal action: ACH transfer via Increase, gated on `fund.status === "active"` BEFORE the transfer call — currently a no-op stub for the transfer itself awaiting payout-destination linking), and `recordReimbursementPaid` (internal: called post-transfer or by manual entry).

**functions/finance/roles.ts** — Fund role (finance_admin / manager / cardholder) lifecycle. Exports `grantFundRole` (mutation: community-admin-only role assignment), `revokeFundRole` (mutation: soft-delete via revokedAt), and `getFundRoles` (query: list active roles on a fund).

**functions/finance/jobs.ts** — Allocation, reconciliation, and payout-retry background jobs. Exports `planAllocations` (internal: decides which pending donations a payout covers — oldest-first, whole-only), `recordAllocation` (internal: flips donation.allocationStatus + audit log), `runAllocation` (internal action: pairs planAllocations with Increase transfers), `runNightlyReconcileAllCommunities` (cron: nightly invariant check per community), `retryStuckReimbursements` (cron: re-schedules `payReimbursement` for reimbursements stuck "approved" > 6h with no transfer — a backstop for a crashed/interrupted payout, safe because `createAchTransfer`'s idempotency key collapses a retry to the same transfer), and `registerFinanceCrons` (registers all three crons — reconcile daily at 07:00 UTC, allocation-retry hourly at :45, stuck-reimbursement-retry hourly at :20).

**functions/finance/webhooks.ts** — Stripe payment/payout/refund/dispute and Increase event dispatch + signature verification. Handles Stripe routing to `recordDonationSucceeded` (payment_intent.succeeded, with a server-side connected-account cross-check against the fund's own `communityFinance` before crediting — see `getFundFinanceForWebhook`), `recordDonationRefund` (charge.refunded, same account cross-check via `getDonationFundForWebhook`), `recordDonationDisputed` (charge.dispute.created, audit-only), `planAllocations` (payout.paid), Increase Entity/Account status updates (entity.created, account.created), and webhook signature verification via Increase's idempotency behavior (documented in lib/finance/increase.ts).

## Money Flow

**Donation → Ledger → Payout → Allocation → Reconcile**

1. `createDonationIntent` (Stripe PaymentIntent on connected account) → donor card charged
2. Stripe webhook: `payment_intent.succeeded` → `recordDonationSucceeded` (writes donations row + credit to ledger + schedules receipt email)
3. Stripe bulk payout (T+2) arrives at Increase receiving Account
4. Webhook: `payout.paid` → `planAllocations` + `runAllocation` (Increase AccountTransfer to group Account + flip allocationStatus)
5. Nightly cron: `runNightlyReconcileAllCommunities` → invariant check (ledger balance == bank balance + pending)

**Reimbursement → Approve → Pay**

1. `submitExpense` (member submits receipt + amount, kind=reimbursement)
2. `approveExpense` (manager/finance_admin first or second approval — $200+ needs two)
3. `payReimbursement` (internal action: ACH transfer via Increase) → `recordReimbursementPaid` (flips status + ledger debit)

## Audit Trail: Two Surfaces

**Money movement: `ledgerEntries` (append-only, never deleted)**
- Every debit/credit (donation.recorded, allocation, refund, reimbursement debit, sweep, fee, transfer, card_capture)
- Denormalized `communityId`, `fundId`, `idempotencyKey` (for dedup), `actorUserId` (optional — absent for webhooks/crons), `createdAt`
- Indexed `by_fund`, `by_idempotencyKey`, `by_community`

**Control-plane events: `financeAuditEvents` (append-only, never deleted)**
- Recorded via `logFinanceAudit()` in lib/finance/audit.ts
- Action strings (dot-namespaced):
  - `onboarding.status_changed` — Stripe/Increase status machine driven by webhooks or explicit form resubmission
  - `fund.created` — Group giving enabled; fund provisioned with Increase Account
  - `role.granted` — Finance role assigned to a user
  - `role.revoked` — Finance role soft-deleted
  - `donation.recorded` — Stripe donation succeeded; webhook-driven
  - `donation.allocated` — Increase AccountTransfer completed; includes transfer id in details
  - `reconcile.drift` — Nightly invariant failed (ledger ≠ bank + pending)
  - `expense.submitted` — Member reimbursement created
  - `expense.approved` — First or second approval
  - `expense.denied` — Explicit rejection
  - `expense.paid` — ACH transfer initiated
  - `expense.pay_skipped` — Payout skipped (already paid, or ledger conflict)
  - `expense.pay_blocked_no_destination` — Payout blocked; payer has no linked bank account
  - `expense.pay_blocked_fund_inactive` — Payout blocked; the fund is frozen/closed (checked BEFORE the Increase ACH transfer call, not just at the later ledger write)
  - `donation.refunded` — Stripe `charge.refunded`; ledger debit posted (always allowed, even on a frozen fund)
  - `donation.disputed` — Stripe `charge.dispute.created`; audit-only, no ledger entry yet (see "Known Seams & TODOs")
  - `webhook.rejected_account_mismatch` — A donation-crediting/refunding webhook event's `account` didn't match the fund's community's connected account; nothing was credited/debited
  - `fund.frozen` — Fund frozen (e.g. its group was archived)
- Indexed `by_community`, `by_fund` (both with `createdAt` for timeline queries)

## Idempotency Inventory

Every external write (Stripe, Increase API calls) is idempotency-keyed to safely retry without duplicating effects:

- **`finance:stripe-account:{communityId}`** — Community Stripe connected account creation (used in onboarding.ts createConnectedAccount)
- **`finance:entity:{communityId}`** — Increase Entity creation (communityFinance.increaseEntityId — used in increase.ts createEntity)
- **`donation:{paymentIntentId}`** — Donation ledger credit (giving.ts recordDonationSucceeded + ledger posting)
- **`alloc:{donationId}`** — Allocation ledger entry for the AccountTransfer (jobs.ts recordAllocation + postLedgerEntry)
- **`reimb:{expenseId}`** — Reimbursement ledger debit + ACH initiation (expenses.ts payReimbursement + postLedgerEntry)
- **`refund:{chargeId}:{cumulativeAmountRefundedCents}`** — Refund ledger debit (giving.ts recordDonationRefund + postLedgerEntry). The CUMULATIVE amount (Stripe's own running total, not a per-event delta) is part of the key, so a redelivered `charge.refunded` webhook with the same cumulative amount dedupes to one entry, while a later refund step (e.g. partial → full) gets its own key and posts its own entry.
- **`donation-intent:{fundId}:{idempotencyNonce}`** — Stripe's own REQUEST-level idempotency key on `paymentIntents.create` (giving.ts createDonationIntent), not a ledger key — prevents a double-tap on the give sheet from creating two PaymentIntents. Only sent when the client provides `idempotencyNonce`.

Ledger posting adds `:debit` or `:credit` suffix to distinguish the paired transfer legs (see lib/finance/ledger.ts postPairedTransfer).

## Webhook Security

**Stripe (/stripe-webhook, routed in http.ts)**
- Signature verification via HMAC-SHA256 (Web Crypto API — no Node crypto, Convex action isolation)
- Signature header: `stripe-signature` (format: `t=<timestamp>,v1=<hash>,…`)
- Shared with billing layer; finance dispatch added to event router (previously billing-only)
- Defense-in-depth beyond signature verification: donation-crediting/refunding events (`payment_intent.succeeded`, `charge.refunded`) additionally cross-check the event's Connect `account` against the target fund's own `communityFinance.stripeConnectedAccountId` server-side before writing anything — a mismatch is rejected and audited (`webhook.rejected_account_mismatch`), never silently trusted off event metadata alone (see `functions/finance/webhooks.ts`'s `getFundFinanceForWebhook` / `getDonationFundForWebhook`)

**Increase (/increase-webhook, routed in http.ts)**
- Signature verification via Increase's `Idempotency-Key` echo and HTTP 200 ACK (documented in lib/finance/increase.ts)
- No additional X-signature header — Increase API is bearer-token auth only; webhook authenticity relies on Transport Layer Security + the bank's own request origin
- Webhook retries on non-200; Increase stops retrying after successful ACK (per docs: `https://increase.com/documentation/webhooks`)
- Event types routed in functions/finance/webhooks.ts to category handlers (entity.created, account.created, account.updated, transfer.created)

## Permissions

**Fund role hierarchy** (see lib/helpers.ts requireFundRole):
- `cardholder` (rank 0) — Can submit expenses
- `manager` (rank 1) — Can approve expenses; can submit (rank ≥ cardholder)
- `finance_admin` (rank 2) — Can assign roles, freeze funds, approve expense; can approve (rank ≥ manager)

**Community admin override** (ADR-032 §4) — Community admins always pass requireFundRole checks; admins can do anything on any fund without an explicit grant. Mirrors requireCommunityAdmin + requireGroupLeaderOrCommunityAdmin patterns.

**Group leader carve-out** — Group leaders can (via requireFundRoleOrGroupLeader in roles.ts) assign themselves or other active group members a finance role on their group's fund (ADR-032 §4 exception: leaders gain a narrow role-grant power scoped to their group only). Used in enableGroupGiving (grants current leaders finance_admin on the new fund).

## Testing

Four finance test files in `apps/convex/__tests__/`:

- **finance-ledger.test.ts** — Tests `postLedgerEntry`, `deriveBalance`, `checkInvariant`, paired-transfer semantics; validates dedup by idempotencyKey and the append-only invariant
- **finance-onboarding.test.ts** — Tests `startOnboarding` (form validation — EIN format, address shape), status machine transitions, idempotency of external provisioning calls
- **finance-expenses.test.ts** — Tests `submitExpense`, `approveExpense`, `denyExpense`, two-approver $200 threshold, policy violations (non-members can't submit, expired roles can't approve)
- **finance-giving.test.ts** — Tests `planAllocations` (oldest-first, whole-only selection), `recordAllocation` semantics, reconcile drift detection; exercises allocation/reconcile directly without Increase provider (lazy-imported in actions so tests never load it)

## Known Seams & TODOs

- **Community withdrawals + solvency warnings are Phase-2 requirements** —
  see ADR-032 "Phase 2 requirements": withdrawals draw from the General
  fund's Account only, capped at settled (not ledger) balance; explicit
  group-fund sweeps require double confirmation + notification to the fund's
  finance admins; payout-destination drift (church re-pointing Stripe payouts
  away from the managed Increase account via the Express Dashboard) must be
  detected and surfaced.

- **Allocation matches GROSS donation amounts against a NET payout.** A Stripe
  payout is net of processing fees, while `planAllocations` sums gross
  donation totals — so a payout will under-cover its own donations by roughly
  the fee amount, leaving a tail of donations pending (surfaced by the
  `allocation.stale_pending` alert; no money moves incorrectly because the
  stale backstop is alert-only and payout replays are blocked by
  `processedStripePayouts`). Before Phase-2 go-live, allocation must switch to
  balance-transaction-based per-charge NET amounts (`stripe.balanceTransactions`
  for the payout) instead of gross donation totals. Tracked from the Codex
  review on PR #653.

**Member payout destination stub** (expenses.ts `getPayoutDestination`) — Phase 2 follow-up. Currently returns `null` (every expense blocks at "no destination found"). Awaiting linking flow to ship; structure is in place (`payReimbursement` action + `recordReimbursementPaid` mutation + Increase ACH client calls). Replace the stub with a real lookup once the UI for members to link their bank account lands.

**Card-charge expenses** (expenses.ts module comment) — Phase 3. Expense schema includes `kind: "card_charge"`, but today's implementation only handles reimbursements. Card charges are created by the card-transaction webhook; approval/payout flows are structured but stubbed (see the card_capture kind in ledger).

**Statement descriptor source** (expenses.ts `payReimbursement` comment) — Phase 2. Currently hardcoded in Stripe requests; should source from `communityFinance.statementDescriptor` once collected in onboarding (the form already captures it).

**Payment confirmation UI** — Phase 3 mobile wave. Payout flows exist (allocation/reconcile/pay), but the mobile app's payment confirmation / receipt display is not yet implemented.

**Group archive freeze without the bank-side sweep** (onboarding.ts `freezeFundForArchivedGroup`, scheduled from `functions/groups/mutations.ts`'s `isArchived: true` cascade) — ADR-032 §3 "Group archive" describes freeze cards + AccountTransfer the remainder to the General Account (or a successor group) + close the Account + paired sweep ledger entries. Only the freeze half is wired today: archiving a group flips its fund's `status` to `"frozen"`, which blocks new donations (`createDonationIntent`'s `prepareDonationIntent`), new expense submissions/approvals (`expenses.ts`), and new reimbursement payouts (`payReimbursement`'s fund-status gate) — `postLedgerEntry`'s `FROZEN_ALLOWED_KINDS` still lets `refund`/`transfer`/`sweep` entries land so anything already in flight can settle. The actual bank-side sweep (moving the frozen fund's remaining balance out and closing its Increase Account) is **not implemented** — it's a Phase-2 admin-triggered mutation, not yet built. Until it ships, an archived group's fund balance sits frozen but un-swept in its Increase Account.

**Dispute lifecycle** (giving.ts `recordDonationDisputed`, webhooks.ts's `charge.dispute.created` case) — audit-only. No provisional debit on dispute creation, no reversal-on-win/debit-on-loss ledger entries, no fund-status interaction. Any actual bank-side withdrawal Stripe/Increase performs on a dispute will show up as ledger/bank drift and get flagged by the existing nightly reconcile job (`jobs.ts` `runNightlyReconcile`) until a real dispute state machine is designed and built.
