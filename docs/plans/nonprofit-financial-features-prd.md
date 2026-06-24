# PRD: Nonprofit Financial Features (Group Giving, Funds, Budgets & Cards)

- **Status:** Draft / for discussion
- **Author:** (you)
- **Last updated:** 2026-06-24
- **Branch:** `claude/nonprofit-financial-features-30zw04`
- **Scope of this doc:** A single combined PRD covering four interdependent feature areas, now **group-first**:
  1. **Group funds, budgets & designated giving** (headline)
  2. Giving statements (IRS-compliant, auto-issued)
  3. Budget spending cards (Stripe Issuing)
  4. Financial reporting & dashboards
  5. Community-wide giving (**optional / deferred** — see §9)

> This is a design/PRD document, not an implementation plan.

### Revision note (2026-06-24) — pivot to group-first

Early feedback: **community leaders do not want to route their community's
primary donations (tithes/offerings) through another app** — they're attached to
their existing giving platform and won't move it. But **group-level giving is
wanted**: groups raising money for *their* activities and purposes.

So this revision makes **group funds + designated giving the headline** and demotes
community-wide giving to an optional/deferred mode (§9).

**Important clarification (don't be misled by the pivot):** you confirmed group
giving is **tax-deductible charitable giving designated to a group**, *not*
informal cost-sharing. Legally, a group is **not** a separate entity — that money
still flows to the **community's 501c3** and statements still issue under the
**community's EIN**, simply *restricted/designated* to the group. Therefore the
heavy compliance foundation (Stripe Connect onboarding, KYC, Apple nonprofit
verification) **still applies** — the pivot changes the *donor-facing emphasis and
build order*, not the regulatory machinery. (If we later want a genuinely lighter
path, that's the "activity cost-sharing" model we explicitly did **not** choose;
noted in §12 as a future option.)

---

## 1. Summary & Vision

Togather is a community management platform (Communities → Group Types → Groups →
Members). Today the only money flow is **platform billing** — communities pay
Togather a monthly subscription via Stripe (`apps/convex/functions/ee/billing.ts`).

This initiative adds money flowing **toward the mission**, centered on **groups**:

- Members **give to a specific group's fund** (e.g. "Youth missions trip", "Small
  group benevolence") as a **tax-deductible, designated charitable gift** to the
  community's 501c3.
- Admins set **budgets per group** and groups see **budget vs. actual** live.
- Authorized people **spend** a group's budget via issued **cards**, with limits
  and full attribution.
- The community auto-issues **IRS-compliant giving statements** for all charitable
  giving (group-designated + any community-wide), under its own EIN.
- **Community-wide giving** is supported but **optional/deferred** — for the
  communities that *do* want it — and is explicitly **not** positioned as a
  replacement for a church's primary offering platform.

The north star: a group can **raise money for its purpose and spend it
accountably**, end to end, inside Togather — without standing up its own
fundraiser and without the community having to migrate its main giving platform.

### Why this is viable inside the app (the Apple question)

Apple **App Review Guideline 3.2.1(vi)** lets *approved nonprofits* collect
donations **inside the app without In-App Purchase** (so **no 30% Apple cut**),
provided they use **Apple Pay**, disclose how funds are used, and make tax
receipts available.

Because group-designated giving is **still tax-deductible charitable giving to the
community's 501c3**, this is the path that applies — and its condition applies too:
Togather is a **platform connecting donors to many nonprofits**, so Apple requires
**every community has gone through nonprofit approval**. We gate giving behind a
per-community verification step (§4).

Card spending and budget management are **real-world money movement, not digital
goods** — entirely outside IAP.

---

## 2. Goals & Non-Goals

### Goals (reordered group-first)

- Let a member give to a **specific group's fund** in a few taps (one-time +
  recurring), as a designated, tax-deductible gift.
- Let admins create **funds** (general + per-group, restricted/unrestricted) and
  **set budgets** per group, with budget-vs-actual visibility.
- Let groups **spend** their budget via **issued cards**, with per-card limits and
  attribution of who spent what on which fund.
- **Auto-issue IRS-compliant giving statements** (annual + on-demand) under each
  community's own EIN, covering all charitable giving.
- Give admins & leaders **dashboards**: giving by group/fund, fund balances,
  budget vs. actual, card spend.
- Keep each community as its **own 501c3 of record**; money flows to them via
  Stripe Connect; Togather stays the software platform.
- Support **community-wide giving as an optional mode** for communities that want
  it — without forcing it or positioning it as their main offering platform.

### Non-Goals

- Togather acting as fiscal sponsor / merchant-of-record / holder of donor funds.
- Positioning community-wide giving as a replacement for a church's primary
  tithe/offering platform (explicitly **not** the goal — see Revision note).
- **Informal activity cost-sharing / chip-ins** (pizza splits, non-deductible
  collections). We chose the *charitable designated* model; cost-sharing is a
  possible future track (§12), not in scope now.
- Full double-entry / GAAP general ledger replacement (we track giving + fund
  balances; we are not QuickBooks).
- Grant management, pledge campaigns, payroll, 1099/vendor tax filing.
- Non-US tax regimes; crypto/stablecoin giving.

---

## 3. Personas & Top User Stories

| Persona | Needs |
| --- | --- |
| **Donor / member** | Give quickly to a **group I care about**, set up recurring giving, see my history, download my year-end statement. |
| **Group leader** | Raise money for my group's purpose, see budget vs. spend, hold/manage a card, capture receipts, see who gave to our fund. |
| **Community admin / treasurer** | Configure funds, set group budgets, oversee all giving, issue/freeze cards, run reports, ensure statements go out, stay compliant. |
| **Card spender** | Get a (virtual) card instantly, know my limit, tap to pay, attach a receipt. |
| **Togather (platform)** | Verify each community's nonprofit status, route money via Connect, stay off the hook as merchant-of-record. |

Representative stories:

- *As a group leader*, I open a **"Missions Trip" fund** for my group, share it,
  and members give toward our $4,000 goal.
- *As a donor*, I tap **Give → "Youth Group"**, choose $50 monthly via Apple Pay,
  and see it in my history; it's a designated, deductible gift to the church.
- *As a treasurer*, I set the **Youth Group budget to $2,000/yr**, issue the youth
  leader a virtual card capped at **$500/mo**, and watch budget-vs-actual live.
- *As a group leader*, I tap my card in Apple Wallet, buy supplies for $40, snap
  the receipt, and it auto-categorizes against our fund.
- *As a donor*, in January I get "Your 2025 giving statement from Grace Community
  is ready" — a PDF that satisfies IRS substantiation, covering all my giving
  (group-designated and otherwise).

---

## 4. Foundational Architecture & Constraints

The four features sit on this backbone. Decisions here are expensive to change.

### 4.1 Legal / money-movement model — **each community is its own 501c3**

**Decision (confirmed):** Togather is the **software platform**. Each community is
its **own legal nonprofit (501c3) with its own EIN and bank account**. Charitable
gifts — **including group-designated gifts** — flow **directly to the community**,
and the community is the **donee of record** issuing statements under its own
name/EIN.

**Group ≠ legal entity.** A "group fund" is a **designation/restriction inside the
community's 501c3**, not a separate bank account or tax entity. This is what makes
group-designated giving deductible: it's a gift to the qualified charity (the
community), restricted to a group's purpose. The "group" framing is about **donor
experience, designation, visibility, and group control of budget/spend** — not a
separate money pipe.

**Implementation: Stripe Connect.** Each community gets a **Stripe connected
account**; Togather is the Connect **platform**. Modern Connect uses **controller
properties** (not the legacy Standard/Express/Custom labels). We configure each
account so:

- The **community is liable** and is merchant of record (keeps Togather out of
  fund-holding/MOR — supports the §2 non-goal).
- **Togather controls onboarding UX** so the experience stays in-app/in-brand.
- Funds settle to the **community's own bank account**.
- Togather can take a **platform/application fee** per gift if/when we monetize
  giving (open question §12).

### 4.2 Apple App Store compliance (donations)

- Donations use **Apple Pay → Stripe**, **not IAP**. No 30% cut. (3.2.1(vi).)
- **Per-community nonprofit verification is mandatory** — including for
  group-designated giving, because it's still charitable giving. A community
  cannot enable *any* giving until verified. We must:
  - Collect/verify EIN + 501c3 determination and complete Apple's nonprofit
    approval for platform-listed nonprofits.
  - Gate the "Give" UI behind `givingStatus = active`, which flips on only after
    Stripe Connect KYC **and** nonprofit verification pass.
- **Disclosure**: each give screen discloses how funds are used and surfaces tax-
  receipt availability.
- **Card spending is outside IAP** (real-world money movement).

> ⚠️ The pivot to group-first does **not** remove this gate. See §12 open
> questions on Apple's nonprofit-approval mechanics for a multi-tenant platform.

### 4.3 Card issuing & budgets — Stripe Issuing (+ Treasury/Financial Accounts)

Budget **spending** is **Stripe Issuing**. The connected account needs the
**`card_issuing`** capability (and **`treasury`** if cards draw on a Stripe
**financial-account** balance). An **Issuing balance** must be funded before a card
can transact (US default = **pull funding** from a verified bank, ~up to 5 business
days; **push funding** in beta).

A group "budget" therefore has **two distinct layers**:

- **Accounting budget** — an app-level cap an admin assigns to a group ("you may
  spend $2,000 this year"). Available immediately.
- **Funded card balance** — actual money loaded to an Issuing balance that cards
  draw from. Requires funding + KYC capabilities.

Cards are an **opt-in overlay** on top of fund balances, never a prerequisite for
giving or budgets.

### 4.4 Onboarding & enablement flow

```
Community decides to enable giving
        │
        ▼
1. Nonprofit verification (EIN, 501c3 determination) ──┐
2. Stripe Connect onboarding/KYC (controller acct)     ├─ all must pass
3. Apple nonprofit approval (platform-listed)          ┘
        ▼
givingStatus = active  →  Give UI unlocked (group funds first)
        ▼
Create group funds + set group budgets  →  designated giving live
        ▼
(optional) Enable Issuing: card_issuing capability + fund Issuing balance
        ▼
Issue cards
        ▼
(optional) Enable community-wide "General fund" giving (§9)
```

### 4.5 Reuse of existing infrastructure

- **Stripe SDK already installed** (`stripe@^20.4.1`, root + `apps/convex`).
- **Existing webhook + billing patterns** in `apps/convex/functions/ee/billing.ts`
  and `apps/convex/http.ts` are the template for Connect/Issuing webhooks.
- **EE vs OSS**: giving/funds/cards are commercial nonprofit-grade features →
  should live under **ELv2 `ee/`** alongside billing, not AGPL core (confirm §12).
- **Permissions**: extend the `userCommunities` role bitmask
  (`apps/convex/lib/permissions.ts`) with a **treasurer/finance** role; reuse
  `groupMembers.role` (leader) for group-fund/budget management.

---

## 5. Feature 1 (Headline) — Group Funds, Budgets & Designated Giving

This is the centerpiece. It merges "where money goes" (funds), "what's allowed"
(budgets), and "money in" (designated giving) into one group-centric experience.

### 5.1 Concepts

- **Fund**: a designation bucket money can be given to. Every community has a
  **General fund**; the focus here is **per-group funds** ("Youth missions trip").
- **Restricted vs. unrestricted**: a fund can be **restricted** (must be spent on
  its purpose). Designated gifts to a restricted group fund increase only that
  fund's balance — important for nonprofit integrity.
- **Budget**: an admin-set **spending allowance** for a group over a period
  (annual/monthly). Distinct from fund balance (§4.3): budget = plan/cap; fund
  balance = money actually available.

### 5.2 Group leader / admin flows

- **Create a group fund** (name, purpose/description, optional goal amount,
  restricted?, donor-visible?). Leaders can create funds for their own group;
  admins for any group (permission TBD §12).
- **Set a group's budget** (amount + period + rollover policy).
- View **fund balance** (gifts in − spend out) and **budget vs. actual**.
- Optional **fundraising goal / progress bar** for campaign-style group funds.

### 5.3 Donor-designated giving flow

1. Member opens **Give** (gated on `givingStatus = active`) — or taps "Give" from
   inside a **group**.
2. Picks a **group fund** (group context preselects it), **amount** (presets +
   custom), **frequency** (one-time / weekly / monthly).
3. Pays via **Apple Pay** (primary), card, or bank/ACH (lower fees for recurring).
4. Confirmation + instant entry in **My Giving**; group's fund balance + goal
   progress update live.
5. Optional **cover-the-fees** toggle (donor pays processing; group nets 100%).

Every gift is a **designated, tax-deductible charitable gift** to the community's
501c3, restricted to the group fund — so it counts toward statements (§6).

### 5.4 Data captured per gift (donation ledger)

Donor identity, community, **fund + group designation**, gross/fees/net, method,
Stripe payment-intent/charge id, recurring-plan id, status, and **tax metadata**
(`goodsOrServicesProvided` + value; default none → fully deductible), timestamp.

### 5.5 Recurring giving

- Stripe recurring on the connected account; donor self-service (pause, edit
  amount, change fund, change method, cancel); dunning/retry on failure.

### 5.6 Guardrails

- Spending against a **restricted** fund can't exceed that fund's balance.
- Budget overruns: warn/alert (optionally block at card-auth — §7) as a group's
  spend nears/exceeds budget.
- **Fund reallocation** (moving money between funds) is an explicit, logged admin
  action — preserves restricted-fund integrity + audit trail.

### 5.7 Edge cases

- **Refunds / chargebacks** → ledger reversal + statement recompute + fund-balance
  adjustment.
- **"Anonymous" group gift** → hidden from group leaders, but donor identity is
  always retained (statements require it).
- **Group archived/deleted with a fund balance** → admin must reassign/close the
  fund (restricted funds can't just vanish).
- **Gift attempted before nonprofit verified** → blocked by `givingStatus`.

---

## 6. Feature 2 — Giving Statements (IRS-compliant)

Applies to **all charitable giving** — group-designated and community-wide alike.
This is a core differentiator and must be correct.

### 6.1 IRS requirements we must satisfy (Pub. 1771)

- Single gift **≥ $250** → donor needs a **contemporaneous written
  acknowledgment**; year-end **computer-generated statements are acceptable**.
- Statement **must state whether the org provided goods/services** in exchange, and
  if so a **good-faith estimate of value** (quid pro quo).
- **Quid pro quo > $75** → written disclosure of the deductible portion.
- **Intangible religious benefits only** → statement must say so explicitly.
- Must include: org legal name + **EIN**, donor name, date(s), amount(s), and the
  goods/services statement.

### 6.2 Design

- Each gift carries `goodsOrServicesProvided` (default none → fully deductible);
  quid-pro-quo (e.g. fundraising dinner) is the supported exception.
- **Auto-issue annual statements** each January for the prior tax year: a branded
  **PDF per donor per community**, stored in **Cloudflare R2**, delivered via
  **push + Resend email**, plus **on-demand download** in My Giving anytime.
- Generated from the **community's own EIN/legal name** (§4.1) — valid receipts,
  no Togather-as-donee ambiguity. Statements **aggregate a donor's gifts across all
  funds/groups** within that community.
- Re-generation/versioning when refunds or corrections occur post-issuance.

---

## 7. Feature 3 — Budget Spending Cards (Stripe Issuing)

Authorized people spend a group's budget with a card, with limits + attribution.
We were asked to spec both models and recommend one.

### 7.1 Model A — **Per-person cards** (one per authorized spender)

- Each spender gets their **own** card (virtual instantly via Apple Wallet;
  physical optional), tied to a group's fund/budget.
- Per-card controls: monthly/transaction limits, allowed merchant categories,
  freeze/cancel. **Attribution is automatic** — every txn maps to a person.
- **Pros:** clean accountability, individual limits, freeze one person without
  disrupting others, scales to many leaders.
- **Cons:** more cards to manage; cardholders may need identity info for KYC.

### 7.2 Model B — **One shared card per group**

- A single group card the leader manages; multiple people may use the number.
- **Attribution is weak** — txns land on the group, not a person; rely on receipt
  capture + manual notes.
- **Pros:** simplest, fewest cards. **Cons:** poor accountability, harder
  reconciliation, one compromised number affects the whole group.

### 7.3 **Recommendation: Per-person (Model A) default**, shared as a niche option

Nonprofits live on **accountability and audit trails**; per-person attribution is
the whole point of cards vs. reimbursements. Virtual cards are free/instant, so
"one per person" isn't costly. Offer **shared cards as an explicit, discouraged
option** for small groups (e.g. one physical card in a shared space). **v1 =
per-person virtual cards**; physical + shared cards are fast-follows.

### 7.4 Mechanics (both models)

- **Stripe Issuing**; connected account needs **`card_issuing`** (and **`treasury`**
  if cards draw on a financial-account balance) — §4.3.
- **Funding**: the group's **Issuing balance** must be funded from the community's
  bank (US pull funding ~≤5 business days; push funding beta). Until funded, a card
  can't transact even if the accounting budget exists.
- **Real-time authorization controls** via Issuing auth webhooks: limits, MCC
  restrictions, optional **budget-aware decline** (decline if it would blow the
  group's remaining budget).
- **Receipt capture**: prompt the spender to attach a receipt (photo → R2) right
  after a txn; required above a threshold.
- **Reconciliation**: every txn posts to the ledger against the group's fund,
  reducing fund balance + budget-remaining.
- **Lifecycle**: issue, add to Apple Wallet, freeze, adjust limits, cancel, replace
  lost/stolen.

### 7.5 Compliance / risk

- Issuing requires **cardholder + business KYC** (per-person → collect cardholder
  info). Adds fraud/dispute surface → needs alerting + freeze tooling for
  treasurers. Confirm Issuing terms cover our nonprofit-community use during Stripe
  enablement.

---

## 8. Feature 4 — Reporting & Dashboards

### 8.1 Admin / treasurer dashboard

- **Giving over time** (day/week/month/year), **by group**, by fund, by method.
- **Fund balances** (restricted vs. unrestricted split).
- **Budget vs. actual** per group, with overrun alerts.
- Recurring vs. one-time mix; **statement issuance status** at year-end.
- **Card spend** by card/person/fund; uncategorized / missing-receipt queue.
- **CSV export** for the community's accountant / QuickBooks import.

### 8.2 Group leader view

- **Budget remaining**, **fund balance**, goal progress, recent gifts to our fund,
  recent card spend, missing receipts.

### 8.3 Donor view ("My Giving")

- History across groups/funds, recurring-plan management, **download statements**
  anytime, year-to-date total.

### 8.4 Implementation notes

- Convex **reactive queries** over the donation + spend ledgers (live updates).
- Heavy aggregates → **pre-computed rollups** (cron-driven, like the existing
  `memberFollowupScores` pattern) rather than per-request scans.

---

## 9. Feature 5 — Community-wide Giving (optional / deferred)

For communities that **do** want an in-app general-fund/offering channel. **Not the
headline, not built first, and not positioned as a replacement** for a church's
primary giving platform (per the §-Revision feedback).

- Same rails as group giving: Apple Pay → Stripe Connect → community 501c3,
  designated to the **General fund** instead of a group fund.
- Same statements (§6) and ledger (§5.4) — community-wide gifts just carry no
  group designation.
- **Enablement is a separate, explicit toggle** so a community can run group giving
  only and never surface a community-wide "Give to the church" CTA.
- Build **after** group giving + statements + funds/budgets are solid.

---

## 10. Proposed Data Model (Convex) — sketch

New tables in `apps/convex/schema.ts` (names indicative):

- `communityGiving` — `communityId`, `stripeConnectedAccountId`, `givingStatus`
  (`pending`/`active`/`suspended`), `nonprofitVerified`, `ein`, `legalName`,
  `payoutBankStatus`, `issuingEnabled`, `communityWideGivingEnabled`.
- `funds` — `communityId`, `groupId?`, `name`, `purpose`, `goalAmount?`,
  `isRestricted`, `isGeneral`, `donorVisible`, `archivedAt?`.
- `groupBudgets` — `communityId`, `groupId`, `fundId`, `amount`, `period`,
  `rolloverPolicy`, `startsAt`/`endsAt`.
- `donations` (append-only ledger) — `communityId`, `donorUserId`, `fundId`,
  `groupId?`, `grossAmount`, `feeAmount`, `netAmount`, `coveredFees`, `method`,
  `stripePaymentIntentId`, `recurringPlanId?`, `status`,
  `goodsOrServicesProvided`, `goodsValue?`, `createdAt`.
- `recurringGifts` — `donorUserId`, `communityId`, `fundId`, `amount`, `interval`,
  `stripeSubscriptionId`, `status`.
- `givingStatements` — `communityId`, `donorUserId`, `taxYear`, `r2Key`,
  `totalDeductible`, `issuedAt`, `version`, `status`.
- `issuedCards` — `communityId`, `groupId`, `fundId`, `holderUserId?`, `model`
  (`per_person`/`shared`), `stripeCardId`, `last4`, `limits`, `status`.
- `cardTransactions` (ledger) — `cardId`, `groupId`, `fundId`, `spenderUserId?`,
  `amount`, `merchant`, `mcc`, `stripeAuthorizationId`, `status`, `receiptR2Key?`,
  `createdAt`.

Permissions: add a **treasurer/finance** role bit in
`apps/convex/lib/permissions.ts`; reuse `groupMembers.role` for group-fund/budget
management.

---

## 11. Phased Rollout (group-first)

| Phase | Delivers | Gates / dependencies |
| --- | --- | --- |
| **0. Compliance + Connect foundation** | Connect onboarding, nonprofit + Apple verification, `givingStatus` gate, webhooks | Legal/AppStore review (§12); no user-facing giving yet |
| **1. Group funds + designated giving** | Group funds (incl. restricted), Give-to-group flow (Apple Pay, one-time + recurring), donation ledger, My Giving, goal progress | Phase 0 |
| **2. Budgets + leader/admin views** | Group budgets, budget-vs-actual, fund balances, group leader view | Phase 1 |
| **3. Statements** | Auto-issued + on-demand IRS-compliant PDF statements (R2 + email/push) | Phase 1 |
| **4. Cards (per-person v1)** | Issuing enablement, Issuing-balance funding, virtual per-person cards, limits, receipt capture, reconciliation | Phase 2 + Issuing capability/KYC |
| **5. Cards fast-follow** | Physical cards, shared-card option, budget-aware declines | Phase 4 |
| **6. Reporting depth** | Full dashboards, exports, rollups | Phases 1–4 |
| **7. Community-wide giving (optional)** | General-fund giving toggle + CTA, for communities that want it | Phases 1–3 |

Phases 1–3 deliver the highest value at the lowest regulatory complexity; cards
(4–5) carry the most KYC/risk and depend on budgets; community-wide giving (7) is
deliberately last and opt-in.

---

## 12. Open Questions & Risks (need decisions before build)

1. **Apple nonprofit approval mechanics** — exact process, lead time, and whether a
   multi-tenant platform enrolls once or per-community. **Blocking for Phase 0.**
   Needs legal/AppStore counsel. (Unchanged by the group-first pivot — group
   giving is still charitable.)
2. **Android / Google Play** — analogous donation gate? Confirm parity.
3. **EE vs OSS placement** — confirm giving/funds/cards live under ELv2 `ee/`.
4. **Who can create group funds / set budgets** — group leaders autonomously, or
   admin-approved? Affects abuse surface and treasurer oversight.
5. **Platform monetization of giving** — Connect application fee on gifts, or free
   (monetize only via subscription)? Affects "cover the fees" UX + positioning.
6. **Stripe product enablement** — Connect (controller config), Issuing, possibly
   Treasury all require Stripe review for our use case/volumes. Start early.
7. **Issuing funding latency** — US pull funding ~5 business days; do we need push
   funding (beta) so group budgets fund fast enough to be usable?
8. **Restricted-fund accounting depth** — how far toward true fund accounting vs.
   simple balance tracking before communities need QuickBooks?
9. **Existing community-billing collision** — communities already have
   `stripeCustomerId`/subscription (money *out* to Togather). Keep the Connect
   account (money *in*) cleanly separated on schema + webhooks.
10. **State charitable-solicitation registration** — many states require
    registration before soliciting donations; surface/track per community, or treat
    as the community's responsibility? (Group fundraising may broaden this.)
11. **Future: activity cost-sharing track** — we deliberately chose *charitable
    designated* giving. If demand appears for non-deductible chip-ins (pizza,
    trips), that's a separate, lighter-compliance model (no statement, different
    Apple/tax treatment) to spec later — do **not** conflate it with charitable
    funds.

---

## 13. Appendix — Key References

- Apple App Review Guidelines (3.2.1 / nonprofit donations):
  https://developer.apple.com/app-store/review/guidelines/
- IRS — Substantiating charitable contributions:
  https://www.irs.gov/charities-non-profits/substantiating-charitable-contributions
- IRS Pub. 1771 (Substantiation & Disclosure):
  https://www.irs.gov/pub/irs-pdf/p1771.pdf
- IRS — Written acknowledgments:
  https://www.irs.gov/charities-non-profits/charitable-organizations/charitable-contributions-written-acknowledgments
- Stripe Connect: https://stripe.com/connect
- Stripe Issuing: https://stripe.com/issuing
- Stripe — Fund Issuing balances with Connect:
  https://docs.stripe.com/issuing/connect/funding
- Stripe — Treasury for platforms: https://docs.stripe.com/treasury/connect
- Stripe for nonprofits: https://stripe.com/industries/nonprofits

### Codebase touchpoints

- Existing billing (template for Connect/Issuing webhooks):
  `apps/convex/functions/ee/billing.ts`, `apps/convex/http.ts`
- Schema (new tables): `apps/convex/schema.ts`
- Permissions (add treasurer role): `apps/convex/lib/permissions.ts`
- Stripe SDK already present: root + `apps/convex/package.json` (`stripe@^20.4.1`)
