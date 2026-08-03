# ADR-033: Bring-Your-Own-Cards — a card-provider adapter

## Status

Accepted (2026-08). Phase 0 implemented.

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
```

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

**Surfaces tightened** (`isCommunityAdmin` → `canManageCommunityFinance`):

- `functions/finance/onboarding.ts` — `startOnboarding`, `retryProvisioning`,
  `getOnboardingStatus`, `enableGroupGiving`, `assertAdminAndGetFinance`
  (the gate behind `getStripeOnboardingLinkUrl`).
- `functions/finance/roles.ts` — `getMyFundRole`'s third access signal, which
  mobile uses to unlock the community-wide finance surfaces. The returned
  field is renamed `isCommunityAdmin` → `canManageCommunityFinance`.
- Provider connection (Phase 1) will gate here from the start.

**Explicitly NOT tightened.** Fund-level access is unchanged:
`requireFundRole` / `requireFundRoleOrGroupLeader` in `lib/helpers.ts` still
let any community admin through a fund gate, and `fundRoles` is untouched.
Nothing an admin could do on a *specific fund* stopped working — only the
community-wide surfaces moved. Revoking is de-escalation and stays reachable
with the `group-giving` kill switch off, matching `revokeFundRole` and the
card freeze/cancel carve-out in `lib/finance/flag.ts`.

**Consequence, accepted:** a plain community admin who could reach finance
onboarding yesterday cannot today. That is the point. The primary admin can
restore it for any of them in two taps, and the audit trail records who did.

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

**Phase 2 — pooled-balance attribution.** The bookkeeping that stands in for
`hardFundIsolation` when a provider lacks it: per-fund allocation against a
pooled balance, over-attribution detection, and the reconcile invariant
re-stated for a topology where the bank cannot enforce it.

**Phase 3 — provider switching.** Move a community between issuers without
losing card history: close at the old provider, re-issue at the new one, keep
`cards` rows continuous through `provider` + `providerCardId`.

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
  into our code. Phase 2 is not optional before shipping such a provider, and
  the dedicated-account recommendation is what bounds the risk meanwhile.
- `cards.status` now carries two vocabularies (normalized in the adapter,
  legacy in the database) until Phase 1. That is a documented seam with a
  named owner, not an accident.
- A plain community admin loses implicit finance access. Support burden is
  real but bounded, and it is the correct default.
