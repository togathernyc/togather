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
