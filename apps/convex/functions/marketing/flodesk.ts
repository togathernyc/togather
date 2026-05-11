/**
 * Flodesk integration
 *
 * Flodesk is an email marketing platform. This module syncs Togather community
 * members into a single Flodesk segment chosen by the admin at connect time.
 *
 * Design mirrors clearstream.ts — see that file for the full design rationale.
 * Differences:
 * - Auth: HTTP Basic, API key as username with empty password.
 * - Identifier: email (not phone). Users without an email are skipped.
 *
 * API reference: https://developers.flodesk.com
 *   Base URL:  https://api.flodesk.com/v1
 *   Auth:      Authorization: Basic <base64(apiKey + ":")>
 *   Endpoints used:
 *     GET    /segments                          — list segments for picker
 *     POST   /subscribers                       — create-or-update by email
 *     POST   /subscribers/{email}/segments      — add to segment
 */

import { v } from "convex/values";
import {
  query,
  mutation,
  action,
  internalQuery,
  internalMutation,
  internalAction,
} from "../../_generated/server";
import { internal } from "../../_generated/api";
import { now } from "../../lib/utils";
import { requireAuth } from "../../lib/auth";
import { isCommunityAdmin } from "../../lib/permissions";

const PLATFORM = "flodesk" as const;
const FLODESK_BASE_URL = "https://api.flodesk.com/v1";

interface FlodeskCredentials {
  apiKey: string;
}

interface FlodeskConfig {
  segmentId: string;
  segmentName?: string;
}

interface FlodeskSegment {
  id: string;
  name: string;
}

// ============================================================================
// HTTP helper
// ============================================================================

function flodeskAuthHeader(apiKey: string): string {
  // Flodesk uses HTTP Basic with the API key as the username and empty password.
  const encoded = btoa(`${apiKey}:`);
  return `Basic ${encoded}`;
}

async function flodeskFetch(
  apiKey: string,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const headers: Record<string, string> = {
    Authorization: flodeskAuthHeader(apiKey),
    Accept: "application/json",
    ...((init.headers as Record<string, string>) || {}),
  };
  if (init.body && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/json";
  }
  return fetch(`${FLODESK_BASE_URL}${path}`, { ...init, headers });
}

// ============================================================================
// Queries
// ============================================================================

export const status = query({
  args: {
    token: v.string(),
    communityId: v.id("communities"),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);

    const membership = await ctx.db
      .query("userCommunities")
      .withIndex("by_user_community", (q) =>
        q.eq("userId", userId).eq("communityId", args.communityId),
      )
      .first();
    if (!membership || membership.status !== 1) {
      throw new Error("Not a member of this community");
    }

    const integration = await ctx.db
      .query("communityIntegrations")
      .withIndex("by_community_type", (q) =>
        q.eq("communityId", args.communityId).eq("integrationType", PLATFORM),
      )
      .first();

    if (!integration) {
      return {
        isConnected: false,
        status: null,
        lastSyncAt: null,
        lastError: null,
        segmentId: null,
        segmentName: null,
        connectedBy: null,
      };
    }

    const config = (integration.config as FlodeskConfig | null) ?? null;

    let connectedBy = null;
    if (integration.connectedById) {
      const user = await ctx.db.get(integration.connectedById);
      if (user) {
        connectedBy = {
          id: user._id,
          firstName: user.firstName || "",
          lastName: user.lastName || "",
        };
      }
    }

    return {
      isConnected: integration.status === "connected",
      status: integration.status,
      lastSyncAt: integration.lastSyncAt || null,
      lastError: integration.lastError || null,
      segmentId: config?.segmentId || null,
      segmentName: config?.segmentName || null,
      connectedBy,
    };
  },
});

// ============================================================================
// Mutations
// ============================================================================

export const connect = mutation({
  args: {
    token: v.string(),
    communityId: v.id("communities"),
    apiKey: v.string(),
    segmentId: v.optional(v.string()),
    segmentName: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    const isAdmin = await isCommunityAdmin(ctx, args.communityId, userId);
    if (!isAdmin) {
      throw new Error("Only community admins can connect integrations");
    }

    const timestamp = now();
    const credentials: FlodeskCredentials = { apiKey: args.apiKey };
    const config: FlodeskConfig | Record<string, never> = args.segmentId
      ? { segmentId: args.segmentId, segmentName: args.segmentName }
      : {};

    const existing = await ctx.db
      .query("communityIntegrations")
      .withIndex("by_community_type", (q) =>
        q.eq("communityId", args.communityId).eq("integrationType", PLATFORM),
      )
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        credentials,
        config,
        status: args.segmentId ? "connected" : "pending",
        connectedById: userId,
        lastError: undefined,
        updatedAt: timestamp,
      });
    } else {
      await ctx.db.insert("communityIntegrations", {
        communityId: args.communityId,
        integrationType: PLATFORM,
        credentials,
        config,
        status: args.segmentId ? "connected" : "pending",
        connectedById: userId,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
    }

    return { success: true };
  },
});

export const setDestinationSegment = mutation({
  args: {
    token: v.string(),
    communityId: v.id("communities"),
    segmentId: v.string(),
    segmentName: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    const isAdmin = await isCommunityAdmin(ctx, args.communityId, userId);
    if (!isAdmin) {
      throw new Error("Only community admins can update integrations");
    }

    const integration = await ctx.db
      .query("communityIntegrations")
      .withIndex("by_community_type", (q) =>
        q.eq("communityId", args.communityId).eq("integrationType", PLATFORM),
      )
      .first();
    if (!integration) {
      throw new Error("Flodesk integration not found");
    }

    await ctx.db.patch(integration._id, {
      config: { segmentId: args.segmentId, segmentName: args.segmentName },
      status: "connected",
      updatedAt: now(),
    });

    return { success: true };
  },
});

export const disconnect = mutation({
  args: {
    token: v.string(),
    communityId: v.id("communities"),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    const isAdmin = await isCommunityAdmin(ctx, args.communityId, userId);
    if (!isAdmin) {
      throw new Error("Only community admins can disconnect integrations");
    }

    const integration = await ctx.db
      .query("communityIntegrations")
      .withIndex("by_community_type", (q) =>
        q.eq("communityId", args.communityId).eq("integrationType", PLATFORM),
      )
      .first();
    if (!integration) {
      throw new Error("Flodesk integration not found");
    }

    await ctx.db.patch(integration._id, {
      status: "disconnected",
      credentials: {},
      lastError: undefined,
      updatedAt: now(),
    });

    return { success: true };
  },
});

// ============================================================================
// Internal helpers
// ============================================================================

export const _getIntegration = internalQuery({
  args: { communityId: v.id("communities") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("communityIntegrations")
      .withIndex("by_community_type", (q) =>
        q.eq("communityId", args.communityId).eq("integrationType", PLATFORM),
      )
      .first();
  },
});

export const _getUserForSync = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.userId);
  },
});

export const _markError = internalMutation({
  args: {
    communityId: v.id("communities"),
    error: v.string(),
  },
  handler: async (ctx, args) => {
    const integration = await ctx.db
      .query("communityIntegrations")
      .withIndex("by_community_type", (q) =>
        q.eq("communityId", args.communityId).eq("integrationType", PLATFORM),
      )
      .first();
    if (integration) {
      await ctx.db.patch(integration._id, {
        status: "error",
        lastError: args.error,
        updatedAt: now(),
      });
    }
  },
});

export const _markSynced = internalMutation({
  args: { communityId: v.id("communities") },
  handler: async (ctx, args) => {
    const integration = await ctx.db
      .query("communityIntegrations")
      .withIndex("by_community_type", (q) =>
        q.eq("communityId", args.communityId).eq("integrationType", PLATFORM),
      )
      .first();
    if (integration) {
      await ctx.db.patch(integration._id, {
        lastSyncAt: now(),
        lastError: undefined,
        updatedAt: now(),
      });
    }
  },
});

export const _storeSubscriberId = internalMutation({
  args: {
    userId: v.id("users"),
    communityId: v.id("communities"),
    subscriberId: v.string(),
  },
  handler: async (ctx, args) => {
    const membership = await ctx.db
      .query("userCommunities")
      .withIndex("by_user_community", (q) =>
        q.eq("userId", args.userId).eq("communityId", args.communityId),
      )
      .first();
    if (membership) {
      await ctx.db.patch(membership._id, {
        externalIds: {
          ...((membership.externalIds as Record<string, string>) || {}),
          flodeskSubscriberId: args.subscriberId,
        },
        updatedAt: now(),
      });
    }
  },
});

export const _authorizeAdmin = internalMutation({
  args: {
    token: v.string(),
    communityId: v.id("communities"),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    const isAdmin = await isCommunityAdmin(ctx, args.communityId, userId);
    return { userId, isAdmin };
  },
});

// ============================================================================
// Actions
// ============================================================================

export const listSegments = action({
  args: {
    token: v.string(),
    communityId: v.id("communities"),
    apiKey: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<FlodeskSegment[]> => {
    const authResult = await ctx.runMutation(
      internal.functions.marketing.flodesk._authorizeAdmin,
      { token: args.token, communityId: args.communityId },
    );
    if (!authResult.isAdmin) {
      throw new Error("Only community admins can list integration segments");
    }

    let apiKey = args.apiKey;
    if (!apiKey) {
      const integration = await ctx.runQuery(
        internal.functions.marketing.flodesk._getIntegration,
        { communityId: args.communityId },
      );
      apiKey = (integration?.credentials as FlodeskCredentials | null)?.apiKey;
    }
    if (!apiKey) {
      throw new Error("No Flodesk API key configured");
    }

    const res = await flodeskFetch(apiKey, "/segments");
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Flodesk API error ${res.status}: ${body}`);
    }
    const data = (await res.json()) as {
      data?: Array<{ id: string; name: string }>;
      segments?: Array<{ id: string; name: string }>;
    };
    const segments = data.data ?? data.segments ?? [];
    return segments.map((s) => ({ id: s.id, name: s.name }));
  },
});

/**
 * Sync a single user to Flodesk. See clearstream.syncUser for the design notes.
 * One-way outbound; no opt-out tracking. Skipped if no email on file.
 */
export const syncUser = internalAction({
  args: {
    communityId: v.id("communities"),
    userId: v.id("users"),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ synced: boolean; reason?: string; subscriberId?: string }> => {
    const integration = await ctx.runQuery(
      internal.functions.marketing.flodesk._getIntegration,
      { communityId: args.communityId },
    );
    if (!integration || integration.status !== "connected") {
      return { synced: false, reason: "no_integration" };
    }

    const credentials = integration.credentials as FlodeskCredentials;
    const config = integration.config as FlodeskConfig;
    if (!credentials?.apiKey) {
      return { synced: false, reason: "no_api_key" };
    }
    if (!config?.segmentId) {
      return { synced: false, reason: "no_destination_segment" };
    }

    const user = await ctx.runQuery(
      internal.functions.marketing.flodesk._getUserForSync,
      { userId: args.userId },
    );
    if (!user) {
      return { synced: false, reason: "user_not_found" };
    }
    if (!user.email) {
      return { synced: false, reason: "no_email" };
    }

    try {
      const upsertRes = await flodeskFetch(credentials.apiKey, "/subscribers", {
        method: "POST",
        body: JSON.stringify({
          email: user.email,
          first_name: user.firstName || undefined,
          last_name: user.lastName || undefined,
        }),
      });
      if (!upsertRes.ok) {
        const body = await upsertRes.text().catch(() => "");
        throw new Error(`subscriber upsert ${upsertRes.status}: ${body}`);
      }
      const upserted = (await upsertRes.json()) as {
        id?: string;
        data?: { id?: string };
      };
      const subscriberId = upserted.id ?? upserted.data?.id;

      const addRes = await flodeskFetch(
        credentials.apiKey,
        `/subscribers/${encodeURIComponent(user.email)}/segments`,
        {
          method: "POST",
          body: JSON.stringify({ segment_ids: [config.segmentId] }),
        },
      );
      if (!addRes.ok && addRes.status !== 409) {
        const body = await addRes.text().catch(() => "");
        throw new Error(`segment add ${addRes.status}: ${body}`);
      }

      if (subscriberId) {
        await ctx.runMutation(
          internal.functions.marketing.flodesk._storeSubscriberId,
          {
            userId: args.userId,
            communityId: args.communityId,
            subscriberId,
          },
        );
      }
      await ctx.runMutation(
        internal.functions.marketing.flodesk._markSynced,
        { communityId: args.communityId },
      );
      return { synced: true, subscriberId };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await ctx.runMutation(
        internal.functions.marketing.flodesk._markError,
        { communityId: args.communityId, error: message },
      );
      return { synced: false, reason: "api_error" };
    }
  },
});

export const runSyncUser = action({
  args: {
    token: v.string(),
    communityId: v.id("communities"),
    userId: v.id("users"),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ synced: boolean; reason?: string; subscriberId?: string }> => {
    const authResult = await ctx.runMutation(
      internal.functions.marketing.flodesk._authorizeAdmin,
      { token: args.token, communityId: args.communityId },
    );
    if (!authResult.isAdmin) {
      throw new Error("Only community admins can run a manual sync");
    }
    return await ctx.runAction(
      internal.functions.marketing.flodesk.syncUser,
      { communityId: args.communityId, userId: args.userId },
    );
  },
});
