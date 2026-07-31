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
   * Integer cents this charge contributed to the payout: Stripe's `net`
   * (gross minus the processing fee), NOT the gross the donor was charged.
   * A payout is the sum of its charges' nets, so this is the only basis on
   * which an allocation can actually be funded.
   */
  netCents: number;
}

/** One page of `GET /v1/balance_transactions` is 100 rows; a payout with more
 * charges than this is entirely normal for a busy community, so we page. The
 * cap is a runaway guard, not an expected limit (100 pages = 10k charges in
 * a single payout). */
const BALANCE_TXN_PAGE_LIMIT = 100;
const BALANCE_TXN_MAX_PAGES = 100;

/**
 * List the per-charge NET amounts that composed one Stripe payout.
 *
 * ADR-032's allocation job splits a bulk payout into per-group Increase
 * Accounts. A payout is paid NET of Stripe's processing fees, so matching
 * donations by their GROSS total can never fit (the gross always exceeds
 * what arrived) — this is the balance-transaction lookup that ADR-032's
 * Phase-2 requirement 6 names as the fix. It also removes the guesswork
 * entirely: Stripe reports exactly WHICH charges the payout contained, so
 * allocation no longer has to infer membership from a running total.
 *
 * `expand: ["data.source"]` inflates each balance transaction's `source`
 * into the full Charge, which is where `payment_intent` lives — without it
 * `source` is just a `ch_…` id we have no mapping for. Non-charge rows
 * (`stripe_fee`, `payout`, `refund`, `adjustment`, …) are skipped: they are
 * the difference between the payout total and the sum of the nets, i.e. the
 * expected `leftoverCents` on the allocation plan.
 *
 * Runs against the CONNECTED account (`stripeAccount`), the same way
 * donations are collected — the platform account has no view of a
 * community's payouts.
 */
export async function listPayoutChargeNets(
  connectedAccountId: string,
  payoutId: string,
): Promise<PayoutChargeNet[]> {
  const stripe = await getStripeClient();
  const nets: PayoutChargeNet[] = [];
  let startingAfter: string | undefined;

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
      // "charge" is a card payment; "payment" is the ACH-debit equivalent
      // (ADR-032 §3 offers ACH for large gifts). Everything else is fee or
      // reversal bookkeeping, not donor money arriving.
      if (txn.type !== "charge" && txn.type !== "payment") continue;

      const paymentIntentId = paymentIntentIdFromSource(txn.source);
      if (!paymentIntentId) {
        console.error(
          `[finance] listPayoutChargeNets: balance transaction ${txn.id} on payout ${payoutId} has no resolvable payment_intent — skipping`,
        );
        continue;
      }
      // Integer cents only — a non-integer or non-positive net would be a
      // Stripe-side surprise, and allocating against it would move a wrong
      // amount of real money. Skip loudly instead.
      if (!Number.isInteger(txn.net) || txn.net <= 0) {
        console.error(
          `[finance] listPayoutChargeNets: balance transaction ${txn.id} has a non-positive/non-integer net (${txn.net}) — skipping`,
        );
        continue;
      }

      nets.push({ paymentIntentId, netCents: txn.net });
    }

    if (!result.has_more) break;
    startingAfter = result.data[result.data.length - 1]?.id;
    if (!startingAfter) break;
  }

  return nets;
}

/**
 * A balance transaction's `source` is `string | BalanceTransactionSource |
 * null`; only the expanded Charge object carries `payment_intent`, which
 * itself may be an id or (if something else expanded it) a full object.
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
