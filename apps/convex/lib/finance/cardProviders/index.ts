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
  db: { query: (table: "communityFinance") => any };
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
  return await getCardProviderByName(
    await resolveCardProviderName(ctx, communityId),
  );
}

/**
 * The db-free half of `getCardProvider`, for ACTIONS.
 *
 * An action has no `ctx.db`, so the card actions resolve the name inside the
 * internalQuery they already run (`getCardForProvisioning` /
 * `getCardInternal`) and pass it here. Splitting the resolution from the
 * import is what keeps that from costing a second round trip.
 */
export async function getCardProviderByName(
  name: CardProviderName,
): Promise<CardProviderAdapter> {
  switch (name) {
    case "increase": {
      const { increaseCardProvider } = await import("./increase");
      return increaseCardProvider;
    }
    case "privacy":
    case "bill":
      // Phase 1 lands these adapters. Until then a community cannot be put on
      // one (nothing writes `cardProvider`), so reaching this is a
      // hand-edited row — say so plainly rather than falling back to Increase,
      // which would issue a card at the wrong bank.
      throw new ConvexError(
        `The "${name}" card provider isn't available yet — this community's card provider setting is ahead of the code`,
      );
    case "none":
      throw new ConvexError(
        "No card provider is configured for this community — finish finance setup before issuing cards",
      );
  }
}
