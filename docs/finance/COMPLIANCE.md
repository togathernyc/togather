# Group Giving: Compliance & Audit Reference

This document outlines the compliance posture, data handling, and audit mechanisms for Togather's group giving feature (ADR-032). It is intended for internal counsel review, regulatory inquiries, and underwriting assessments.

## Regulatory Posture

**Stripe Connect Framework** — Churches operate as Stripe "connected accounts." Togather remains out of the funds flow: donations flow directly from donors → Stripe → church's connected account. Togather never holds, receives, or intermediates the money; Togather is the platform/payment facilitator, not a Money Services Business (MSB) or a fund custodian.

**Increase Banking** — Each church is a distinct KYB'd Entity on Increase. The Entity holds the bank accounts (receiving account for Stripe payouts, general account for operational funds, one account per fund/group). The church is the legal owner of funds; Togather provides operational tooling (ledger, allocation, cards, expense approvals) but does not hold accounts in trust.

**Charitable Solicitation & Regulatory Compliance** — OPEN ITEM for counsel sign-off:
- State-level charitable solicitation registration requirements (varies by state)
- Donor notification / consent for fee-cover add-ons (currently voluntary opt-in)
- EIN validation (we validate format; EIN legitimacy is sourced from church during onboarding)
- Receipting with legalName/EIN (implemented; see Receipting section below)

**Fund-for-Benefit (FBO) Framing** — OPEN ITEM for counsel + Increase underwriting:
- Are group funds within a community best characterized as sub-accounts of a "general" fund, or distinct FBO entities?
- What does "beneficial_ownership_exemption_reason: other" on Increase entities mean for the church's compliance posture?
- Increase program structure: does the church's Entity need additional beneficial-owner disclosures if funds are redistributed as grants/assistance to individuals?

## KYB/KYC Inventory

**What we collect at onboarding** (stored in `communityFinance` row):
- `legalName` — Legal entity name (e.g., "First Church of Example")
- `ein` — Employer Identification Number (format validated: `\d{2}-\d{7}`)
- `address` — Mailing address (addressLine1, addressLine2 optional, city, state, zipCode)
- `website` — Public website (optional)
- `statementDescriptor` — Custom bank statement text (optional; sourced from form or Stripe default)

**Collection of representative identity** — Sent directly to Stripe Hosted Onboarding (we never store it):
- Name, email, phone, date of birth, personal address
- Stripe retains; Togather never sees it once transmitted

**Increase KYB** — The Entity created in Increase inherits the community's `legalName` and `ein`. Beneficial owner disclosures on the Entity are incomplete: `beneficial_ownership_exemption_reason: "other"` is set, but full beneficial-owner vetting has not been implemented. OPEN ITEM for Increase underwriting partnership: confirm whether this exemption is valid for the program structure (churches with multiple member-managed funds).

## PII Handling

**EIN Storage** — Stored in Convex (persistent, unencrypted at rest in the application layer). EINs are quasi-public (charities file Form 990-N with the IRS; EIN is public data). Access controlled via community-admin permission.

**No SSNs** — Togather **never collects, stores, or processes Social Security Numbers**. Stripe Hosted Onboarding may request personal identity (including SSN for beneficial owners) from the church representative; we do not retrieve, store, or transmit those values.

**Receipt Images** — Submitted by users during expense reimbursement. Stored in Cloudflare R2 (encrypted in transit via HTTPS). Accessed via presigned URLs. No retention policy yet (OPEN ITEM: determine retention schedule per Increase/Stripe documentation and relevant tax law — likely 7 years for charitable organizations).

**Donor Data** — Donations recorded with optional `donorUserId` (community member) or anonymous (no user). No additional PII collected beyond what the user has already shared in their Togather profile. Receipts sent to donor's email (via Resend); see Receipting section.

## Receipting

**Donation receipts** are generated and sent via Resend (transactional email) immediately after a donation succeeds. Built by `buildDonationReceiptEmail()` in `lib/finance/receipts.ts`.

Receipt includes:
- **Donor acknowledgment**: "Thank you for your generous gift to [fund.name]"
- **Amount**: amountCents + feeCoverCents (displayed as dollars)
- **Community legal name & EIN**: `communityFinance.legalName`, `communityFinance.ein`
- **Fund name**: `fund.name`
- **Date**: donation createdAt (ISO date)
- **No-goods-or-services statement**: "You received no goods or services in return for this contribution" (actual text: from receipts.ts line matching IRS Section 170(f)(8) and Prop 65 requirements)
- **Charity identification**: Community website (if set) and state of incorporation (OPEN ITEM: state not stored; should be sourced from EIN lookup or added to communityFinance)

## Audit Trail: Two Surfaces

**`ledgerEntries`** (append-only, never deleted) — Money movement
- Every debit/credit (donation.recorded, allocation, card_capture, refund, reimbursement, transfer, sweep, fee)
- Indexed by `fundId`, `idempotencyKey` (external dedup), `communityId`
- Denormalized `actorUserId` (absent for webhooks/crons) and `createdAt`
- Rows tied to external systems via `stripeObjectId` or `increaseObjectId` for audit trail continuity

**`financeAuditEvents`** (append-only, never deleted) — Control-plane actions
- Role grants/revocations, status machine transitions, approvals, denials, expense submissions
- Indexed by `communityId`, `fundId`, with `createdAt` for timeline
- `action` field uses dot-namespaced strings: `role.granted`, `expense.approved`, `onboarding.status_changed`, etc.
- `detailsJson` captures structured context (user ids, amounts, previous status, reason for denial)
- `actorUserId` identifies the person who took the action (absent for system actions like webhooks)

**Retention** — No automated deletion. Rows accumulate indefinitely (OPEN ITEM: determine audit-log retention requirements based on charitable organization rules — likely 7 years minimum).

## Financial Controls

**No Self-Approval** — An expense's submitter can never approve it, regardless of role (including finance_admin and community admin). Enforced unconditionally in `canApprove()` (`lib/finance/expensePolicy.ts`), called from `approveExpense` (`functions/finance/expenses.ts`).

**Two-Approver Threshold** — Expenses ≥ $200 (`SECOND_APPROVAL_THRESHOLD_CENTS = 20000` in `lib/finance/expensePolicy.ts`) require two *distinct* approvers, neither of whom is the submitter. Under the threshold one approval moves the expense `pending → approved`; at/above it, the first approval records `approverId` while status stays `pending`, and only a second, different approver (`secondApproverId`) moves it to `approved` and triggers payout scheduling. Implemented in `nextStatusOnApproval()`.

**Last Finance Admin Guard** — `revokeFundRole` refuses to revoke the last active finance_admin on an active fund (`functions/finance/roles.ts`); community admins may override to hand a fund off during an offboard. Covered by `finance-expenses.test.ts`.

**Monotonic Onboarding Status Machine** — Community finance status transitions are one-way (collecting → verifying → live; or → stripe_blocked / increase_blocked on failure). No going backward. Implemented in `applyStripeAccountStatus` + `applyIncreaseEntityStatus` (onboarding.ts, webhooks.ts) — status only advances on webhook updates or explicit admin resubmission of the form.

**Nightly Reconcile + Drift Audit** — `runNightlyReconcileAllCommunities` compares ledger balance against bank balance (adjusted for donations in allocation pipeline). Drift logged as `financeAuditEvents` with `action: "reconcile.drift"` and details including ledger, bank, and pending amounts. Alerts are in `detailsJson` (OPEN ITEM: add monitoring/notification to alert ops team on drift).

**Collusion / Sock-Puppet Residual Risk** — The two-approver threshold is a control on *distinct approvals*, not on *distinct trust*. It assumes the two approvers are independent humans acting in good faith. That assumption isn't structurally enforced: any active group leader can grant fund roles on their group's fund — including `manager` to a second account they also control — via `requireFundRoleOrGroupLeader`'s leader carve-out (ADR-032 §4), and community admins bypass fund-role checks entirely (`requireFundRole`'s admin override), so an admin can both submit and effectively steer approval on any fund. In other words, the threshold is trust-scoped to leader/admin integrity, not a cryptographic or organizational guarantee against a single bad actor operating two accounts. This is an accepted residual risk, not a bug to fix in this change — flagged here for the fraud/ops runbook (OPEN ITEM: define detection heuristics, e.g. approver pairs sharing a device/IP/payout destination, for ops to monitor).

## Open Items for Counsel & Underwriting

1. **Charitable Solicitation Registration** — Which states require registration? Who is liable: the church (as Stripe-connected entity) or Togather (as platform)? Should we display state-specific disclosures on the give sheet?

2. **FBO (Fund-for-Benefit) Framing** — Are group funds best characterized as restricted gifts/sub-allocations of a general community fund, or as separate beneficial-interest entities? Impact on IRS Form 990 reporting and state solicitation compliance.

3. **Increase Program Structure** — Can `beneficial_ownership_exemption_reason: "other"` be used for churches with multiple member-managed funds? Does Increase require additional beneficial-owner identification for each fund? Partner with Increase on final Entity KYB protocol.

4. **Statement Descriptor Rules** — Stripe connected accounts have rules on what text appears on donor cards (no special chars, length limits, no misleading claims). Validate statementDescriptor against Stripe's rules before storing.

5. **Receipt Timing & Proof** — When is a receipt issued relative to the donation clearing through the bank? (Current: issued immediately on Stripe payment_intent.succeeded, before Stripe payout; OPEN: clarify if this is acceptable per IRS/state law — some jurisdictions may require bank-level evidence of receipt).

6. **Retention & Destruction** — Establish data retention schedules:
   - Ledger entries: 7 years minimum (charitable organization standard)
   - Receipt images: same as ledger
   - PII in receipts (donor names/emails): same, or separate policy?
   - Failed/denied expenses: same

7. **Donor Consent** — Fee-cover add-ons are currently voluntary opt-in. Confirm compliance with state charitable solicitation rules (some states may require explicit consent language).

8. **Tax Reporting** — Who files Form 990-N (e-postcard) or 990? (Answer: the church/community, not Togather.) Do we need to provide 1099-equivalent reporting to Togather for platform fees? (Answer: OPEN — check with Stripe/Increase on whether platform fees appear on church's 1099-K.)

---

**Last Updated**: 2026-07-29 | **Status**: Ready for counsel & underwriting review | **Next Steps**: Resolve open items in consultation with legal counsel and Increase partner
