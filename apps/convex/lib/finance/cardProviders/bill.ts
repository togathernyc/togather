/**
 * The BILL Spend & Expense card-provider adapter (ADR-033 Phase 2) — the
 * second BRING-YOUR-OWN issuer, and the first one whose model does not line up
 * with ours field for field.
 *
 * Privacy.com was a flat account: create a card, give it a limit, done. BILL
 * has a middle layer — a BUDGET — that every card must live inside, and that
 * layer is where the mapping decisions are. All five are here, at the top,
 * because each one is a trade a reviewer should be able to disagree with:
 *
 * 1. **ONE BUDGET PER FUND**, named `"<fund> · Togather"`. A fund is the unit
 *    of money in Togather and a budget is the unit of money in BILL, so this is
 *    the only mapping where a church's BILL dashboard tells the same story as
 *    their Togather one.
 *
 * 2. **The budget is found BY NAME, and created if missing.** There is nowhere
 *    to persist a `fundId -> budgetUuid` map without a schema change, and
 *    ADR-033's phase discipline says no schema change here. The cost is a real
 *    hazard, stated plainly: IF A CHURCH RENAMES THE BUDGET IN BILL, the lookup
 *    misses and we create a second one. Nothing breaks and no money moves
 *    wrongly — new cards simply land in a fresh budget while old cards keep
 *    spending from the old one, splitting that fund's history in BILL. It is
 *    logged loudly (`[BillAdapter] created budget …`) precisely so the support
 *    answer is "someone renamed it, rename it back or accept the split".
 *
 *    A SECOND, NARROWER WAY TO SPLIT THE SAME HISTORY: two cards provisioned
 *    for the SAME fund concurrently both miss the lookup and both create a
 *    budget, because there is no `fundId -> budgetUuid` row to take a lock on
 *    and BILL does not reject a duplicate budget name. Every later card then
 *    resolves to whichever one the list returns first. Same blast radius as the
 *    rename (split history, no misdirected money) and the same loud log names
 *    it. The real fix is the persisted mapping a later phase's schema change
 *    brings, which closes both at once — not a retry loop here, which would
 *    still race. The THIRD way, a lookup that gave up mid-list, is refused
 *    outright in `findOrCreateBudget` rather than allowed to split silently.
 *
 * 3. **Cards carry their OWN limit; `shareBudgetFunds` is always false.** The
 *    card limit is the only per-card control BILL offers, so it is Togather's
 *    enforcement lever. Sharing budget funds would let one card spend the whole
 *    fund, which is precisely the control the finance admin thought they set.
 *
 * 4. **"Closed" is a freeze plus a rename.** BILL has NO close/terminate
 *    endpoint (docs/virtual-cards documents freeze and unfreeze and nothing
 *    else). So `closed` means: freeze the card, and rename it with a
 *    `" · closed"` suffix so the church's own BILL dashboard says what
 *    happened. `cardCloseReversible` is TRUE and honest about it — this is a
 *    strong freeze, not a destruction, and the UI copy must not promise
 *    otherwise.
 *
 * 5. **Cardholders are matched to BILL users BY EMAIL, never created.**
 *    Creating a BILL user takes personal details (and, for some roles, a date
 *    of birth) that Togather has no business collecting on someone's behalf.
 *    No match is a legible error telling the finance admin to invite that
 *    person in BILL first.
 *
 * TWO MORE FACTS THAT SHAPE EVERYTHING BELOW:
 *
 * - **BILL cards are a CHARGE CARD against the org's shared credit line.**
 *   There is no per-fund pot of money at the bank, so `hardFundIsolation` is
 *   false — the same posture as Privacy, for a different reason. Repayment and
 *   bank accounts are not in the API at all (`repaymentVisibility:
 *   "in_product"`).
 * - **Webhooks carry no verifiable signature.** `verifyWebhook` is therefore
 *   NOT implemented; `fetchTransaction` is, and the route uses it to re-read
 *   every notification from the API before booking a cent. See
 *   lib/finance/bill.ts's `getBillTransaction`.
 *
 * Every API fact was confirmed against developer.bill.com on 2026-08-03. What
 * a live sandbox or the founder's church token would still settle is listed on
 * `BILL_UNVERIFIED_BEHAVIOURS` at the bottom of this file.
 */

import {
  BILL_MAX_PAGE_SIZE,
  billClient,
  billUuid,
  centsToDollars,
  createBillBudget,
  createBillCard,
  createBillWebhookSubscription,
  dollarsToCents,
  exactUsdCents,
  freezeBillCard,
  getBillCurrentUser,
  getBillTransaction,
  listBillBudgets,
  listBillTransactions,
  listBillUsers,
  unfreezeBillCard,
  updateBillCard,
  type BillBudget,
  type BillCard,
  type BillClient,
  type BillTransaction,
} from "../bill";
import type {
  CardProviderAdapter,
  CardState,
  CardStateRequest,
  NormalizedLimit,
  ProviderCapabilities,
  ProviderCard,
  ProviderTxn,
  ProviderTxnPage,
} from "./types";

// ============================================================================
// Budgets
// ============================================================================

/** The suffix that marks a budget as ours inside the church's own BILL account. */
export const BILL_BUDGET_SUFFIX = " · Togather";

/**
 * The budget name for a fund. This string IS the mapping key (decision 2
 * above), so it is a function rather than an inline template — one definition,
 * used by both the lookup and the create.
 */
export function billBudgetName(fundName: string): string {
  return `${fundName.trim()}${BILL_BUDGET_SUFFIX}`;
}

/** The rename suffix that stands in for a close (decision 4 above). */
export const BILL_CLOSED_SUFFIX = " · closed";

/**
 * Pages of budgets walked when looking one up. 10 x 50 = 500 budgets, which is
 * far past any church's fund count and well inside the 60-calls-per-minute
 * token budget.
 */
const BILL_BUDGET_MAX_PAGES = 10;

/** Same reasoning, for the user directory. */
const BILL_USER_MAX_PAGES = 20;

// ============================================================================
// Limits
// ============================================================================

/**
 * Our normalized limit -> BILL's card fields.
 *
 * BILL card limits are a plain AMOUNT plus an optional recurrence; there is no
 * per-week and no per-transaction window (the budget owns the period, and it
 * is per-budget, not per-card). So:
 *
 * - `month`  -> a recurring limit, which is the one period that maps cleanly
 *               onto the MONTHLY budget interval we create budgets with.
 * - `week`   -> the same NUMBER as a NON-recurring cap. Stricter than asked,
 *               never looser: the card stops at a week's worth of spend and
 *               stays stopped until someone tops it up, rather than silently
 *               being handed four weeks of runway. `weeklyLimits: false` is
 *               what the UI reads to disclose this.
 * - `charge` -> likewise. BILL cannot cap a single authorization, so a
 *               "$200 per charge" card becomes a $200 card. Same direction of
 *               error, same disclosure.
 *
 * `null` (no limit) becomes `shareBudgetFunds: true` — the card draws the whole
 * budget, which is BILL's only expression of "uncapped". Stated EXPLICITLY
 * rather than by omission, because omitting fields on a PATCH leaves whatever
 * the card already had.
 *
 * UNREACHABLE FROM THE APP, exactly as Privacy's equivalent branch is: BILL has
 * no hard fund isolation, so `requiresSpendLimit("bill")` is true and
 * `createFundCard` / `setCardLimit` refuse to make an uncapped card. This
 * branch is the adapter honouring its own contract ("no limit must be stated
 * explicitly"), not a path anything takes.
 *
 * Likewise `week`: `supportsWeeklyLimits("bill")` is false, so the gate refuses
 * a weekly limit before it reaches here rather than letting a card say
 * "/ week" while capping a flat amount. The mapping below stays because the
 * adapter must still answer honestly if it is ever handed one — the refusal
 * lives at the gate, not in two divergent copies.
 */
export function toBillCardLimit(limit: NormalizedLimit | null): {
  limit?: number;
  shareBudgetFunds: boolean;
  recurring: boolean;
} {
  if (!limit) {
    return { shareBudgetFunds: true, recurring: false };
  }
  return {
    limit: centsToDollars(limit.limitCents),
    shareBudgetFunds: false,
    recurring: limit.period === "month",
  };
}

/** True when the requested period cannot be expressed natively — the caller may want to disclose it. */
export function isDegradedBillLimitPeriod(
  period: NormalizedLimit["period"],
): boolean {
  return period !== "month";
}

// ============================================================================
// States
// ============================================================================

/**
 * BILL's card `status` -> our vocabulary.
 *
 * An UNRECOGNIZED status maps to `failed`, matching both other adapters and for
 * the same reason: guessing "active" is the dangerous direction.
 */
export function billStatusToCardState(status: string): CardState {
  switch (status.toUpperCase()) {
    case "ACTIVATED":
    case "ACTIVE":
      return "active";
    case "FROZEN":
      return "paused";
    case "TERMINATED":
    case "CLOSED":
    case "CANCELED":
    case "CANCELLED":
      return "closed";
    case "PENDING":
    case "REQUESTED":
      return "pending";
    default:
      return "failed";
  }
}

function toProviderCard(card: BillCard, fallbackId?: string): ProviderCard {
  const id = billUuid(card) ?? fallbackId ?? "";
  const status = card.status ?? "";
  return {
    providerCardId: id,
    // BILL spells it `lastFour`, not `last_four` — reading the wrong one gets
    // `undefined` and a card that renders as "Groceries •••• ".
    last4: card.lastFour,
    state: billStatusToCardState(status),
    providerStatus: status,
  };
}

// ============================================================================
// Transactions
// ============================================================================

/**
 * BILL transaction -> our `ProviderTxn`.
 *
 * **Only `CLEAR` is settled.** BILL updates the SAME uuid from `AUTHORIZATION`
 * to `CLEAR` on settlement, so an authorization is genuinely the same object
 * in an earlier state — recording it would double-book the moment it clears.
 * `DECLINE` is `declined`; anything else (`OTHER`, or a type BILL adds later)
 * is `pending`, because booking money on a status we don't understand is the
 * one failure with no cheap recovery.
 *
 * **Sign is carried, not stripped.** A reversal or refund arrives as a negative
 * amount, which is exactly `ProviderTxn`'s stated convention ("positive cents
 * SPENT, a refund/credit is negative"). Phase 1's recorder deliberately skips
 * negatives — reversing an expense is real work owned by the expense module —
 * so normalizing it correctly now means that day this function doesn't move.
 *
 * **Amount comes from the exact minor-unit string when it can.** See
 * `exactUsdCents`: BILL's float dollars are lossy at the cent, and a foreign
 * charge's minor-unit string is not USD. This picks whichever is right.
 */
export function normalizeBillTransaction(txn: BillTransaction): ProviderTxn {
  const exact = exactUsdCents(txn.currencyData);
  const amountCents = exact ?? dollarsToCents(txn.amount ?? 0);

  // `occurredTime` is when the swipe happened, which is the date a church
  // recognizes on a receipt. `updatedTime` is our cursor field, not our date.
  const occurredAtMs = Date.parse(txn.occurredTime ?? txn.updatedTime ?? "");

  return {
    providerTxnId: txn.uuid ?? "",
    providerCardId: txn.cardUuid ?? "",
    amountCents,
    // `merchantName` is BILL's cleaned-up name ("Amazon"); `rawMerchantName`
    // is the network descriptor ("AMZN Mktp US"). Prefer the readable one and
    // fall back, because a blank description on an expense is useless.
    merchantName: txn.merchantName ?? txn.rawMerchantName ?? null,
    // A decline reason is the one piece of free text worth carrying: it is what
    // makes a declined-card notification actionable in Phase 3.
    description: txn.declineReason ?? null,
    occurredAtMs: Number.isNaN(occurredAtMs) ? Date.now() : occurredAtMs,
    state: billTxnState(txn.transactionType ?? ""),
  };
}

function billTxnState(transactionType: string): ProviderTxn["state"] {
  switch (transactionType.toUpperCase()) {
    case "CLEAR":
      return "settled";
    case "DECLINE":
      return "declined";
    case "AUTHORIZATION":
      return "pending";
    default:
      return "pending";
  }
}

/**
 * How far back a FIRST poll looks when the connection has no cursor yet.
 *
 * Seven days, matching the Privacy adapter and for the same reason: a freshly
 * connected BILL account may hold years of the church's own pre-Togather
 * spending, none of which belongs to a card this app issued.
 */
export const BILL_INITIAL_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Pages walked per poll. 20 x 50 = 1,000 transactions an hour.
 *
 * The cap is a RATE-LIMIT budget as much as a work budget: BILL allows 60 calls
 * per minute per token, and this poll must leave room for the card operations a
 * finance admin is doing at the same time.
 */
const BILL_TXN_MAX_PAGES = 20;

// ============================================================================
// Capabilities
// ============================================================================

/**
 * BILL Spend & Expense's capability profile. Every value is a claim about the
 * vendor, checked against their docs (2026-08-03), not assumed.
 */
export const BILL_CAPABILITIES: ProviderCapabilities = {
  // Cards are a charge card against the ORGANIZATION's shared credit line.
  // A budget is a spending policy, not a segregated pot — so the bank cannot
  // enforce a fund boundary and the ledger has to.
  hardFundIsolation: false,
  // Card limits are a plain amount; only the BUDGET has a period, and it is
  // per-budget rather than per-card. See toBillCardLimit.
  weeklyLimits: false,
  // TRUE, and the word is doing work: there IS no close at BILL. "Closed" is
  // freeze + rename, and a freeze is reversible — so the honest answer is true
  // and the UI must not promise an irreversible destruction it cannot perform.
  cardCloseReversible: true,
  cardFreezeReversible: true,
  // Subscriptions are PRODUCTION-ONLY (sandbox offers a test endpoint and no
  // real deliveries), so a staging deployment is poll-only. "partial" is also
  // the truthful answer for production: the transaction event pushes, card
  // status changes do not.
  webhooks: "partial",
  // A DECLINE is a transaction row like any other; nothing distinct pushes for
  // it, and the poll is where we see them.
  declineFeed: "poll",
  // No documented per-month card cap.
  maxCardsPerMonth: null,
  // A charge card billed on a cycle. Repayment, bank accounts and the credit
  // line are IN-PRODUCT ONLY — not in the API, so Togather can neither show nor
  // reconcile them.
  repaymentVisibility: "in_product",
};

/**
 * What a live BILL sandbox (or the founder's church token) would settle that
 * reading the docs cannot. Kept as data, next to the code it qualifies, so it
 * survives being copied into a PR description.
 */
export const BILL_UNVERIFIED_BEHAVIOURS = [
  "Whether POST /v3/subscriptions accepts the Spend & Expense apiToken, or requires the core API's devKey + sessionId (registration is best-effort for exactly this reason).",
  "Whether PATCH /v3/spend/cards/{uuid} accepts availableFunds on a card created with an explicit limit, or only on shareBudgetFunds cards.",
  "The exact status string a freshly created card comes back with (ACTIVATED is documented; a card awaiting activation may differ).",
  "Whether GET /v3/spend/users/current returns a company name we can use as the connection label.",
  "Whether GET /v3/spend/budgets' filters support name equality, which would replace the paged client-side match in findOrCreateBudget.",
] as const;

// ============================================================================
// The adapter
// ============================================================================

/**
 * Build an adapter bound to ONE community's BILL Spend & Expense token.
 *
 * A factory, not a singleton: the credential is the church's, decrypted per
 * call by the resolver (lib/finance/cardProviders/index.ts) and held only for
 * the life of this object. Nothing here writes it anywhere, and nothing here
 * puts it in an error message.
 */
export function createBillCardProvider(apiToken: string): CardProviderAdapter {
  const client = billClient(apiToken);

  return {
    name: "bill",
    capabilities: BILL_CAPABILITIES,

    async createCard(input) {
      // Order matters: resolve the HUMAN first. A missing BILL user is the one
      // failure a finance admin can act on, and finding it out before we have
      // created a budget means a failed attempt leaves nothing behind.
      const userUuid = await resolveBillUserByEmail(client, input.holderEmail);
      const budgetUuid = await findOrCreateBudget(
        client,
        input.fundName,
        input.limit,
      );

      const { limit, shareBudgetFunds } = toBillCardLimit(input.limit);
      const card = await createBillCard(client, {
        // The name a church admin sees in THEIR BILL dashboard. Already carries
        // the fund and the card's own name (cards.ts builds it) — they have
        // their own cards in this account and must tell ours apart at a glance.
        name: input.description,
        userId: userUuid,
        budgetId: budgetUuid,
        ...(limit !== undefined ? { limit } : {}),
        shareBudgetFunds,
      });

      const providerCard = toProviderCard(card);
      if (!providerCard.providerCardId) {
        // Without an id we cannot ever freeze, re-limit, or reconcile this
        // card, and a card row pointing at nothing is worse than a failure.
        throw new Error(
          "BILL created a card but returned no uuid — refusing to record a card Togather could never control again",
        );
      }
      return providerCard;
    },

    /**
     * Move a card to `state`.
     *
     * `closed` is the interesting one, and it is decision 4 in this file's
     * header: BILL has no close endpoint, so a close is a freeze plus a rename
     * that says so in the church's own dashboard. The rename is best-effort —
     * a card that is frozen but not renamed is cosmetically wrong, and failing
     * the whole close over cosmetics would leave a card LIVE that a finance
     * admin believes they just killed.
     */
    async setCardState(providerCardId, state) {
      const card = await applyBillCardState(client, providerCardId, state);
      const providerCard = toProviderCard(card ?? {}, providerCardId);

      if (state !== "closed") return providerCard;

      // OVERRIDE THE NORMALIZED STATE, AND ONLY THAT. It is load-bearing
      // rather than tidy.
      //
      // A closed BILL card and a paused one are both `FROZEN` at the vendor —
      // BILL has no word for what we just did, so `billStatusToCardState`
      // reads the response as `paused`. But `state` is what
      // `cardStateToStoredStatus` turns into `cards.status` at the write, and
      // `countLiveProviderCards` decides whether a card is still spending from
      // exactly that. Leaving it `paused` would store "disabled" — a live card
      // as far as the disconnect guard is concerned — and a church that closed
      // every card could never disconnect BILL without `force`.
      //
      // `providerStatus` is deliberately NOT touched: it stays BILL's own
      // `FROZEN`, verbatim, because that is literally what the card is at the
      // bank and the field's whole contract is to carry the vendor's word
      // unedited. The two together say the true thing — Togather considers
      // this card closed, BILL has it frozen — and
      // `capabilities.cardCloseReversible: true` is what stops the UI from
      // promising a destruction that never happened.
      return { ...providerCard, state: "closed" };
    },

    /**
     * Replace the card's spend limit.
     *
     * `availableFunds` is the CURRENT period's cap and `recurringLimit` is what
     * each future period gets; both are sent so a limit change is not silently
     * a one-period change. `null` means "no limit", which at BILL is
     * `shareBudgetFunds: true` — the card draws the budget. Sent explicitly,
     * because omission on a PATCH means "leave it alone".
     */
    async setSpendLimit(providerCardId, limit) {
      const { limit: dollars, shareBudgetFunds, recurring } =
        toBillCardLimit(limit);
      const card = await updateBillCard(client, providerCardId, {
        shareBudgetFunds,
        recurring,
        ...(dollars !== undefined
          ? { availableFunds: dollars, recurringLimit: dollars }
          : {}),
      });
      return toProviderCard(card, providerCardId);
    },

    /**
     * Pull transactions since `cursor`.
     *
     * THE CURSOR IS AN ISO `updatedTime`, not a page token. BILL's `nextPage`
     * tokens are valid within one walk and meaningless between polls, so each
     * run filters `updatedTime:gte:<cursor>`, sorts ASCENDING, and returns the
     * newest `updatedTime` it saw.
     *
     * `gte` is inclusive, so the boundary transaction is re-fetched every run.
     * Intended: `recordCardSettlement` is idempotent on the transaction uuid,
     * and one duplicate read beats a one-millisecond gap that drops a charge.
     *
     * `updatedTime` rather than `occurredTime` is what makes this a settlement
     * feed at all — a purchase that authorized last week and CLEARS today is
     * updated today, and an occurredTime cursor would have walked past it.
     *
     * IF THE BACKLOG EXCEEDS `BILL_TXN_MAX_PAGES`, the cursor does NOT advance
     * and the page comes back `truncated: true`. The next poll re-reads the
     * same window rather than skipping ahead, and `pollOneConnection` records
     * the stall as a visible error — an operator notices, instead of a hole in
     * a church's books that nobody does. Everything fetched is still recorded.
     *
     * THE CURSOR ALSO STOPS BELOW THE OLDEST STILL-CHANGEABLE TRANSACTION, the
     * same invariant the Privacy adapter holds. The reasoning transfers even
     * though the mechanism differs: an `AUTHORIZATION` is one we deliberately
     * did not record, and BILL turns it into a `CLEAR` by UPDATING THE SAME
     * uuid. In principle that bumps `updatedTime` and a plain high-water mark
     * would still catch it — but "BILL always bumps `updatedTime` on
     * settlement" is precisely the sort of vendor claim this integration lists
     * as unverified, and if it is ever false the settled charge is imported by
     * nothing at all. Holding below the oldest pending row costs one re-read
     * per poll and removes the assumption entirely.
     *
     * Held on `updatedTime`, NOT `occurredTime`: the cursor is a high-water
     * mark over `updatedTime`, and holding one field back while advancing on
     * another would leave exactly the gap this is meant to close.
     */
    async listTransactions(cursor: string | null): Promise<ProviderTxnPage> {
      const since =
        cursor ?? new Date(Date.now() - BILL_INITIAL_LOOKBACK_MS).toISOString();

      const collected: BillTransaction[] = [];
      let nextPage: string | undefined;
      let exhausted = false;

      for (let page = 0; page < BILL_TXN_MAX_PAGES; page++) {
        const result = await listBillTransactions(client, {
          filters: `updatedTime:gte:${since}`,
          sort: "updatedTime:asc",
          max: BILL_MAX_PAGE_SIZE,
          nextPage,
        });
        collected.push(...(result.results ?? []));
        nextPage = result.nextPage ?? undefined;
        if (!nextPage) {
          exhausted = true;
          break;
        }
      }

      const transactions = collected
        .map(normalizeBillTransaction)
        // A transaction with no uuid or no card cannot be recorded or routed;
        // dropping it here keeps the recorder from logging a mystery.
        .filter((txn) => txn.providerTxnId !== "" && txn.providerCardId !== "");

      // The oldest `updatedTime` that can still change state. Terminal rows
      // (settled, declined) are safe to pass: settled is already recorded, and
      // a later refund on it is work the recorder skips either way.
      let holdBackFrom: number | null = null;
      for (const row of collected) {
        if (billTxnState(row.transactionType ?? "") !== "pending") continue;
        const parsed = Date.parse(row.updatedTime ?? "");
        if (Number.isNaN(parsed)) continue;
        if (holdBackFrom === null || parsed < holdBackFrom) {
          holdBackFrom = parsed;
        }
      }

      // Only advance past what we know we've seen ALL of, and never past
      // something still in flight.
      let nextCursor = cursor;
      if (exhausted) {
        for (const row of collected) {
          const parsed = Date.parse(row.updatedTime ?? "");
          if (Number.isNaN(parsed)) continue;
          if (holdBackFrom !== null && parsed >= holdBackFrom) continue;
          if (nextCursor === null || parsed > Date.parse(nextCursor)) {
            nextCursor = new Date(parsed).toISOString();
          }
        }
      }

      return { transactions, nextCursor, truncated: !exhausted };
    },

    /**
     * Re-read one transaction from BILL. The fetch half of fetch-to-verify.
     *
     * Returns `null` for a transaction BILL doesn't have, which is what a
     * forged or stale notification looks like — and the route writes nothing.
     */
    async fetchTransaction(providerTxnId: string): Promise<ProviderTxn | null> {
      const txn = await getBillTransaction(client, providerTxnId);
      if (!txn) return null;
      const normalized = normalizeBillTransaction(txn);
      // BILL echoing back a transaction with no uuid would make the settlement
      // recorder's idempotency key empty, which is how one charge becomes many.
      if (!normalized.providerTxnId) return null;
      return normalized;
    },

    /**
     * Validate the credential and name the account.
     *
     * `GET /v3/spend/users/current` is the probe: authenticated, read-only and
     * cheap, so checking a token can never move money. The label is the
     * company name when BILL gives one, the authenticated user's email
     * otherwise — the point is that a finance admin can tell WHICH BILL account
     * they just connected.
     */
    async checkConnection() {
      const user = await getBillCurrentUser(client);
      const label =
        user.companyName?.trim() ||
        user.company?.name?.trim() ||
        user.email?.trim() ||
        null;
      return { accountLabel: label ?? null };
    },

    /**
     * Register this deployment's webhook URL, best effort.
     *
     * Deliberately swallows nothing — it throws, and the CALLER decides that a
     * failure is a log rather than an error (see connectCardProvider). The
     * adapter's job is to say what happened; the connect flow's job is to know
     * that the poll makes this optional.
     */
    async registerWebhook(notificationUrl: string) {
      await createBillWebhookSubscription(client, {
        name: "Togather card transactions",
        notificationUrl,
      });
    },

    // NO `verifyWebhook`. BILL's Spend & Expense notifications carry no
    // documented signature, and an adapter that returned `true` here would be
    // claiming a guarantee that does not exist — the most expensive kind of
    // lie a security boundary can tell. The route uses `fetchTransaction`
    // instead: the payload routes, the API decides.
  };
}

// ============================================================================
// Budget resolution
// ============================================================================

/**
 * The fund's budget, found by name or created.
 *
 * This is decision 2 from the file header made literal, and the rename hazard
 * lives here. The lookup walks the budget list and matches the EXACT name
 * (trimmed, case-insensitive — a church that fixes the capitalization of a
 * fund name should not get a second budget for it). A miss creates the budget
 * and logs loudly.
 *
 * The new budget's limit is seeded from the card being created, because that is
 * the only number available at this point, and its interval is MONTHLY so the
 * budget refreshes rather than draining to a permanent stop. When the budget
 * ALREADY exists and its period limit is below what this card is asking for, we
 * warn rather than fail: the church owns that number in BILL, the card is still
 * created, and if the budget really is the binding constraint the decline feed
 * will say so with BILL's own reason attached.
 */
export async function findOrCreateBudget(
  client: BillClient,
  fundName: string,
  limit: NormalizedLimit | null,
): Promise<string> {
  const wanted = billBudgetName(fundName);
  const { budget: existing, exhausted } = await findBudgetByName(client, wanted);

  if (existing) {
    const uuid = billUuid(existing);
    if (!uuid) {
      throw new Error(
        `BILL returned a budget named "${wanted}" with no uuid — cannot attach a card to it`,
      );
    }
    warnIfBudgetTooSmall(existing, wanted, limit);
    return uuid;
  }

  // "No match" and "stopped looking" are NOT the same answer, and treating them
  // the same is how a history split happens for a reason nobody can diagnose.
  // If the walk hit `BILL_BUDGET_MAX_PAGES` with more pages still to come, the
  // fund's budget may well exist on page 11 — creating a second one here would
  // permanently split that fund's spending across two BILL budgets, and the
  // "someone renamed it" log below would send support down the wrong path.
  //
  // Refusing is the recoverable direction: no card is issued, nothing is
  // created, and the message names the actual fix. A duplicate budget cannot be
  // merged in BILL, so the asymmetry is not close.
  if (!exhausted) {
    throw new Error(
      `Togather could not read all of your BILL budgets (stopped after ${BILL_BUDGET_MAX_PAGES * BILL_MAX_PAGE_SIZE}) and so cannot tell whether "${wanted}" already exists. Refusing to create a second budget for this fund — retire the budgets you no longer use in BILL Spend & Expense, then issue this card.`,
    );
  }

  // Budgets need an owner, and the only BILL user we are certain exists is the
  // one whose token we are holding — the admin who connected the account.
  const currentUser = await getBillCurrentUser(client);
  const ownerUuid = billUuid(currentUser);
  if (!ownerUuid) {
    throw new Error(
      "BILL did not identify the authenticated user, so there is no one to own a new budget — reconnect the BILL account in Community Settings → Finance",
    );
  }

  const seedDollars = limit ? centsToDollars(limit.limitCents) : 0;
  const budget = await createBillBudget(client, {
    name: wanted,
    owners: [ownerUuid],
    limit: seedDollars,
    recurringLimit: seedDollars,
    recurringInterval: "MONTHLY",
  });
  const uuid = billUuid(budget);
  if (!uuid) {
    throw new Error(
      `BILL created the budget "${wanted}" but returned no uuid — refusing to issue a card into a budget we cannot reference`,
    );
  }

  // LOUD on purpose. On the first card for a fund this line is routine; seeing
  // it a second time for the same fund name is the rename hazard happening, and
  // this log is the only place that shows up.
  console.log(
    `[BillAdapter] created budget "${wanted}" (${uuid}). If this fund already had a Togather budget in BILL, it was renamed there and its history is now split — rename it back to "${wanted}" to re-link.`,
  );
  return uuid;
}

/**
 * Walk the budget list looking for an exact (trimmed, case-insensitive) name
 * match.
 *
 * `exhausted` reports whether the walk actually reached the END of the list, and
 * it is the half of the answer that matters when `budget` is null: only a
 * complete walk licenses the caller to conclude "this fund has no budget yet".
 * See the refusal in `findOrCreateBudget`.
 */
async function findBudgetByName(
  client: BillClient,
  wanted: string,
): Promise<{ budget: BillBudget | null; exhausted: boolean }> {
  const target = wanted.trim().toLowerCase();
  let nextPage: string | undefined;

  for (let page = 0; page < BILL_BUDGET_MAX_PAGES; page++) {
    const result = await listBillBudgets(client, {
      max: BILL_MAX_PAGE_SIZE,
      nextPage,
    });
    for (const budget of result.results ?? []) {
      // A retired budget cannot take new cards, and matching one would send
      // every future card into a dead container. Skipping it means the next
      // create makes a live one with the same name, which is the recoverable
      // direction.
      if (budget.retired) continue;
      if ((budget.name ?? "").trim().toLowerCase() === target) {
        return { budget, exhausted: true };
      }
    }
    nextPage = result.nextPage ?? undefined;
    if (!nextPage) return { budget: null, exhausted: true };
  }
  return { budget: null, exhausted: false };
}

function warnIfBudgetTooSmall(
  budget: BillBudget,
  name: string,
  limit: NormalizedLimit | null,
): void {
  if (!limit) return;
  const budgetDollars = budget.currentPeriod?.limit ?? budget.limit;
  if (typeof budgetDollars !== "number") return;
  const cardDollars = centsToDollars(limit.limitCents);
  if (budgetDollars >= cardDollars) return;
  console.warn(
    `[BillAdapter] budget "${name}" allows $${budgetDollars} this period but the new card asks for $${cardDollars}. The card is being created anyway — BILL will decline past the BUDGET's limit, so raise it in BILL if these cards should all be able to spend.`,
  );
}

// ============================================================================
// User resolution
// ============================================================================

/**
 * The cardholder's BILL user uuid, matched by email.
 *
 * Decision 5 from the file header: we match, we never create. `POST
 * /v3/spend/users` exists, but creating a person at a bank on their behalf —
 * with the personal details BILL wants — is not a thing Togather should do
 * silently from a card-issuing flow.
 *
 * The no-match error is written for the finance admin who will read it in the
 * card row's failure message, and names the exact next action.
 */
export async function resolveBillUserByEmail(
  client: BillClient,
  email: string | null,
): Promise<string> {
  const wanted = email?.trim().toLowerCase();
  if (!wanted) {
    throw new Error(
      "This cardholder has no email address on their Togather profile, and BILL identifies cardholders by email. Add their email in Togather, then issue the card.",
    );
  }

  // THREE failures hide behind "we didn't return a uuid", and they have three
  // different fixes. Telling an admin to "invite them in BILL" when the person
  // is already there — deactivated, or simply past the page cap — gets a SECOND
  // BILL user created for the same human, and a duplicate identity at a bank is
  // the expensive kind of wrong. So each case is tracked and answered on its own.
  let retiredMatch = false;
  let exhausted = false;
  let nextPage: string | undefined;
  for (let page = 0; page < BILL_USER_MAX_PAGES; page++) {
    const result = await listBillUsers(client, {
      max: BILL_MAX_PAGE_SIZE,
      nextPage,
    });
    for (const user of result.results ?? []) {
      if ((user.email ?? "").trim().toLowerCase() !== wanted) continue;
      // A retired BILL user cannot hold a card; matching one would produce a
      // card creation that fails with a message about the wrong thing. Noted
      // rather than ignored, so the error below can name the real fix.
      if (user.retired) {
        retiredMatch = true;
        continue;
      }
      const uuid = billUuid(user);
      if (uuid) return uuid;
    }
    nextPage = result.nextPage ?? undefined;
    if (!nextPage) {
      exhausted = true;
      break;
    }
  }

  if (retiredMatch) {
    throw new Error(
      `${wanted} exists in your BILL Spend & Expense account but is DEACTIVATED, and a deactivated user cannot hold a card. Reactivate them in BILL — don't invite them again, a second BILL user for the same person is worse than no card.`,
    );
  }
  if (!exhausted) {
    throw new Error(
      `Togather could not read all of your BILL users (stopped after ${BILL_USER_MAX_PAGES * BILL_MAX_PAGE_SIZE}) and so cannot tell whether ${wanted} is among them. Not inviting anyone on that basis — retire the BILL users you no longer need, then issue this card.`,
    );
  }

  throw new Error(
    `No BILL user has the email ${wanted}. BILL issues cards to people who already exist in your BILL account, and Togather won't create one on their behalf — invite them in BILL Spend & Expense first, then issue this card.`,
  );
}

// ============================================================================
// Card state
// ============================================================================

/**
 * Freeze / unfreeze / pseudo-close, split out of the adapter so the "closed is
 * a freeze plus a rename" decision reads as one thing.
 */
async function applyBillCardState(
  client: BillClient,
  cardUuid: string,
  state: CardStateRequest,
): Promise<BillCard | null> {
  if (state === "active") {
    return await unfreezeBillCard(client, cardUuid);
  }

  const frozen = await freezeBillCard(client, cardUuid);
  if (state === "paused") return frozen;

  // state === "closed": the card is already frozen and can no longer spend,
  // which is the part that matters. The rename is the part that tells the
  // church's own dashboard why — best-effort, because a cosmetic failure must
  // never leave a "closed" card looking merely paused to us while it is
  // actually stopped at the bank.
  const currentName = frozen?.name ?? "";
  if (currentName.endsWith(BILL_CLOSED_SUFFIX)) return frozen;
  try {
    return await updateBillCard(client, cardUuid, {
      name: `${currentName}${BILL_CLOSED_SUFFIX}`.slice(0, 200),
    });
  } catch (error) {
    console.warn(
      `[BillAdapter] froze card ${cardUuid} but could not rename it to mark it closed:`,
      error,
    );
    return frozen;
  }
}
