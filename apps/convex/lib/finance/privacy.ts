/**
 * Dependency-free Privacy.com API client (ADR-033 Phase 1 — "bring your own
 * cards").
 *
 * The shape mirrors lib/finance/increase.ts on purpose: plain `fetch`, no
 * vendor SDK, because Convex actions/httpActions run in a restricted V8
 * isolate with no Node `crypto`/`Buffer`. That is also why the webhook HMAC
 * below is hand-rolled with Web Crypto.
 *
 * ONE STRUCTURAL DIFFERENCE FROM INCREASE, AND IT DRIVES EVERYTHING HERE:
 * Increase is Togather's OWN vendor, so its key is a deployment env var read
 * lazily inside the client. Privacy.com is the COMMUNITY's vendor — the key
 * belongs to the church, arrives through `connectCardProvider`, and lives
 * encrypted in `cardProviderConnections`. So every function in this module
 * takes an explicit `PrivacyClient` (the decrypted key + host) rather than
 * reaching for an env var. There is no ambient credential to accidentally use
 * for the wrong community, which is the property that matters most when one
 * deployment holds many churches' spending keys.
 *
 * Endpoint paths, field names, enums and the webhook signing scheme below were
 * confirmed against developers.privacy.com on 2026-08-03 (reference/post_cards-1,
 * reference/patch_cards-card-token-1, reference/get_transactions-1,
 * reference/get_funding-sources, docs/transaction-webhooks) — not guessed.
 * Anything non-obvious cites its section inline. What could NOT be exercised
 * without a live account is called out in the adapter's header.
 */

// ============================================================================
// Client handle
// ============================================================================

/** Production host. `https://sandbox.privacy.com/v1` is the sandbox twin. */
const PRIVACY_PRODUCTION_BASE_URL = "https://api.privacy.com/v1";

/**
 * The decrypted credential plus the host to spend it at.
 *
 * `baseUrl` is resolved once, at the edge, rather than read per request: a
 * community's key is either a production key or a sandbox key, and a client
 * that could silently change hosts mid-flight is a way to create a card in one
 * environment and look for it in the other.
 */
export interface PrivacyClient {
  /** The community's own Privacy.com API key. Never logged, never returned to a caller. */
  apiKey: string;
  /** Defaults to production; `PRIVACY_API_BASE_URL` overrides for dev/staging. */
  baseUrl: string;
}

/**
 * Build a client from a decrypted key.
 *
 * The host comes from `PRIVACY_API_BASE_URL` when set (dev/staging point at
 * `https://sandbox.privacy.com/v1`), production otherwise — the same
 * `INCREASE_API_BASE_URL` convention, so an operator learns one rule. It is
 * deliberately NOT stored per connection: a deployment talks to one Privacy
 * environment, and a per-row host would let a staging row hold a production
 * key.
 */
export function privacyClient(apiKey: string): PrivacyClient {
  return {
    apiKey,
    baseUrl: process.env.PRIVACY_API_BASE_URL ?? PRIVACY_PRODUCTION_BASE_URL,
  };
}

// ============================================================================
// Request plumbing
// ============================================================================

interface PrivacyRequestOptions {
  method: "GET" | "POST" | "PATCH";
  body?: unknown;
  /** Appended as a query string. Values are URI-encoded here, not by callers. */
  query?: Record<string, string | number | undefined>;
}

/**
 * One request.
 *
 * Auth is `Authorization: api-key <key>` — Privacy's own scheme, NOT
 * `Bearer` (developers.privacy.com "Authentication"). Getting this wrong
 * produces a 401 that looks like a bad key, so it is worth the comment.
 *
 * Errors carry the status and the response body, and deliberately never the
 * key. The message reaches a finance admin through
 * `recordCardProvisionFailed`, so it has to say what the vendor said.
 */
async function privacyRequest<T>(
  client: PrivacyClient,
  path: string,
  options: PrivacyRequestOptions,
): Promise<T> {
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
        Authorization: `api-key ${client.apiKey}`,
        "Content-Type": "application/json",
      },
      body:
        options.body !== undefined ? JSON.stringify(options.body) : undefined,
    },
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `Privacy.com API ${options.method} ${path} failed (${response.status}): ${text}`,
    );
  }

  return (await response.json()) as T;
}

// ============================================================================
// Cards — POST /v1/cards, PATCH /v1/cards/{card_token}
// ============================================================================

/**
 * Privacy's card types.
 *
 * - `MERCHANT_LOCKED` — locks to the first merchant that authorizes it.
 * - `UNLOCKED`        — general purpose; what a per-fund Togather card needs.
 * - `SINGLE_USE`      — closes after one authorization.
 * - `DIGITAL_WALLET`  — tokenized for Apple/Google Pay provisioning.
 */
export type PrivacyCardType =
  | "MERCHANT_LOCKED"
  | "UNLOCKED"
  | "SINGLE_USE"
  | "DIGITAL_WALLET";

/** Privacy's spend-limit windows. There is no per-WEEK option — see the adapter's limit map. */
export type PrivacySpendLimitDuration =
  | "TRANSACTION"
  | "MONTHLY"
  | "ANNUALLY"
  | "FOREVER";

/**
 * Card states we can REQUEST. Privacy's full `state` enum also has
 * `PENDING_ACTIVATION` and `PENDING_FULFILLMENT` (physical-card fulfilment),
 * which we can receive but never send — the adapter maps them to our
 * `pending`.
 *
 * `CLOSED` is terminal. Privacy's own words: "setting a card to a `CLOSED`
 * state is a final action that cannot be undone."
 */
export type PrivacyCardState = "OPEN" | "PAUSED" | "CLOSED";

/**
 * The card object, in the fields this module reads.
 *
 * DELIBERATELY OMITTED: `pan` and `cvv`. POST /v1/cards returns the full card
 * NUMBER and security code, and Togather has no use for either — we are not a
 * card-display surface. Leaving them off the type is not cosmetic: it means no
 * code path can persist, log, or return them by autocompleting a field name,
 * and a future reader can't mistake their absence for an oversight. Only
 * `last_four` is ever stored (`cards.last4`).
 */
export interface PrivacyCard {
  /** Privacy's id for the card. Referenced as `card_token` everywhere else in their API. */
  token: string;
  state: string;
  /** Last four of the PAN. Absent on some responses, so optional here. */
  last_four?: string;
  memo?: string;
  type?: string;
  spend_limit?: number;
  spend_limit_duration?: string;
  created?: string;
}

export interface PrivacyCreateCardParams {
  type: PrivacyCardType;
  /** Shown in the Privacy dashboard. Togather writes "<fund> · Togather" so a church can tell our cards from theirs. */
  memo: string;
  /** Whole cents. Omitted entirely for "no limit" — see the adapter. */
  spend_limit?: number;
  spend_limit_duration?: PrivacySpendLimitDuration;
  state?: Extract<PrivacyCardState, "OPEN" | "PAUSED">;
  /** Which funding source pays. Omitted = the account's default. */
  funding_token?: string;
}

/**
 * POST /v1/cards.
 *
 * NOTE: Privacy has no `Idempotency-Key` header the way Increase does, so a
 * retried provisioning run can mint a SECOND card. `provisionCard` runs once
 * per card row and records failure rather than retrying, which is what keeps
 * that from happening in practice; if a retry loop is ever added it must
 * reconcile by `memo` first.
 */
export async function createPrivacyCard(
  client: PrivacyClient,
  params: PrivacyCreateCardParams,
): Promise<PrivacyCard> {
  return await privacyRequest<PrivacyCard>(client, "/cards", {
    method: "POST",
    body: params,
  });
}

export interface PrivacyUpdateCardParams {
  memo?: string;
  spend_limit?: number;
  spend_limit_duration?: PrivacySpendLimitDuration;
  state?: PrivacyCardState;
}

/** PATCH /v1/cards/{card_token}. `state: "CLOSED"` is IRREVERSIBLE. */
export async function updatePrivacyCard(
  client: PrivacyClient,
  cardToken: string,
  params: PrivacyUpdateCardParams,
): Promise<PrivacyCard> {
  return await privacyRequest<PrivacyCard>(
    client,
    `/cards/${encodeURIComponent(cardToken)}`,
    { method: "PATCH", body: params },
  );
}

// ============================================================================
// Transactions — GET /v1/transactions
// ============================================================================

/**
 * Transaction lifecycle status.
 * - `PENDING` / `SETTLING` — authorized, money has not moved.
 * - `SETTLED`              — cleared.
 * - `VOIDED`               — the authorization was released; money never moved.
 * - `DECLINED`             — refused at authorization.
 * - `BOUNCED`              — the funding pull failed after the fact.
 */
export interface PrivacyTransaction {
  token: string;
  card_token: string;
  /** Authorized amount, cents. */
  amount: number;
  /** Cleared amount, cents. Differs from `amount` on tips/partial captures. */
  settled_amount?: number;
  status: string;
  result?: string;
  merchant?: {
    descriptor?: string;
    mcc?: string;
    city?: string;
    state?: string;
  };
  /**
   * The lifecycle trail. `type` is one of `AUTHORIZATION`,
   * `AUTHORIZATION_ADVICE`, `CLEARING`, `VOID`, `RETURN`,
   * `TRANSACTION_CORRECTION_DEBIT`, `TRANSACTION_CORRECTION_CREDIT`.
   */
  events?: Array<{
    token?: string;
    type?: string;
    result?: string;
    amount?: number;
    created?: string;
  }>;
  /** ISO 8601. The poll cursor is a high-water mark over this field. */
  created: string;
}

/** Privacy paginates by PAGE NUMBER (1-based), not by opaque cursor. */
export interface PrivacyTransactionPage {
  data: PrivacyTransaction[];
  page?: number;
  total_pages?: number;
  total_entries?: number;
}

export interface PrivacyListTransactionsParams {
  card_token?: string;
  /** `APPROVED` | `DECLINED`. Omitted = both. */
  result?: "APPROVED" | "DECLINED";
  /** ISO 8601, inclusive. */
  begin?: string;
  /** ISO 8601, exclusive. */
  end?: string;
  /** 1-based. Privacy defaults to 1. */
  page?: number;
  /** Privacy defaults to 50 and caps this at 100 (reference/get_transactions-1). */
  page_size?: number;
}

export async function listPrivacyTransactions(
  client: PrivacyClient,
  params: PrivacyListTransactionsParams,
): Promise<PrivacyTransactionPage> {
  return await privacyRequest<PrivacyTransactionPage>(
    client,
    "/transactions",
    { method: "GET", query: { ...params } },
  );
}

// ============================================================================
// Funding sources — GET /v1/funding_sources
// ============================================================================

export interface PrivacyFundingSource {
  token: string;
  /** `ENABLED` | `PENDING`. */
  state?: string;
  /** Open string on purpose — the docs' two pages disagree on the enum (`CARD_DEBIT` vs `DEPOSITORY_*`). */
  type?: string;
  /** Both are nullable per the schema, hence `null` and not just `undefined`. */
  nickname?: string | null;
  account_name?: string | null;
  last_four?: string;
}

/**
 * The cheapest authenticated read Privacy offers — used as the connection
 * probe. Read-only, so validating a key never moves money, and a revoked key
 * fails HERE, at connect time, rather than later at card creation.
 */
export async function listPrivacyFundingSources(
  client: PrivacyClient,
): Promise<PrivacyFundingSource[]> {
  const result = await privacyRequest<
    PrivacyFundingSource[] | { data: PrivacyFundingSource[] }
  >(client, "/funding_sources", { method: "GET" });
  // Documented as a `{ data, page, total_pages, total_entries }` envelope. The
  // bare-array branch is tolerance, not confusion: this is the ONE call that
  // decides whether a connection is healthy, and an envelope change must not
  // read as "your key stopped working".
  return Array.isArray(result) ? result : (result?.data ?? []);
}

// ============================================================================
// Webhook signature — X-Privacy-HMAC
// ============================================================================

/** The header carrying the base64 HMAC-SHA256 of the canonicalized payload. */
export const PRIVACY_HMAC_HEADER = "X-Privacy-HMAC";

/**
 * JSON, canonicalized the way Privacy signs it: object keys sorted
 * ALPHABETICALLY at every level, and NO whitespace anywhere.
 *
 * Why this exists at all: Privacy does not sign the raw bytes it sent (the way
 * Stripe and Increase do), it signs a canonical re-rendering of the payload.
 * That means we cannot HMAC `await request.text()` — we must parse, re-render
 * in their canonical form, and sign that. It also means key ORDER in the wire
 * body is irrelevant, which is the one property a reviewer should check the
 * tests for.
 *
 * Implementation notes, each one a place a naive version silently diverges:
 * - `JSON.stringify(value, Object.keys(value).sort())` does NOT work: the
 *   replacer-array form applies one key list to every nested object.
 * - Array ORDER is preserved. Only object keys are sorted.
 * - `undefined` members are dropped, matching `JSON.stringify`'s own rule, so
 *   a parsed payload (which can never contain `undefined`) round-trips
 *   identically either way.
 * - `.sort()`'s default UTF-16 code-unit order is the "alphabetical" meaning
 *   for the ASCII snake_case keys Privacy emits; a locale-aware compare would
 *   be the divergence, not the fix.
 */
export function canonicalJsonStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    // Numbers, strings, booleans, null. `undefined`/function/symbol return
    // undefined from JSON.stringify — normalize to "null" so a caller never
    // splices the literal string "undefined" into the signed payload.
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJsonStringify(item)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  const parts: string[] = [];
  for (const key of Object.keys(record).sort()) {
    const serialized = canonicalJsonStringify(record[key]);
    if (record[key] === undefined) continue; // JSON.stringify drops these members
    parts.push(`${JSON.stringify(key)}:${serialized}`);
  }
  return `{${parts.join(",")}}`;
}

/** Constant-time-ish string compare (copied in spirit from lib/finance/increase.ts). */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/**
 * The expected `X-Privacy-HMAC` value for a payload.
 *
 * The signing key is THE ACCOUNT'S API KEY — Privacy issues no separate
 * webhook secret, which is why `cardProviderConnections.webhookSecretCiphertext`
 * stays empty for this provider and why the webhook handler has to decrypt the
 * spending credential to verify a delivery. Rotating the key rotates the
 * signature; there is no overlap window.
 */
export async function signPrivacyWebhook(
  payload: unknown,
  apiKey: string,
): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(apiKey),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(canonicalJsonStringify(payload)),
  );
  return bytesToBase64(new Uint8Array(digest));
}

/**
 * Verify a webhook delivery. Returns a boolean and never throws — a malformed
 * header is "not signed by them", not a 500.
 *
 * NOTE: there is no timestamp in Privacy's scheme, so unlike Increase there is
 * no replay WINDOW to enforce. Replay safety comes entirely from the
 * settlement recorder being idempotent on the transaction token; that is a
 * load-bearing property here, not a nicety.
 */
export async function verifyPrivacyWebhookSignature(
  payload: unknown,
  headerSignature: string | null,
  apiKey: string,
): Promise<boolean> {
  if (!headerSignature) return false;
  try {
    const expected = await signPrivacyWebhook(payload, apiKey);
    return timingSafeEqual(headerSignature.trim(), expected);
  } catch {
    return false;
  }
}
