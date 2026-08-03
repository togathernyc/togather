/**
 * Dependency-free BILL Spend & Expense API client (ADR-033 Phase 2 — the
 * second "bring your own cards" issuer, formerly Divvy).
 *
 * Shaped like lib/finance/privacy.ts and lib/finance/increase.ts: plain
 * `fetch`, no vendor SDK, because Convex actions/httpActions run in a
 * restricted V8 isolate. And like Privacy — and unlike Increase — the
 * credential belongs to the CHURCH, so every function takes an explicit
 * `BillClient` rather than reading an env var. There is no ambient token to
 * accidentally spend the wrong community's money with.
 *
 * FOUR THINGS ABOUT THIS VENDOR THAT DRIVE THE WHOLE FILE:
 *
 * 1. **Money is DOLLARS, not cents.** BILL sends `"amount": 53.03` and expects
 *    the same on the way in. Togather is integer cents end to end, so every
 *    boundary here converts, and `dollarsToCents` rounds rather than truncates
 *    — `4.35 * 100` is `434.99999999999994` in IEEE754 and a truncating
 *    conversion would quietly under-book a cent on ordinary amounts.
 * 2. **Auth is a static `apiToken` HEADER**, self-served by an admin inside the
 *    BILL product. Not OAuth, not Bearer, and long-lived with full-company
 *    scope — which is why `checkConnection` is read-only and why the connect
 *    flow's warning copy matters.
 * 3. **Webhook deliveries carry no verifiable signature.** BILL's Spend &
 *    Expense notification docs describe the payload and say nothing about a
 *    signing scheme. So the payload is a HINT, never evidence — see
 *    `getBillTransaction` and the webhook route's fetch-to-verify flow.
 * 4. **60 calls per minute per token.** Every list here takes a page cap, and
 *    the adapter's poll is budgeted against it.
 *
 * Endpoints, field names, enums and payload shapes below were confirmed
 * against developer.bill.com on 2026-08-03 (docs/virtual-cards,
 * docs/budgets-and-users, docs/transaction-management, reference/updatecard,
 * reference/listbudgets, docs/spend-expense-transaction-notification-payloads).
 * Anything NOT confirmable without a live account or sandbox is marked
 * `UNVERIFIED:` inline, so a reviewer can find every guess by grepping one word.
 */

// ============================================================================
// Client handle
// ============================================================================

/** Production gateway. `https://gateway.stage.bill.com/connect` is the sandbox twin. */
const BILL_PRODUCTION_BASE_URL = "https://gateway.prod.bill.com/connect";

/**
 * The decrypted token plus the host to spend it at.
 *
 * `baseUrl` is resolved once, at the edge, for the same reason as Privacy's: a
 * token is either a production token or a sandbox token, and a client that
 * could change hosts mid-flight is a way to create a card in one environment
 * and look for it in the other.
 */
export interface BillClient {
  /** The community's own BILL Spend & Expense API token. Never logged, never returned. */
  apiToken: string;
  /** Defaults to production; `BILL_API_BASE_URL` overrides for dev/staging. */
  baseUrl: string;
}

/**
 * Build a client from a decrypted token.
 *
 * Host comes from `BILL_API_BASE_URL` when set (dev/staging point at
 * `https://gateway.stage.bill.com/connect`), production otherwise — the same
 * convention as `INCREASE_API_BASE_URL` / `PRIVACY_API_BASE_URL`, so an
 * operator learns one rule. Deliberately NOT stored per connection: a
 * deployment talks to one BILL environment, and a per-row host would let a
 * staging row hold a production token.
 */
export function billClient(apiToken: string): BillClient {
  return {
    apiToken,
    baseUrl: process.env.BILL_API_BASE_URL ?? BILL_PRODUCTION_BASE_URL,
  };
}

// ============================================================================
// Money
// ============================================================================

/**
 * BILL dollars -> Togather cents.
 *
 * `Math.round`, not `Math.trunc` or `| 0`: `4.35 * 100 === 434.99999999999994`
 * and `16.08 * 100 === 1607.9999999999998`. Truncating books $4.34 for a $4.35
 * charge, and the error is invisible until a church reconciles a statement by
 * hand.
 */
export function dollarsToCents(amount: number): number {
  return Math.round(amount * 100);
}

/**
 * Togather cents -> BILL dollars.
 *
 * The `Math.round(... ) / 100` shape (rather than `cents / 100`) keeps the
 * result to two decimals for every integer input, so a limit never leaves as
 * `500.0000000000001`.
 */
export function centsToDollars(cents: number): number {
  return Math.round(cents) / 100;
}

/**
 * The exact minor-unit amount from a transaction's `currencyData`, when it is
 * safe to use — i.e. when the transaction really is USD at par.
 *
 * BILL gives BOTH a float `amount` (settled USD) and a
 * `currencyData.originalCurrencyAmount` STRING in the original currency's
 * minor units (`"5303"`, `exponent: 2`). For a domestic charge those describe
 * the same money and the string is exact, so it is preferred. For a FOREIGN
 * charge they do not: the string is euros-worth of cents and `amount` is what
 * the church was actually billed, so the float (rounded) is the correct source
 * and the string must be ignored.
 *
 * Returns `null` when the string can't be trusted, which pushes the caller onto
 * `dollarsToCents(amount)`.
 */
export function exactUsdCents(
  currencyData: BillCurrencyData | undefined | null,
): number | null {
  if (!currencyData) return null;
  if (currencyData.originalCurrencyCode !== "USD") return null;
  // An exchange rate other than 1 means the minor-unit string is not USD cents
  // even if the code says USD; absent is treated as par, which is what a
  // domestic payload looks like.
  if (
    currencyData.exchangeRate !== undefined &&
    currencyData.exchangeRate !== null &&
    currencyData.exchangeRate !== 1
  ) {
    return null;
  }
  if (currencyData.exponent !== undefined && currencyData.exponent !== 2) {
    return null;
  }
  const raw = currencyData.originalCurrencyAmount;
  if (typeof raw !== "string" || !/^-?\d+$/.test(raw)) return null;
  return Number.parseInt(raw, 10);
}

// ============================================================================
// Request plumbing
// ============================================================================

interface BillRequestOptions {
  method: "GET" | "POST" | "PATCH" | "PUT";
  body?: unknown;
  /** Appended as a query string. Values are URI-encoded here, not by callers. */
  query?: Record<string, string | number | undefined>;
  /**
   * Treat a 404 as "no such object" and return `null` instead of throwing.
   * Used by the fetch-to-verify path, where "BILL doesn't have this
   * transaction" is the ANSWER, not a failure.
   */
  nullOn404?: boolean;
}

/** Thrown for a non-2xx that isn't a tolerated 404. Carries the status for callers that branch on it. */
export class BillApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "BillApiError";
  }
}

/**
 * One request.
 *
 * Auth is a bare `apiToken: <token>` header — BILL's own scheme for Spend &
 * Expense, NOT `Authorization: Bearer` (docs/authentication-with-api-token).
 * Getting this wrong produces a 401 that reads like a bad token, so it is
 * worth the comment.
 *
 * Errors carry the status and the response body and deliberately never the
 * token. The message reaches a finance admin through
 * `recordCardProvisionFailed`, so it has to say what the vendor said.
 */
async function billRequest<T>(
  client: BillClient,
  path: string,
  options: BillRequestOptions,
): Promise<T | null> {
  const query = options.query
    ? Object.entries(options.query)
        .filter(([, value]) => value !== undefined)
        .map(
          ([key, value]) =>
            `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`,
        )
        .join("&")
    : "";

  const response = await fetch(
    `${client.baseUrl}${path}${query ? `?${query}` : ""}`,
    {
      method: options.method,
      headers: {
        apiToken: client.apiToken,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body:
        options.body !== undefined ? JSON.stringify(options.body) : undefined,
    },
  );

  if (response.status === 404 && options.nullOn404) return null;

  if (!response.ok) {
    const text = await response.text();
    throw new BillApiError(
      `BILL API ${options.method} ${path} failed (${response.status}): ${text}`,
      response.status,
    );
  }

  // A 204 (or any empty body) is a success with nothing to parse — freeze and
  // unfreeze are documented as returning the card, but an empty 200 must not
  // become a JSON parse error on a call that actually worked.
  const text = await response.text();
  if (!text) return null;
  return JSON.parse(text) as T;
}

/** `billRequest` for the calls where a null response is a bug, not an answer. */
async function billRequestRequired<T>(
  client: BillClient,
  path: string,
  options: BillRequestOptions,
): Promise<T> {
  const result = await billRequest<T>(client, path, options);
  if (result === null) {
    throw new BillApiError(
      `BILL API ${options.method} ${path} returned an empty body where an object was expected`,
      200,
    );
  }
  return result;
}

/**
 * BILL's list envelope. Token-based: `nextPage` is opaque and is handed back
 * as the `nextPage` QUERY parameter on the following call.
 */
export interface BillPage<T> {
  results?: T[];
  nextPage?: string | null;
  prevPage?: string | null;
}

/**
 * Every BILL Spend & Expense list caps `max` at a small number and 60 calls a
 * minute is the whole budget for a token. 50 is the documented ceiling for
 * transactions; budgets allow 100 but there is no reason to ask for more pages
 * than we will walk.
 */
export const BILL_MAX_PAGE_SIZE = 50;

// ============================================================================
// Identity — the `uuid` vs `id` trap
// ============================================================================

/**
 * BILL objects carry BOTH `uuid` (the prefixed handle, `crd_…`/`bgt_…`/`usr_…`)
 * and, on some responses, a numeric-ish `id`. Every WRITE path takes the uuid,
 * including the create bodies whose fields are confusingly named `userId` and
 * `budgetId`. Reading `id` and sending it as `budgetId` is the mistake this
 * helper exists to make impossible to write by accident.
 */
export function billUuid(
  object: { uuid?: string; id?: string } | null | undefined,
): string | null {
  return object?.uuid ?? object?.id ?? null;
}

// ============================================================================
// Users — GET /v3/spend/users, GET /v3/spend/users/current
// ============================================================================

export interface BillUser {
  uuid?: string;
  id?: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  /** `ADMIN` | `AUDITOR` | `BOOKKEEPER` | `MEMBER`. Open string — new roles must not break a read. */
  role?: string;
  retired?: boolean;
}

export interface BillCurrentUser extends BillUser {
  /** UNVERIFIED: present on some responses; the connection label falls back to the email. */
  companyName?: string;
  company?: { name?: string; uuid?: string } | null;
  companyUuid?: string;
}

/**
 * The cheapest authenticated read BILL offers, and the connection probe.
 *
 * Read-only, so validating a token can never move money, and a revoked token
 * fails HERE at connect time rather than later at card creation.
 */
export async function getBillCurrentUser(
  client: BillClient,
): Promise<BillCurrentUser> {
  return await billRequestRequired<BillCurrentUser>(
    client,
    "/v3/spend/users/current",
    { method: "GET" },
  );
}

export async function listBillUsers(
  client: BillClient,
  params: { max?: number; nextPage?: string } = {},
): Promise<BillPage<BillUser>> {
  return (
    (await billRequest<BillPage<BillUser>>(client, "/v3/spend/users", {
      method: "GET",
      query: { max: params.max ?? BILL_MAX_PAGE_SIZE, nextPage: params.nextPage },
    })) ?? {}
  );
}

// ============================================================================
// Budgets — GET/POST /v3/spend/budgets
// ============================================================================

/** A budget's current window. `assigned` is what has been handed to cards; `spent` is what left. */
export interface BillBudgetPeriod {
  startDate?: string;
  endDate?: string;
  spent?: number;
  assigned?: number;
  limit?: number;
}

export interface BillBudget {
  uuid?: string;
  id?: string;
  name?: string;
  limit?: number;
  recurringLimit?: number;
  /** `MONTHLY` | `NONE` and friends. Open string on purpose. */
  recurringInterval?: string;
  retired?: boolean;
  currentPeriod?: BillBudgetPeriod;
}

export interface BillCreateBudgetParams {
  name: string;
  /** User UUIDs. BILL requires at least one owner. */
  owners: string[];
  /** DOLLARS. */
  limit: number;
  /** DOLLARS — the limit each subsequent period gets. */
  recurringLimit: number;
  /** `MONTHLY` for a resetting budget, `NONE` for a one-off pot. */
  recurringInterval: string;
}

export async function listBillBudgets(
  client: BillClient,
  params: { max?: number; nextPage?: string } = {},
): Promise<BillPage<BillBudget>> {
  return (
    (await billRequest<BillPage<BillBudget>>(client, "/v3/spend/budgets", {
      method: "GET",
      query: { max: params.max ?? BILL_MAX_PAGE_SIZE, nextPage: params.nextPage },
    })) ?? {}
  );
}

export async function createBillBudget(
  client: BillClient,
  params: BillCreateBudgetParams,
): Promise<BillBudget> {
  return await billRequestRequired<BillBudget>(client, "/v3/spend/budgets", {
    method: "POST",
    body: params,
  });
}

// ============================================================================
// Cards — POST /v3/spend/cards, PATCH /v3/spend/cards/{uuid}, freeze/unfreeze
// ============================================================================

export interface BillCard {
  uuid?: string;
  id?: string;
  name?: string;
  /** `ACTIVATED` | `FROZEN` | … — BILL's own vocabulary, mapped by the adapter. */
  status?: string;
  lastFour?: string;
  validThru?: string;
  userUuid?: string;
  budgetUuid?: string;
  currentPeriod?: { limit?: number; spent?: number };
}

/**
 * POST /v3/spend/cards body.
 *
 * NOTE the field NAMES: `userId` and `budgetId` both take UUIDs (see
 * `billUuid`). `limit` is DOLLARS.
 *
 * DELIBERATELY ABSENT: anything to do with the PAN. BILL exposes card numbers
 * through a separate two-step JWT flow (`GET /v3/spend/cards/{uuid}/pan-jwt`)
 * which this integration does not implement and should not: Togather is not a
 * card-display surface, cardholders read their numbers in BILL's own app, and
 * a type with no PAN field is a type no future edit can accidentally persist
 * one through.
 */
export interface BillCreateCardParams {
  name: string;
  /** BILL user UUID of the cardholder. Resolved from their email — see the adapter. */
  userId: string;
  /** BILL budget UUID this card draws from. */
  budgetId: string;
  /** DOLLARS. The card's own cap — Togather's enforcement lever. */
  limit?: number;
  /**
   * `false` for every Togather card. `true` would let the card spend the whole
   * budget, which throws away the only per-card control BILL gives us.
   */
  shareBudgetFunds?: boolean;
}

/** PATCH /v3/spend/cards/{cardId} body (reference/updatecard). All fields nullable/optional. */
export interface BillUpdateCardParams {
  name?: string;
  budgetId?: string;
  /** DOLLARS available in the CURRENT period. */
  availableFunds?: number;
  /** DOLLARS granted in each FUTURE period. */
  recurringLimit?: number;
  shareBudgetFunds?: boolean;
  recurring?: boolean;
}

export async function createBillCard(
  client: BillClient,
  params: BillCreateCardParams,
): Promise<BillCard> {
  return await billRequestRequired<BillCard>(client, "/v3/spend/cards", {
    method: "POST",
    body: params,
  });
}

export async function updateBillCard(
  client: BillClient,
  cardUuid: string,
  params: BillUpdateCardParams,
): Promise<BillCard> {
  return await billRequestRequired<BillCard>(
    client,
    `/v3/spend/cards/${encodeURIComponent(cardUuid)}`,
    { method: "PATCH", body: params },
  );
}

/**
 * POST /v3/spend/cards/{uuid}/freeze — "frozen cards cannot be used for
 * payments". Reversible, which is the whole reason `cardCloseReversible` is
 * TRUE for this provider and false for Privacy.
 */
export async function freezeBillCard(
  client: BillClient,
  cardUuid: string,
): Promise<BillCard | null> {
  return await billRequest<BillCard>(
    client,
    `/v3/spend/cards/${encodeURIComponent(cardUuid)}/freeze`,
    { method: "POST" },
  );
}

/** POST /v3/spend/cards/{uuid}/unfreeze — restores the pre-freeze status. */
export async function unfreezeBillCard(
  client: BillClient,
  cardUuid: string,
): Promise<BillCard | null> {
  return await billRequest<BillCard>(
    client,
    `/v3/spend/cards/${encodeURIComponent(cardUuid)}/unfreeze`,
    { method: "POST" },
  );
}

// ============================================================================
// Transactions — GET /v3/spend/transactions, GET /v3/spend/transactions/{uuid}
// ============================================================================

export interface BillCurrencyData {
  exchangeRate?: number;
  exponent?: number;
  /** Minor units of the ORIGINAL currency, as a string. See `exactUsdCents`. */
  originalCurrencyAmount?: string;
  originalCurrencyCode?: string;
  symbol?: string;
}

/**
 * One Spend & Expense transaction.
 *
 * `transactionType` is the lifecycle: a purchase arrives as `AUTHORIZATION`
 * (or `DECLINE`) and the SAME uuid is updated to `CLEAR` on settlement. A
 * reversal is a negative amount ending at `AUTHORIZATION`; a refund is a
 * negative amount ending at `CLEAR`. So "did money move" is
 * `transactionType === "CLEAR"`, and sign carries direction — which is exactly
 * the shape `ProviderTxn` already documents.
 */
export interface BillTransaction {
  uuid?: string;
  cardUuid?: string;
  budgetUuid?: string;
  userUuid?: string;
  companyUuid?: string;
  /** DOLLARS, signed. */
  amount?: number;
  fees?: number;
  merchantName?: string;
  rawMerchantName?: string;
  merchantCategoryCode?: string;
  /** `AUTHORIZATION` | `CLEAR` | `DECLINE` | `OTHER`. */
  transactionType?: string;
  occurredTime?: string;
  updatedTime?: string;
  authorizedTime?: string | null;
  complete?: boolean;
  declineReason?: string | null;
  currencyData?: BillCurrencyData;
}

export interface BillListTransactionsParams {
  /**
   * BILL's filter syntax: `{field}:{operator}:{value}`, e.g.
   * `updatedTime:gte:2026-08-01T00:00:00.000Z`. Multiple filters are repeated
   * occurrences of the parameter; the poll needs exactly one.
   */
  filters?: string;
  /** `{field}:{asc|desc}`. The poll sorts by `updatedTime` ascending so a truncated walk is resumable. */
  sort?: string;
  /** 1–50. */
  max?: number;
  /** Opaque token from the previous page's `nextPage`. */
  nextPage?: string;
}

export async function listBillTransactions(
  client: BillClient,
  params: BillListTransactionsParams,
): Promise<BillPage<BillTransaction>> {
  return (
    (await billRequest<BillPage<BillTransaction>>(
      client,
      "/v3/spend/transactions",
      {
        method: "GET",
        query: {
          filters: params.filters,
          sort: params.sort,
          max: params.max ?? BILL_MAX_PAGE_SIZE,
          nextPage: params.nextPage,
        },
      },
    )) ?? {}
  );
}

/**
 * Fetch ONE transaction by uuid. Returns `null` for a 404.
 *
 * THIS IS THE SECURITY BOUNDARY for the webhook route. BILL's Spend & Expense
 * notifications carry no signature we can verify, so a delivery is only ever a
 * hint that something happened; what gets BOOKED is whatever this call returns,
 * fetched with the community's own stored token. A forged POST claiming a
 * $9,000 charge results in either a 404 (nothing written) or the real
 * transaction (the real amount written) — never the attacker's number.
 */
export async function getBillTransaction(
  client: BillClient,
  transactionUuid: string,
): Promise<BillTransaction | null> {
  return await billRequest<BillTransaction>(
    client,
    `/v3/spend/transactions/${encodeURIComponent(transactionUuid)}`,
    { method: "GET", nullOn404: true },
  );
}

// ============================================================================
// Webhook subscriptions — POST /v3/subscriptions
// ============================================================================

/** The Spend & Expense transaction event. Fires at AUTHORIZATION and AGAIN at CLEAR. */
export const BILL_TRANSACTION_UPDATED_EVENT = "spend.transaction.updated";

export interface BillSubscription {
  id?: string;
  uuid?: string;
  notificationUrl?: string;
}

/**
 * Register a notification URL, best effort.
 *
 * PRODUCTION ONLY — BILL's sandbox exposes a test endpoint and no real
 * subscriptions, so in staging this call is expected to fail and the poll is
 * the entire feed.
 *
 * UNVERIFIED: `/v3/subscriptions` is documented as part of BILL's CORE v3 API,
 * whose auth is `devKey` + `sessionId` rather than the Spend & Expense
 * `apiToken` this client holds. It may therefore reject our token outright.
 * That is survivable and deliberately not fatal: the caller logs and moves on,
 * because the hourly poll is the source of truth in staging and the backstop in
 * production. If it turns out a separate credential is required, THIS is the
 * function that grows a second argument — nothing else changes.
 */
export async function createBillWebhookSubscription(
  client: BillClient,
  params: { name: string; notificationUrl: string; events?: string[] },
): Promise<BillSubscription | null> {
  const events = params.events ?? [BILL_TRANSACTION_UPDATED_EVENT];
  return await billRequest<BillSubscription>(client, "/v3/subscriptions", {
    method: "POST",
    body: {
      name: params.name,
      status: { enabled: true },
      events: events.map((type) => ({ type, version: "1" })),
      notificationUrl: params.notificationUrl,
    },
  });
}

/**
 * The shape of an inbound Spend & Expense notification, in the fields the
 * route reads BEFORE it throws the rest away.
 *
 * Only `transaction.uuid` (what to fetch) and `transaction.cardUuid` (who to
 * route to) are ever used. Every other field — amount included, especially
 * amount — is ignored by design.
 */
export interface BillWebhookNotification {
  metadata?: {
    eventId?: string;
    subscriptionId?: string;
    spendCompanyUuid?: string;
    eventType?: string;
    version?: string;
  };
  transaction?: {
    uuid?: string;
    cardUuid?: string;
    [key: string]: unknown;
  };
}
