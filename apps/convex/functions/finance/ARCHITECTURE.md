# Finance System Architecture (ADR-032)

## Module Map

**functions/finance/onboarding.ts** — Community-level intake and status machine. Exports `startOnboarding` (mutation: one-time intake form — legalName, EIN, address, website, statementDescriptor — triggering `provisionProviders`), `getOnboardingStatus` (read-side for the mobile admin checklist), `enableGroupGiving` (per-group fund provisioning + leader role grants), `applyStripeAccountStatus` (Stripe webhook-driven status machine), `recordProvisioned` (internal: stores provider ids after external provisioning succeeds), `recordProvisioningFailure` (internal: marks `stripe_blocked`/`increase_blocked` with a stored `provisioningError` when `provisionProviders` itself throws — there is no webhook at that stage to explain a stall, so the checklist surfaces the provider error directly), `retryProvisioning` (mutation: admin re-runs a failed provisioning; safe because every provider call is idempotency-keyed on the community id; refuses once all provider ids exist so it can't clobber a webhook-set blocked state), `freezeFundForArchivedGroup` (internal: freezes a group's fund on archive — ADR-032 §3, freeze half only), and `isValidEin` (pure validator for EIN format).

**functions/finance/giving.ts** — Donation lifecycle and transparency screen. Exports `getGivingContext` (assembly of donation UI: fund list, suggested amounts, fee-cover toggle), `createDonationIntent` (creates Stripe PaymentIntent on the connected account, with an optional client nonce folded into Stripe's own request idempotency key to prevent a double-tap double-charge), `recordDonationSucceeded` (internal: Stripe webhook handler — writes donation + ledger credit + schedules receipt), `recordDonationRefund` (internal: Stripe `charge.refunded` handler — posts a "refund" ledger debit, replay-safe against Stripe's cumulative `amount_refunded`; also stamps `donations.refundedCents`, flips a fully-refunded pending gift to the terminal `"refunded"` allocation status so it can never be transferred, and reverses the realised allocation fee when refunds exceed the net the fund received, so a fund balance can't go negative), `recordDonationDisputed` (internal: Stripe `charge.dispute.created` handler — audit-only), `getFundOverview` (transparency screen with donor-name visibility gating for non-finance roles; period totals split spend from `feesCents`/`refundedCents`), and `updateDonationReceipt` (internal: Resend email callback handler).

**functions/finance/expenses.ts** — Member reimbursement submission, approval, and payout. Exports `submitExpense` (mutation: member-submitted reimbursement request; rejects on a non-active fund), `approveExpense` (mutation: first or second approval, respecting the $200 threshold; rejects on a non-active fund), `denyExpense` (mutation: explicit rejection — allowed regardless of fund status), `payReimbursement` (internal action: ACH transfer via Increase, gated on `fund.status === "active"` BEFORE the transfer call — currently a no-op stub for the transfer itself awaiting payout-destination linking), and `recordReimbursementPaid` (internal: called post-transfer or by manual entry).

**functions/finance/roles.ts** — Fund role (finance_admin / manager / cardholder) lifecycle. Exports `grantFundRole` (mutation: community-admin-only role assignment), `revokeFundRole` (mutation: soft-delete via revokedAt), and `getFundRoles` (query: list active roles on a fund).

**functions/finance/jobs.ts** — Allocation, reconciliation, and payout-retry background jobs. Exports `planAllocations` (internal: binds a payout's donations to it, matching Stripe balance-transaction per-PaymentIntent NET amounts and stamping `donations.allocationPayoutId` / `payoutNetCents` / the transfer lease; skips — never `break`s on — an item it can't fit or that another pass holds), `recordAllocation` (internal: flips donation.allocationStatus, posts the realised Stripe fee as a `fee` ledger debit, releases the lease, audit-logs the transfer id), `recordAllocationFailure` (internal: releases the lease and audits `allocation.transfer_failed` or `allocation.record_failed` depending on which half failed, leaving the item pending and retryable), `runAllocation` (internal action: reads the payout's composition from Stripe, plans, then transfers item-by-item with per-item error isolation; alarms on an unmatched payout), `recordUnmatchedPayout` (internal: the `allocation.payout_unmatched` alarm), `unbindFailedPayout` (internal: `payout.failed` handler — releases the bindings a `payout.paid` made), `listResumableAllocations` (internal: payout-bound donations whose transfer never landed, leased as they're handed out), `runNightlyReconcileAllCommunities` (cron: nightly invariant check per community), `retryStaleAllocations` (cron: resumes stranded payout-bound allocations, alerts on donations no payout has covered yet), `retryStuckReimbursements` (cron: re-schedules `payReimbursement` for reimbursements stuck "approved" > 6h with no transfer — a backstop for a crashed/interrupted payout, safe because `createAchTransfer`'s idempotency key collapses a retry to the same transfer), and `registerFinanceCrons` (registers all three crons — reconcile daily at 07:00 UTC, allocation-retry hourly at :45, stuck-reimbursement-retry hourly at :20).

**functions/finance/webhooks.ts** — Stripe payment/payout/refund/dispute and Increase event dispatch + signature verification. Handles Stripe routing to `recordDonationSucceeded` (payment_intent.succeeded, with a server-side connected-account cross-check against the fund's own `communityFinance` before crediting — see `getFundFinanceForWebhook`), `recordDonationRefund` (charge.refunded, same account cross-check via `getDonationFundForWebhook`), `recordDonationDisputed` (charge.dispute.created, audit-only), `runAllocation` (payout.paid **and** payout.reconciliation_completed — Stripe attributes balance transactions asynchronously, so the paid event alone can read a partial or empty composition), `unbindFailedPayout` (payout.failed), Increase Entity/Account status updates (entity.created, account.created), `recordCardSettlement` (transaction.created with `source.category === "card_settlement"` — turns a card swipe into a `card_charge` expense + ledger debit, see cards.ts below), and webhook signature verification via Increase's idempotency behavior (documented in lib/finance/increase.ts).

**functions/finance/cards.ts** — Group-fund virtual cards (ADR-032 §3 Phase 3). Exports `listFundCards` / `getCardDetail` (cardholder+/leader/admin-gated reads; `getCardDetail` includes the card's last 20 `card_charge` expenses), `createFundCard` (mutation: finance_admin issues a card to a cardholder+ holder — rejects a non-`active` fund, a fund with no `increaseAccountId`, or a community whose `communityFinance.onboardingStatus` isn't `"live"`; inserts a `"pending"` row, audits `card.created`, then schedules `provisionCard`, an internalAction that calls Increase's `createCard` and records the result via `recordCardProvisioned`/`recordCardProvisionFailed` — same provider-write-then-record shape as onboarding.ts's `provisionProviders`), `setCardFrozen` (mutation: the holder can self-freeze, but only a finance_admin can unfreeze — a compromised holder must not be able to re-enable their own frozen card), and `cancelCard` (mutation: finance_admin-only, irreversible). Both lifecycle mutations schedule the shared `applyCardStatus` internalAction (`updateCardStatus` at Increase, then `recordCardStatus` persists whatever status Increase actually confirmed). `spendLimitCents`/`limitPeriod` are **advisory only** — Increase enforces no automatic period reset tied to them; real per-swipe enforcement needs Increase's real-time-authorization webhook, out of scope here (Phase 2 follow-up, see "Known Seams & TODOs"). The settlement side — turning a confirmed card swipe into an expense — is `webhooks.ts`'s `recordCardSettlement`, not this file.

## Money Flow

**Donation → Ledger → Payout → Allocation → Reconcile**

1. `createDonationIntent` (Stripe PaymentIntent on connected account) → donor card charged
2. Stripe webhook: `payment_intent.succeeded` → `recordDonationSucceeded` (writes donations row + credit to ledger + schedules receipt email)
3. Stripe bulk payout (T+2) arrives at Increase receiving Account — **net** of Stripe's processing fees
4. Webhook: `payout.paid` (and `payout.reconciliation_completed`) → `runAllocation`: read the payout's per-PaymentIntent NET composition from Stripe (`getPayoutComposition`) → `planAllocations` binds each matching donation to the payout and leases it → one Increase AccountTransfer per group-fund donation, at its NET, each isolated from the others → `recordAllocation` flips allocationStatus and posts the `gross − refunded − net` difference as a `fee` ledger debit
5. Nightly cron: `runNightlyReconcileAllCommunities` → invariant check (ledger balance == bank balance + pending, pending summed on the same NET basis step 4 transfers)

**Why NET, not gross (ADR-032 Phase-2 requirement 6).** A payout delivers the sum of its charges' nets. Matching donations by gross — what the donor was charged and what the ledger was credited — could never fit a donation inside the payout carrying it, which deterministically stalled allocation on the ordinary one-donation-per-payout case. Stripe's balance transactions for a payout also say exactly *which* charges it contained, so membership is read rather than inferred from a running total, and a donation is matched by PaymentIntent identity.

**Refunds are netted, never dropped.** A payout's balance transactions include reversals (`refund`, `payment_refund`, `adjustment` for a chargeback, and the `*_failure` rows that put money back). `getPayoutComposition` sums each PaymentIntent's rows — a Refund's expanded `source` carries `payment_intent` just like a Charge's does — and emits only PaymentIntents whose total is strictly positive; the rest come back as `reversedPaymentIntentIds`. Discarding reversal rows (as the first cut of this job did) was a P0: a donation refunded before its payout is still `allocationStatus: "pending"`, so the surviving charge row looked like a fundable gift and the job transferred money the donor had already been given back into a group's spendable Increase Account. Belt and braces on the other side: `recordDonationRefund` stamps `donations.refundedCents` and flips a fully-refunded pending gift to the terminal `"refunded"` status, which every allocation query (planner, retry cron, pending sum) excludes.

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
  - `donation.allocated` — Increase AccountTransfer completed; details carry the transfer id, the payout id, and the net/gross/fee breakdown of the balance change
  - `allocation.transfer_failed` — One item of an allocation pass didn't transfer; **no money moved**. The donation stays `pending` with its payout binding and its lease released, so the next pass (webhook redelivery or the hourly retry) picks up exactly it
  - `allocation.record_failed` — The Increase transfer **landed** (its id is in the details) but the bookkeeping mutation threw, so real money is in the group's Account with nothing in the ledger saying so. Distinct from `transfer_failed` on purpose: the retry re-issues the same `alloc:{donationId}` key, which Increase collapses into the same transfer, then re-attempts the recording
  - `allocation.refunded_in_flight` — A refund landed while that donation's transfer was in flight, so money moved for a gift the donor already got back. The donation stays `"refunded"` and the misplaced money surfaces as reconcile drift
  - `allocation.payout_unmatched` — A payout matched no donation at all, or a material slice of it couldn't be attributed. The one allocation failure with no automatic recovery (the `processedStripePayouts` row is written and the webhook 200s, so Stripe never redelivers), hence the alarm
  - `allocation.payout_failed` — `payout.failed` arrived; donations that a `payout.paid` for the same payout had bound were unbound so the retry cron stops trying to move money out of an Account that never received it
  - `allocation.stale_pending` — Donations pending allocation for > 3 days; the amount is the **>3-day slice only**, not the community's whole pending balance. Details include how many stranded items that run managed to resume
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
  - `webhook.rejected_account_mismatch` — A donation-crediting/refunding webhook event's `account` didn't match the fund's community's connected account; nothing was credited/debited (also used by `recordCardSettlement` for a card transaction's `account_id` mismatch)
  - `fund.frozen` — Fund frozen (e.g. its group was archived)
  - `card.created` — Card issued (row inserted; provisioning at Increase is still in flight)
  - `card.provision_failed` — `provisionCard`'s Increase call itself failed; card marked `"failed"`
  - `card.frozen` / `card.unfrozen` — Card status change requested (holder self-freeze, or finance_admin either direction)
  - `card.canceled` — Card permanently canceled (finance_admin only)
  - `expense.card_charge_recorded` — Card-settlement webhook created a `card_charge` expense + ledger debit
- Indexed `by_community`, `by_fund` (both with `createdAt` for timeline queries)

## Idempotency Inventory

Every external write (Stripe, Increase API calls) is idempotency-keyed to safely retry without duplicating effects:

- **`finance:stripe-account:{communityId}`** — Community Stripe connected account creation (used in onboarding.ts createConnectedAccount)
- **`finance:entity:{communityId}`** — Increase Entity creation (communityFinance.increaseEntityId — used in increase.ts createEntity)
- **`donation:{paymentIntentId}`** — Donation ledger credit (giving.ts recordDonationSucceeded + ledger posting)
- **`alloc:{donationId}`** — Increase AccountTransfer for one allocated donation (jobs.ts `executeAllocationItems` → `createAccountTransfer`). Doing double duty as replay protection: if a transfer succeeded but the action died before recording it, the retry resolves to the SAME transfer at Increase instead of moving money twice.
- **`alloc-fee:{donationId}`** — The `fee` ledger debit for the Stripe processing fee realised when that donation's allocation lands (jobs.ts recordAllocation + postLedgerEntry)
- **`reimb:{expenseId}`** — Reimbursement ledger debit + ACH initiation (expenses.ts payReimbursement + postLedgerEntry)
- **`refund:{chargeId}:{cumulativeAmountRefundedCents}`** — Refund ledger debit (giving.ts recordDonationRefund + postLedgerEntry). The CUMULATIVE amount (Stripe's own running total, not a per-event delta) is part of the key, so a redelivered `charge.refunded` webhook with the same cumulative amount dedupes to one entry, while a later refund step (e.g. partial → full) gets its own key and posts its own entry.
- **`alloc-fee-reversal:{donationId}`** — The compensating `fee` CREDIT that cancels an `alloc-fee:{donationId}` debit once refunds exceed the net the fund actually received (giving.ts recordDonationRefund). Keyed per donation, not per refund step, so the reversal happens at most once however many refund events arrive.
- **`donation-intent:{fundId}:{idempotencyNonce}`** — Stripe's own REQUEST-level idempotency key on `paymentIntents.create` (giving.ts createDonationIntent), not a ledger key — prevents a double-tap on the give sheet from creating two PaymentIntents. Only sent when the client provides `idempotencyNonce`.
- **`finance:card:{cardId}`** — Increase card creation (cards.ts provisionCard + createCard)
- **`card-settlement:{increaseTransactionId}`** — Card-charge ledger debit (webhooks.ts recordCardSettlement + postLedgerEntry); the expense row itself is deduped separately via `expenses.by_increaseTransactionId` before either write happens.

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

Finance test files in `apps/convex/__tests__/`:

- **finance-ledger.test.ts** — Tests `postLedgerEntry`, `deriveBalance`, `checkInvariant`, paired-transfer semantics; validates dedup by idempotencyKey and the append-only invariant
- **finance-onboarding.test.ts** — Tests `startOnboarding` (form validation — EIN format, address shape), status machine transitions, idempotency of external provisioning calls
- **finance-expenses.test.ts** — Tests `submitExpense`, `approveExpense`, `denyExpense`, two-approver $200 threshold, policy violations (non-members can't submit, expired roles can't approve)
- **finance-giving.test.ts** — Tests the donation lifecycle (`recordDonationSucceeded`/`Refund`/`Disputed`, transparency reads), plus `recordAllocation` semantics, `computePendingAllocationCents`, and reconcile drift detection; exercises them directly without the Increase provider (lazy-imported in actions so these tests never load it)
- **finance-allocation.test.ts** — Tests the payout seam end to end: NET matching (including the exact stall — a lone donation whose gross exceeds its payout's net), skip-don't-stall selection, per-donation replay protection, the concurrency lease (a second pass over a live-leased item gets nothing; an expired lease is reclaimable), partial-failure isolation and resume (transfer 2 of 3 fails → 1 and 3 land, a redelivery finishes 2 and re-transfers nothing), transfer-landed-record-failed as a distinct audited outcome, no-op replay of a completed payout, the full refund sequences (before payout → nothing transfers and no negative balance; partial before payout; full after allocation → fee reversed; refunded while bound → retry cron drops it), unmatched/empty payouts alarming, `payout.failed` unbinding, `retryStaleAllocations` recovery vs. alert-only, and drift on a stranded allocation. Unlike the other suites this one drives the `runAllocation` **action**, with `getPayoutComposition` and `createAccountTransfer` mocked at the module boundary — the Increase mock models idempotency-key dedupe, so the "same key returns the same transfer" lock is genuinely exercised — and deliberately no suite-wide fake timers, so an awaited action can't silently no-op
- **finance-payout-nets.test.ts** — Tests `getPayoutComposition` against a mocked `stripe` SDK: NET extraction, PaymentIntent mapping via the expanded `source`, paging (including a charge and its refund landing on different pages), netting refunds/chargebacks/failed-refunds against their charge, reporting reversals that can't be attributed, refusing a truncated view, and skipping pure bookkeeping rows and malformed nets
- **finance-cards.test.ts** — Tests `createFundCard` (pending row + audit, holder-role gate, caller gate, fund-readiness gates), `listFundCards`/`getCardDetail` viewer gating, `setCardFrozen` permissions (self-freeze vs. finance_admin-only unfreeze), `cancelCard` (finance_admin-only), and `recordCardSettlement` (idempotency, account-mismatch rejection, missing-card log-not-throw)

## Known Seams & TODOs

- **Community withdrawals + solvency warnings are Phase-2 requirements** —
  see ADR-032 "Phase 2 requirements": withdrawals draw from the General
  fund's Account only, capped at settled (not ledger) balance; explicit
  group-fund sweeps require double confirmation + notification to the fund's
  finance admins and managers; payout-destination drift (church re-pointing Stripe payouts
  away from the managed Increase account via the Express Dashboard) must be
  detected and surfaced.

- **Net-amount allocation — DONE** (ADR-032 Phase-2 requirement 6, was a hard
  go-live prerequisite). Allocation matches Stripe balance-transaction
  per-PaymentIntent NET amounts (`getPayoutComposition` in lib/finance/stripeConnect.ts,
  `GET /v1/balance_transactions?payout=…&expand[]=data.source` on the
  connected account, paged), not gross donation totals. The old gross matcher
  compared a gross donation against a fee-reduced payout, so the common
  one-donation-per-payout case never fit — and it `break`ed on the first
  non-fitting item, so the queue never advanced and every later payout stalled
  the same way. Selection now skips (`continue`) rather than stopping, and
  membership comes from Stripe rather than a running total.

  **Partial-failure recovery semantics.** The transfer and the recording are
  wrapped in SEPARATE try blocks per item: one failure costs that donation
  only, and the two halves are audited differently
  (`allocation.transfer_failed` = no money moved; `allocation.record_failed` =
  money moved and isn't booked yet) because they need different responses from
  whoever reads the log. Either way the donation stays `pending` with its
  `allocationPayoutId` / `payoutNetCents` stamp intact and its lease released.
  Replay protection is per-**(payout, donation)**, not per payout: a
  redelivered `payout.paid` re-derives the same donation set from Stripe,
  drops the ones already flipped to `"allocated"`, and finishes only the tail.
  `processedStripePayouts` is now only the bookkeeping record of the first
  pass, not the gate. Stripe is queried *before* anything is written, so an
  unreachable Stripe leaves the payout wholly untouched for the next attempt.
  `retryStaleAllocations` (hourly) resumes stranded payout-bound donations for
  real now — the payout id and the exact delivered net are on the row, so
  nothing has to be guessed — and stays alert-only for donations no payout has
  covered yet (fabricating a payout amount there would still be wrong; Codex
  review, PR #653).

  **Exactly-once rests on three locks, in this order.**
  1. **A per-donation transfer LEASE** (`donations.allocationTransferStartedAt`,
     15-minute TTL). Taken inside the selection *mutation* — `planAllocations`
     and `listResumableAllocations` both claim every item they hand out and
     skip anything another pass still holds — so acquiring the claim and
     returning the item are one serializable transaction and Convex's OCC
     picks the winner. This is what closes the window that opened when the
     whole-payout `claimPayout` was removed: the payout stamp alone is a
     *marker*, and two passes (a redelivered webhook, or the `:45` retry cron
     firing mid-`runAllocation`) could both be handed the same bound donation
     and both issue `alloc:{donationId}` *concurrently*, before either had
     recorded anything. Increase documents "at most one object per key" but
     says nothing about two in-flight requests sharing one, which is not a
     property to rest a money guarantee on. Failures release the lease
     immediately, so the normal retry path never waits for expiry; the TTL
     only bounds a pass that died mid-transfer.
  2. **`recordAllocation` no-ops** on an already-`"allocated"` donation, so a
     finished item is never re-recorded.
  3. **The `alloc:{donationId}` Increase idempotency key** collapses the
     genuinely ambiguous case (transfer landed, recording didn't) into the
     same transfer instead of a second movement of money.

  **Unmatched payouts alarm.** An empty plan used to `return` silently while
  the `processedStripePayouts` row was already written and the webhook 200'd —
  no redelivery, and the retry cron only resumes *bound* donations, so nothing
  would ever re-plan that payout. `runAllocation` now audits
  `allocation.payout_unmatched` for an empty plan or a material unattributed
  remainder (>$1, or >1% of the payout). `payout.reconciliation_completed` is
  routed alongside `payout.paid` because Stripe attributes balance
  transactions to a payout asynchronously, so a query at `payout.paid` can
  legitimately come back partial or empty; and `getPayoutComposition` throws
  rather than returning a truncated prefix if the 100-page cap is hit while
  Stripe still reports `has_more`. `payout.failed` unbinds whatever a
  preceding `payout.paid` bound.

  **Ledger consequence: allocation posts a `fee` debit.** The donation credit
  is gross, the bank only ever holds net, so ADR-032's invariant
  (`funds.balanceCents === Increase balance + pending allocations`) is only
  satisfiable if the fee is realised somewhere. `recordAllocation` posts it
  (`gross − net`, key `alloc-fee:{donationId}`) when the transfer lands — and
  that timing is deliberate. `computePendingAllocationCents` counts a donation
  at gross while it's still in the Stripe pipeline and at net once a payout
  has bound it, so the three states read:
  in-pipeline `ledger gross / bank 0 / pending gross` → ok;
  bound but stalled `ledger gross / bank 0 / pending net` → **drift = fee**;
  allocated `ledger net / bank net / pending 0` → ok. Summing pending at gross
  throughout (as it used to) made a stalled allocation self-consistent, which
  is why the deterministic stall was invisible to the nightly alarm. `"fee"`
  is in `FROZEN_ALLOWED_KINDS` for the same in-flight reason as refunds: Stripe
  already kept the money, so a fund frozen between gift and allocation must
  still record it.

  The fee is **not** member-facing "spend". `summarizePeriod` (giving.ts)
  buckets only what a group chose to spend — card swipes, reimbursements,
  transfers, sweeps — into `spentCents`, and reports `feesCents` /
  `refundedCents` separately. Counting the fee as spend would have a group
  that spent nothing report spending 2.9% + 30¢ of every gift on the one
  screen whose purpose is telling members where their money went; hiding it
  entirely would leave "given" minus "spent" not reconciling against the
  balance. Both surfaces render the separate line: `FundScreenView`'s MTD/YTD
  cards and `GivingHubView`'s "SPENT THIS MONTH" tile.

  **Refund states (the fourth and fifth rows of that table).**
  `recordDonationRefund` stamps `donations.refundedCents` and, on a full
  refund of a still-pending gift, flips it to the terminal `"refunded"`
  status. So:
  refunded before its payout `ledger 0 / bank 0 / pending 0` → ok;
  partially refunded, not paid out `ledger gross−refund / bank 0 /
  pending gross−refund` → ok;
  refunded AFTER allocation `ledger gross−fee−refund / bank NET / pending 0`
  → **drift**, deliberately. Stripe takes the refund out of the community's
  Stripe balance (shrinking a later payout) while the gift's money already
  sits in the group's own Increase Account; retrieving it is a bank-side
  clawback ADR-032 hasn't designed, so the nightly reconcile alarms on
  exactly that amount until it's handled by hand. What is guaranteed is that
  a fund balance never renders NEGATIVE from a refund: once refunds exceed
  the net the fund actually received, the realised `fee` debit is cancelled
  by a compensating credit (`alloc-fee-reversal:{donationId}`) instead of
  being left as an overdraft. Partial refunds that stay under the net leave
  the fee alone — Stripe genuinely kept it on the portion the fund retained.
  `recordAllocation` charges its fee on `gross − refunded − net`, not
  `gross − net`, so a partial refund settling inside the same payout isn't
  debited twice.

  DISPUTES remain audit-only and known-drifting (see "Dispute lifecycle"
  below), but the money path is safe without a dispute state machine: Stripe
  posts a chargeback as an `adjustment` balance transaction, which
  `getPayoutComposition` nets against the charge exactly like a refund, so a
  disputed gift is never transferred out of the receiving Account.

  **Still open (pre-existing, unchanged here):** general-fund donations are
  recorded as allocated without any transfer, because `recordProvisioned`
  never provisions a separate General Increase Account (ADR-032 §1's topology
  says there is one) — unearmarked money simply stays in the receiving
  Account. The General fund has no `increaseAccountId`, so
  `getFundsWithIncreaseAccount` excludes it from reconcile and nothing
  alarms; it just means the General fund's ledger balance isn't backed by a
  bank account of its own yet. Provisioning that Account is Phase-2 work.

**Member payout destination stub** (expenses.ts `getPayoutDestination`) — Phase 2 follow-up. Currently returns `null` (every expense blocks at "no destination found"). Awaiting linking flow to ship; structure is in place (`payReimbursement` action + `recordReimbursementPaid` mutation + Increase ACH client calls). Replace the stub with a real lookup once the UI for members to link their bank account lands.

**Card-charge expenses** — Phase 3, now implemented (cards.ts + webhooks.ts's `recordCardSettlement`). A card swipe becomes a `"pending"` `card_charge` expense via the `transaction.created` webhook. Approval/payout for `card_charge` kind still isn't wired: `expenses.ts`'s `approveExpense`/`denyExpense`/`payReimbursement` are written for the reimbursement flow only — a `card_charge` expense today just sits `"pending"` for the transparency screen and manual bookkeeping until an approval flow is designed for it (real money already moved at swipe time, so "approval" here would be after-the-fact acknowledgment, not authorization — a different shape than reimbursement approval).

**Statement descriptor source** (expenses.ts `payReimbursement` comment) — Phase 2. Currently hardcoded in Stripe requests; should source from `communityFinance.statementDescriptor` once collected in onboarding (the form already captures it).

**Payment confirmation UI** — Phase 3 mobile wave. Payout flows exist (allocation/reconcile/pay), but the mobile app's payment confirmation / receipt display is not yet implemented.

**Group archive freeze without the bank-side sweep** (onboarding.ts `freezeFundForArchivedGroup`, scheduled from `functions/groups/mutations.ts`'s `isArchived: true` cascade) — ADR-032 §3 "Group archive" describes freeze cards + AccountTransfer the remainder to the General Account (or a successor group) + close the Account + paired sweep ledger entries. Only the freeze half is wired today: archiving a group flips its fund's `status` to `"frozen"`, which blocks new donations (`createDonationIntent`'s `prepareDonationIntent`), new expense submissions/approvals (`expenses.ts`), and new reimbursement payouts (`payReimbursement`'s fund-status gate) — `postLedgerEntry`'s `FROZEN_ALLOWED_KINDS` still lets `refund`/`transfer`/`sweep` entries land so anything already in flight can settle. The actual bank-side sweep (moving the frozen fund's remaining balance out and closing its Increase Account) is **not implemented** — it's a Phase-2 admin-triggered mutation, not yet built. Until it ships, an archived group's fund balance sits frozen but un-swept in its Increase Account.

**Dispute lifecycle** (giving.ts `recordDonationDisputed`, webhooks.ts's `charge.dispute.created` case) — audit-only. No provisional debit on dispute creation, no reversal-on-win/debit-on-loss ledger entries, no fund-status interaction. Any actual bank-side withdrawal Stripe/Increase performs on a dispute will show up as ledger/bank drift and get flagged by the existing nightly reconcile job (`jobs.ts` `runNightlyReconcile`) until a real dispute state machine is designed and built.
