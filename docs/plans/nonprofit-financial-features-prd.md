# PRD: Nonprofit Financial Features (Giving, Funds, Budgets & Cards)

- **Status:** Draft / for discussion
- **Author:** (you)
- **Last updated:** 2026-06-21
- **Branch:** `claude/nonprofit-financial-features-30zw04`
- **Scope of this doc:** A single combined PRD covering four interdependent feature areas:
  1. Community giving + auto-issued giving statements
  2. Group funds & budgets (restricted/designated giving)
  3. Budget spending cards (Stripe Issuing)
  4. Financial reporting & dashboards

> This is a design/PRD document, not an implementation plan. It documents goals,
> constraints, the money-movement architecture, the data model, per-feature
> requirements, open questions, and a phased rollout. Engineering plans/ADRs are
> spun out per phase once we align on direction.

---

## 1. Summary & Vision

Togather is a community management platform (Communities → Group Types → Groups →
Members). Today the only money flow is **platform billing** — communities pay
Togather a monthly subscription via Stripe (`apps/convex/functions/ee/billing.ts`).

This initiative adds the **other direction of money**: members give *to* their
community, communities track that giving for financial records and auto-issue
tax-compliant **giving statements**, communities allocate **budgets to groups**
and let members **designate gifts to specific group funds**, and authorized
people **spend** group budgets via issued **cards** — all inside the app.

The north star: a nonprofit community can run its entire donation + fund-
accounting + expense lifecycle in Togather without bolting on a separate giving
platform (Tithe.ly, Pushpay) and a separate expense tool (Ramp, Brex).

### Why this is viable inside the app (the Apple question)

Your instinct is correct, with one important condition. Apple **App Review
Guideline 3.2.1(vi)** allows *approved nonprofits* to collect donations **inside
the app without using In-App Purchase** (so **no 30% Apple cut**) — provided they
use **Apple Pay**, disclose how funds are used, and make tax receipts available.

The catch for us: Togather is a **platform that connects donors to many
nonprofits**, and Apple requires that **every nonprofit listed in the app has
gone through Apple's nonprofit approval process**. So "no Apple tax on donations"
is real, but it is **gated on a per-community nonprofit-verification step** that
we must build into onboarding.

Card spending and budget management are **not donation flows and not digital
goods** — they are real-world money movement and are entirely outside IAP.

---

## 2. Goals & Non-Goals

### Goals

- Let a member give to their community in a few taps (one-time + recurring).
- Give communities a clean ledger of all giving for financial records & audits.
- **Auto-issue IRS-compliant giving statements** (annual + on-demand).
- Let admins create **funds** (general + per-group) and **set budgets** per group.
- Let members **designate** a gift to a specific fund/group.
- Let communities issue **cards** so groups/people can spend their budgets, with
  per-card limits and full attribution of who spent what on which fund.
- Give admins **dashboards**: giving over time, fund balances, budget vs. actual.
- Keep each community as its **own 501c3 of record** — money flows to them, they
  issue statements under their own EIN, Togather is the software platform.

### Non-Goals (for this initiative)

- Togather acting as fiscal sponsor / merchant-of-record / holder of donor funds.
  (Explicitly rejected — see §4.1. Each community is its own 501c3.)
- Full double-entry fund accounting / GAAP general ledger replacement. We track
  giving and fund balances; we are not QuickBooks.
- Grant management, pledge campaigns, payroll, or 1099/vendor tax filing (future).
- Non-US tax regimes (US 501c3 / IRS first; internationalization is later).
- Crypto / stablecoin giving.

---

## 3. Personas & Top User Stories

| Persona | Needs |
| --- | --- |
| **Donor / member** | Give quickly, designate to a group, set up recurring giving, see my giving history, download my year-end statement. |
| **Community admin / treasurer** | See all giving, reconcile, configure funds, set group budgets, issue/freeze cards, run reports, ensure statements go out. |
| **Group leader** | See my group's budget vs. spend, request/hold a card, submit receipts, see who gave to my group's fund. |
| **Card spender** | Get a (virtual) card instantly, know my limit, tap to pay, attach a receipt. |
| **Togather (platform)** | Verify each community's nonprofit status, route money via Connect, take a platform/processing margin, stay off the hook as merchant-of-record. |

Representative stories:

- *As a donor*, I tap "Give", choose **$50 → "Youth Group fund"**, pay with Apple
  Pay, and immediately see it in my giving history.
- *As a donor*, in January I get a push + email: "Your 2025 giving statement from
  Grace Community is ready" and download a PDF that satisfies IRS substantiation.
- *As a treasurer*, I set the **Youth Group budget to $2,000/yr**, issue the youth
  leader a virtual card capped at **$500/mo**, and watch budget-vs-actual live.
- *As a group leader*, I tap my card into Apple Wallet, buy pizza for $40, snap the
  receipt, and it's auto-categorized against my group's fund.

---

## 4. Foundational Architecture & Constraints

This section is the backbone the four features sit on. Decisions here are the
ones that are expensive to change later.

### 4.1 Legal / money-movement model — **each community is its own 501c3**

**Decision (confirmed):** Togather is the **software platform**. Each community is
its **own legal nonprofit (501c3) with its own EIN and bank account**. Donations
flow **directly to the community**, and the community is the **donee of record**
that issues giving statements under its own name/EIN.

**Implementation: Stripe Connect.** Each community gets a **Stripe connected
account**. Togather is the Connect **platform**. Modern Connect uses
**controller properties** rather than the legacy Standard/Express/Custom labels;
we configure each connected account so:

- The **community is liable** for its charges/refunds and is the merchant of
  record (keeps Togather out of the fund-holding/MOR role — directly supports our
  non-goal in §2).
- **Togather controls onboarding UX** (embedded/hosted onboarding) and dashboard
  surface so the experience stays in-app/in-brand.
- Funds settle to the **community's own bank account** on a payout schedule.
- Togather can take a **platform fee / application fee** per donation if/when we
  monetize giving (separate from the existing subscription).

**Why this model:**
- Cleanest legally — Togather never holds or owns donor money, dramatically
  lowering our compliance + liability surface.
- Maps exactly to Apple's "platform connecting donors to *approved* nonprofits"
  framing (§4.2).
- Each community's statements are correct by construction (their EIN, their name).

**Cost:** Each community must complete **nonprofit onboarding/KYC** with Stripe
(and our Apple verification) before it can accept giving. This is the main new
onboarding burden — see §4.4.

### 4.2 Apple App Store compliance (donations)

- Donations use **Apple Pay → Stripe**, **not IAP**. No 30% cut. (Guideline
  3.2.1(vi).)
- **Per-community nonprofit verification is mandatory.** A community cannot
  enable giving until it's verified as an approved nonprofit. We must:
  - Collect/verify EIN + 501c3 determination (and run Apple's nonprofit approval
    process for platform-listed nonprofits).
  - Gate the "Give" UI behind a `givingStatus = active` flag that only flips on
    after both Stripe Connect KYC **and** nonprofit verification pass.
- **Disclosure**: each community's give screen must disclose how funds are used
  and surface tax-receipt availability (we generate the receipts — §5.4).
- **Card spending is outside IAP entirely** (real-world goods/services / money
  movement), so it doesn't implicate IAP rules. Standard financial-app review
  considerations apply.

> ⚠️ Open compliance question (§11): exact mechanics + lead time of Apple's
> nonprofit approval program for a multi-tenant platform like ours, and whether
> Android/Play has an analogous gate. Needs a legal/AppStore review before build.

### 4.3 Card issuing & budgets — Stripe Issuing (+ Treasury/Financial Accounts)

Budget **spending** is **Stripe Issuing**. To fund and run cards on behalf of each
community's connected account, the connected account needs the **`card_issuing`**
capability (and **`treasury`** capability if we attach cards to a Stripe
**financial account** balance). An **Issuing balance** must be funded before a
card can transact (US default = **pull funding** from a verified bank account,
~up to 5 business days; **push funding** in beta).

This means a group "budget" has two layers we must keep distinct:

- **Accounting budget** (an app-level number/cap an admin assigns to a group — the
  "you may spend $2,000 this year" figure). Always available.
- **Funded card balance** (actual money loaded to an Issuing balance that cards
  draw from). Requires funding + KYC capabilities.

A community can use the accounting budget layer immediately; cards require the
extra capability/funding steps. We design budgets so cards are an **opt-in
overlay** on top of fund balances, not a prerequisite.

### 4.4 Onboarding & enablement flow (new)

```
Community decides to enable giving
        │
        ▼
1. Nonprofit verification (EIN, 501c3 determination) ──┐
2. Stripe Connect onboarding/KYC (controller acct)     ├─ both must pass
3. Apple nonprofit approval (platform-listed)          ┘
        ▼
givingStatus = active  →  "Give" UI unlocked
        ▼
(optional) Enable funds & budgets  →  designate giving on
        ▼
(optional) Enable Issuing: card_issuing capability + fund Issuing balance
        ▼
Issue cards
```

### 4.5 Reuse of existing infrastructure

- **Stripe SDK already installed** (`stripe@^20.4.1`, root + `apps/convex`).
- **Existing webhook + billing patterns** in `apps/convex/functions/ee/billing.ts`
  and `apps/convex/http.ts` are the template for the new Connect/Issuing webhooks.
- **EE vs OSS split**: giving/funds/cards are commercial, nonprofit-grade features
  and should live under the **ELv2 `ee/`** tree alongside existing billing, **not**
  the AGPL core. (Confirm in §11.)
- **Permissions**: extend the `userCommunities` role bitmask
  (`apps/convex/lib/permissions.ts`) with a **treasurer/finance** role rather than
  overloading primary-admin.

---

## 5. Feature 1 — Community Giving + Statements

### 5.1 Overview

A member gives money to their community: one-time or recurring, optionally
designated to a fund (§6). Every gift is recorded in an immutable ledger that
powers statements (§5.4) and reports (§8).

### 5.2 Donor flow

1. Member opens **Give** (gated on `givingStatus = active`).
2. Choose **amount** (presets + custom), **frequency** (one-time / weekly /
   monthly), and **fund** (defaults to "General"; group funds listed if enabled).
3. Pay via **Apple Pay** (primary), card, or bank/ACH (lower fees for recurring).
4. Confirmation + instant entry in **My Giving** history.
5. Optional **cover-the-fees** toggle (donor pays processing so the community nets
   100%).

### 5.3 Data captured per gift (donation ledger)

Each gift records: donor (member) identity, community, fund/group designation,
gross amount, fees, net amount, payment method, Stripe payment intent/charge id,
recurring-plan id (if any), status (succeeded/refunded/failed), timestamp, and
**tax-deductibility metadata** (was anything of value given in return — see §5.4).

### 5.4 Giving statements (IRS-compliant) — the differentiator

Statements must satisfy **IRS substantiation rules** (Pub. 1771). Requirements we
must bake in:

- For any single gift **≥ $250**, the donor needs a **contemporaneous written
  acknowledgment**. Year-end **computer-generated statements are acceptable**.
- The statement **must state whether the org provided goods or services** in
  exchange, and if so a **good-faith estimate of their value** (quid pro quo).
- **Quid pro quo > $75** requires a written disclosure of the deductible portion.
- Religious orgs: if only **intangible religious benefits** were provided, the
  statement must say so explicitly.
- Must include: org legal name + EIN, donor name, date(s), amount(s), and the
  goods/services statement.

**Design:**
- Each gift carries a `goodsOrServicesProvided` flag + optional value (default:
  none → fully deductible). Most gifts are pure donations; quid-pro-quo (e.g.
  fundraising dinner) is the exception we must support.
- **Auto-issue annual statements** in January for the prior tax year: generate a
  branded **PDF per donor per community**, store in **Cloudflare R2**, notify via
  **push + Resend email**, and expose **on-demand download** in My Giving any time.
- Statements are generated from the **community's own EIN/legal name** (§4.1), so
  they're valid receipts with no Togather-as-donee ambiguity.
- Re-generation/versioning when refunds or corrections occur after issuance.

### 5.5 Recurring giving

- Stripe subscriptions/recurring on the connected account.
- Donor self-service: pause, edit amount, change fund, change method, cancel.
- Dunning/retry on failed charges; notify donor; reflect in ledger as failed.

### 5.6 Edge cases

- **Refunds / chargebacks** → ledger reversal + statement recompute.
- **Anonymous-to-community giving** vs. statement need (donor still needs a
  receipt → we always know donor identity; "anonymous" only hides from leaders).
- **Gift before nonprofit verified** → blocked by `givingStatus` gate.
- **Member leaves community** → retains access to historical statements.

---

## 6. Feature 2 — Group Funds & Budgets

### 6.1 Concepts

- **Fund**: a designation bucket money can be given to. Every community has a
  **General fund**; communities can create additional funds, including
  **per-group funds** ("Youth Group", "Missions Trip").
- **Restricted vs. unrestricted**: funds can be marked **restricted** (must be
  spent on that purpose) — important for nonprofit accounting integrity. Designated
  gifts to a restricted fund increase that fund's balance only.
- **Budget**: an admin-set **spending allowance** for a group over a period
  (annual/monthly). Distinct from fund balance (§4.3): budget is the *plan/cap*;
  fund balance is *money actually available*.

### 6.2 Admin flows

- Create/edit/archive funds; mark restricted; attach a fund to a group.
- Set a group's **budget** (amount + period + rollover policy).
- View **fund balance** (gifts in − spend out) and **budget vs. actual**.
- Configure whether a group's fund is **donor-visible** in the Give screen.

### 6.3 Donor-designated giving

- In the Give screen, donor picks a fund/group; the gift is tagged to that fund.
- Restricted-fund gifts are tracked separately and reported distinctly (§8).

### 6.4 Relationship to existing schema

Funds attach to `communities` and optionally to `groups`
(`apps/convex/schema.ts`). Budgets are a per-group, per-period record. Designation
on a gift references the fund. Reuse existing group leadership
(`groupMembers.role`) to decide who can see/manage a group's fund & budget.

### 6.5 Guardrails

- Spending against a **restricted** fund can't exceed that fund's balance.
- Budget overruns: warn/alert (and optionally block at the card-authorization
  layer — §7) when a group's spend approaches/exceeds budget.
- Moving money between funds (reallocation) is an **explicit, logged admin action**
  (preserves restricted-fund integrity / audit trail).

---

## 7. Feature 3 — Budget Spending Cards (Stripe Issuing)

Goal: authorized people spend a group's budget with a card, with limits and
full attribution. We were asked to **spec both models and recommend one**.

### 7.1 Model A — **Per-person cards** (one card per authorized spender)

- Each authorized spender gets their **own** card (virtual instantly via Apple
  Wallet; physical optional) tied to a group's fund/budget.
- Per-card **spending controls**: monthly/transaction limits, allowed merchant
  categories, freeze/cancel.
- **Attribution is automatic** — every transaction maps to a person.

**Pros:** clean accountability (who spent what), individual limits, instant
freeze of one person without disrupting others, scales to many leaders.
**Cons:** more cards to manage; each cardholder may need identity info for KYC.

### 7.2 Model B — **One shared card per group**

- A single group card the leader manages; multiple people may use the number.
- **Attribution is weak** — transactions land on the group, not a person; you rely
  on receipt capture + manual notes to know who spent.
- **Pros:** simplest to set up; fewest cards.
- **Cons:** poor accountability, harder reconciliation, one compromised number
  affects the whole group, awkward for shared physical cards.

### 7.3 **Recommendation: Per-person (Model A) as the default**, shared as a niche option

- Nonprofits live or die on **accountability and audit trails**; per-person
  attribution is the whole point of issuing cards vs. reimbursements.
- Virtual cards are free/instant to issue, so "one per person" isn't costly.
- Offer **shared cards as an explicit, discouraged option** for small groups that
  insist (e.g. a single physical card kept in a shared space).
- **Default v1: per-person virtual cards**, with **physical cards** and **shared
  cards** as fast-follows.

### 7.4 Mechanics (both models)

- Built on **Stripe Issuing**; connected account needs **`card_issuing`** (and
  **`treasury`** if cards draw on a financial-account balance) — §4.3.
- **Funding**: the group's **Issuing balance** must be funded from the community's
  bank (US pull funding, ~≤5 business days; push funding beta). Until funded, a
  card can't transact even if the *accounting budget* exists.
- **Real-time authorization controls**: spending limits, merchant-category
  restrictions, and optional **budget-aware decline** (decline if it would blow the
  group's remaining budget). Implemented via Issuing authorization webhooks.
- **Receipt capture**: prompt the spender to attach a receipt (photo → R2) right
  after a transaction; required above a threshold (IRS-friendly).
- **Reconciliation**: every authorization/transaction posts to the ledger against
  the group's fund, reducing fund balance and budget-remaining.
- **Lifecycle**: issue, add to Apple Wallet, freeze, set/adjust limits, cancel,
  replace lost/stolen.

### 7.5 Compliance / risk notes

- Issuing requires **cardholder + business KYC**; per-person model means collecting
  some cardholder info.
- Card programs add fraud/dispute surface — needs alerting + freeze tooling for
  treasurers.
- Confirm Issuing card terms allow our nonprofit-community use case during the
  Stripe enablement review.

---

## 8. Feature 4 — Reporting & Dashboards

### 8.1 Admin / treasurer dashboard

- **Giving over time** (day/week/month/year), by fund, by group, by method.
- **Fund balances** (with restricted vs. unrestricted split).
- **Budget vs. actual** per group, with overrun alerts.
- **Top funds / designation breakdown**; recurring vs. one-time mix.
- **Donor roster** with giving totals (respecting anonymity rules) for the
  treasurer; **statement issuance status** (issued / pending / failed) at year-end.
- **Card spend**: by card, by person, by fund; uncategorized / missing-receipt
  queue.
- Export **CSV** for the community's accountant / QuickBooks import.

### 8.2 Group leader view

- My group's **budget remaining**, **fund balance**, recent gifts to our fund,
  recent card spend, missing receipts.

### 8.3 Donor view ("My Giving")

- History across funds, recurring plans management, **download statements** any
  time, year-to-date total.

### 8.4 Implementation notes

- All views are **Convex reactive queries** over the donation + spend ledgers
  (live updates).
- Heavy aggregates may need **pre-computed rollups** (cron-driven, like the
  existing `memberFollowupScores` pattern) rather than per-request scans.

---

## 9. Proposed Data Model (Convex) — sketch

New tables in `apps/convex/schema.ts` (names indicative):

- `communityGiving` — connected-account + giving config per community:
  `communityId`, `stripeConnectedAccountId`, `givingStatus`
  (`pending`/`active`/`suspended`), `nonprofitVerified`, `ein`, `legalName`,
  `payoutBankStatus`, `issuingEnabled`.
- `funds` — `communityId`, `groupId?`, `name`, `isRestricted`, `isGeneral`,
  `donorVisible`, `archivedAt?`.
- `groupBudgets` — `communityId`, `groupId`, `fundId`, `amount`, `period`
  (`annual`/`monthly`), `rolloverPolicy`, `startsAt`/`endsAt`.
- `donations` (ledger; append-only) — `communityId`, `donorUserId`, `fundId`,
  `groupId?`, `grossAmount`, `feeAmount`, `netAmount`, `coveredFees`, `method`,
  `stripePaymentIntentId`, `recurringPlanId?`, `status`, `goodsOrServicesProvided`,
  `goodsValue?`, `createdAt`.
- `recurringGifts` — `donorUserId`, `communityId`, `fundId`, `amount`, `interval`,
  `stripeSubscriptionId`, `status`.
- `givingStatements` — `communityId`, `donorUserId`, `taxYear`, `r2Key`,
  `totalDeductible`, `issuedAt`, `version`, `status`.
- `issuedCards` — `communityId`, `groupId`, `fundId`, `holderUserId?`
  (null for shared), `model` (`per_person`/`shared`), `stripeCardId`,
  `last4`, `limits`, `status` (`active`/`frozen`/`canceled`).
- `cardTransactions` (ledger) — `cardId`, `groupId`, `fundId`, `spenderUserId?`,
  `amount`, `merchant`, `mcc`, `stripeAuthorizationId`, `status`, `receiptR2Key?`,
  `createdAt`.

Permissions: add a **treasurer/finance** role bit in
`apps/convex/lib/permissions.ts`.

---

## 10. Phased Rollout

| Phase | Delivers | Gates / dependencies |
| --- | --- | --- |
| **0. Compliance + Connect foundation** | Connect onboarding, nonprofit + Apple verification, `givingStatus` gate, webhooks | Legal/AppStore review (§11); no user-facing giving yet |
| **1. Community giving** | Give screen (Apple Pay, one-time + recurring), donation ledger, My Giving | Phase 0 |
| **2. Statements** | Auto-issued + on-demand IRS-compliant PDF statements (R2 + email/push) | Phase 1 |
| **3. Funds & budgets** | Funds (incl. restricted + per-group), designated giving, group budgets, budget-vs-actual | Phase 1 |
| **4. Cards (per-person v1)** | Stripe Issuing enablement, Issuing balance funding, virtual per-person cards, limits, receipt capture, reconciliation | Phase 3 + Issuing capability/KYC |
| **5. Cards fast-follow** | Physical cards, shared-card option, budget-aware declines | Phase 4 |
| **6. Reporting depth** | Full dashboards, exports, rollups | Phases 1–4 |

Phases 1–3 deliver the highest value with the lowest regulatory complexity; cards
(4–5) carry the most KYC/risk work and depend on funds.

---

## 11. Open Questions & Risks (need decisions before build)

1. **Apple nonprofit approval mechanics** — exact process, lead time, and whether
   a multi-tenant platform enrolls once or per-community. **Blocking for Phase 0.**
   Needs legal/AppStore counsel.
2. **Android / Google Play** — is there an analogous donation gate? Confirm parity.
3. **EE vs OSS placement** — confirm giving/funds/cards live under ELv2 `ee/`
   (recommended, matches billing) vs AGPL core.
4. **Platform monetization of giving** — do we take a Connect application fee on
   donations, or is giving free and we monetize only via subscription? Affects
   donor "cover the fees" UX and trust/positioning.
5. **Stripe product enablement** — Connect (controller config), Issuing, and
   possibly Treasury all require Stripe review/approval for our use case and
   volumes. Start these applications early.
6. **Issuing funding latency** — US pull funding can take ~5 business days; do we
   need push funding (beta) so budgets fund fast enough to be usable?
7. **Restricted-fund accounting depth** — how far do we go toward true fund
   accounting vs. simple balance tracking before communities need QuickBooks?
8. **Donor identity / anonymity** — reconcile "anonymous gift" UX with the fact
   that statements always require donor identity.
9. **Existing community-billing collision** — communities already have
   `stripeCustomerId`/subscription. Ensure the Connect account (money *in*) and
   the subscription customer (money *out to Togather*) are cleanly separated on the
   schema and in webhooks.
10. **State charitable-solicitation registration** — many US states require
    nonprofits to register before soliciting donations. Do we surface/track this
    per community, or is it the community's responsibility (likely the latter, but
    document it)?

---

## 12. Appendix — Key References

- Apple App Review Guidelines (3.2.1 Business / nonprofit donations):
  https://developer.apple.com/app-store/review/guidelines/
- IRS — Substantiating charitable contributions:
  https://www.irs.gov/charities-non-profits/substantiating-charitable-contributions
- IRS Pub. 1771 (Charitable Contributions — Substantiation & Disclosure):
  https://www.irs.gov/pub/irs-pdf/p1771.pdf
- IRS — Written acknowledgments:
  https://www.irs.gov/charities-non-profits/charitable-organizations/charitable-contributions-written-acknowledgments
- Stripe Connect (platform/marketplace): https://stripe.com/connect
- Stripe Issuing: https://stripe.com/issuing
- Stripe — Fund Issuing balances with Connect:
  https://docs.stripe.com/issuing/connect/funding
- Stripe — Treasury for platforms: https://docs.stripe.com/treasury/connect
- Stripe for nonprofits: https://stripe.com/industries/nonprofits

### Codebase touchpoints

- Existing billing (template for Connect/Issuing webhooks):
  `apps/convex/functions/ee/billing.ts`, `apps/convex/http.ts`
- Schema (new tables go here): `apps/convex/schema.ts`
- Permissions (add treasurer role): `apps/convex/lib/permissions.ts`
- Stripe SDK already present: root + `apps/convex/package.json` (`stripe@^20.4.1`)
