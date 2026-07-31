# Finance System Architecture (ADR-032)

## Module Map

**functions/finance/onboarding.ts** — Community-level intake and status machine. Exports `startOnboarding` (mutation: one-time intake form — legalName, EIN, address, website, statementDescriptor — triggering `provisionProviders`), `getOnboardingStatus` (read-side for the mobile admin checklist), `enableGroupGiving` (per-group fund provisioning + leader role grants; **refuses unless the community's own `onboardingStatus` is `"live"`** — provisioning a group fund under a half-onboarded community used to "succeed" with a toast and then fail silently in the background, leaving a fund with no bank account), `applyStripeAccountStatus` (Stripe webhook-driven status machine), `recordProvisioned` (internal: stores provider ids after external provisioning succeeds, creates the community's General Fund once, and **returns its fund id** so the caller can mint its Account against it — ADR-032 §1), `recordProvisioningFailure` (internal: marks `stripe_blocked`/`increase_blocked` with a stored `provisioningError` when `provisionProviders` itself throws — there is no webhook at that stage to explain a stall, so the checklist surfaces the provider error directly), `retryProvisioning` (mutation: admin re-runs a failed provisioning; safe because every provider call is idempotency-keyed on the community id; refuses once all provider ids exist so it can't clobber a webhook-set blocked state), `provisionFundAccount` (internal action: **the one and only producer of a fund's Increase Account** — a group's on `enableGroupGiving`, the community's General Account on the provisioning, self-heal and backfill paths alike; no-ops if the fund already has one), `recordFundAccount` (internal: binds the Account to the fund and reconciles the fund's pre-Account history in the same transaction — see "General Account" below), `freezeFundForArchivedGroup` (internal: freezes a group's fund on archive — ADR-032 §3, freeze half only), and `isValidEin` (pure validator for EIN format).

### The General Account, and the one key that mints it

A community's Entity carries **two** Accounts: the receiving Account (Stripe's payout destination — transit for money still attributed to individual funds) and the **General Account**, the community-wide fund's own bank account. They must stay distinct: allocating a general-fund donation is a receiving → General transfer, which would be a no-op against itself.

**Exactly one code path mints a fund's Account, under exactly one key.** `provisionProviders` creates the Entity and receiving Account itself, then calls `recordProvisioned` (which inserts the General Fund row) and hands the resulting fund id to `provisionFundAccount`. `enableGroupGiving` and `migrations/backfillGeneralFundAccounts.ts` call the same action. The key is `fundAccountIdempotencyKey(type, fundId)` — `finance:general-account:{fundId}` or `finance:group-account:{fundId}`.

This is load-bearing, not tidiness. Increase dedupes on the idempotency key, so **two keys for the same logical account are two real bank Accounts** under a KYB'd Entity. `provisionProviders` used to mint the General Account inline under `finance:general-account:{communityId}:{fingerprint}` while `provisionFundAccount` used `finance:group-account:{fundId}`; a backfill interleaved with a provisioning run would have created a second, unreferenced, unaudited Account (the fund itself stayed single-valued, so no money could land in the loser — but the artefact would exist). Minting it against the fund id is also what makes the key fingerprint-free: the fund is inserted once and never re-created, so the key is stable across a corrected intake resubmission that mints a fresh Entity. The `group-account` prefix is kept for group funds deliberately — changing it would ask Increase for a second Account for any first attempt still in flight under the old key.

Because there's one producer, there's also one name at the bank: the fund's own `name` ("General Fund"), not two names depending on which path got there first. A name mismatch under a shared key would itself be an Increase error.

**Binding an Account reconciles the fund's history first.** `recordFundAccount` reopens every donation already marked `"allocated"` on the fund before it writes `increaseAccountId` — see "Backfilling a fund that already has history" under Known Seams.

**functions/finance/giving.ts** — Donation lifecycle and transparency screen. Exports `getGivingContext` (assembly of donation UI: fund list, suggested amounts, fee-cover toggle), `createDonationIntent` (creates Stripe PaymentIntent on the connected account, with an optional client nonce folded into Stripe's own request idempotency key to prevent a double-tap double-charge), `recordDonationSucceeded` (internal: Stripe webhook handler — writes donation + ledger credit + schedules receipt), `recordDonationRefund` (internal: Stripe `charge.refunded` handler — posts a "refund" ledger debit, replay-safe against Stripe's cumulative `amount_refunded`; also stamps `donations.refundedCents`, flips a fully-refunded pending gift to the terminal `"refunded"` allocation status so it can never be transferred, and reverses the realised allocation fee when refunds exceed the net the fund received, so a fund balance can't go negative), `recordDonationDisputed` (internal: Stripe `charge.dispute.created` handler — audit-only), `getFundOverview` (transparency screen with donor-name visibility gating for non-finance roles; period totals split spend from `feesCents`/`refundedCents`), and `updateDonationReceipt` (internal: Resend email callback handler).

**functions/finance/expenses.ts** — Member reimbursement submission, approval, and payout. Exports `submitExpense` (mutation: member-submitted reimbursement request; rejects on a non-active fund, and rejects a `receiptKey` with no matching `uploadGrants` row for the caller — see "Receipt provenance" below), `approveExpense` (mutation: first or second approval, respecting the $200 threshold; rejects on a non-active fund), `denyExpense` (mutation: explicit rejection — allowed regardless of fund status, and deliberately NOT behind the feature flag: see "Feature-flag coverage"), `payReimbursement` (internal action: ACH transfer via Increase, gated on `fund.status === "active"` BEFORE the transfer call — currently a no-op stub for the transfer itself awaiting payout-destination linking), and `recordReimbursementPaid` (internal: called post-transfer or by manual entry).

**functions/finance/roles.ts** — Fund role (finance_admin / manager / cardholder) lifecycle. Exports `grantFundRole` (mutation: finance_admin, community admin, or — per the ADR-032 §4 carve-out — an active group leader; **a caller who is only through the gate as a group leader cannot name themselves as the target**, see "Group leader carve-out" below), `revokeFundRole` (mutation: soft-delete via revokedAt; deliberately NOT flag-gated), `listFundRoles`, and `getMyFundRole` (queries: both flag-gated).

**functions/finance/jobs.ts** — Allocation, reconciliation, and payout-retry background jobs. Exports `planAllocations` (internal: binds a payout's donations to it, matching Stripe balance-transaction per-PaymentIntent NET amounts and stamping `donations.allocationPayoutId` / `payoutNetCents` / the transfer lease; skips — never `break`s on — an item it can't fit or that another pass holds), `recordAllocation` (internal: flips donation.allocationStatus, posts the realised Stripe fee as a `fee` ledger debit, releases the lease, audit-logs the transfer id), `recordAllocationFailure` (internal: releases the lease and audits `allocation.transfer_failed` or `allocation.record_failed` depending on which half failed, leaving the item pending and retryable), `runAllocation` (internal action: reads the payout's composition from Stripe, plans, then transfers item-by-item with per-item error isolation — **every** fund transfers receiving → its own Account, general included; a fund with no `increaseAccountId` fails its item at the transfer stage, so the donation stays `"pending"` and retryable rather than being marked allocated with nowhere to have sent it; alarms on an unmatched payout), `recordUnmatchedPayout` (internal: the `allocation.payout_unmatched` alarm), `unbindFailedPayout` (internal: `payout.failed` handler — releases the bindings a `payout.paid` made), `listResumableAllocations` (internal: payout-bound donations whose transfer never landed, leased as they're handed out), `runNightlyReconcileAllCommunities` (cron: nightly invariant check per community), `retryStaleAllocations` (cron: resumes stranded payout-bound allocations, alerts on donations no payout has covered yet), `retryStuckReimbursements` (cron: re-schedules `payReimbursement` for reimbursements stuck "approved" > 6h with no transfer — a backstop for a crashed/interrupted payout, safe because `createAchTransfer`'s idempotency key collapses a retry to the same transfer), and `registerFinanceCrons` (registers all three crons — reconcile daily at 07:00 UTC, allocation-retry hourly at :45, stuck-reimbursement-retry hourly at :20).

**functions/finance/webhooks.ts** — Stripe payment/payout/refund/dispute and Increase event dispatch + signature verification. Handles Stripe routing to `recordDonationSucceeded` (payment_intent.succeeded, with a server-side connected-account cross-check against the fund's own `communityFinance` before crediting — see `getFundFinanceForWebhook`), `recordDonationRefund` (charge.refunded, same account cross-check via `getDonationFundForWebhook`), `recordDonationDisputed` (charge.dispute.created, audit-only), `runAllocation` (payout.paid **and** payout.reconciliation_completed — Stripe attributes balance transactions asynchronously, so the paid event alone can read a partial or empty composition), `unbindFailedPayout` (payout.failed), Increase Entity/Account status updates (entity.created, account.created), `recordCardSettlement` (transaction.created with `source.category === "card_settlement"` — turns a card swipe into a `card_charge` expense + ledger debit, see cards.ts below), and webhook signature verification via Increase's idempotency behavior (documented in lib/finance/increase.ts).

**functions/finance/cards.ts** — Group-fund virtual cards (ADR-032 §3 Phase 3). Exports `listFundCards` / `getCardDetail` (cardholder+/leader/admin-gated reads; `getCardDetail` includes the card's last 20 `card_charge` expenses), `createFundCard` (mutation: finance_admin issues a card to a cardholder+ holder — rejects a non-`active` fund, a fund with no `increaseAccountId`, or a community whose `communityFinance.onboardingStatus` isn't `"live"`; inserts a `"pending"` row, audits `card.created`, then schedules `provisionCard`, an internalAction that calls Increase's `createCard` and records the result via `recordCardProvisioned`/`recordCardProvisionFailed` — same provider-write-then-record shape as onboarding.ts's `provisionProviders`), `setCardLimit` (mutation: finance_admin changes or clears a live card's limit — same readiness gates as `createFundCard`, i.e. an `active` fund and a card that is `active`/`disabled`; a `canceled` card and a frozen fund are both refused, since changing a cap is mostly a spending-power grant. It returns `{ status: "pending", requested* }`, never the limit as if applied), `setCardFrozen` (mutation: the holder can self-freeze, but only a finance_admin can unfreeze — a compromised holder must not be able to re-enable their own frozen card), and `cancelCard` (mutation: finance_admin-only, irreversible). The lifecycle mutations schedule the shared `applyCardStatus` internalAction (`updateCardStatus` at Increase, then `recordCardStatus` persists whatever status Increase actually confirmed); `setCardLimit` schedules the equivalent `applyCardLimit`/`recordCardLimit` pair. The settlement side — turning a confirmed card swipe into an expense — is `webhooks.ts`'s `recordCardSettlement`, not this file.

**Spend limits are bank-enforced, not advisory.** `spendLimitCents`/`limitPeriod` are translated by **lib/finance/cardPolicy.ts** into Increase's `authorization_controls.usage.multi_use.spending_limits` and sent at card creation and on every change, so Increase declines an over-limit authorization without calling us ([Increase: Launching a card program](https://increase.com/documentation/launch-a-card-program) — "enforced at authorization time without a round trip to your server"). Increase's own reset semantics apply and are UTC: `week` → `per_week` (resets Mondays at midnight UTC), `month` → `per_month` (the 1st, midnight UTC), `charge` → `per_transaction`. The stored pair is a **mirror** of the bank's copy, only ever written after Increase confirms the change; `webhooks.ts` compares settlements against it and audits `card.limit_exceeded` when the two disagree.

**The drift audit runs in its own transaction, on purpose.** `recordCardSettlement` *schedules* `auditOverLimitCardCharge` rather than calling it — a Convex mutation is one transaction, so an inline check that threw would roll back the `card_charge` expense **and** the `card_capture` ledger debit, and Increase would retry the webhook straight into the same failure: a card swipe that silently stops being recorded. Scheduling is atomic with the settlement (it only happens if the settlement commits) while running separately, which is the only arrangement in which "the audit can never affect the money path" is true rather than intended. Its window query is bounded by the `expenses.by_card_created` index range (`cardId` + `createdAt`), not a `.collect()` of a card's whole history, so a card in weekly use for years can't grow the read until it hits Convex's limits. `finance-cards.test.ts` pins both: one test fails the audit deliberately and asserts the expense and ledger entry survive.

**Two card mutations are deliberately NOT behind the `group-giving` flag** — `setCardFrozen` and `cancelCard`. A card is a bank object that keeps authorizing when the app is switched off, so gating de-escalation on the kill switch would disarm the only tool for containing an incident. Role checks are unchanged. See lib/finance/flag.ts.

## Money Flow

**Donation → Ledger → Payout → Allocation → Reconcile**

1. `createDonationIntent` (Stripe PaymentIntent on connected account) → donor card charged
2. Stripe webhook: `payment_intent.succeeded` → `recordDonationSucceeded` (writes donations row + credit to ledger + schedules receipt email)
3. Stripe bulk payout (T+2) arrives at Increase receiving Account — **net** of Stripe's processing fees
4. Webhook: `payout.paid` (and `payout.reconciliation_completed`) → `runAllocation`: read the payout's per-PaymentIntent NET composition from Stripe (`getPayoutComposition`) → `planAllocations` binds each matching donation to the payout and leases it → one Increase AccountTransfer per donation, at its NET, into that fund's own Account (general included), each isolated from the others → `recordAllocation` flips allocationStatus and posts the `gross − refunded − net` difference as a `fee` ledger debit
5. Nightly cron: `runNightlyReconcileAllCommunities` → invariant check (ledger balance == bank balance + pending, pending summed on the same NET basis step 4 transfers)

**Why NET, not gross (ADR-032 Phase-2 requirement 6).** A payout delivers the sum of its charges' nets. Matching donations by gross — what the donor was charged and what the ledger was credited — could never fit a donation inside the payout carrying it, which deterministically stalled allocation on the ordinary one-donation-per-payout case. Stripe's balance transactions for a payout also say exactly *which* charges it contained, so membership is read rather than inferred from a running total, and a donation is matched by PaymentIntent identity.

**Refunds are netted, never dropped, and `payment_intent` — not `type` — decides what counts.** A payout's balance transactions include reversals (`refund`, `payment_refund`, `adjustment` for a chargeback, `payment_reversal` for a bank-side reversal of an ACH `payment`, and the `*_failure` rows that put money back). `getPayoutComposition` sums each PaymentIntent's rows — a Refund's expanded `source` carries `payment_intent` just like a Charge's does — and emits only PaymentIntents whose total is strictly positive; the rest come back as `reversedPaymentIntentIds`. Membership deliberately is **not** an allowlist of reversal types: every omission from such a list fails *open* (the charge row survives alone and looks fundable), and the first cut proved it by listing `payment_refund_failure`, which Stripe does not emit, while omitting `payment_reversal`, which it does. Two structural guards back this up: the nets of every row (excluding the payout's own `payout` leg) must sum **exactly** to `payout.amount` or `getPayoutComposition` throws, and anything it could not tie to a PaymentIntent lands in `unattributedNetCents`, whose negative direction `runAllocation` refuses outright. Discarding reversal rows (as the first cut of this job did) was a P0: a donation refunded before its payout is still `allocationStatus: "pending"`, so the surviving charge row looked like a fundable gift and the job transferred money the donor had already been given back into a group's spendable Increase Account. Belt and braces on the other side: `recordDonationRefund` stamps `donations.refundedCents` and flips a fully-refunded pending gift to the terminal `"refunded"` status, which every allocation query (planner, retry cron, pending sum) excludes.

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
  - `fund.account_provisioned` — A fund was bound to its Increase Account after the fact (backfilled General Account, or a group fund whose provisioning action landed later) — the moment allocation and nightly reconcile start covering it
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
  - `allocation.reopened` — A fund gained its Increase Account with donations already marked `"allocated"` behind it. Those can never have settled (there was no Account to transfer into), so they were flipped back to `"pending"` in the same transaction that bound the Account; details carry the count, the cents, and the donation ids (capped at 100, with `truncated`)
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
  - `card.provision_refused` — `provisionCard` re-checked the fund/community immediately before the provider call and found it no longer qualified (fund frozen, Account gone, onboarding out of `"live"`) between `createFundCard` and the scheduled action; no card was issued, row marked `"failed"`
  - `card.limit_update_requested` — A finance_admin asked to change or clear a card's spend limit (`from*`/`to*` in details). The **request**, recorded by `setCardLimit` with the actor; Increase hasn't been called yet
  - `card.limit_updated` — Increase **accepted** the change and the mirror was patched (written by `recordCardLimit`, not by the mutation). The audit trail must never assert a limit the bank never took, so the applied row only exists once it has
  - `card.limit_update_failed` — The change didn't complete. `details.providerApplied` is the important field: `false` = Increase refused, bank and mirror both still hold the old limit (consistent); `true` = Increase took the change but the mirror write failed, so **the bank and the app now disagree** and nothing reconciles it automatically (there is no read-back cron) — a finance_admin has to re-save the limit
  - `card.limit_exceeded` — A settled charge put the card past the limit Increase is supposed to be enforcing, i.e. our mirror and the bank disagree (see `webhooks.ts`'s `auditOverLimitCardCharge`). Audit-only; the money has already moved
  - `card.frozen` / `card.unfrozen` — Card status change requested (holder self-freeze, or finance_admin either direction)
  - `card.canceled` — Card permanently canceled (finance_admin only)
  - `expense.card_charge_recorded` — Card-settlement webhook created a `card_charge` expense + ledger debit
- Indexed `by_community`, `by_fund` (both with `createdAt` for timeline queries)

## Idempotency Inventory

Every external write (Stripe, Increase API calls) is idempotency-keyed to safely retry without duplicating effects:

- **`finance:stripe-account:{communityId}`** — Community Stripe connected account creation (used in onboarding.ts createConnectedAccount)
- **`finance:entity:{communityId}`** — Increase Entity creation (communityFinance.increaseEntityId — used in increase.ts createEntity)
- **`finance:general-account:{fundId}` / `finance:group-account:{fundId}`** — A fund's own Increase Account (`fundAccountIdempotencyKey` in onboarding.ts, the only caller of `createAccount` for a fund). Fund-scoped and fingerprint-free on purpose: the fund row is inserted once and never re-created, so all three provisioning paths resolve to the same key — and therefore the same Account — forever. See "The General Account, and the one key that mints it"
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

**Group leader carve-out** — Group leaders can (via `requireFundRoleOrGroupLeader` in lib/helpers.ts) assign other active group members a finance role on their group's fund (ADR-032 §4 exception: leaders gain a narrow role-grant power scoped to their group only). Used in `enableGroupGiving`, which grants current leaders finance_admin on the new fund.

**…but never to themselves.** The carve-out ignores `minRole` by design — a leader with no fund role at all passes a `"finance_admin"` gate — which made it a one-tap privilege ladder: leader → `grantFundRole(self, "finance_admin")` → `createFundCard(self, …)` → spend the fund alone. `requireFundRole` / `requireFundRoleOrGroupLeader` therefore return **which** path allowed the call (`"community_admin" | "fund_role" | "group_leader"`, the `FundAccessVia` type), and `grantFundRole` refuses a self-targeted grant when the answer is `"group_leader"`. The strong paths resolve first, so a community admin who also leads the group is `"community_admin"` and unaffected. Granting to someone else still works — that is the ADR's bootstrap, and it costs a second willing human.

Residual, not closed by code: a leader can still grant `manager` to a second account **they** control, which defeats the two-approver threshold. See the sock-puppet entry in `docs/finance/COMPLIANCE.md`.

**Feature-flag coverage** — every public finance entry point is behind `requireGroupGivingEnabled` / `isGroupGivingEnabled` (lib/finance/flag.ts) with two deliberate classes of exception:
- *Member-facing reads return null instead of throwing* (`getGivingContext`, `getFundOverview`) so the flag hides the UI rather than erroring it. Role-gated management reads throw (`listFundRoles`, `getMyFundRole`, `listExpenses`, `listMyExpenses`, `listFundCards`, `getCardDetail`) — the screens that call them are only reachable once a null-returning read has already said the feature is on.
- *De-escalation / incident response is never gated*: `setCardFrozen`, `cancelCard`, `denyExpense`, `revokeFundRole`. The kill switch is most likely flipped DURING an incident, which is exactly when someone needs to freeze a card, strip a compromised finance_admin, or clear a pending expense. Each only ever removes power or stops money moving, and every path that ADDS power or moves money is still gated, so none of them can be a step toward anything.

**Receipt provenance** — an `r2:<key>` string is not self-authenticating, and receipt URLs are shown to every manager+ viewer (`listExpenses`) and card viewer (`getCardDetail`). An `uploadGrants` row (storagePath → userId) records who each key was minted for, and `submitExpense` refuses a receipt whose grant is missing or belongs to someone else.

*Both* producers of `r2:` keys write the row:
- `functions/uploads.ts` — `getR2UploadUrl` / `getR2FileUploadUrl`, at presign time.
- `lib/r2.ts` — `putR2Object`, when the caller passes `grantTo`. This is the server-side PUT used for bytes we already hold (PCO song files, dev-assistant config). Those are system uploads and pass nothing, deliberately: no row means no user can claim the key. A server-side upload made *on behalf of a member* must pass `grantTo`, or that member's own file would be refused as not theirs.

**The grant write is non-fatal, on both paths.** It hangs off actions that serve every upload in the product — chat images, profile photos, group covers, event posters — so awaiting it bare let one write conflict on `uploadGrants` stop the whole app from uploading anything, for the sake of a finance-only check. It is wrapped and logged instead (`recordUploadGrantBestEffort`). Safe because the security property is enforced at the **read**: a lost row costs one member one re-attach, never a false accept.

**Two rejection messages, on purpose.** A grant owned by *someone else* is the attack the check exists for and says so. *No grant at all* has an innocent cause the member can act on — a photo picked before this shipped, or a grant write that failed — so it asks them to re-attach the photo rather than accusing them. Still a refusal either way. **Deploy note:** an upload in flight across the deploy that introduced `uploadGrants` has no row; those members see the re-attach message once and re-attaching fixes it. Expenses already stored are unaffected — the check runs only at submit.

## Testing

Finance test files in `apps/convex/__tests__/`:

- **finance-ledger.test.ts** — Tests `postLedgerEntry`, `deriveBalance`, `checkInvariant`, paired-transfer semantics; validates dedup by idempotencyKey and the append-only invariant
- **finance-onboarding.test.ts** — Tests `startOnboarding` (form validation — EIN format, address shape), status machine transitions, idempotency of external provisioning calls
- **finance-expenses.test.ts** — Tests `submitExpense`, `approveExpense`, `denyExpense`, two-approver $200 threshold, policy violations (non-members can't submit, expired roles can't approve)
- **finance-giving.test.ts** — Tests the donation lifecycle (`recordDonationSucceeded`/`Refund`/`Disputed`, transparency reads), plus `recordAllocation` semantics, `computePendingAllocationCents`, and reconcile drift detection; exercises them directly without the Increase provider (lazy-imported in actions so these tests never load it)
- **finance-allocation.test.ts** — Tests the payout seam end to end: NET matching (including the exact stall — a lone donation whose gross exceeds its payout's net), skip-don't-stall selection, per-donation replay protection, the concurrency lease (a second pass over a live-leased item gets nothing; an expired lease is reclaimable), partial-failure isolation and resume (transfer 2 of 3 fails → 1 and 3 land, a redelivery finishes 2 and re-transfers nothing), transfer-landed-record-failed as a distinct audited outcome, no-op replay of a completed payout, the full refund sequences (before payout → nothing transfers and no negative balance; partial before payout; full after allocation → fee reversed; refunded while bound → retry cron drops it), unmatched/empty payouts alarming, `payout.failed` unbinding, `retryStaleAllocations` recovery vs. alert-only, and drift on a stranded allocation. Unlike the other suites this one drives the `runAllocation` **action**, with `getPayoutComposition` and `createAccountTransfer` mocked at the module boundary — the Increase mock models idempotency-key dedupe, so the "same key returns the same transfer" lock is genuinely exercised — and deliberately no suite-wide fake timers, so an awaited action can't silently no-op
- **finance-payout-nets.test.ts** — Tests `getPayoutComposition` against a mocked `stripe` SDK: NET extraction, PaymentIntent mapping via the expanded `source`, paging (including a charge and its refund landing on different pages), netting refunds/chargebacks/failed-refunds against their charge, reporting reversals that can't be attributed, refusing a truncated view, refusing a fractional net, refusing a composition whose nets don't sum to the payout, excluding the payout's own leg, and netting types the code has never heard of (`payment_reversal`, and a made-up future type) purely off `payment_intent`
- **finance-roles.test.ts** — Tests the group-leader carve-out end to end: no self-grant at any rank, the escalation chain (self-grant → self-issued card) stays closed, the ADR's grant-to-someone-else bootstrap still works, admin-who-is-also-a-leader precedence, and a finance_admin changing their own role
- **finance-general-account.test.ts** — Tests the General Account (ADR-032 §1): that `provisionProviders` mints it alongside the receiving Account, that all three provisioning paths ask Increase for the **same idempotency key** (asserted on the key, not just the account name), that the backfill heals older communities with per-fund error isolation and truthful counts, that a community with historically no-transfer `"allocated"` general donations **reconciles to zero drift** after the backfill (and that its ledger entries are untouched), that replaying the recorded payout actually moves the cash, and that a general-fund donation makes a real receiving → General transfer at its NET (staying `"pending"` when the fund has no Account yet). Unlike the other suites it MOCKS lib/finance/increase + lib/finance/stripeConnect and genuinely RUNS the actions (`provisionProviders`, `provisionFundAccount`, `runAllocation`, `runNightlyReconcile`, the migration) rather than freezing timers so they never fire — the assertions are about what was asked of the bank
- **finance-receipt-provenance.test.ts** — Tests both producers of `r2:` keys against the receipt check: a `putR2Object` upload with `grantTo` is accepted by `submitExpense`, one without stays unclaimable, and a failing grant write never propagates out of either the presign path or `putR2Object` (mocks `@aws-sdk/client-s3`)
- **finance-cards.test.ts** — Tests `createFundCard` (pending row + audit, holder-role gate, caller gate, fund-readiness gates), spend-limit validation on both `createFundCard` and `setCardLimit`, `listFundCards`/`getCardDetail` viewer gating, `setCardFrozen` permissions (self-freeze vs. finance_admin-only unfreeze), `cancelCard` (finance_admin-only), that freeze/unfreeze/cancel still work with the `group-giving` flag OFF while every other entry point refuses, and `recordCardSettlement` (idempotency, account-mismatch rejection, missing-card log-not-throw, over-limit drift audit). The internalActions — `provisionCard`, `applyCardStatus`, `applyCardLimit` — are invoked directly against a mocked `lib/finance/increase`, so the payload sent to the provider (in particular the spend limit and its interval mapping) is asserted rather than assumed; the suite's `vi.useFakeTimers()` only stops SCHEDULED runs, it must not be allowed to skip the action logic itself
- **finance-increase-cards.test.ts** — The card request bodies actually put on the wire. `finance-cards.test.ts` mocks the whole `lib/finance/increase` module, so `buildAuthorizationControls` — the function that decides what the bank is told — never runs there. This suite stubs `fetch` instead and asserts the literal JSON: `{"usage":{"category":"multi_use","multi_use":{"spending_limits":[{"interval":"per_week","settlement_amount":25000}]}}}` and the empty-array clear form. Without it, renaming `spending_limits` keeps CI green while shipping an uncapped card under a UI that promises the bank declines overages


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
  `allocation.payout_unmatched` when a pass got nothing *done* (an empty plan
  with nothing already allocated out of this payout), when a material slice
  is unattributed (>$1, or >1% of the payout), when the residual-budget check
  had to strand a gift, or when the pass refused the payout outright. It
  deliberately stays quiet for a payout with nothing left to do: Stripe emits
  `payout.reconciliation_completed` after every healthy payout and webhooks.ts
  routes it to the same handler, so an empty plan on that second pass is the
  success condition — treating it as "matched nothing" fired a full-payout
  alarm on every payout and made the signal useless. `payout.reconciliation_completed` is
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

  **Known gap:** `refundedCents` is computed and typed through to
  `member/types.ts` but rendered nowhere, so the same "given minus spent must
  reconcile" argument that put fees on-screen is not yet satisfied for a fund
  that has taken a refund. Deliberately left for a copy/layout pass rather
  than bolted on here — refunds on group funds are rare, and the wrong words
  for them are worse than none.

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
  below), and the money path is safe **only when the chargeback settles in
  the same payout as the charge**: Stripe posts it as an `adjustment` balance
  transaction, which `getPayoutComposition` nets against the charge exactly
  like a refund, so that gift is not transferred out of the receiving
  Account. Disputes typically arrive weeks after the payout, by which point
  the gift is already allocated — and a dispute filed *before* the payout but
  settling in a later one funds the gift in full, because unlike
  `recordDonationRefund` the dispute path sets no `refundedCents` and no
  status. Both cases surface as nightly reconcile drift, not as a blocked
  transfer.

  **The general fund is not a special case — DONE** (ADR-032 §1). Allocation
  used to record general-fund donations as allocated with no transfer at all,
  because `recordProvisioned` never minted the General Increase Account the
  ADR's topology calls for; unearmarked cash therefore sat in the receiving
  Account while the ledger called it settled, and — with no
  `increaseAccountId` — `getFundsWithIncreaseAccount` excluded the fund from
  nightly reconcile, so nothing could ever have alarmed. Provisioning now
  mints the General Account (see "The General Account, and the one key that
  mints it") and binds it to the fund, so the general fund flows through
  exactly the path above with nothing exempted: matched on NET, leased,
  transferred receiving → General, fee realised, reconciled. A fund still
  missing an Account (an older community awaiting
  `migrations/backfillGeneralFundAccounts.ts`) fails its item at the transfer
  stage rather than skipping it, so it is audited as
  `allocation.transfer_failed` and the donation keeps its `pending` status
  and payout stamp — which is exactly what `listResumableAllocations` looks
  for, so the hourly retry finishes it the moment the Account exists.

  **Backfilling a fund that already has history — the reopen.** Minting the
  Account is the easy half; it is also the half that arms the nightly alarm.
  A pre-fix general fund holds donations marked `"allocated"` whose money was
  never moved: ledger holds their gross, the General Account holds nothing,
  and `computePendingAllocationCents` counts only `"pending"` rows, so pending
  is zero too. Bringing that fund into reconcile scope would report
  `drift = the whole historical balance` **every night, forever** — which
  destroys, through alarm fatigue, the one control that would catch real
  theft.

  So `recordFundAccount` reopens them, in the same transaction that binds the
  Account, before the fund can ever be selected by
  `getFundsWithIncreaseAccount`. A donation marked allocated on a fund that
  had no Account cannot have settled — there was nowhere to send it —
  so `"pending"` is simply what it factually is. The invariant then holds on
  the very first night by construction: `ledger == bank 0 + pending`, whether
  the row carries a payout stamp (ledger net / pending net) or not (ledger
  gross / pending gross).

  **The ledger is not touched, and that is the point.** `ledgerEntries` is
  append-only, and nothing needs appending: allocation deliberately posts no
  credit (the gift was credited at donation time), so an allocation that never
  moved money left no entry to reverse. The reopen changes
  `donations.allocationStatus` and writes an `allocation.reopened` audit row.
  Nothing else.

  **Moving the cash: the catch-up sweep.** `backfillGeneralFundAccounts` then
  replays each of the community's recorded `processedStripePayouts` through
  the ordinary `runAllocation` (default `resumeAllocations: true`, capped at
  200 payouts per community). That re-reads the payout's real per-charge NETs
  from Stripe, stamps them, makes the receiving → General AccountTransfer the
  original pass never made, and realises the fee — no bespoke money-moving
  code and no invented amounts. A transfer Increase rejects (e.g. the
  receiving Account is short) fails that item only: the donation stays
  `pending`, so drift stays zero and the hourly retry keeps trying.

  **Running it.** Dry run first — it writes nothing and calls no provider,
  and reports the funds and the donation count/cents it would reopen:

  ```
  npx convex run migrations/backfillGeneralFundAccounts:backfillGeneralFundAccounts '{"dryRun": true}'
  npx convex run migrations/backfillGeneralFundAccounts:backfillGeneralFundAccounts
  ```

  The result is `{ provisioned, skipped, failed, reopened, reopenedCents,
  resumed, stillPending, funds[] }`. `provisioned` counts Accounts actually
  written by `recordFundAccount`, not funds attempted — `provisionFundAccount`
  fails soft on a community with no Entity, so counting intent could report a
  dozen having provisioned none. Each fund is wrapped individually: one
  community whose Increase Entity is rejected is recorded as `failed` with its
  error in `funds[]` and the run continues. Re-running is safe at every layer
  (Account key per fund, `alloc:{donationId}` per transfer, reopen only fires
  on the first bind). `resumeAllocations: false` skips the Stripe replay:
  correct, zero-drift ledger, cash still in receiving, and
  `allocation.stale_pending` will (truthfully) alert after three days.

- **What card controls still DON'T do.** Increase enforces the amount-per-interval
  cap we send it, and nothing else. There is no merchant-category restriction, no
  merchant-country restriction, no per-holder velocity rule, and no receipt
  requirement — a charge with no receipt sits `"pending"` and is visible, but
  nothing chases it and nothing blocks the card. All of those need either
  Increase's other `authorization_controls` fields (`merchant_category_code`,
  `merchant_country`, `merchant_acceptor_identifier` — declarative, cheap to add)
  or its real-time-decision webhook (`real_time_decision`, for anything requiring
  our own logic per swipe). ADR-032 §3 already scopes the latter out ("No custom
  real-time authorization decisioner sits on the critical path (Increase's
  real-time decisions remain available later for merchant-category rules)").
  **And there is no approval step for a card charge.** Nothing in the app
  surfaces a `card_charge` for approval, and `expensePolicy.ts`'s `canPay`
  requires `kind === "reimbursement"`, so the reimbursement flow's two-approver
  threshold is unreachable from a card swipe. A settled charge becomes a
  `"pending"` expense that is *visible*, and that is all.

  **The rule this seam exists to protect:** no card surface may claim a control
  that isn't in this list — the create-card sheet and card detail once advertised
  a "Require receipts — On" toggle backed by nothing at all, and later a
  "needs a second approver" line backed by nothing either. The mobile constant is
  `CARD_CHARGE_SETTLEMENT_NOTE` (`features/finance/leader/types.ts`), and the
  view tests assert the *claim* is absent (`/second approver/i`, `/sign-off/i`),
  not one historical sentence — the earlier string-literal assertion is exactly
  how the reworded version shipped past CI.

- **Legacy cards may be uncapped at the bank.** Cards provisioned before spend
  limits were wired through carry a `spendLimitCents` we never sent to Increase,
  so the bank is enforcing nothing on them. There is no backfill: a finance_admin
  re-saving the limit via `setCardLimit` pushes it, and until then
  `card.limit_exceeded` is the only signal. If group giving reaches more than the
  pilot community, this wants a one-off migration that replays every card's
  stored limit through `applyCardLimit`.

**Member payout destination stub** (expenses.ts `getPayoutDestination`) — Phase 2 follow-up. Currently returns `null` (every expense blocks at "no destination found"). Awaiting linking flow to ship; structure is in place (`payReimbursement` action + `recordReimbursementPaid` mutation + Increase ACH client calls). Replace the stub with a real lookup once the UI for members to link their bank account lands.

**Card-charge expenses** — Phase 3, now implemented (cards.ts + webhooks.ts's `recordCardSettlement`). A card swipe becomes a `"pending"` `card_charge` expense via the `transaction.created` webhook. Approval/payout for `card_charge` kind still isn't wired: `expenses.ts`'s `approveExpense`/`denyExpense`/`payReimbursement` are written for the reimbursement flow only — a `card_charge` expense today just sits `"pending"` for the transparency screen and manual bookkeeping until an approval flow is designed for it (real money already moved at swipe time, so "approval" here would be after-the-fact acknowledgment, not authorization — a different shape than reimbursement approval).

**Statement descriptor source** (expenses.ts `payReimbursement` comment) — Phase 2. Currently hardcoded in Stripe requests; should source from `communityFinance.statementDescriptor` once collected in onboarding (the form already captures it).

**Payment confirmation UI** — Phase 3 mobile wave. Payout flows exist (allocation/reconcile/pay), but the mobile app's payment confirmation / receipt display is not yet implemented.

**Group archive freeze without the bank-side sweep** (onboarding.ts `freezeFundForArchivedGroup`, scheduled from `functions/groups/mutations.ts`'s `isArchived: true` cascade) — ADR-032 §3 "Group archive" describes freeze cards + AccountTransfer the remainder to the General Account (or a successor group) + close the Account + paired sweep ledger entries. Only the freeze half is wired today: archiving a group flips its fund's `status` to `"frozen"`, which blocks new donations (`createDonationIntent`'s `prepareDonationIntent`), new expense submissions/approvals (`expenses.ts`), and new reimbursement payouts (`payReimbursement`'s fund-status gate) — `postLedgerEntry`'s `FROZEN_ALLOWED_KINDS` still lets `refund`/`transfer`/`sweep` entries land so anything already in flight can settle. The actual bank-side sweep (moving the frozen fund's remaining balance out and closing its Increase Account) is **not implemented** — it's a Phase-2 admin-triggered mutation, not yet built. Until it ships, an archived group's fund balance sits frozen but un-swept in its Increase Account.

**Dispute lifecycle** (giving.ts `recordDonationDisputed`, webhooks.ts's `charge.dispute.created` case) — audit-only. No provisional debit on dispute creation, no reversal-on-win/debit-on-loss ledger entries, no fund-status interaction. Any actual bank-side withdrawal Stripe/Increase performs on a dispute will show up as ledger/bank drift and get flagged by the existing nightly reconcile job (`jobs.ts` `runNightlyReconcile`) until a real dispute state machine is designed and built.
