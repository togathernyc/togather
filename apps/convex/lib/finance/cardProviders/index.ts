/**
 * Card-provider resolution (ADR-033 §2) — "which issuer does this community
 * use?", answered once, in one place.
 *
 * `functions/finance/cards.ts` calls `getCardProvider(ctx, communityId)` and
 * then talks only to the returned `CardProviderAdapter`. It never branches on
 * a provider name, which is the whole point of the seam: adding an issuer
 * must not add an `if` to the card lifecycle.
 */

import { ConvexError } from "convex/values";
import type { Id } from "../../../_generated/dataModel";
import { decryptCredential, type EncryptedCredential } from "../credentialCrypto";
import type { CardProviderAdapter } from "./types";

export type {
  CardProviderAdapter,
  CardState,
  CardStateRequest,
  NormalizedLimit,
  ProviderCapabilities,
  ProviderCard,
  ProviderTxn,
  ProviderTxnPage,
} from "./types";

/** Names a community can be on. Mirrors `communityFinance.cardProvider`. */
export type CardProviderName = "increase" | "privacy" | "bill" | "none";

/**
 * The minimum context shape this needs. Deliberately structural (`{ db }`)
 * rather than a Convex `QueryCtx`, matching lib/helpers.ts and
 * lib/permissions.ts, so an action can pass through an internalQuery's ctx
 * without a type gymnastics import.
 */
interface DbCtx {
  db: { query: (table: "communityFinance" | "cardProviderConnections") => any };
}

/**
 * A community's live connection to a bring-your-own issuer, as the resolver
 * hands it around: the credential is still ENCRYPTED here. It is decrypted
 * exactly once, inside `getCardProviderByName`, straight into the adapter
 * closure — never assigned to a variable a caller can reach, never returned,
 * never logged. "The key stays in memory only" is a claim this shape has to
 * make structurally true, because a comment cannot.
 */
export interface ProviderConnection {
  connectionId: Id<"cardProviderConnections">;
  /** Carried for the decrypt AAD: the ciphertext only opens for the row's own
   * (community, provider) identity, so a credential lifted onto another row
   * refuses to decrypt (see credentialCrypto.ts's CredentialContext). */
  communityId: Id<"communities">;
  provider: string;
  credential: EncryptedCredential;
  accountLabel?: string;
  syncCursor?: string;
}

/**
 * The community's ACTIVE connection row, or null.
 *
 * "Active" excludes `revoked` (we disconnected — the ciphertext is dead) and
 * `error` (the credential stopped working). Both are deliberate: a card
 * operation on a broken connection should fail with "reconnect your card
 * provider", not with whatever the vendor says about a stale key.
 *
 * Lives here rather than in a function module so the ACTION-side callers
 * (`provisionCard` et al, which have no `ctx.db`) can load it inside the
 * internalQuery they already run, in one round trip.
 */
export async function loadActiveProviderConnection(
  ctx: DbCtx,
  communityId: Id<"communities">,
): Promise<ProviderConnection | null> {
  const rows = await ctx.db
    .query("cardProviderConnections")
    .withIndex("by_community", (q: any) => q.eq("communityId", communityId))
    .collect();
  const active = rows.find(
    (row: { status: string }) => row.status === "active",
  );
  if (!active) return null;
  return {
    connectionId: active._id,
    communityId,
    provider: active.provider,
    credential: {
      ciphertext: active.credentialCiphertext,
      iv: active.credentialIv,
      keyVersion: active.keyVersion,
    },
    accountLabel: active.accountLabel,
    syncCursor: active.syncCursor,
  };
}

/**
 * Read the community's chosen provider, treating "never chosen" as
 * "increase" WHEN the community already has Increase objects.
 *
 * That default is not a guess, it's a migration: every community with cards
 * today was provisioned at Increase by ADR-032's onboarding, and none of them
 * has a `cardProvider` value because the column is new. Rather than backfill
 * a row for each (and risk missing one), the absence is read against the fact
 * that already distinguishes them. A community that has neither a stored
 * choice nor an Increase Entity has genuinely not set up card issuing, and
 * gets the error rather than a silent Increase attempt that would fail later
 * and further from the cause.
 *
 * Exported and pure-ish (one db read) so tests can assert the resolution
 * without going through an adapter.
 */
export async function resolveCardProviderName(
  ctx: DbCtx,
  communityId: Id<"communities">,
): Promise<CardProviderName> {
  const finance = await ctx.db
    .query("communityFinance")
    .withIndex("by_community", (q: any) => q.eq("communityId", communityId))
    .first();

  if (finance?.cardProvider) return finance.cardProvider;
  if (finance?.increaseEntityId) return "increase";
  return "none";
}

/**
 * The adapter for a community's card issuer.
 *
 * Throws a `ConvexError` (not a plain `Error`) on "no provider": this
 * surfaces through public mutations, and a plain Error dead-ends the user in
 * the mobile root ErrorBoundary instead of showing them the message.
 *
 * Adapters are imported LAZILY — an adapter module pulls in a provider client
 * that reads env vars, and a community on provider A must never fail because
 * provider B's key is unset in this deployment.
 */
export async function getCardProvider(
  ctx: DbCtx,
  communityId: Id<"communities">,
): Promise<CardProviderAdapter> {
  const name = await resolveCardProviderName(ctx, communityId);
  return await getCardProviderByName(
    name,
    // Only BYO providers have a connection to load; asking for one on Increase
    // would be a wasted read on every card operation the platform performs.
    name === "increase" || name === "none"
      ? null
      : await loadActiveProviderConnection(ctx, communityId),
  );
}

/**
 * The db-free half of `getCardProvider`, for ACTIONS.
 *
 * An action has no `ctx.db`, so the card actions resolve the name AND load the
 * (still-encrypted) connection inside the internalQuery they already run
 * (`getCardForProvisioning` / `getCardInternal`) and pass both here. Splitting
 * the resolution from the import is what keeps that from costing a second
 * round trip.
 *
 * `connection` is required for a BRING-YOUR-OWN provider and ignored for
 * Increase, whose key is the platform's. DECRYPTION HAPPENS HERE and nowhere
 * else in the card path: the plaintext key is passed straight into the adapter
 * factory and is unreachable from any caller afterwards.
 */
export async function getCardProviderByName(
  name: CardProviderName,
  connection: ProviderConnection | null = null,
): Promise<CardProviderAdapter> {
  switch (name) {
    case "increase": {
      const { increaseCardProvider } = await import("./increase");
      return increaseCardProvider;
    }
    case "privacy": {
      if (!connection) {
        // A community set to "privacy" with no live connection is a real
        // state, not a bug: they disconnected, or the key stopped working and
        // the connection went to "error". Say which thing to do, since the
        // person reading this is the finance admin who has to do it.
        throw new ConvexError(
          "This community's Privacy.com account isn't connected — reconnect it in Community Settings → Finance before issuing or changing cards",
        );
      }
      const { createPrivacyCardProvider } = await import("./privacy");
      return createPrivacyCardProvider(
        await decryptCredential(connection.credential, {
          communityId: connection.communityId,
          provider: connection.provider,
          purpose: "apiKey",
        }),
      );
    }
    case "bill": {
      if (!connection) {
        // Same real state as Privacy's: they disconnected, or the token stopped
        // working and the connection went to "error". Say which thing to do,
        // since the person reading this is the finance admin who has to do it.
        throw new ConvexError(
          "This community's BILL Spend & Expense account isn't connected — reconnect it in Community Settings → Finance before issuing or changing cards",
        );
      }
      const { createBillCardProvider } = await import("./bill");
      return createBillCardProvider(
        await decryptCredential(connection.credential, {
          communityId: connection.communityId,
          provider: connection.provider,
          purpose: "apiKey",
        }),
      );
    }
    case "none":
      throw new ConvexError(
        "No card provider is configured for this community — finish finance setup before issuing cards",
      );
  }
}

/**
 * An adapter for a key that has NOT been stored yet.
 *
 * `connectCardProvider` has to prove a key works BEFORE it is encrypted and
 * written — otherwise a typo becomes a saved connection that fails at the
 * worst possible moment, on someone's first card. That is the only legitimate
 * caller: everywhere else, the credential must come from the database through
 * `getCardProviderByName`, so there is exactly one place a raw key enters the
 * system and it is a function whose name says so.
 */
export async function createUnsavedProvider(
  name: "privacy" | "bill",
  apiKey: string,
): Promise<CardProviderAdapter> {
  if (name === "privacy") {
    const { createPrivacyCardProvider } = await import("./privacy");
    return createPrivacyCardProvider(apiKey);
  }
  const { createBillCardProvider } = await import("./bill");
  return createBillCardProvider(apiKey);
}

/**
 * Can this provider enforce a per-WEEK spend limit natively?
 *
 * Kept here, keyed on the NAME, because the callers that need it are mutations
 * with no credential to build an adapter from — and this must never be the
 * kind of question that requires decrypting a church's API key to answer.
 * MUST agree with the adapter's own `capabilities.weeklyLimits`; a test pins
 * that the two cannot drift.
 *
 * Why refuse rather than degrade: Privacy has TRANSACTION | MONTHLY | ANNUALLY
 * | FOREVER and no week. Mapping "$100/week" onto "$100/month" is strictly
 * tighter, which is the safe direction for the money — but the card screen
 * still says "/ week" with a Monday reset, so the cardholder learns the truth
 * by being declined for three weeks. An honest refusal at the gate beats a
 * safe number under a false label.
 *
 * BILL is the same answer for a slightly different shape (ADR-033 Phase 2): a
 * BILL card limit is a plain AMOUNT with an optional recurrence, and the only
 * period in the model belongs to the BUDGET, not the card. So "$100/week"
 * degrades to a $100 cap that does not reset weekly — same false label, same
 * three weeks of unexplained declines, same refusal.
 */
export function supportsWeeklyLimits(name: CardProviderName): boolean {
  return name !== "privacy" && name !== "bill";
}

/**
 * Must every card at this provider carry a spend limit?
 *
 * YES exactly when the provider has no hard fund isolation. At Increase a fund
 * owns its own Account, so an uncapped card can only ever reach that fund's
 * money — the bank enforces the boundary and "no limit" honestly means "up to
 * this fund's balance". At Privacy every card draws the SAME pooled funding
 * source, so an uncapped card can spend the church's entire account: another
 * group's giving, the general fund, all of it. The card screen's own copy
 * promises the opposite, and no pooled-balance authorization control exists
 * yet (ADR-033 Phase 2).
 *
 * BILL is the same answer and, if anything, a starker version of it (ADR-033
 * Phase 2). Its cards are a CHARGE CARD against the organization's shared
 * credit line — there is no per-fund pot at the bank at all, and a budget is a
 * spending policy rather than segregated money. An uncapped BILL card
 * (`shareBudgetFunds: true`) draws the whole budget, and the budget is
 * whatever the church set it to. So the card limit is again the only boundary
 * Togather controls, and it must exist.
 *
 * So the limit stops being a preference and becomes the only boundary there
 * is. Same shape as `supportsWeeklyLimits` and for the same reason: keyed on
 * the NAME, because the mutations that gate a limit have no credential to
 * build an adapter from. MUST agree with `capabilities.hardFundIsolation` FOR
 * EVERY PROVIDER; a test pins that the two cannot drift.
 */
export function requiresSpendLimit(name: CardProviderName): boolean {
  return name === "privacy" || name === "bill";
}

/** Does this provider bring its own, community-held credential? */
export function isBringYourOwnProvider(
  name: CardProviderName,
): name is "privacy" | "bill" {
  return name === "privacy" || name === "bill";
}
