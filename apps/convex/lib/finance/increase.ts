/**
 * Dependency-free Increase API client (ADR-032 §2/§6).
 *
 * Increase is the banking core: one Entity per community (KYB'd once), a
 * receiving Account (Stripe's payout destination) and a General Account under
 * it, plus one Account per group with giving enabled. This client is plain
 * `fetch` — no `increase` npm package — because Convex actions/httpActions
 * run in a restricted V8 isolate (no Node `crypto`/`Buffer`), the same reason
 * `http.ts`'s Stripe signature check hand-rolls HMAC with Web Crypto instead
 * of the Stripe SDK's `constructEvent`.
 *
 * Every endpoint path, request/response field name, and the webhook signature
 * scheme below were confirmed against Increase's own OpenAPI document
 * (https://increase.com/openapi.json, fetched 2026-07-29) and
 * https://increase.com/documentation/webhooks — not guessed. Inline comments
 * cite the specific doc section for anything non-obvious.
 *
 * Base URL: the OpenAPI spec's `servers` list has TWO hosts —
 * `https://api.increase.com` (production) and `https://sandbox.increase.com`
 * (sandbox) — not one host shared by key type. `INCREASE_API_BASE_URL`
 * selects which; set it to the sandbox host alongside a sandbox API key for
 * dev/staging (see docs/secrets.md).
 */

// ============================================================================
// Lazy env reads (mirrors lib/resend.ts's getResendClient pattern — reading
// at call time, not module load, so codegen/import never fails on a missing
// key in environments that don't send finance traffic).
// ============================================================================

function getIncreaseApiKey(): string {
  const key = process.env.INCREASE_API_KEY;
  if (!key) {
    throw new Error("INCREASE_API_KEY environment variable is not configured");
  }
  return key;
}

/** Exported so functions/finance/webhooks.ts can fetch the secret once per request. */
export function getIncreaseWebhookSecret(): string {
  const secret = process.env.INCREASE_WEBHOOK_SECRET;
  if (!secret) {
    throw new Error(
      "INCREASE_WEBHOOK_SECRET environment variable is not configured",
    );
  }
  return secret;
}

/** https://increase.com/openapi.json `servers` — two hosts, not one shared by key type. */
function getIncreaseBaseUrl(): string {
  return process.env.INCREASE_API_BASE_URL ?? "https://api.increase.com";
}

// ============================================================================
// Request plumbing
// ============================================================================

interface IncreaseRequestOptions {
  method: "GET" | "POST" | "PATCH";
  body?: unknown;
  /**
   * Sent as the `Idempotency-Key` header on every POST, per
   * https://increase.com/documentation/idempotency-keys ("provide an
   * additional, unique `Idempotency-Key` request header per intended
   * request" to safely retry without duplicating the effect).
   */
  idempotencyKey?: string;
}

async function increaseRequest<T>(
  path: string,
  options: IncreaseRequestOptions,
): Promise<T> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${getIncreaseApiKey()}`,
    "Content-Type": "application/json",
  };
  if (options.idempotencyKey) {
    headers["Idempotency-Key"] = options.idempotencyKey;
  }

  const response = await fetch(`${getIncreaseBaseUrl()}${path}`, {
    method: options.method,
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `Increase API ${options.method} ${path} failed (${response.status}): ${text}`,
    );
  }

  return (await response.json()) as T;
}

// ============================================================================
// Entities — https://increase.com/openapi.json #/paths/~1entities/post
// (schema: create_an_entity_parameters / entity)
// ============================================================================

export interface IncreaseAddress {
  addressLine1: string;
  addressLine2?: string;
  city: string;
  state: string;
  zipCode: string;
}

export interface CreateEntityInput {
  legalName: string;
  /** communityFinance.ein, either "NN-NNNNNNN" or bare digits — dashes are stripped before sending. */
  ein: string;
  website?: string;
  address: IncreaseAddress;
  idempotencyKey: string;
}

export interface IncreaseEntity {
  id: string;
  status: "active" | "archived" | "disabled";
}

/**
 * Create a "corporation" Entity for a community's church.
 *
 * Increase normally requires `beneficial_owners` (identifying details,
 * including SSN, for the CEO/owners) for a corporation Entity. Togather's
 * one-form onboarding (ADR-032 §2) deliberately never collects a
 * representative's SSN — Stripe's hosted onboarding is the one identity
 * verification step. Increase's own schema anticipates this: submitting
 * `beneficial_ownership_exemption_reason` in place of `beneficial_owners` is
 * allowed "after approval from your bank partner" (create_an_entity_parameters
 * -> corporation.beneficial_ownership_exemption_reason enum description),
 * which is exactly the one-time platform-level underwriting relationship
 * ADR-032 §2 describes Togather establishing with Increase.
 */
export async function createEntity(
  input: CreateEntityInput,
): Promise<IncreaseEntity> {
  const corporation: Record<string, unknown> = {
    name: input.legalName,
    website: input.website,
    address: {
      line1: input.address.addressLine1,
      line2: input.address.addressLine2,
      city: input.address.city,
      state: input.address.state,
      zip: input.address.zipCode,
      country: "US",
    },
    legal_identifier: {
      category: "us_employer_identification_number",
      value: input.ein.replace(/-/g, ""),
    },
  };

  if (getIncreaseBaseUrl().includes("sandbox")) {
    // The exemption parameter is rejected until Increase's bank partner
    // approves it for the program (verified live: sandbox 400s with
    // "beneficial_ownership_exemption_reason: Unexpected parameter" and then
    // requires beneficial_owners). Sandbox is test data by definition, so we
    // submit an obviously-fake owner there to keep dev/staging flows working
    // end-to-end. Production keeps the exemption — real owner PII must never
    // be fabricated, and launch is gated on the exemption approval anyway
    // (docs/finance/COMPLIANCE.md).
    corporation.beneficial_owners = [
      {
        individual: {
          name: "Sandbox Test Owner",
          date_of_birth: "1980-01-01",
          address: {
            line1: "123 Main Street",
            city: "New York",
            state: "NY",
            zip: "10001",
            country: "US",
          },
          identification: {
            method: "social_security_number",
            number: "078051120",
          },
        },
        prongs: ["control"],
      },
    ];
  } else {
    corporation.beneficial_ownership_exemption_reason = "other";
  }

  return await increaseRequest<IncreaseEntity>("/entities", {
    method: "POST",
    idempotencyKey: input.idempotencyKey,
    body: {
      structure: "corporation",
      corporation,
    },
  });
}

/** GET /entities/{id} — needed by the entity.updated webhook, whose payload only carries the id (see verifyIncreaseWebhookSignature / handleIncreaseWebhookRequest). */
export async function getEntity(entityId: string): Promise<IncreaseEntity> {
  return await increaseRequest<IncreaseEntity>(`/entities/${entityId}`, {
    method: "GET",
  });
}

// ============================================================================
// Accounts — POST /accounts (create_an_account_parameters / account)
// ============================================================================

export interface IncreaseAccount {
  id: string;
  status: string;
}

export async function createAccount(
  entityId: string,
  name: string,
  idempotencyKey: string,
): Promise<IncreaseAccount> {
  return await increaseRequest<IncreaseAccount>("/accounts", {
    method: "POST",
    idempotencyKey,
    body: { entity_id: entityId, name },
  });
}

// ============================================================================
// Account Numbers — POST /account_numbers
// (create_an_account_number_parameters / account_number)
// ============================================================================

export interface IncreaseAccountNumber {
  id: string;
  accountNumber: string;
  routingNumber: string;
}

/**
 * Mint an Account Number (routing + account number) for an Account — used to
 * set an Account (typically the receiving Account) as a Stripe Connect
 * external payout destination.
 */
export async function createAccountNumber(
  accountId: string,
  name: string,
  idempotencyKey: string,
): Promise<IncreaseAccountNumber> {
  const result = await increaseRequest<{
    id: string;
    account_number: string;
    routing_number: string;
  }>("/account_numbers", {
    method: "POST",
    idempotencyKey,
    body: { account_id: accountId, name },
  });
  return {
    id: result.id,
    accountNumber: result.account_number,
    routingNumber: result.routing_number,
  };
}

// ============================================================================
// Account Transfers — POST /account_transfers (Increase Account <-> Account,
// e.g. the allocation job's receiving-Account -> group-Account split, or a
// group -> General sweep on archive). create_an_account_transfer_parameters.
// ============================================================================

export interface CreateAccountTransferInput {
  fromAccountId: string;
  toAccountId: string;
  amountCents: number;
  description: string;
  idempotencyKey: string;
}

export interface IncreaseAccountTransfer {
  id: string;
  status: string;
}

export async function createAccountTransfer(
  input: CreateAccountTransferInput,
): Promise<IncreaseAccountTransfer> {
  return await increaseRequest<IncreaseAccountTransfer>("/account_transfers", {
    method: "POST",
    idempotencyKey: input.idempotencyKey,
    body: {
      account_id: input.fromAccountId,
      destination_account_id: input.toAccountId,
      amount: input.amountCents,
      description: input.description,
    },
  });
}

// ============================================================================
// ACH Transfers — POST /ach_transfers (Increase Account -> outside bank, e.g.
// a member reimbursement). create_an_ach_transfer_parameters.
// ============================================================================

export interface CreateAchTransferInput {
  accountId: string;
  amountCents: number;
  statementDescriptor: string;
  routingNumber: string;
  accountNumber: string;
  individualName?: string;
  /** Our internal identifier for the recipient (e.g. the reimbursement's expense id) — informational, not verified by Increase. */
  individualId?: string;
  idempotencyKey: string;
}

export interface IncreaseAchTransfer {
  id: string;
  status: string;
}

export async function createAchTransfer(
  input: CreateAchTransferInput,
): Promise<IncreaseAchTransfer> {
  return await increaseRequest<IncreaseAchTransfer>("/ach_transfers", {
    method: "POST",
    idempotencyKey: input.idempotencyKey,
    body: {
      account_id: input.accountId,
      amount: input.amountCents,
      statement_descriptor: input.statementDescriptor,
      routing_number: input.routingNumber,
      account_number: input.accountNumber,
      individual_name: input.individualName,
      // Increase enforces a 15-character max on individual_id (verified live:
      // longer values 400). Callers pass Convex document ids (~32 chars) as a
      // reconciliation breadcrumb, so truncate here at the client boundary —
      // the full id lives in our own expense/audit records anyway.
      individual_id: input.individualId?.slice(0, 15),
    },
  });
}

// ============================================================================
// Balances — GET /accounts/{id}/balance (balance_lookup)
// ============================================================================

export interface IncreaseBalance {
  availableBalanceCents: number;
  currentBalanceCents: number;
}

export async function getAccountBalance(
  accountId: string,
): Promise<IncreaseBalance> {
  const result = await increaseRequest<{
    available_balance: number;
    current_balance: number;
  }>(`/accounts/${accountId}/balance`, { method: "GET" });
  return {
    availableBalanceCents: result.available_balance,
    currentBalanceCents: result.current_balance,
  };
}

// ============================================================================
// Webhook signature verification
// https://increase.com/documentation/webhooks
// ============================================================================

/**
 * Constant-time string comparison — mirrors `timingSafeEqual` in http.ts
 * (same rationale: prevent a timing side-channel on the comparison).
 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

/**
 * The three headers Increase sends with every webhook POST
 * (https://increase.com/documentation/webhooks): `webhook-id`,
 * `webhook-timestamp`, and `webhook-signature`.
 */
export interface IncreaseWebhookHeaders {
  webhookId: string;
  webhookTimestamp: string;
  webhookSignature: string;
}

/**
 * Verify an Increase webhook's signature.
 *
 * Per https://increase.com/documentation/webhooks: the signed payload is
 * `{webhook-id}.{webhook-timestamp}.{raw_request_body}`, HMAC-SHA256'd with
 * the endpoint's signing secret (used directly as the key — no prefix/decode
 * step), base64-encoded, and prefixed `v1,`. `webhook-signature` may contain
 * multiple space-separated `v1,...` signatures during secret rotation — any
 * match is valid. We also enforce Increase's documented 300-second replay
 * window (same tolerance Stripe uses, see http.ts's `verifyStripeSignature`).
 *
 * Uses Web Crypto (`crypto.subtle`) rather than Node's `crypto`/`Buffer` —
 * this runs inside an httpAction-driven handler, the same restricted V8
 * isolate that forced http.ts to hand-roll Stripe signature verification.
 */
export async function verifyIncreaseWebhookSignature(
  rawBody: string,
  headers: IncreaseWebhookHeaders,
  secret: string,
): Promise<boolean> {
  try {
    const timestampSec = Number(headers.webhookTimestamp);
    if (!Number.isFinite(timestampSec)) return false;
    const nowSec = Math.floor(Date.now() / 1000);
    if (Math.abs(nowSec - timestampSec) > 300) return false;

    const signedPayload = `${headers.webhookId}.${headers.webhookTimestamp}.${rawBody}`;
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const digest = await crypto.subtle.sign(
      "HMAC",
      key,
      encoder.encode(signedPayload),
    );
    const expected = `v1,${bytesToBase64(new Uint8Array(digest))}`;

    return headers.webhookSignature
      .split(" ")
      .some((candidate) => timingSafeEqual(candidate.trim(), expected));
  } catch {
    return false;
  }
}
