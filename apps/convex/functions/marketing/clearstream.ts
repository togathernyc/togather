/**
 * Clearstream integration
 *
 * Clearstream is an SMS marketing platform. This module syncs Togather
 * community members into a single Clearstream subscriber list (group) chosen
 * by the admin at connect time.
 *
 * Design decisions (see ADR / chat record):
 * - Auth: API key (not OAuth). Stored in communityIntegrations.credentials.apiKey.
 * - Destination: one Clearstream list ID per community, in config.listId.
 * - Sync direction: outbound only (Togather → Clearstream). One-way; we do
 *   not consume unsubscribe webhooks. If a user unsubs in Clearstream and
 *   later edits their Togather profile, they will be re-pushed — accepted
 *   trade-off for not maintaining inbound state.
 * - Backfill: none. Only event-driven (user join / profile edit) pushes
 *   members. Existing members at connect time are not pushed.
 *
 * API reference: https://api-docs.clearstream.io
 *   Base URL:  https://api.getclearstream.com/v1
 *   Auth:      X-Api-Key: <api_key>
 *   Endpoints used:
 *     GET    /lists                      — list groups for the picker
 *     POST   /subscribers                — create/update subscriber by mobile_number
 *                                          (accepts a `lists` array to add to lists
 *                                          in the same call; idempotent)
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

const PLATFORM = "clearstream" as const;
const CLEARSTREAM_BASE_URL = "https://api.getclearstream.com/v1";

interface ClearstreamCredentials {
  apiKey: string;
}

interface ClearstreamConfig {
  listId: string;
  listName?: string;
}

interface ClearstreamList {
  id: string;
  name: string;
  subscriberCount?: number;
}

// ============================================================================
// HTTP helper
// ============================================================================

async function clearstreamFetch(
  apiKey: string,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  // Clearstream uses an X-Api-Key header, not OAuth-style Bearer tokens.
  const headers: Record<string, string> = {
    "X-Api-Key": apiKey,
    Accept: "application/json",
    ...((init.headers as Record<string, string>) || {}),
  };
  if (init.body && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/json";
  }
  return fetch(`${CLEARSTREAM_BASE_URL}${path}`, { ...init, headers });
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
        listId: null,
        listName: null,
        connectedBy: null,
      };
    }

    const config = (integration.config as ClearstreamConfig | null) ?? null;

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
      listId: config?.listId || null,
      listName: config?.listName || null,
      connectedBy,
    };
  },
});

// ============================================================================
// Mutations
// ============================================================================

/**
 * Connect Clearstream with an API key and destination list ID.
 * If listId is omitted, the integration is stored in a "pending" state and the
 * admin completes setup by picking a list (we don't expose the key until then).
 */
export const connect = mutation({
  args: {
    token: v.string(),
    communityId: v.id("communities"),
    apiKey: v.string(),
    listId: v.optional(v.string()),
    listName: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    const isAdmin = await isCommunityAdmin(ctx, args.communityId, userId);
    if (!isAdmin) {
      throw new Error("Only community admins can connect integrations");
    }

    const timestamp = now();
    const credentials: ClearstreamCredentials = { apiKey: args.apiKey };
    const config: ClearstreamConfig | Record<string, never> = args.listId
      ? { listId: args.listId, listName: args.listName }
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
        status: args.listId ? "connected" : "pending",
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
        status: args.listId ? "connected" : "pending",
        connectedById: userId,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
    }

    return { success: true };
  },
});

/**
 * Update the destination list after the admin picks one from the dropdown.
 */
export const setDestinationList = mutation({
  args: {
    token: v.string(),
    communityId: v.id("communities"),
    listId: v.string(),
    listName: v.optional(v.string()),
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
      throw new Error("Clearstream integration not found");
    }

    await ctx.db.patch(integration._id, {
      config: { listId: args.listId, listName: args.listName },
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
      throw new Error("Clearstream integration not found");
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
      // Record the failure but leave `status` alone — flipping a connected
      // integration to "error" would cause syncUser to short-circuit on every
      // subsequent join/profile edit until an admin reconnects, so one
      // transient API blip would disable the integration entirely.
      await ctx.db.patch(integration._id, {
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

export const _storeContactId = internalMutation({
  args: {
    userId: v.id("users"),
    communityId: v.id("communities"),
    contactId: v.string(),
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
          clearstreamContactId: args.contactId,
        },
        updatedAt: now(),
      });
    }
  },
});

// ============================================================================
// Actions
// ============================================================================

/**
 * List Clearstream subscriber lists ("groups") for the destination picker.
 * Called from the admin UI after the API key is entered but before save.
 */
export const listGroups = action({
  args: {
    token: v.string(),
    communityId: v.id("communities"),
    apiKey: v.optional(v.string()), // Caller may pass key before saving
  },
  handler: async (ctx, args): Promise<ClearstreamList[]> => {
    const authResult = await ctx.runMutation(
      internal.functions.marketing.clearstream._authorizeAdmin,
      { token: args.token, communityId: args.communityId },
    );
    if (!authResult.isAdmin) {
      throw new Error("Only community admins can list integration groups");
    }

    let apiKey = args.apiKey;
    if (!apiKey) {
      const integration = await ctx.runQuery(
        internal.functions.marketing.clearstream._getIntegration,
        { communityId: args.communityId },
      );
      apiKey = (integration?.credentials as ClearstreamCredentials | null)
        ?.apiKey;
    }
    if (!apiKey) {
      throw new Error("No Clearstream API key configured");
    }

    const res = await clearstreamFetch(apiKey, "/lists");
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Clearstream API error ${res.status}: ${body}`);
    }
    const data = (await res.json()) as {
      lists?: Array<{ id: string | number; name: string; subscriber_count?: number }>;
      data?: Array<{ id: string | number; name: string; subscriber_count?: number }>;
    };
    const lists = data.lists ?? data.data ?? [];
    return lists.map((l) => ({
      id: String(l.id),
      name: l.name,
      subscriberCount: l.subscriber_count,
    }));
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

/**
 * Sync a single user to Clearstream.
 *
 * Internal action: invoked by event triggers (user join / profile edit) and
 * the public `runSyncUser` admin wrapper.
 * Idempotent — re-running for a user already on the list is a no-op
 * (Clearstream upserts by phone). Skips if:
 * - No integration / not connected
 * - User has no phone number
 */
export const syncUser = internalAction({
  args: {
    communityId: v.id("communities"),
    userId: v.id("users"),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ synced: boolean; reason?: string; contactId?: string }> => {
    const integration = await ctx.runQuery(
      internal.functions.marketing.clearstream._getIntegration,
      { communityId: args.communityId },
    );
    if (!integration || integration.status !== "connected") {
      return { synced: false, reason: "no_integration" };
    }

    const credentials = integration.credentials as ClearstreamCredentials;
    const config = integration.config as ClearstreamConfig;
    if (!credentials?.apiKey) {
      return { synced: false, reason: "no_api_key" };
    }
    if (!config?.listId) {
      return { synced: false, reason: "no_destination_list" };
    }

    const user = await ctx.runQuery(
      internal.functions.marketing.clearstream._getUserForSync,
      { userId: args.userId },
    );
    if (!user) {
      return { synced: false, reason: "user_not_found" };
    }
    if (!user.phone) {
      // Clearstream is SMS-only; no phone, no sync
      return { synced: false, reason: "no_phone" };
    }

    try {
      // POST /subscribers upserts by mobile_number AND can add the subscriber
      // to one or more lists in a single call via the `lists` array, so no
      // follow-up request is needed. Idempotent: re-posting the same number is
      // not an error.
      const res = await clearstreamFetch(credentials.apiKey, "/subscribers", {
        method: "POST",
        body: JSON.stringify({
          mobile_number: user.phone,
          first: user.firstName || undefined,
          last: user.lastName || undefined,
          email: user.email || undefined,
          lists: [config.listId],
          // Clearstream's create endpoint leaves an existing subscriber's
          // attributes alone unless this flag is set, so profile edits would
          // otherwise be silently dropped for users already on the list.
          overwrite_attributes: true,
        }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`subscriber upsert ${res.status}: ${body}`);
      }
      // Clearstream identifies subscribers by their mobile_number — there is
      // no separate opaque id. We persist the phone we sent so a later sync
      // can detect a number change.
      const contactId = user.phone;

      await ctx.runMutation(
        internal.functions.marketing.clearstream._storeContactId,
        {
          userId: args.userId,
          communityId: args.communityId,
          contactId,
        },
      );
      await ctx.runMutation(
        internal.functions.marketing.clearstream._markSynced,
        { communityId: args.communityId },
      );
      return { synced: true, contactId };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await ctx.runMutation(
        internal.functions.marketing.clearstream._markError,
        { communityId: args.communityId, error: message },
      );
      return { synced: false, reason: "api_error" };
    }
  },
});

/**
 * Public admin wrapper around `syncUser` — used by the admin "Test sync" button.
 * Gates on community admin, then delegates to the internal action.
 */
export const runSyncUser = action({
  args: {
    token: v.string(),
    communityId: v.id("communities"),
    userId: v.id("users"),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ synced: boolean; reason?: string; contactId?: string }> => {
    const authResult = await ctx.runMutation(
      internal.functions.marketing.clearstream._authorizeAdmin,
      { token: args.token, communityId: args.communityId },
    );
    if (!authResult.isAdmin) {
      throw new Error("Only community admins can run a manual sync");
    }
    return await ctx.runAction(
      internal.functions.marketing.clearstream.syncUser,
      { communityId: args.communityId, userId: args.userId },
    );
  },
});
