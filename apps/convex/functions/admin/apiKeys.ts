/**
 * Admin functions for managing community API keys.
 *
 * API keys let external apps call the public attendance HTTP API
 * (`GET /api/v1/attendance` in http.ts). Keys are community-scoped and can
 * only be managed by community admins.
 *
 * The raw key is returned exactly once — from `createApiKey`. After that only
 * the display prefix and metadata are ever returned; the secret lives only as
 * a SHA-256 hash (see lib/apiKeys.ts).
 */

import { v } from "convex/values";
import { query, mutation } from "../../_generated/server";
import { now, getDisplayName } from "../../lib/utils";
import { requireAuth } from "../../lib/auth";
import { requireCommunityAdmin } from "./auth";
import { generateApiKey, hashApiKey } from "../../lib/apiKeys";

/**
 * List API keys for a community (admin only).
 *
 * Never returns the raw key or its hash — only the display prefix and metadata.
 */
export const listApiKeys = query({
  args: {
    token: v.string(),
    communityId: v.id("communities"),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    await requireCommunityAdmin(ctx, args.communityId, userId);

    const keys = await ctx.db
      .query("apiKeys")
      .withIndex("by_community", (q) => q.eq("communityId", args.communityId))
      .collect();

    // Batch-fetch creators for display names.
    const creatorIds = [...new Set(keys.map((k) => k.createdById))];
    const creators = await Promise.all(creatorIds.map((id) => ctx.db.get(id)));
    const creatorMap = new Map(
      creators
        .filter((u): u is NonNullable<typeof u> => u !== null)
        .map((u) => [u._id, u])
    );

    // Newest first.
    keys.sort((a, b) => b.createdAt - a.createdAt);

    return keys.map((key) => {
      const creator = creatorMap.get(key.createdById);
      return {
        id: key._id,
        name: key.name,
        keyPrefix: key.keyPrefix,
        createdAt: key.createdAt,
        lastUsedAt: key.lastUsedAt ?? null,
        revokedAt: key.revokedAt ?? null,
        isActive: !key.revokedAt,
        createdByName: creator
          ? getDisplayName(creator.firstName, creator.lastName)
          : "Unknown",
      };
    });
  },
});

/**
 * Create a new API key for a community (admin only).
 *
 * Returns the raw key in the `key` field — this is the ONLY time it is exposed.
 * The caller must surface it to the admin immediately to copy and store.
 */
export const createApiKey = mutation({
  args: {
    token: v.string(),
    communityId: v.id("communities"),
    name: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    await requireCommunityAdmin(ctx, args.communityId, userId);

    const name = args.name.trim();
    if (!name) {
      throw new Error("API key name is required");
    }

    const { raw, prefix } = generateApiKey();
    const keyHash = await hashApiKey(raw);
    const timestamp = now();

    const id = await ctx.db.insert("apiKeys", {
      communityId: args.communityId,
      name,
      keyHash,
      keyPrefix: prefix,
      createdById: userId,
      createdAt: timestamp,
    });

    return {
      id,
      name,
      keyPrefix: prefix,
      createdAt: timestamp,
      // Shown to the admin once; never returned again.
      key: raw,
    };
  },
});

/**
 * Revoke an API key (admin only).
 *
 * Once revoked, the key immediately stops authenticating API requests. The row
 * is kept (rather than deleted) so the audit trail and "last used" data remain
 * visible in the UI.
 */
export const revokeApiKey = mutation({
  args: {
    token: v.string(),
    communityId: v.id("communities"),
    keyId: v.id("apiKeys"),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    await requireCommunityAdmin(ctx, args.communityId, userId);

    const key = await ctx.db.get(args.keyId);
    if (!key || key.communityId !== args.communityId) {
      throw new Error("API key not found");
    }

    if (!key.revokedAt) {
      await ctx.db.patch(args.keyId, {
        revokedAt: now(),
        revokedById: userId,
      });
    }

    return { success: true };
  },
});
