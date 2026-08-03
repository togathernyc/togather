# ADR-033: Bring-Your-Own-Cards — a card-provider adapter

## Status

Accepted (2026-08). Phases 0–3 implemented; Phase 4 (provider switching) open.

Extends [ADR-032: Group Giving, Spending, Receipting & Reimbursements](./ADR-032-group-giving.md),
which remains the design of record for the money model (funds, ledger,
allocation, receipts). This ADR changes only *who issues the cards* and *who
is allowed to set that up*.

## Context

ADR-032 put one banking provider behind everything: Increase. One Entity per
community, one Account per fund, and a virtual card bound to a fund's Account.
That is a genuinely good topology — the bank enforces spend segregation, so a
card physically cannot overdraw its fund or reach another fund's money — and
nothing here proposes giving it up.

What it also does is make Increase a hard dependency of the product. Three
pressures push against that:

1. **Increase is a program-level relationship we underwrite once, for
   everyone.** A community that already has a card program (Privacy, Bill,
   a bank they like) has to abandon it to use group spending, and a community
   Increase won't onboard cannot use group spending at all.
2. **Some churches must keep their own vendor relationship** for policy or
   audit reasons. "Togather holds the banking relationship" is a feature for
   most and a blocker for a few.
3. **Increase's own availability is a single point of failure** for a feature
   that touches real money.

Meanwhile the code had drifted into an accidental shape that made this cheap
to fix: everything *above* the provider call was already provider-neutral.
The queries, the mutations, the mobile screens all talk about a card with a
holder, a status, and a limit. Only **four** places named Increase at all —
three `internalAction`s in `functions/finance/cards.ts` and
`recordCardSettlement` in `functions/finance/webhooks.ts`.

A second, separable problem surfaced while scoping this. Connecting a card
issuer means handing Togather an API key that can move a church's money.
Today the only precedent for storing third-party credentials is
`communityIntegrations`, which stores them **in plaintext**, and the only
permission gate on community-level finance is `isCommunityAdmin` — the same
role that lets a volunteer add a channel. Neither is adequate for a
spending credential.

### Considered and rejected

- **Do nothing; stay Increase-only.** Cheapest, and correct if no community
  ever needs otherwise. Rejected because the blockers above are already real,
  and the seam costs one week now versus a rewrite later.
- **Abstract the whole banking layer** (accounts, transfers, ACH, cards).
  Rejected: the money model *depends* on Increase's account topology (ADR-032
  §1), and no BYOC issuer offers it. Abstracting the part we can't replace
  would be a false promise. Cards are separable; banking is not.
- **A per-provider branch inside `cards.ts`.** Rejected: three `if`s today,
  fifteen at three providers, and every new gate must remember all of them.
  An interface makes "did you handle every provider?" a type error.
- **Reuse `communityIntegrations` for credentials.** Rejected outright — see
  §3.

## Decision

### 1. The model

A community picks a **card provider**. Increase stays the default and the
reference implementation; a community may instead **bring their own** account
at a supported issuer.

```
communityFinance.cardProvider : "increase" | "privacy" | "bill" | "none"
```

Absent means "never chosen", which resolves to `"increase"` **when the
community already has Increase objects** — which is every community that
exists today. That default is a migration, not a guess: rather than backfill
a column on every row and risk missing one, the absence is read against the
fact that already distinguishes them (`increaseEntityId`). A community with
neither a stored choice nor an Increase Entity has genuinely not set up card
issuing, and gets a clear error instead of a silent Increase attempt that
would fail later and further from the cause. `"none"` is the explicit opt-out
for a community that takes giving but issues no cards — a *different fact*
from "not chosen yet", and the resolver refuses it rather than falling back.

Two topologies coexist:

- **Togather-issued (Increase).** Unchanged from ADR-032. One Account per
  fund; the bank enforces fund isolation; the card spends money we already
  hold.
- **Bring-your-own (BYOC).** The community holds the vendor relationship and
  gives us a credential. Their issuer has **one pooled balance**, not an
  account per fund, so fund attribution becomes *our* bookkeeping rather than
  the bank's guarantee. That difference is not hidden — it is declared, as
  `capabilities.hardFundIsolation: false`, and any surface that promises
  hard segregation must read it before promising.

**Recommended BYOC topology: a dedicated account.** A community bringing
their own issuer is strongly advised to open an account used *only* for
Togather group funds, rather than pointing us at the account that also runs
payroll and facilities. Without hard fund isolation, the pooled balance is
the blast radius: a compromised or mis-limited group card can reach every
dollar in that account. A dedicated account restores most of what ADR-032's
per-fund Accounts gave for free, using the one control the community actually
has — how much money sits in it. This is guidance we surface at connect time,
not something we can enforce.

### 2. The contract

`apps/convex/lib/finance/cardProviders/types.ts`:

```
CardProviderAdapter
  name           "increase" | "privacy" | "bill"
  capabilities   ProviderCapabilities
  createCard({ fundAccountRef, description, idempotencyKey, limit })
                                                       -> ProviderCard
  setCardState(providerCardId, "active"|"paused"|"closed")
                                                       -> ProviderCard
  setSpendLimit(providerCardId, NormalizedLimit | null) -> ProviderCard
  listTransactions?(cursor)                            -> ProviderTxnPage
  fetchTransaction?(providerTxnId)                     -> ProviderTxn | null
  forwardReceipt?(providerTxnId, receipt)              -> void
  registerWebhook?(notificationUrl)                    -> void
  checkConnection?()                                   -> { accountLabel }
  verifyWebhook?(payload, signature)                   -> boolean
```

The optional half grew as real issuers were added, and every one of them exists
because a provider could not be served without it: `fetchTransaction` for an
issuer whose webhooks carry no verifiable signature, `checkConnection` for a
credential a human pastes, `forwardReceipt` for the only issuer with a receipt
API. A caller MUST check for the method before calling it, and must gate on the
matching capability rather than on the method's presence — otherwise the first
provider to implement one before we wire it starts promising something.

Deliberately small. Anything the card module does not do today (physical
cards, merchant-category controls, real-time authorization decisioning) is
**absent** rather than optional-and-unimplemented — an interface that promises
what no adapter delivers is worse than one that has to grow.

`NormalizedLimit` is `{ limitCents, period: "week" | "month" | "charge" }`,
derived from the existing `cardPolicy` vocabulary rather than re-declared.
`null` means "no limit" and must be sent **explicitly**: Increase replaces the
whole controls object on `PATCH`, so omitting the field silently leaves the
old cap in place — a no-op on the one path (lowering or clearing a limit)
where silence is most expensive.

**Capabilities are declared, not discovered.** Every flag exists because two
real issuers disagree about it:

| Flag | Meaning | Increase |
| --- | --- | --- |
| `hardFundIsolation` | Provider enforces per-fund segregation at the bank | `true` |
| `weeklyLimits` | Native per-week spending limit | `true` |
| `cardCloseReversible` | A closed card can be reopened | `false` |
| `cardFreezeReversible` | A paused card can be un-paused | `true` |
| `webhooks` | `"all"` \| `"partial"` \| `"none"` | `"all"` |
| `declineFeed` | How we learn about declines | `"webhook"` |
| `maxCardsPerMonth` | Documented cap, or `null` | `null` |
| `repaymentVisibility` | `"n/a"` \| `"prefund"` \| `"statement"` | `"n/a"` |
| `maxCardsPerFund` | Live cards Togather allows per fund | `null` |
| `managedFundLimit` | Togather computes the cap from the fund's ledger | `false` |
| `receiptForwarding` | A receipt uploaded here also reaches the provider | `false` |

The last three arrived with Phase 3 and answer differently at every provider,
which is the test each flag has to pass: `maxCardsPerFund` is `1` at Privacy
and `null` elsewhere; `managedFundLimit` is true at Privacy alone;
`receiptForwarding` at BILL alone.

Capabilities are ALSO published to the client, through a name-keyed
`describeProviderCapabilities` rather than the adapter object. Two reasons, and
they are the same reason: a query has no credential, so answering "can a closed
card be reopened?" must never cost a decrypt of a church's API key; and the
group-level surfaces are provider-anonymous, so the shape handed out contains
no field a future edit could widen into leaking the vendor's name. The
duplication is pinned by a test that loads every adapter and asserts the table
agrees.

A caller reads the flag and adapts; it never catches an error at the provider
boundary and guesses what it meant.

**Resolution** is `getCardProvider(ctx, communityId)` in
`lib/finance/cardProviders/index.ts`. Adapters are imported lazily, so a
community on provider A never fails because provider B's key is unset in this
deployment. Actions (which have no `ctx.db`) resolve the *name* inside the
`internalQuery` they already run and pass it to `getCardProviderByName`.

**Status vocabulary.** The adapter speaks a normalized `CardState` —
`pending | active | paused | closed | failed` — and every provider maps onto
it. `cards.status` **in the database still stores the legacy Increase
strings** (`active` / `disabled` / `canceled`). This is deliberate and
smallest-safe: mobile's `CardStatus` union is pinned to those strings and
every production card row already holds them, so changing the stored
vocabulary means a data migration *plus* a coordinated mobile release —
a bigger and riskier change than the seam itself needs. The adapter therefore
returns **both** `state` (normalized) and `providerStatus` (verbatim), and
`cards.ts` persists the latter. Phase 1 migrates the column. New code reads
`state`; nothing should add a new consumer of the raw string.

**Increase-semantic code moved into the Increase adapter**:
`LIMIT_PERIOD_TO_INCREASE_INTERVAL` and `cardLimitWindowStart` (whose
UTC-anchored windows are Increase's own reset rules, not a shared policy).
`validateCardLimit` stayed shared — "a limit is whole positive cents and not
a slipped decimal" is a Togather rule every provider inherits.

### 3. Credentials

New table `cardProviderConnections`, with credentials under **envelope
encryption**: AES-256-GCM via Web Crypto, a fresh 96-bit IV per encryption, a
master key from `CREDENTIALS_MASTER_KEY` (base64, 32 bytes), and a
`keyVersion` stamped on every ciphertext so rotation is decrypt-with-old /
encrypt-with-new, row by row, with no flag day.

`communityIntegrations` is **not** reused. It stores its tokens in plaintext,
and a key on this table can move a church's money. GCM's authentication tag
means a tampered ciphertext *fails to decrypt* rather than returning garbage
— the property that lets a caller treat a successful decrypt as "this is
exactly what we stored". Decryption throws on every failure mode (wrong key,
tampered bytes, unknown version); there is deliberately no "returns null"
variant to accidentally ignore.

Every ciphertext is additionally **bound to its row** through GCM's additional
authenticated data: `(communityId, provider, purpose)`, all immutable for the
life of the row. Authenticity alone is not enough here — a valid ciphertext
lifted from another row by a mis-scoped query, a bad update, or a restored
backup would decrypt perfectly, and community A would start spending with
community B's credential without anything having failed. The binding upgrades
a successful decrypt from "this is what we stored" to "this is what we stored
*here*". `purpose` separates the API key from the webhook secret so the two
cannot be swapped for each other. Editable fields (`accountLabel`, `status`)
are deliberately excluded: binding to one would make a rename undecryptable.

`webhookSecretCiphertext` covers issuers that mint a per-endpoint signing
secret at connect time. `syncCursor` / `lastSyncAt` belong to the pull-based
providers, where a poll has to remember where it stopped.

### 4. Schema (additive only)

```
cardProviderConnections  communityId, provider: "privacy" | "bill",
                         credentialCiphertext, credentialIv, keyVersion,
                         accountLabel?, status: "active"|"error"|"revoked",
                         webhookSecretCiphertext?, webhookSecretIv?,
                         syncCursor?, lastSyncAt?, lastError?,
                         connectedById, createdAt, updatedAt
                         index by_community

communityFinanceRoles    communityId, userId, role: "finance_admin",
                         grantedBy, grantedAt, revokedAt?
                         indexes by_community, by_user_community

cards                    + provider?, providerCardId?
                         + index by_provider_cardId
                         (increaseCardId and by_increaseCardId untouched)
                         Phase 3 adds NO column: a managed card's
                         {managedLimit, manualCapCents?} lives in the existing
                         `controls: v.any()` bag, and its lifetime window is
                         expressed by `limitPeriod` being ABSENT.

communityFinance         + cardProvider?: "increase"|"privacy"|"bill"|"none"
```

Nothing is renamed and nothing is dropped. `increaseCardId` keeps being
written for Increase cards because it is still the lookup key for the live
`transaction.created` settlement webhook; Phase 1 moves those readers to
`by_provider_cardId` and only then retires the column.

`by_provider_cardId` carries the same trap as
`recurringDonations.by_stripeSubscriptionId`: both fields are optional, so
every legacy card shares the missing value on that index. Readers **must**
guard on non-empty values before querying it.

### 5. Roles and visibility

Two different questions have been answered by the same check until now:

> "Can this person run the community?" → `isCommunityAdmin`
> "Can this person run the community's **money**?" → also `isCommunityAdmin`

This ADR separates them. A church may have several community admins — a
volunteer who manages groups, a comms lead who edits branding — and none of
that implies authority to connect a card issuer, submit the church's EIN, or
turn giving on for a group. Being able to add a channel should not carry the
ability to hand a vendor a spending credential.

The rule at **community-level** finance surfaces:

> **primary admin (implicit, always)  OR  an active `communityFinanceRoles` row**

The primary admin's power is **implicit** — deliberately not a seeded row.
Nothing to migrate when this ships, and no sequence of revokes can lock a
community out of its own finances. Only the primary admin grants or revokes;
not a plain admin, and **not a holder of the role** — otherwise the first
grantee could mint peers, and the role would decay back into "community admin
with extra steps". A grantee must already be a community admin: this is an
extra key on top of admin, never a way to give finance power to someone with
no standing in the community.

That standing is re-checked at USE time, not only at grant time.
`canManageCommunityFinance` requires an active row **and** current
community-admin standing, because nothing revokes the finance row when someone
is later demoted to member — the role-management mutations only patch
`userCommunities.roles`. Evaluating it where the access is used means no
future demotion path can forget to call us.

**Surfaces tightened in Phase 0** (`isCommunityAdmin` → `canManageCommunityFinance`):

- `functions/finance/onboarding.ts` — `startOnboarding`, `retryProvisioning`,
  `getOnboardingStatus`, `enableGroupGiving`, `assertAdminAndGetFinance`
  (the gate behind `getStripeOnboardingLinkUrl`).
- `functions/finance/roles.ts` — `getMyFundRole`'s third access signal, which
  mobile uses to unlock the community-wide finance surfaces. The returned
  field is renamed `isCommunityAdmin` → `canManageCommunityFinance`. The
  fund-level override is returned ALONGSIDE it as
  `hasCommunityAdminFundOverride`, not folded into it: a plain community admin
  gets different answers to "can run the money" and "can act on this fund",
  and collapsing them would make mobile hide controls the server still
  authorizes. Mobile picks per surface, and never approximates either from
  `user.is_admin` — that flag is scoped to the viewer's *active* community,
  not the fund's.
- Provider connection (Phase 1) will gate here from the start.

**Not tightened in Phase 0; tightened in Phase 3.** Phase 0 deliberately left
fund-level access alone — `requireFundRole` / `requireFundRoleOrGroupLeader` in
`lib/helpers.ts` still let any community admin through a fund gate, and
`fundRoles` was untouched. Phase 3 then moved the three fund surfaces that are
not operations but APPOINTMENTS (`createFundCard`, `grantFundRole`,
`revokeFundRole`) to this same community gate; see Phase 3 in §6 for why the
self-grant guard those relied on was never enough. The helpers themselves are
still unchanged, and every genuinely operational fund surface still runs
through them. Revoking is de-escalation and stays reachable with the
`group-giving` kill switch off, matching the card freeze/cancel carve-out in
`lib/finance/flag.ts`.

**Consequence, accepted:** a plain community admin who could reach finance
onboarding yesterday cannot today. That is the point. The primary admin can
restore it for any of them, and the audit trail records who did.

**Sequencing, and the one thing to watch.** Phase 0 shipped the grant
*mutations* (`functions/finance/communityRoles.ts`) but no grant *screen*, so a
grant had to be made through the Convex dashboard. That was safe only because
`group-giving` is a superuser kill switch that is OFF by default: with the flag
down nobody reaches these surfaces, so there was no one to lock out. **The
screen landed in Phase 3** (`FinancialControlsScreen`), which closes the gap —
and it had to, because Phase 3 also moved card issuing and fund-role grants
behind this same gate, which widens the set of people a missing screen would
strand from "community onboarding" to "anyone who used to issue a card".

The error copy still names the primary admin rather than the screen, which is
now a choice rather than a constraint: the person hitting the refusal cannot
reach the screen either (only the primary admin can grant), so pointing them at
it would send them somewhere they can only read.

### 6. Phases

**Phase 0 — foundations (this change).** Envelope encryption; the two new
tables and the additive `cards` / `communityFinance` columns; the adapter
interface and resolver; the Increase adapter; `cards.ts` refactored onto it;
the community finance role and the gate tightening. **No behaviour change for
any existing community** — every community resolves to Increase and every
card path runs the same provider calls with the same payloads.

**Phase 1 — the first BYOC adapter.** Connect flow (credential capture →
`encryptCredential` → `cardProviderConnections`), webhook route and signature
verification for the new issuer, `listTransactions` polling for whatever it
does not push, and the settlement path moved from `increaseCardId` onto
`by_provider_cardId`. Migrate `cards.status` to the normalized vocabulary
alongside a mobile release. Surface the dedicated-account guidance at connect
time.

**Phase 2 — the second BYOC adapter (BILL Spend & Expense).** One BILL budget
per fund, cardholders matched by email against BILL's own user directory,
fetch-to-verify on an unsigned webhook, and the hourly transaction poll that
backstops both BYO providers.

**Phase 3 — the fund boundary, the gate, and the screens.** Four changes that
had to land together, because each of the first three is what makes the fourth
safe to put in front of a church.

*Groups OPERATE, community finance ADMINISTERS.* `createFundCard`,
`grantFundRole` and `revokeFundRole` moved from fund gates to
`requireCommunityFinanceAccess`. §5 separated "can run the community" from "can
run its money"; this closes the other half of the same hole. ADR-032 §4 let a
group leader grant a finance role on their own fund, guarded only against
naming *themselves* — but two leaders of one group could grant each other, and
at a BYO provider the card that grant produces spends the CHURCH's pooled
account rather than a per-fund one the bank keeps separate. The whole ladder
ran inside one group with nobody outside it in the loop. Everything
OPERATIONAL stays fund-scoped: cardholders use their cards, managers approve
reimbursements, leaders see the roster, balance and transactions, and
freeze/cancel keep their fund gate *and* their kill-switch exemption, because
de-escalation must never need a phone call to someone outside the group.
`revokeFundRole`'s "last finance_admin" guard is deleted rather than kept —
every caller is now a community finance holder, i.e. exactly the class the old
guard exempted, so it could only ever evaluate to "allowed", and a guard that
cannot fire reads as protection that isn't there.

*Managed lifetime limits.* The honest answer to `hardFundIsolation: false` at
Privacy. A per-card, per-PERIOD cap hands the card the fund's balance again
next month whether or not the fund was ever credited that much; Privacy's
`FOREVER` window is the one that never resets, which makes it usable as an
ACCUMULATOR rather than an allowance. The cap is recomputed from the fund's own
ledger as

```
L = lifetime CREDITS − non-card DEBITS
```

`card_capture` debits are excluded because the provider is already counting
that spend against the lifetime cap; subtracting here too would charge every
purchase twice. The consequence is the property the whole mechanism exists for:
`remaining at the provider == the fund's balance`. Two preconditions make the
number true and both are enforced — ONE live card per fund (`maxCardsPerFund`,
because the cap is per card and two cards would each carry the fund's whole
allowance), and every card charge reaching the ledger (it does; a missed one
errs *tighter*, never looser, because the provider still counted it). The sync
is scheduled from ONE seam, inside `postLedgerEntry`, rather than from the four
mutations that post entries — the next path someone adds gets it for free, and
the failure mode of forgetting is a card that quietly under-spends its fund
weeks later. It recomputes from the whole ledger every run, which is what makes
it idempotent and order-independent, and a failed push is left for the hourly
`finance-card-txn-poll` (which carries the resync AFTER its import, so it
computes against a current ledger). An admin may pin a LOWER cap
(`cards.controls.manualCapCents`); raising above the fund is refused with both
numbers, because "invalid" only makes someone try a slightly smaller one.

`NormalizedLimitPeriod` gains `"lifetime"` for the wire between `cards.ts` and
an adapter, and deliberately NOT for `cards.limitPeriod` — "resets weekly" and
"never resets" are not two settings of one control, so a managed card stores
the amount with no period and declares itself through `controls.managedLimit`.
An adapter that cannot express a lifetime cap THROWS rather than degrading:
every degradation of "never resets" is a window that does.

*Receipt forwarding.* `forwardReceipt` is added to the adapter interface and
implemented for BILL alone (its documented three-step upload), declared as
`capabilities.receiptForwarding`. Shipping it required the missing WRITE half
of ADR-032's receipt-nudge flow: `attachExpenseReceipt`, the mutation behind a
"No receipt" badge that had been rendering with nothing to set it, because a
card charge is created by the settlement webhook before anyone has the paper.
Forwarding is best-effort by contract — the receipt is already durable in
Togather and the church's books are complete without the copy at the issuer, so
a failure is an audit row and never undoes the attachment. Dedupe is a
staleness check rather than a marker column (`expenses` has no free-form field
and the schema is not being widened): one run is enqueued per attachment, and
the action stops unless `receiptKey` is still the key it was scheduled with.

*The screens.* The connect flow, the financial-controls grant screen §5's
sequencing note promised, and the capability-driven card copy — including the
fix for the `cardCloseReversible` TODO left in Phase 2, where a cancel dialog
said "this can't be undone" on a provider where it demonstrably can. Card
surfaces INSIDE a group are provider-ANONYMOUS: the community holds the vendor
relationship, a group's members did not choose it and cannot act on its name,
so they are told the behaviour ("you can reopen this from your provider") and
not the brand. The community-level settings screen names it, because that is
where the choice was made.

**Phase 4 — provider switching.** Move a community between issuers without
losing card history: close at the old provider, re-issue at the new one, keep
`cards` rows continuous through `provider` + `providerCardId`. Until it exists,
`saveCardProviderConnection` refuses a switch that would strand live cards.

## Consequences

- Communities blocked by the Increase-only dependency can use group spending;
  churches that must keep their own vendor relationship can. Increase stops
  being a single point of failure for the feature.
- Adding an issuer is now an adapter file plus a webhook route, and "did you
  handle every provider?" is a type error rather than a code review.
- We take on custody of third-party spending credentials. Envelope encryption
  and a narrowed permission gate are the mitigations; `CREDENTIALS_MASTER_KEY`
  becomes an operationally critical secret (losing it makes every stored
  credential unrecoverable — recoverable only by reconnecting each provider).
- Providers without `hardFundIsolation` move a real guarantee from the bank
  into our code. Phase 3's managed lifetime limit is what stands in for it at
  Privacy, and the dedicated-account recommendation is what bounds the rest.
  The substitution is honest but weaker in one named way: it is a cumulative
  cap, not a real-time authorization decision, so two charges racing before
  either settles are judged against the cap Privacy currently holds rather than
  against the fund. That is the conservative direction, and it is not the same
  thing as the bank refusing to let a card touch another fund's money.
- BILL has no equivalent: its per-fund container is a budget, which is a
  spending policy rather than segregated money, so `managedFundLimit` is false
  there and the budget's own cap is the boundary. A church on BILL is relying
  on a number it set in BILL, and the connect screen says so.
- `cards.status` now carries two vocabularies (normalized in the adapter,
  legacy in the database) until Phase 1. That is a documented seam with a
  named owner, not an accident.
- A plain community admin loses implicit finance access. Support burden is
  real but bounded, and it is the correct default.
