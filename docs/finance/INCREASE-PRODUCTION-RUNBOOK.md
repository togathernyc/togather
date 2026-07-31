# Increase Production Runbook

**Status as of this writing (2026-07-31): the Increase production program has
not been started at all.** No application submitted, no underwriting
conversation, no contract. Everything in the codebase — Entities, Accounts,
transfers, cards — runs against the free Increase **sandbox**
(`sandbox.increase.com`). This is the single longest-lead item on the
group-giving critical path (ADR-032) and it is entirely external to
engineering: it cannot be shortened by writing more code.

This document is for whoever drives the Increase relationship (founder/owner)
and whoever does the eventual technical cutover. It assumes no prior research
into Increase — every external claim below is sourced and linked.

---

## 1. What this unblocks — and what it doesn't

Starting the Increase program **today** unblocks the underwriting clock,
which is the thing on the critical path. It does **not** unblock real money
movement by itself — that also needs, independently:

- Increase underwriting **approved** (not just started) and a program live.
- The three code landmines in §5 fixed (base-URL default, sandbox/production
  detection, and a General Account for the community-wide fund).
- The Phase-2 product gaps in §6 (net-amount allocation, reimbursement
  payout destinations, card spend limits) closed enough to trust with a real
  church's donations.
- Counsel sign-off on the open items in `docs/finance/COMPLIANCE.md`.

**No real donor dollar can move until all of the above are done, not just
this one.** Treat this runbook as "start the clock on the slowest item," not
"the last step before launch."

---

## 2. Application checklist

Prepare everything below **before** contacting Increase — `/documentation/customized-compliance`
and `/documentation/platform-implementation` both describe onboarding as a
document-request-and-review process, so arriving with complete answers
shortens the number of back-and-forth rounds.

### 2.1 What the codebase already tells you (fill in, don't re-derive)

| Item | Answer (from this codebase) | Source |
| --- | --- | --- |
| What we're building | A platform where **churches (our customers) are the Entities that own bank accounts** — Togather never owns or holds the funds. One Increase Entity per church community, KYB'd once. | ADR-032 §1 |
| Account structure per Entity | 1 receiving Account (Stripe payout destination) + 1 General Account (community-wide fund) + 1 Account per group with giving enabled | ADR-032 §1 (see the diagram in §4 below) |
| Who legally owns the money | The church, not Togather and not the group. A group is never its own banking customer — group money is the church's money, purpose-restricted, mirroring how church fund accounting already works. | ADR-032 §1 |
| Money in | Stripe Connect (donor card / Apple Pay), bulk payout T+2 to the Increase receiving Account | ADR-032 §3 |
| Money out | Increase ACH transfer (member reimbursement) or Increase virtual card spend (group purchases) | ADR-032 §3 |
| Segregation model | Bank-enforced — a card or transfer is bound to its Account and cannot touch another group's balance. No custom real-time authorization decisioner on the critical path today. | ADR-032 §1 |
| Onboarding UX for churches | One intake form (legal name, EIN, address, website) + one Stripe-hosted identity redirect; everything else automatic via webhooks. Churches never talk to Increase directly. | ADR-032 §2 |
| What we ask Increase's API to do today | Create Entities (`POST /entities`, structure `corporation`), create Accounts, mint Account Numbers, Account Transfers (receiving → group), ACH Transfers (reimbursements), create/freeze/cancel virtual Cards, read balances and transactions, verify webhooks | `apps/convex/lib/finance/increase.ts` |
| Compliance model requested | Beneficial-ownership **exemption** for the church Entity (`beneficial_ownership_exemption_reason: "other"`) instead of submitting a representative's SSN — see §3 | `apps/convex/lib/finance/increase.ts:130-200`, `docs/finance/COMPLIANCE.md` |
| Current scale | Sandbox only; zero real communities onboarded to Increase in production | — |

### 2.2 What the owner must supply — TODOs

Increase's `customized-compliance` onboarding table (below, reproduced from
[`/documentation/customized-compliance`](https://increase.com/documentation/customized-compliance))
is the actual shape of what they will ask for. Use it as the checklist:

| Category | What Increase says they look for | Togather status |
| --- | --- | --- |
| Regulatory compliance | AML procedures, compliance management policies, your terms of service | TODO — no written AML/compliance policy exists yet. Good looks like a short doc: who reviews suspicious activity, how fast, and what "suspicious" means for a church-donation platform (large one-off gifts, structuring, etc.). Draft with counsel, not solo. |
| Business experience and qualifications | Business size, staffing, products | TODO — one page: Togather's history (existing Stripe SaaS billing, live community-management product), team size, and that group giving is a new module on an already-operating platform, not a fintech startup's first product. |
| Financial health | Financial statements, audit reports, forecasts | TODO — whatever Supa Media's bookkeeper/accountant can produce on short notice (P&L, bank statements); a forecast specifically for expected *donation volume* (see next row) is more load-bearing than general company financials for a banking-as-a-service underwriting. |
| Risk management and controls | Vendor management, current vendors, counterparty risk process | TODO — one page listing Stripe (acquiring), Increase (banking), Cloudflare R2 (file storage), Twilio (SMS), Resend (email) and how each is reviewed. This is mostly writing down what's already true. |
| Information security | Data protection, network diagrams, SDLC | TODO — Convex's own security posture + Togather's own practices (auth model, encryption in transit, R2 access control). Convex publishes a security/compliance page that may be citable directly; verify current content before quoting it. |
| Operational resilience | Business continuity, penetration tests, insurance | TODO — likely thin today (no pen test, no formal BCP, general/E&O insurance status unknown to this runbook's author). Flag this honestly rather than padding it — Increase's own docs say they'll give feedback to help build this out, which is easier to accept than to fake. |

Additional Togather-specific items to have ready, not from Increase's public
list but implied by what the API calls need (`apps/convex/lib/finance/increase.ts`,
`apps/convex/functions/finance/onboarding.ts`):

- **TODO — projected volumes.** Increase's sales form (`/contact`, see §2.3)
  explicitly asks about money-movement type and customer profile; underwriting
  will want donation $ volume, transaction count, and per-church account count
  projections (e.g. "N pilot churches in year 1, average $X/month/church").
  Good looks like a rough model, not false precision — Increase expects a
  fintech-stage forecast, not a public-company one.
- **TODO — company/legal entity details.** Togather's registered legal entity
  name, EIN, formation state, and the responsible individual(s) for the
  underwriting conversation and (per §2.1) the eventual `beneficial_owners`
  disclosure for **Togather's own** platform-level Entity (distinct from each
  church's Entity).
- **TODO — flow-of-funds diagram approval.** The narrative in §4 below is
  built to paste into Increase's diligence questionnaire as-is; confirm it
  matches what Increase's underwriters expect to see (some programs want a
  literal Visio-style diagram, not prose — ask before assuming prose suffices).

### 2.3 How to actually reach Increase

- **Sign up (self-serve sandbox account, if not already done):**
  [`https://dashboard.increase.com/signup`](https://dashboard.increase.com/signup)
- **Talk to sales / start a platform conversation:**
  [`https://increase.com/contact`](https://increase.com/contact) — the form
  asks for: your name, work email, company website, a free-text "what you'd
  like to build," whether you're moving "my own money" or "my customers'
  money" (answer: customers' — the churches'), whether customers are
  businesses or consumers (businesses — churches, structured as
  `corporation` entities per `/documentation/entities`), customer location,
  company funding stage, and whether you already have a compliance program
  planned. Answer "my customers' money" / "businesses" — this is what routes
  the conversation to a platform/program discussion rather than a
  single-account signup.
- **Direct email:** `sales@increase.com` for sales, `support@increase.com`
  for open compliance/technical questions once you're further in (both
  addresses appear throughout Increase's own docs, e.g.
  [`/documentation/compliance-overview`](https://increase.com/documentation/compliance-overview),
  [`/documentation/platform-implementation`](https://increase.com/documentation/platform-implementation)).

**Confirm with Increase, not assumed:** exact underwriting timeline. Increase's
documentation describes the onboarding *process* (the table above) but does
not publish a duration anywhere in `/documentation`. **Do not promise a
timeline to anyone internally until Increase gives one.**

---

## 3. Compliance questions to raise explicitly

Raise these in the underwriting conversation itself, not just in the intake
form — they determine whether the account topology in §4 is even the right
shape, and getting a "yes, that structure works" early avoids re-architecting
later. Sourced from ADR-032's Open Questions and `docs/finance/COMPLIANCE.md`'s
Open Items:

1. **Churches-as-Entities under a Togather platform program — is this the
   shape their compliance team wants for donated funds?** ADR-032's Open
   Questions section names this explicitly: "confirm during underwriting that
   churches-as-Entities under a Togather platform program is the shape their
   compliance team wants for donated funds." Increase's own
   [`/documentation/platform-implementation`](https://increase.com/documentation/platform-implementation)
   describes exactly three account-ownership options (customer-owned Entity,
   bank-FBO, or platform-owned Entity) — Togather's design is **Option 1**
   ("Entities are created for individual customers, each of which owns their
   own Account"), which is the option requiring the least regulatory
   permission on Togather's side (no money-transmitter license), but Increase
   needs to confirm it's acceptable for a donation/charitable-fund use case
   specifically, not just a generic SaaS-platform use case.
2. **Is `beneficial_ownership_exemption_reason: "other"` valid for a 501(c)(3)
   church Entity, and is it available at all before the platform program is
   approved?** The codebase already establishes (verified live against the
   sandbox, see `apps/convex/lib/finance/increase.ts:159-168`) that Increase's
   own `create_an_entity_parameters` OpenAPI schema documents this parameter
   as usable "after approval from your bank partner" — i.e. it is explicitly
   gated on the underwriting relationship this runbook exists to start. **The
   public prose documentation does not explain this field at all** —
   [`/documentation/entities`](https://increase.com/documentation/entities)
   and [`/documentation/entity-validation`](https://increase.com/documentation/entity-validation)
   describe full beneficial-owner disclosure (control prong + up to 4
   ownership prongs, each needing an SSN) with no mention of nonprofit or
   other exemptions. This has to be raised as a direct question in
   underwriting, not inferred from docs — **confirm with Increase**: (a)
   whether the exemption is granted per-program or per-Entity, (b) what
   documentation substitutes for beneficial-owner SSNs on a 501(c)(3) (IRS
   determination letter? board member list?), and (c) whether it still
   applies to a church with multiple member-managed group funds under one
   Entity, which `docs/finance/COMPLIANCE.md` flags as an open item Increase
   hasn't weighed in on.
3. **FBO / fund-for-benefit framing for group funds.** Are per-group Accounts
   under a church's Entity best treated as restricted sub-allocations of the
   church's own money (Togather's current framing — see ADR-032 §1: "A group
   is never its own banking customer... group money is legally the church's
   money"), or does Increase's compliance team want additional beneficial-
   owner-style disclosure when church funds are functionally earmarked to
   member-run groups? `docs/finance/COMPLIANCE.md` lists this as an open item
   for both counsel and Increase underwriting.
4. **Additional beneficial-owner identification per fund?** Direct follow-on
   to #3 — `docs/finance/COMPLIANCE.md`'s Open Items #3 asks this explicitly:
   "Does Increase require additional beneficial-owner identification for each
   fund?" Get a yes/no; it changes onboarding UX if so (today's one-form flow,
   ADR-032 §2, assumes no).
5. **What does "Managed" vs "Customized" compliance mean for Togather's
   specific case?** Increase's
   [`/documentation/compliance-programs`](https://increase.com/documentation/compliance-programs)
   describes two models: under **Customized compliance**, Togather runs its
   own KYC/AML program with bank supervision; under **Managed compliance**,
   "the bank directly performs key compliance functions for you," including
   identity verification, sanctions screening, and transaction monitoring
   ([`/documentation/managed-compliance`](https://increase.com/documentation/managed-compliance)).
   Given Togather has no existing compliance program, ask directly whether
   Managed compliance is available for this use case — it would materially
   reduce the "regulatory compliance" and "risk management" TODOs in §2.2.
   Increase's own docs say "Your exact model is determined when you onboard
   your Program" — so this is a first-conversation question, not something
   to guess at.

Also flag to Increase, even if not phrased as a question: the counsel-only
items in `docs/finance/COMPLIANCE.md` §"Open Items for Counsel & Underwriting"
that touch Increase's own program design — state-level charitable
solicitation registration (#1) and receipt-timing relative to bank clearing
(#5) may inform how Increase structures the program, even though the answers
are ultimately counsel's to give.

---

## 4. Flow-of-funds narrative

Plain-English version, suitable to paste into an Increase diligence
questionnaire:

> A donor gives to a specific fund (a church's general fund, or one of its
> groups' funds) via Apple Pay or card, charged through **Stripe Connect**
> on the church's Stripe connected account (Stripe is the card-acquiring
> processor only — it never custodies the funds beyond the standard Stripe
> payout cycle). Stripe pays out in bulk, roughly every two days, to a
> **Increase Account** that Togather provisions and designates as that
> church's Stripe payout destination — this is the church's own "receiving"
> bank account, owned by the church's Increase Entity, not Togather's. A
> background allocation job then splits that bulk payout across the
> individual fund Accounts (also owned by the same church Entity) using
> Increase **Account Transfers**, based on which donations the payout
> actually covered. From there, money either sits in a group's Account and is
> spent via an **Increase virtual card** bound to that Account (which Increase
> enforces cannot overdraw or touch another group's balance), or is paid out
> to a church member as a reimbursement via an **Increase ACH Transfer**
> from the group's Account to the member's own linked bank account. Togather
> never touches the money — it only calls Increase's and Stripe's APIs on the
> church's behalf and keeps an append-only ledger for attribution, receipts,
> and audit. The bank (via Increase), not Togather's ledger, holds the
> authoritative balance at every step.

Account topology (from ADR-032 §1):

```
Stripe:   1 connected account per community (church)      — acquiring only
Increase: 1 Entity per community (church, KYB'd once)
          ├─ 1 receiving Account   (Stripe payout destination)
          ├─ 1 General Account     (community-wide fund)
          └─ 1 Account per group with giving enabled
Convex:   funds + append-only ledgerEntries               — attribution/audit
```

---

## 5. Technical cutover checklist

Everything needed to move the integration from sandbox to production, in
order. Follow `docs/secrets.md`'s "Secret Update Flow" exactly — 1Password is
the source of truth; never set a secret directly in GitHub or Convex.

### 5.1 Pre-cutover code changes (do these before touching any secret)

- [ ] **Landmine (a) — fix the missing base-URL default.** Today,
      `apps/convex/lib/finance/increase.ts:52` defaults `INCREASE_API_BASE_URL`
      to `https://api.increase.com` — **production** — when the env var is
      unset. Production Convex currently has **no `INCREASE_API_BASE_URL` set
      at all** (`INCREASE_API_BASE_URL` is in the `optional` list in
      `ee/secrets-allowlist.json`, meaning it's skipped, not defaulted, when
      absent from 1Password). The practical risk: if a sandbox
      `INCREASE_API_KEY` is ever synced to production Convex without also
      setting `INCREASE_API_BASE_URL=https://sandbox.increase.com`, requests
      silently go to the **production** Increase host with a sandbox key —
      which will fail loudly (auth error) rather than silently succeed, but
      only because the key won't authenticate against the wrong host. The
      more dangerous direction is the mirror case at go-live: forgetting to
      set the base URL at all when the *production* key is finally synced
      happens to work today only because the default already points at
      production — meaning there is currently no explicit, reviewable
      declaration of which environment production Convex is even targeting.
      Recommended fix: stop relying on an implicit default; require
      `INCREASE_API_BASE_URL` to be explicitly set in every environment
      (dev/staging → sandbox, production → production), and fail loudly if
      it's missing, the same way `getIncreaseApiKey()` already fails loudly
      when `INCREASE_API_KEY` is missing.
- [ ] **Landmine (b) — stop branching on a substring of the base URL.**
      `apps/convex/lib/finance/increase.ts:160` decides which
      beneficial-ownership path to submit — a fabricated sandbox owner vs.
      the real production exemption — by checking
      `getIncreaseBaseUrl().includes("sandbox")`. A misconfigured or
      malformed `INCREASE_API_BASE_URL` (a typo, a stray trailing slash that
      breaks the check, or a future proxy/CDN URL in front of Increase that
      doesn't literally contain the string `"sandbox"`) silently flips which
      compliance path is submitted — worst case, submitting a **fabricated
      test beneficial owner's fake SSN to the real production Increase API**
      for a real church. Recommended fix: replace the substring check with
      an explicit environment flag (e.g. `INCREASE_ENVIRONMENT=sandbox` /
      `production`, validated against a fixed enum, independent of and
      cross-checked against the base URL) so this branch can never be
      wrong by typo. **Land this fix before the first production Increase
      key exists anywhere in the deploy pipeline** — it's a pure
      unforced-error risk otherwise.
- [ ] **Add the missing community-level General Account provisioning.**
      Noticed while researching this runbook, not previously documented:
      `apps/convex/functions/finance/onboarding.ts`'s `recordProvisioned`
      creates the community's `funds` row of `type: "general"` in Convex, but
      **no code path ever calls Increase's `createAccount` for it** the way
      `provisionGroupFundAccount` does for group funds. Only the receiving
      Account (`increaseReceivingAccountId`) is ever created at Increase.
      `jobs.ts:184-188`'s comment claims "the community's General Account is
      Increase's landing spot" for unearmarked donations, but there is no
      second Account for that money to land in — it has nowhere at Increase
      to go, contradicting ADR-032 §1's documented topology (Entity →
      receiving + **General** + per-group Accounts). This has to be fixed
      before any general-fund donation flow can work in production, sandbox
      or not — flagged here because it will otherwise surface as a
      confusing failure the first time a real donation isn't earmarked to a
      specific group.

### 5.2 Secrets — 1Password → GitHub → Convex

Per `docs/secrets.md`'s "Secret Update Flow" and its "Group giving" section:

1. **1Password** (vault `Togather`): set the **production** field for
   `INCREASE_API_KEY` to the real production key once Increase issues one
   (do not reuse the sandbox key's field — `docs/secrets.md` already
   documents `staging` = sandbox key, `production` = production key on the
   same 1Password item).
2. **1Password**: set the **production** field for `INCREASE_WEBHOOK_SECRET`
   to the signing secret of a **new, separate** webhook Event Subscription
   created in the production Increase dashboard
   (`dashboard.increase.com/developers/webhooks`) pointed at
   `https://<prod-convex-deployment>.convex.site/increase-webhook`. Per
   Increase's own docs
   ([`/documentation/webhooks`](https://increase.com/documentation/webhooks)):
   "Sandbox Event Subscriptions will receive webhooks for Sandbox Events and
   vice versa" — sandbox and production subscriptions are entirely separate,
   with separate signing secrets. **Do not reuse the sandbox
   `INCREASE_WEBHOOK_SECRET`.**
3. **1Password** (per landmine (a) above, after the code fix lands): add an
   explicit production value/flag corresponding to
   `INCREASE_API_BASE_URL` = `https://api.increase.com` (or whatever the
   post-fix explicit-environment variable is named) to the `production`
   field — do not leave it implicit.
4. **`ee/secrets-allowlist.json`**: `INCREASE_API_KEY` and
   `INCREASE_WEBHOOK_SECRET` are already in `required`; `INCREASE_API_BASE_URL`
   is already in `optional`. If landmine (a)'s fix renames or adds a variable
   (e.g. `INCREASE_ENVIRONMENT`), add it here too, in `required` (an env var
   that must always be explicit, per the fix, shouldn't be `optional` and
   silently prunable).
5. **`ee/scripts/sync-secrets-to-convex.sh`**: `INCREASE_API_KEY`,
   `INCREASE_WEBHOOK_SECRET`, and `INCREASE_API_BASE_URL` are already listed
   in `SECRET_KEYS` — add any new variable from step 3 here too, or it will
   sync to GitHub but never reach Convex.
6. Dispatch the sync: `gh workflow run sync-secrets.yml -f environment=both`
   (or `-f environment=production` if staging shouldn't be touched this
   round) — per `docs/secrets.md`, this is the only supported path from
   1Password to GitHub; never `gh secret set` by hand.
7. Confirm the production Convex deploy picks up the new values on its next
   deploy (`deploy-convex.yml` syncs GitHub environment secrets to Convex on
   every deploy, per `docs/secrets.md`'s Secret Update Flow diagram).

### 5.3 Increase-side production setup

- [ ] Create the production Increase Program (this is the output of the
      underwriting process in §2-3, not a self-serve dashboard action).
- [ ] Generate production API keys in the Increase dashboard once the
      program is live — **confirm with Increase** exactly where/how
      production keys are issued relative to program approval (the public
      docs don't document dashboard key-management steps).
- [ ] Create the production webhook Event Subscription (see 5.2 step 2) and
      subscribe to the same event types already handled by
      `apps/convex/functions/finance/webhooks.ts` (`entity.created`,
      `entity.updated`, `account.created`, `account.updated`,
      `transaction.created`, `transfer.created`, etc.) — check that list
      against the live handler before subscribing, don't assume it's
      unchanged since this runbook was written.
- [ ] Confirm with Increase whether the production `beneficial_ownership_exemption_reason`
      path (§3 question 2) is actually enabled for the program before the
      first real `createEntity` call — the code already assumes it will
      work; that assumption is currently **unverified against production**
      per `apps/convex/lib/finance/increase.ts`'s own comments.

### 5.4 Rollout order

1. Land the two pre-cutover code fixes (§5.1) and the General Account fix,
   reviewed and merged, **before** any production Increase secret exists in
   the pipeline.
2. Sync production secrets (§5.2).
3. Smoke-test against production with a **single internal/test church**
   (Togather's own demo/staging community, or a controlled real one) end to
   end: onboarding form → Entity/Account creation → a real small donation →
   allocation → a real small reimbursement. Verify the nightly reconcile job
   reports zero drift for that community.
4. Only then proceed to §6.

---

## 6. Go/no-go gate

Every row below must be green before the `group-giving` flag is turned on in
production for even one **real** church (not the internal smoke test in
§5.4). This list is deliberately honest about what's still broken
independent of Increase:

| Gate | Status | Why it matters |
| --- | --- | --- |
| Increase production program approved and live | ☐ Not started | Nothing below matters until this exists |
| Landmine (a) fixed — explicit, non-defaulted `INCREASE_API_BASE_URL`/environment flag | ☐ Not done | Prevents a sandbox key silently pointing at the production host or vice versa |
| Landmine (b) fixed — explicit environment flag instead of `.includes("sandbox")` | ☐ Not done | Prevents a misconfigured URL silently submitting fabricated beneficial-owner data to the real Increase API |
| Community General Account provisioned by code, not just documented in ADR-032 | ☐ Not done | `apps/convex/functions/finance/onboarding.ts` never creates it today — general-fund (non-group) donations have no Increase Account to land in |
| Allocation switched from gross donation totals to Stripe balance-transaction NET amounts | ☐ Not done | **ARCHITECTURE.md understates this.** It is not "a tail of stuck-pending donations" — it is a deterministic total stall. `planAllocations` matches GROSS donation totals against a NET payout, and `break`s (not `continue`s) on the first item that doesn't fit, so in the common one-donation-per-payout case the queue never advances again. Group Accounts stay at zero while `funds.balanceCents` reports the money is there, and the nightly invariant compares gross to gross so it never fires. Money never reaches a group fund |
| Allocation survives partial failure | ☐ Not done | `runAllocation` claims the payout in `processedStripePayouts` *before* transferring, then loops with no per-item error handling. One transient Increase error strands every remaining donation permanently — the redelivered webhook is ignored as "already processed" and `retryStaleAllocations` is alert-only |
| Per-community kill switch exists | ☐ Not done | Only the app-wide `group-giving` flag ships. One church's incident cannot be contained without disabling giving for every community — unacceptable blast radius once more than one church is live (see §7.2) |
| Finance notifications exist (push + email) | ☐ Not done | There are **no** notifications anywhere in finance — a finance admin learns an expense needs approval only by opening the app; an admin learns onboarding went live only by re-checking the screen. ADR-032 §2 explicitly promises "push + email when live" |
| No UI claims an unenforced control | ☐ Not done | Card creation advertises limits that "reset every Monday" and a "Require receipts" toggle, and the hub says charges over $200 need a second approver — none of which exist for card spend. Shipping copy that overstates financial controls to a church is a trust and liability problem, not a polish issue |
| Group leaders cannot self-escalate to `finance_admin` | ☐ Not done | `requireFundRoleOrGroupLeader` returns early for any active group leader regardless of `minRole`, so a leader can grant themselves `finance_admin`, issue themselves a card, and spend the fund — and can defeat the two-approver rule by granting `manager` to a second account they control |
| Card spend limits enforced at the bank | ☑ Fixed on `finance/card-controls-truth` | **The "advisory only" premise in `cards.ts` was simply wrong.** Increase supports declarative per-card limits via `authorization_controls.usage.multi_use.spending_limits` and "enforces these controls at authorization time without a round trip to your server" ([launch-a-card-program](https://increase.com/documentation/launch-a-card-program)) — no real-time-decisioning webhook required. `createCard` was posting only `{account_id, description}`, so every stored limit was dead data while the UI advertised it as enforced. Limits now reach the bank at provisioning and on change. Intervals reset at UTC midnight (`per_week` Mondays, `per_month` the 1st) — surface that in any copy stating a reset day |
| Backfill limits onto cards provisioned before the fix | ☐ Not done | Cards already issued carry limits Increase never received, and the bank will not enforce them retroactively. Interim signal is the `card.limit_exceeded` audit raised at settlement. Any card issued before this fix must be re-provisioned or cancelled before real money |
| Reimbursement ACH payout destination wired up | ☐ Not done | `expenses.ts`'s `getPayoutDestination` **returns `null` unconditionally** — every reimbursement blocks at "no destination found" until the member bank-linking UI ships |
| Nightly reconcile shows zero drift for at least one production community over a real billing cycle | ☐ Not started | Proves the ledger-vs-bank invariant actually holds outside the smoke test |
| Counsel sign-off on `docs/finance/COMPLIANCE.md`'s open items (esp. charitable solicitation registration, FBO framing) | ☐ Open | Regulatory exposure, not a technical gap |
| Increase's answer to §3's beneficial-ownership-exemption question, in writing | ☐ Open | Determines whether `createEntity`'s production path is even usable as coded |

---

## 7. Rollback

If something goes wrong after the first real dollar moves in production:

1. **Freeze first, investigate second.** Use `setCardFrozen` /
   `updateCardStatus` (Increase `PATCH /cards/{id}` → `"disabled"`) on any
   affected card immediately — this is reversible and doesn't require
   understanding the root cause yet.
2. **Community-level fund freeze — does not exist.** `onboarding.ts`'s
   `freezeFundForArchivedGroup` is an `internalMutation` reachable only by
   archiving a group; there is no admin "freeze this community's giving"
   action. There is also **no per-community flag**: ADR-032 §6 proposed
   `churchFeatures.givingEnabled`, but it was never built. The only switch
   shipped is the single app-wide `group-giving` flag
   (`apps/convex/lib/finance/flag.ts`), so the sole application-layer stop
   is **all-or-nothing across every community** — you cannot contain one
   church's incident without taking giving away from all of them. With more
   than one pilot church live that is an unacceptable blast radius, so a
   per-community kill switch is a **go-live blocker, not a nicety**. Note
   too that freezing a fund does not stop its cards (`card_capture` is in
   `FROZEN_ALLOWED_KINDS` in `lib/finance/ledger.ts`) — cards are bank
   objects and must be disabled at Increase. Alongside that, pause outbound
   transfers by not
   running the allocation/reimbursement crons for that community (they're
   global crons today — see `functions/finance/jobs.ts`'s
   `registerFinanceCrons` — so a targeted pause needs a manual code change or
   a per-community skip list; **this is a gap to close before go-live**, not
   after).
3. **Do not delete or edit `ledgerEntries` or `financeAuditEvents` rows** —
   both are documented as append-only in `docs/finance/COMPLIANCE.md` and
   `functions/finance/ARCHITECTURE.md`. Corrections are new entries (e.g. a
   `transfer`/`sweep` reversal), never edits, or the audit trail becomes
   worthless exactly when it matters most.
4. **Increase-side dispute/reversal**: for a card transaction, use Increase's
   card dispute flow (`/documentation/card-disputes`); for an ACH transfer,
   an `ach_transfer` reversal if within the return window
   (`/documentation/ach-reversals`) — **confirm current procedures and
   deadlines directly with Increase**, since ACH return windows are
   time-boxed and not something to look up after the fact.
5. **Nightly reconcile is the tripwire, not the fix.** `runNightlyReconcileAllCommunities`
   will flag ledger-vs-bank drift as `financeAuditEvents` with
   `action: "reconcile.drift"` — but per `docs/finance/COMPLIANCE.md`,
   alerting to ops on that drift is itself an open item ("OPEN ITEM: add
   monitoring/notification to alert ops team on drift"). **Wire up an actual
   alert (Sentry/Slack/PagerDuty) before go-live** — a silent drift log is not
   a rollback mechanism.
6. **Post-incident**: write up what happened as a new `financeAuditEvents`-adjacent
   record (or at minimum a dated note in this file / a new ADR amendment) —
   per CLAUDE.md's "Remove, Don't Deprecate" / "Document Complexity"
   guidance, don't let the incident just live in someone's memory.

---

## Sources

- Increase documentation (fetched 2026-07-31):
  [`/documentation/platform-implementation`](https://increase.com/documentation/platform-implementation),
  [`/documentation/compliance-overview`](https://increase.com/documentation/compliance-overview),
  [`/documentation/compliance-programs`](https://increase.com/documentation/compliance-programs),
  [`/documentation/customized-compliance`](https://increase.com/documentation/customized-compliance),
  [`/documentation/managed-compliance`](https://increase.com/documentation/managed-compliance),
  [`/documentation/programs`](https://increase.com/documentation/programs),
  [`/documentation/entities`](https://increase.com/documentation/entities),
  [`/documentation/entity-validation`](https://increase.com/documentation/entity-validation),
  [`/documentation/hosted-onboarding`](https://increase.com/documentation/hosted-onboarding),
  [`/documentation/sandbox`](https://increase.com/documentation/sandbox),
  [`/documentation/webhooks`](https://increase.com/documentation/webhooks),
  [`/contact`](https://increase.com/contact)
- Internal: `docs/architecture/decisions/ADR-032-group-giving.md`,
  `docs/finance/COMPLIANCE.md`, `apps/convex/lib/finance/increase.ts`,
  `apps/convex/functions/finance/onboarding.ts`,
  `apps/convex/functions/finance/expenses.ts`,
  `apps/convex/functions/finance/ARCHITECTURE.md`, `docs/secrets.md`,
  `ee/secrets-allowlist.json`, `ee/scripts/sync-secrets-to-convex.sh`
