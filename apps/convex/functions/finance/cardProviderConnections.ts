/**
 * Connecting a community's OWN card issuer (ADR-033 Phase 1).
 *
 * This module is where a church's API key enters Togather, and it is the only
 * one. Everything about its shape follows from what that key can do — it can
 * spend the church's money — so the rules are absolute rather than
 * best-effort:
 *
 * 1. **The key is never persisted in plaintext, never logged, never
 *    returned.** It exists as a string in exactly one place: the argument to
 *    `connectCardProvider`'s action, for as long as it takes to prove it works
 *    and encrypt it. `getCardProviderStatus` returns the account LABEL and the
 *    status and nothing else; there is no "reveal key" surface and there never
 *    should be, because we cannot show a church something we deliberately
 *    cannot read back cheaply.
 * 2. **A key is PROVED before it is stored.** `checkConnection` does a
 *    read-only call at the provider first. A saved-but-broken connection is
 *    worse than a rejected one: it fails later, in front of someone trying to
 *    buy something.
 * 3. **Disconnecting is guarded by the live cards.** Revoking the credential
 *    while cards are open leaves the church with spending instruments Togather
 *    can no longer pause, close, or reconcile — the cards keep working and we
 *    go blind. So the default refuses and says to close the cards first;
 *    `force` exists for the case where the key is already compromised and
 *    keeping it is the bigger risk.
 *
 * COMMUNITY-level finance access gates every entry point here
 * (`requireCommunityFinanceAccess`), not plain community-admin: handing a
 * vendor a spending credential is precisely the power ADR-033 §5 separated out
 * of "can edit branding".
 */

import { ConvexError, v } from "convex/values";
import {
  action,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "../../_generated/server";
import { internal } from "../../_generated/api";
import type { Id } from "../../_generated/dataModel";
import { requireAuth } from "../../lib/auth";
import { now } from "../../lib/utils";
import { logFinanceAudit } from "../../lib/finance/audit";
import { requireCommunityFinanceAccess } from "../../lib/finance/communityFinanceAccess";
import { encryptCredential } from "../../lib/finance/credentialCrypto";
import { createUnsavedProvider } from "../../lib/finance/cardProviders";

/**
 * The providers a community can connect today.
 *
 * A union, not a bare string, so adding the second BYO issuer is a change
 * someone has to make deliberately in three places that must agree: here, the
 * schema, and the resolver.
 */
const byoProviderValidator = v.literal("privacy");

/**
 * Card statuses that mean "this card is DEAD and can be ignored when deciding
 * whether a connection is still in use".
 *
 * Deliberately a small denylist rather than a big allowlist: `cards.status`
 * carries the PROVIDER's own string (see schema.ts), so the set of live values
 * grows every time an issuer invents one, while the set of dead ones is short
 * and known. Guessing wrong in this direction makes the disconnect guard fire
 * when it needn't — annoying. Guessing wrong the other way silently revokes a
 * key out from under a working card.
 */
const DEAD_CARD_STATUSES = new Set(["CLOSED", "canceled", "closed", "failed"]);

// ============================================================================
// Reading the connection
// ============================================================================

/**
 * The community's connection row, if any.
 *
 * Returns the LATEST row rather than the active one: an admin looking at this
 * screen after a key was revoked needs to see "disconnected", not an empty
 * state that implies they never connected at all.
 */
async function loadConnectionRow(
  ctx: { db: any },
  communityId: Id<"communities">,
) {
  const rows = await ctx.db
    .query("cardProviderConnections")
    .withIndex("by_community", (q: any) => q.eq("communityId", communityId))
    .collect();
  if (rows.length === 0) return null;
  return (
    rows.find((row: { status: string }) => row.status === "active") ??
    rows.reduce((latest: any, row: any) =>
      row.updatedAt > latest.updatedAt ? row : latest,
    )
  );
}

/**
 * What the connection screen shows.
 *
 * CREDENTIALS ARE NOT IN THIS SHAPE, and that is a design constraint rather
 * than an omission: there is no field here a future edit could widen into
 * leaking one. Not the ciphertext, not the IV, not a masked prefix — a
 * "pk_live_abc…" hint is still four characters of a live spending key handed
 * to whoever can read a query response.
 */
export const getCardProviderStatus = query({
  args: { token: v.string(), communityId: v.id("communities") },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    await requireCommunityFinanceAccess(ctx, userId, args.communityId);

    const finance = await ctx.db
      .query("communityFinance")
      .withIndex("by_community", (q) => q.eq("communityId", args.communityId))
      .first();
    const connection = await loadConnectionRow(ctx, args.communityId);

    return {
      /** The community's chosen issuer, or null if they've never chosen. */
      cardProvider: finance?.cardProvider ?? null,
      connection: connection
        ? {
            provider: connection.provider as "privacy" | "bill",
            /** Provider-supplied display text — untrusted, escape at render. */
            accountLabel: connection.accountLabel ?? null,
            status: connection.status as "active" | "error" | "revoked",
            lastSyncAt: connection.lastSyncAt ?? null,
            /** Why the connection went to "error". Provider text, untrusted. */
            lastError: connection.lastError ?? null,
            connectedAt: connection.createdAt,
          }
        : null,
    };
  },
});

// ============================================================================
// connectCardProvider — the one door a raw API key comes through
// ============================================================================

/**
 * Auth + finance-access gate for the action below. Actions have no `ctx.db`,
 * so the gate runs here and hands back only the caller's id.
 *
 * Mirrors onboarding.ts's `assertAdminAndGetFinance`.
 */
export const assertFinanceAccessForConnect = internalQuery({
  args: { token: v.string(), communityId: v.id("communities") },
  handler: async (ctx, args): Promise<Id<"users">> => {
    const userId = await requireAuth(ctx, args.token);
    await requireCommunityFinanceAccess(ctx, userId, args.communityId);
    return userId;
  },
});

/**
 * Write the encrypted connection and point the community's card issuing at it.
 *
 * Takes CIPHERTEXT, never the key: encryption happens in the action, so the
 * plaintext never crosses a function boundary that Convex would log arguments
 * for. Internal, and re-checks access anyway — the gate that matters is one
 * transaction older by the time this runs, and this is the write that grants
 * spending power.
 *
 * UPSERTS the community's existing row rather than inserting a second: a
 * community has one card issuer, and a re-connect (rotated key, fixed typo)
 * must replace the credential, not race an old one that still resolves first.
 */
export const saveCardProviderConnection = internalMutation({
  args: {
    communityId: v.id("communities"),
    userId: v.id("users"),
    provider: byoProviderValidator,
    credentialCiphertext: v.string(),
    credentialIv: v.string(),
    keyVersion: v.number(),
    accountLabel: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireCommunityFinanceAccess(ctx, args.userId, args.communityId);

    const timestamp = now();
    const existing = await ctx.db
      .query("cardProviderConnections")
      .withIndex("by_community", (q) => q.eq("communityId", args.communityId))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        provider: args.provider,
        credentialCiphertext: args.credentialCiphertext,
        credentialIv: args.credentialIv,
        keyVersion: args.keyVersion,
        accountLabel: args.accountLabel,
        status: "active",
        // A fresh credential invalidates the old failure AND the old position
        // in the transaction feed: the new key may be for a different Privacy
        // account entirely, whose transaction history has nothing to do with
        // the cursor we were holding.
        lastError: undefined,
        syncCursor: undefined,
        connectedById: args.userId,
        updatedAt: timestamp,
      });
    } else {
      await ctx.db.insert("cardProviderConnections", {
        communityId: args.communityId,
        provider: args.provider,
        credentialCiphertext: args.credentialCiphertext,
        credentialIv: args.credentialIv,
        keyVersion: args.keyVersion,
        accountLabel: args.accountLabel,
        status: "active",
        connectedById: args.userId,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
    }

    // The connection is only half the switch — `cardProvider` is what the
    // resolver reads. Writing both in ONE transaction is what stops a
    // community from ending up connected-but-still-issuing-at-Increase.
    const finance = await ctx.db
      .query("communityFinance")
      .withIndex("by_community", (q) => q.eq("communityId", args.communityId))
      .first();
    if (finance) {
      await ctx.db.patch(finance._id, {
        cardProvider: args.provider,
        updatedAt: timestamp,
      });
    }

    await logFinanceAudit(ctx, {
      communityId: args.communityId,
      actorUserId: args.userId,
      action: "card_provider.connected",
      details: {
        provider: args.provider,
        // The LABEL, not the key, and not a fingerprint of the key either —
        // an audit row is a permanent record and must not become the place a
        // credential survives.
        accountLabel: args.accountLabel ?? null,
        reconnected: existing !== null,
      },
    });
  },
});

/**
 * Connect a community's own card issuer.
 *
 * An ACTION because both halves need one: `checkConnection` makes an HTTP call
 * to the provider, and `encryptCredential` uses Web Crypto. Doing the
 * encryption HERE rather than in the mutation means the raw key is never a
 * mutation argument — Convex records those, and a spending credential must not
 * be recoverable from a function log.
 *
 * Returns the account label so the caller can confirm what they connected. It
 * never returns, echoes, or errors with the key.
 */
export const connectCardProvider = action({
  args: {
    token: v.string(),
    communityId: v.id("communities"),
    provider: byoProviderValidator,
    /** The community's own API key at the provider. Proven, encrypted, then dropped. */
    apiKey: v.string(),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ accountLabel: string | null }> => {
    const userId: Id<"users"> = await ctx.runQuery(
      internal.functions.finance.cardProviderConnections
        .assertFinanceAccessForConnect,
      { token: args.token, communityId: args.communityId },
    );

    const apiKey = args.apiKey.trim();
    if (!apiKey) {
      throw new ConvexError("Enter your Privacy.com API key");
    }

    const provider = await createUnsavedProvider(args.provider, apiKey);
    if (!provider.checkConnection) {
      // Structural impossibility today (every BYO adapter implements it), but
      // the interface makes it optional, so failing loudly beats storing an
      // unproven key on a provider that forgot to implement its probe.
      throw new ConvexError(
        `The ${args.provider} adapter can't validate a credential — refusing to store one it cannot check`,
      );
    }

    let accountLabel: string | null;
    try {
      ({ accountLabel } = await provider.checkConnection());
    } catch (error) {
      // The provider's own words, so an admin can tell "wrong key" from
      // "account suspended". Truncated because it is untrusted vendor text
      // headed for a UI. The key cannot appear here: the client never puts it
      // in a message and the URL it builds carries no credential.
      const message = error instanceof Error ? error.message : String(error);
      throw new ConvexError(
        `Couldn't reach ${args.provider} with that API key: ${message.slice(0, 300)}`,
      );
    }

    const encrypted = await encryptCredential(apiKey, {
      communityId: args.communityId,
      provider: args.provider,
      purpose: "apiKey",
    });
    await ctx.runMutation(
      internal.functions.finance.cardProviderConnections
        .saveCardProviderConnection,
      {
        communityId: args.communityId,
        userId,
        provider: args.provider,
        credentialCiphertext: encrypted.ciphertext,
        credentialIv: encrypted.iv,
        keyVersion: encrypted.keyVersion,
        accountLabel: accountLabel ?? undefined,
      },
    );

    return { accountLabel };
  },
});

// ============================================================================
// disconnectCardProvider
// ============================================================================

/**
 * Disconnect the community's card issuer.
 *
 * Marks the row `revoked` and sets `cardProvider` back to `"none"`. The
 * ciphertext is left in place rather than blanked: the row is the audit trail
 * of who connected what and when, and a dead ciphertext with no key ever
 * decrypts anyway. (A future key rotation clears it for real.)
 *
 * REFUSES while live cards exist on that provider, unless `force`. The reason
 * is not tidiness: those cards keep authorizing after we lose the key, and
 * Togather can no longer pause them, close them, or record what they spend.
 * "Close the cards first" is the only sequence that ends with the church in
 * control of its own instruments. `force` is for the case where the key is
 * already compromised and holding it is the greater risk — it is audited
 * distinctly for exactly that reason.
 */
export const disconnectCardProvider = mutation({
  args: {
    token: v.string(),
    communityId: v.id("communities"),
    /** Revoke even with live cards outstanding. Audited separately. */
    force: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    await requireCommunityFinanceAccess(ctx, userId, args.communityId);

    const connection = await loadConnectionRow(ctx, args.communityId);
    if (!connection || connection.status === "revoked") {
      throw new ConvexError(
        "There's no connected card provider for this community",
      );
    }

    const liveCards = await countLiveProviderCards(
      ctx,
      args.communityId,
      connection.provider,
    );
    if (liveCards > 0 && !args.force) {
      throw new ConvexError(
        `${liveCards} card${liveCards === 1 ? "" : "s"} ${liveCards === 1 ? "is" : "are"} still open at ${connection.provider}. Close ${liveCards === 1 ? "it" : "them"} first — disconnecting now would leave ${liveCards === 1 ? "a card" : "cards"} spending that Togather can no longer pause or track.`,
      );
    }

    const timestamp = now();
    await ctx.db.patch(connection._id, {
      status: "revoked",
      updatedAt: timestamp,
    });

    const finance = await ctx.db
      .query("communityFinance")
      .withIndex("by_community", (q) => q.eq("communityId", args.communityId))
      .first();
    if (finance) {
      // "none", not absent: the resolver reads a missing value as "increase"
      // for any community with Increase ids, and a BYO community that
      // disconnects must not silently start issuing at Togather's bank.
      await ctx.db.patch(finance._id, {
        cardProvider: "none",
        updatedAt: timestamp,
      });
    }

    await logFinanceAudit(ctx, {
      communityId: args.communityId,
      actorUserId: userId,
      action: "card_provider.disconnected",
      details: {
        provider: connection.provider,
        forced: args.force === true,
        liveCardsAtDisconnect: liveCards,
      },
    });

    return { liveCardsAtDisconnect: liveCards };
  },
});

/**
 * How many of this community's cards are still alive at `provider`.
 *
 * Walks funds -> cards because `cards` has no community index (a card belongs
 * to a fund, and the fund carries the community). Bounded by the community's
 * own fund count, which is one per giving-enabled group — small by
 * construction, and this runs once per disconnect.
 */
async function countLiveProviderCards(
  ctx: { db: any },
  communityId: Id<"communities">,
  provider: string,
): Promise<number> {
  const funds = await ctx.db
    .query("funds")
    .withIndex("by_community", (q: any) => q.eq("communityId", communityId))
    .collect();

  let live = 0;
  for (const fund of funds) {
    const cards = await ctx.db
      .query("cards")
      .withIndex("by_fund", (q: any) => q.eq("fundId", fund._id))
      .collect();
    for (const card of cards) {
      if (card.provider !== provider) continue;
      if (DEAD_CARD_STATUSES.has(card.status)) continue;
      live++;
    }
  }
  return live;
}

// ============================================================================
// Internal helpers for the poller and the webhook
// ============================================================================

/**
 * Record the result of a poll: how far the feed was read, and whether the
 * credential still works.
 *
 * `syncCursor` is only ADVANCED, never cleared — see the Privacy adapter's
 * `listTransactions` for why a cursor that can go backwards is worse than one
 * that stalls.
 */
export const recordConnectionSync = internalMutation({
  args: {
    connectionId: v.id("cardProviderConnections"),
    syncCursor: v.optional(v.string()),
    /** Present when the poll failed — flips the connection to "error". */
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const connection = await ctx.db.get(args.connectionId);
    if (!connection) return;

    if (args.error !== undefined) {
      await ctx.db.patch(args.connectionId, {
        status: "error",
        // Truncated vendor text; untrusted, shown to an operator as-is.
        lastError: args.error.slice(0, 500),
        updatedAt: now(),
      });
      return;
    }

    await ctx.db.patch(args.connectionId, {
      // A successful poll clears a previous failure. The credential demonstrably
      // works again, and leaving "error" showing after that is how a support
      // ticket gets opened for a problem that fixed itself.
      status: "active",
      lastError: undefined,
      lastSyncAt: now(),
      ...(args.syncCursor !== undefined ? { syncCursor: args.syncCursor } : {}),
    });
  },
});

/** Every active BYO connection, for the hourly poll's fan-out. */
export const listActiveConnections = internalQuery({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("cardProviderConnections").collect();
    return rows
      .filter((row) => row.status === "active")
      .map((row) => ({
        connectionId: row._id,
        communityId: row.communityId,
        provider: row.provider,
        syncCursor: row.syncCursor ?? null,
      }));
  },
});
