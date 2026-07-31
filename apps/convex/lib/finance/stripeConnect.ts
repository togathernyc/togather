/**
 * Stripe Connect helpers for group giving (ADR-032 §2/§6).
 *
 * Stripe's role in ADR-032 is acquiring only: one Express connected account
 * per community collects donations (Apple Pay, cards, ACH debit); Increase
 * (lib/finance/increase.ts) holds and moves the money. Every Stripe call for
 * onboarding lives here so the actions in functions/finance/onboarding.ts
 * stay thin (construct input, call a helper, persist the result).
 *
 * Mirrors how functions/ee/billing.ts constructs its Stripe client — dynamic
 * `import("stripe")` (so the SDK only loads when a finance action actually
 * runs) and the same pinned `apiVersion` used there.
 */

type StripeClient = InstanceType<typeof import("stripe").default>;

/** True when the configured key is a test-mode key (`sk_test_…`). Payout
 * destination selection branches on this — see choosePayoutDestination. */
export function isStripeTestMode(): boolean {
  return process.env.STRIPE_SECRET_KEY?.startsWith("sk_test") ?? false;
}

/**
 * Pick the bank account to attach as a connected account's payout
 * destination. Production attaches the real Increase receiving-account
 * number. Test mode CANNOT: Stripe test mode rejects any bank account not on
 * its test list ("You must use a test bank account number" — hit live on
 * staging, since Increase's sandbox mints realistic numbers), so dev/staging
 * attach Stripe's documented test account instead
 * (https://docs.stripe.com/connect/testing#account-numbers). Stripe-side
 * payout webhooks still fire against it; the Increase sandbox receiving
 * account is funded via simulations when a test needs bank-side money.
 * Pure so it's unit-testable.
 */
export function choosePayoutDestination(
  stripeTestMode: boolean,
  minted: { routingNumber: string; accountNumber: string },
): { routingNumber: string; accountNumber: string } {
  if (stripeTestMode) {
    return { routingNumber: "110000000", accountNumber: "000123456789" };
  }
  return minted;
}

async function getStripeClient(): Promise<StripeClient> {
  const Stripe = (await import("stripe")).default;
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    throw new Error("STRIPE_SECRET_KEY environment variable is not configured");
  }
  return new Stripe(secretKey, { apiVersion: "2026-02-25.clover" });
}

export interface CreateConnectedAccountInput {
  legalName: string;
  /** communityFinance.ein, "NN-NNNNNNN" or bare digits — dashes are stripped before sending to Stripe. */
  ein: string;
  website?: string;
  address: {
    addressLine1: string;
    addressLine2?: string;
    city: string;
    state: string;
    zipCode: string;
  };
  statementDescriptor?: string;
  /** Derived from communityId by the caller — makes a retried onboarding action resolve to the SAME connected account instead of creating a second one. */
  idempotencyKey: string;
}

/**
 * Create the community's Express connected account. `business_type:
 * "company"` plus the church's legal name/EIN pre-fills Stripe's hosted
 * onboarding (createAccountOnboardingLink below) so the admin's redirect is
 * just identity verification for the representative, not re-entering data
 * already collected in Togather's one intake form.
 */
export async function createConnectedAccount(
  input: CreateConnectedAccountInput,
): Promise<string> {
  const stripe = await getStripeClient();
  const account = await stripe.accounts.create({
    type: "express",
    country: "US",
    business_type: "company",
    company: {
      name: input.legalName,
      tax_id: input.ein.replace(/-/g, ""),
      address: {
        line1: input.address.addressLine1,
        line2: input.address.addressLine2,
        city: input.address.city,
        state: input.address.state,
        postal_code: input.address.zipCode,
        country: "US",
      },
    },
    business_profile: {
      url: input.website,
      // Donations aren't a traditional "product" sale — Stripe's business
      // profile still requires a product description for underwriting.
      product_description: "Church/community donations and group giving",
    },
    settings: input.statementDescriptor
      ? { payouts: { statement_descriptor: input.statementDescriptor } }
      : undefined,
    capabilities: {
      card_payments: { requested: true },
      transfers: { requested: true },
      us_bank_account_ach_payments: { requested: true },
    },
  }, { idempotencyKey: input.idempotencyKey });
  return account.id;
}

/**
 * Create a hosted onboarding link (Stripe's "most battle-tested KYC UI in
 * existence" per ADR-032 §2) for the admin to verify the representative's
 * identity. `refreshUrl` is where Stripe sends the admin if the link expires
 * mid-flow; `returnUrl` is where they land after completing (or abandoning)
 * onboarding — completion itself is detected via the `account.updated`
 * webhook (functions/finance/webhooks.ts), not this redirect.
 */
export async function createAccountOnboardingLink(
  accountId: string,
  returnUrl: string,
  refreshUrl: string,
): Promise<string> {
  const stripe = await getStripeClient();
  const link = await stripe.accountLinks.create({
    account: accountId,
    type: "account_onboarding",
    return_url: returnUrl,
    refresh_url: refreshUrl,
  });
  return link.url;
}

// ============================================================================
// Payout composition — the NET amounts allocation matches against (ADR-032
// Phase-2 requirement 6)
// ============================================================================

export interface PayoutChargeNet {
  /**
   * The PaymentIntent behind the charge. `donations` rows key on
   * `stripePaymentIntentId`, so this is what maps a balance transaction back
   * to a donation — the charge id itself is never stored on our side.
   */
  paymentIntentId: string;
  /**
   * Integer cents this PaymentIntent contributed to the payout: Stripe's
   * `net` (gross minus the processing fee) MINUS any refund/adjustment for
   * the same PaymentIntent that settled in this same payout. NOT the gross
   * the donor was charged. A payout is the sum of its rows' nets, so this is
   * the only basis on which an allocation can actually be funded.
   */
  netCents: number;
}

export interface PayoutComposition {
  /**
   * One entry per PaymentIntent the payout carried, at the amount it
   * actually contributed — netted across every row Stripe attributed to it.
   * Only strictly positive totals appear; see `reversedPaymentIntentIds`.
   */
  charges: PayoutChargeNet[];
  /**
   * PaymentIntents present in this payout whose netted total came out <= 0 —
   * the charge was refunded (or charged back) by at least as much as it
   * brought in, so the payout delivered nothing for them and NOTHING may be
   * allocated on their behalf. Reported rather than silently dropped so the
   * caller can say why a donation went unmatched.
   */
  reversedPaymentIntentIds: string[];
  /**
   * Reversal cents in this payout we could not attribute to any
   * PaymentIntent. Should always be 0 — a Refund's expanded `source` carries
   * `payment_intent` — but a non-zero value means the payout is short by
   * money we cannot subtract from anything, so the caller must alarm rather
   * than allocate as if the shortfall didn't exist.
   */
  unattributedReversalCents: number;
}

/** One page of `GET /v1/balance_transactions` is 100 rows; a payout with more
 * charges than this is entirely normal for a busy community, so we page. The
 * cap is a runaway guard, not an expected limit (100 pages = 10k rows in
 * a single payout). Exhausting it while Stripe still reports `has_more`
 * throws — see `getPayoutComposition`. */
const BALANCE_TXN_PAGE_LIMIT = 100;
const BALANCE_TXN_MAX_PAGES = 100;

/**
 * Balance-transaction types that represent donor money ARRIVING. "charge" is
 * a card payment; "payment" is the ACH-debit equivalent (ADR-032 §3 offers
 * ACH for large gifts).
 */
const INBOUND_TXN_TYPES: ReadonlySet<string> = new Set(["charge", "payment"]);

/**
 * Balance-transaction types that represent money for an EARLIER charge
 * moving back out (or, for the `*_failure` pair, a failed reversal coming
 * back in). Their `net` is already signed by Stripe, so they are summed
 * as-is against the charge's own net.
 *
 * These MUST NOT be discarded. A donation refunded before its payout settles
 * is still `allocationStatus: "pending"`, so dropping the refund row would
 * leave the surviving charge row looking like a fundable gift and transfer
 * money the donor already got back into a group's spendable Increase
 * Account. `adjustment` covers the dispute/chargeback case, whose source is
 * a Dispute — also `payment_intent`-bearing.
 */
const REVERSAL_TXN_TYPES: ReadonlySet<string> = new Set([
  "refund",
  "payment_refund",
  "refund_failure",
  "payment_refund_failure",
  "payment_failure_refund",
  "adjustment",
]);

/**
 * Read what one Stripe payout was actually composed of, per PaymentIntent.
 *
 * ADR-032's allocation job splits a bulk payout into per-group Increase
 * Accounts. A payout is paid NET of Stripe's processing fees, so matching
 * donations by their GROSS total can never fit (the gross always exceeds
 * what arrived) — this is the balance-transaction lookup that ADR-032's
 * Phase-2 requirement 6 names as the fix. It also removes the guesswork
 * entirely: Stripe reports exactly WHICH charges the payout contained, so
 * allocation no longer has to infer membership from a running total.
 *
 * Charges and their reversals are NETTED per PaymentIntent rather than the
 * reversals being thrown away, because both directions are donor money and
 * only their sum is fundable. Pure bookkeeping rows (`stripe_fee`, `payout`,
 * `transfer`, …) are skipped — those are the difference between the payout
 * total and the sum of the nets.
 *
 * `expand: ["data.source"]` inflates each balance transaction's `source`
 * into the full Charge / Refund / Dispute, which is where `payment_intent`
 * lives — without it `source` is just an id we have no mapping for.
 *
 * Runs against the CONNECTED account (`stripeAccount`), the same way
 * donations are collected — the platform account has no view of a
 * community's payouts.
 *
 * NOTE: `?payout=` filters to AUTOMATIC payouts only. A community that
 * switches to manual payouts in its Stripe Express dashboard gets an empty
 * list here forever — that is the payout-destination-drift risk ADR-032
 * Phase-2 requirement 4 tracks, and `runAllocation` alarms on the empty plan
 * it produces rather than stalling silently.
 */
export async function getPayoutComposition(
  connectedAccountId: string,
  payoutId: string,
): Promise<PayoutComposition> {
  const stripe = await getStripeClient();
  // Insertion-ordered so the emitted charge list is stable across runs, which
  // keeps a re-plan of the same payout deterministic.
  const netByPaymentIntent = new Map<string, number>();
  let unattributedReversalCents = 0;
  let startingAfter: string | undefined;
  let pagedToEnd = false;

  for (let page = 0; page < BALANCE_TXN_MAX_PAGES; page++) {
    const result = await stripe.balanceTransactions.list(
      {
        payout: payoutId,
        limit: BALANCE_TXN_PAGE_LIMIT,
        expand: ["data.source"],
        ...(startingAfter ? { starting_after: startingAfter } : {}),
      },
      { stripeAccount: connectedAccountId },
    );

    for (const txn of result.data) {
      const isInbound = INBOUND_TXN_TYPES.has(txn.type);
      const isReversal = REVERSAL_TXN_TYPES.has(txn.type);
      if (!isInbound && !isReversal) continue;

      // Integer cents only — a fractional net would be a Stripe-side
      // surprise, and allocating against it would move a wrong amount of
      // real money. Skip loudly instead.
      if (!Number.isInteger(txn.net)) {
        console.error(
          `[finance] getPayoutComposition: balance transaction ${txn.id} has a non-integer net (${txn.net}) — skipping`,
        );
        continue;
      }
      if (txn.net === 0) continue;
      // An inbound row must bring money in; a reversal must take it out (or,
      // for a failed reversal, put it back). Either way, `net`'s own sign is
      // what we sum — a wrong-signed row is nonsense we refuse to reason on.
      if (isInbound && txn.net < 0) {
        console.error(
          `[finance] getPayoutComposition: ${txn.type} balance transaction ${txn.id} has a negative net (${txn.net}) — skipping`,
        );
        continue;
      }

      const paymentIntentId = paymentIntentIdFromSource(txn.source);
      if (!paymentIntentId) {
        if (isReversal) {
          // Losing a reversal is the dangerous direction: the payout is short
          // by this much and we would allocate as though it weren't.
          unattributedReversalCents += txn.net;
          console.error(
            `[finance] getPayoutComposition: ${txn.type} balance transaction ${txn.id} on payout ${payoutId} (net ${txn.net}) has no resolvable payment_intent — it cannot be netted against any donation`,
          );
        } else {
          console.error(
            `[finance] getPayoutComposition: balance transaction ${txn.id} on payout ${payoutId} has no resolvable payment_intent — skipping`,
          );
        }
        continue;
      }

      netByPaymentIntent.set(
        paymentIntentId,
        (netByPaymentIntent.get(paymentIntentId) ?? 0) + txn.net,
      );
    }

    if (!result.has_more) {
      pagedToEnd = true;
      break;
    }
    startingAfter = result.data[result.data.length - 1]?.id;
    if (!startingAfter) {
      pagedToEnd = true;
      break;
    }
  }

  if (!pagedToEnd) {
    // Returning the prefix would look like a complete payout composition and
    // silently allocate against a partial view — and every retry would read
    // the same first 100 pages, so the tail could never bind. Fail loudly
    // instead; nothing has been written at this point in the pass.
    throw new Error(
      `getPayoutComposition: payout ${payoutId} has more than ${BALANCE_TXN_MAX_PAGES * BALANCE_TXN_PAGE_LIMIT} balance transactions — refusing to allocate on a truncated view`,
    );
  }

  const charges: PayoutChargeNet[] = [];
  const reversedPaymentIntentIds: string[] = [];
  for (const [paymentIntentId, netCents] of netByPaymentIntent) {
    if (netCents > 0) {
      charges.push({ paymentIntentId, netCents });
    } else {
      // Fully refunded/reversed inside this payout. It delivered nothing, so
      // there is nothing to allocate — and its donation may well still be
      // "pending" if the refund webhook has not been processed yet.
      reversedPaymentIntentIds.push(paymentIntentId);
    }
  }

  return { charges, reversedPaymentIntentIds, unattributedReversalCents };
}

/**
 * A balance transaction's `source` is `string | BalanceTransactionSource |
 * null`; only the expanded Charge / Refund / Dispute object carries
 * `payment_intent`, which itself may be an id or (if something else expanded
 * it) a full object.
 */
function paymentIntentIdFromSource(source: unknown): string | undefined {
  if (!source || typeof source !== "object") return undefined;
  const paymentIntent = (source as { payment_intent?: unknown }).payment_intent;
  if (typeof paymentIntent === "string") return paymentIntent;
  if (paymentIntent && typeof paymentIntent === "object") {
    const id = (paymentIntent as { id?: unknown }).id;
    return typeof id === "string" ? id : undefined;
  }
  return undefined;
}

/**
 * Set the community's Increase receiving Account as the connected account's
 * external payout destination, so Stripe's bulk payout (ADR-032 §3) lands
 * directly on the bank side we control. We mint the Increase account number
 * ourselves (lib/finance/increase.ts createAccountNumber), so this is a plain
 * bank-account external account attach — no separate verification step.
 */
export async function attachIncreasePayoutAccount(
  accountId: string,
  routingNumber: string,
  accountNumber: string,
  idempotencyKey: string,
): Promise<void> {
  const stripe = await getStripeClient();
  await stripe.accounts.createExternalAccount(
    accountId,
    {
      external_account: {
        object: "bank_account",
        country: "US",
        currency: "usd",
        routing_number: routingNumber,
        account_number: accountNumber,
      },
    },
    { idempotencyKey },
  );
}
