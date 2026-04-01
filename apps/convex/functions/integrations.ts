/**
 * Integrations functions
 *
 * Handles third-party integrations for communities:
 * - Planning Center OAuth flow
 * - Integration status and management
 */

import { v } from "convex/values";
import { query, mutation, action, internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { now, isTokenExpired } from "../lib/utils";
import { requireAuth, signOAuthState, verifyOAuthState } from "../lib/auth";
import { isCommunityAdmin } from "../lib/permissions";

// ============================================================================
// Constants
// ============================================================================

const PLANNING_CENTER_BASE_URL = "https://api.planningcenteronline.com";
const OAUTH_AUTHORIZE_URL = `${PLANNING_CENTER_BASE_URL}/oauth/authorize`;
const OAUTH_TOKEN_URL = `${PLANNING_CENTER_BASE_URL}/oauth/token`;

// All available Planning Center OAuth scopes
const PLANNING_CENTER_SCOPES = ["people", "groups", "check_ins", "giving", "services", "calendar", "registrations", "publishing"] as const;
const PLANNING_CENTER_SCOPE_STRING = PLANNING_CENTER_SCOPES.join(" ");

// ============================================================================
// Types
// ============================================================================

interface PlanningCenterTokens {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
  created_at: number;
  scope?: string;
}

/**
 * Get Planning Center credentials from environment
 */
function getPlanningCenterCredentials(): {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
} {
  const clientId = process.env.PLANNING_CENTER_CLIENT_ID;
  const clientSecret = process.env.PLANNING_CENTER_CLIENT_SECRET;
  // Default redirect URI for mobile app
  const redirectUri = "togather://planning-center/callback";

  if (!clientId || !clientSecret) {
    throw new Error("Planning Center OAuth credentials not configured");
  }

  return { clientId, clientSecret, redirectUri };
}

// ============================================================================
// Queries
// ============================================================================

/**
 * Get Planning Center integration status for a community
 */
export const planningCenterStatus = query({
  args: {
    token: v.string(),
    communityId: v.id("communities"),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);

    // Verify user is a member of this community
    const membership = await ctx.db
      .query("userCommunities")
      .withIndex("by_user_community", (q) =>
        q.eq("userId", userId).eq("communityId", args.communityId)
      )
      .first();

    if (!membership || membership.status !== 1) {
      throw new Error("Not a member of this community");
    }

    // Get the integration
    const integration = await ctx.db
      .query("communityIntegrations")
      .withIndex("by_community_type", (q) =>
        q.eq("communityId", args.communityId).eq("integrationType", "planning_center")
      )
      .first();

    if (!integration) {
      return {
        isConnected: false,
        status: null,
        lastSyncAt: null,
        lastError: null,
        tokenExpiresAt: null,
        isTokenExpired: false,
        connectedBy: null,
      };
    }

    // Check token expiry
    const credentials = integration.credentials as PlanningCenterTokens | null;
    const tokenExpiresAt =
      credentials?.created_at && credentials?.expires_in
        ? (credentials.created_at + credentials.expires_in) * 1000
        : null;

    const isExpired =
      credentials?.created_at && credentials?.expires_in
        ? isTokenExpired(credentials.created_at, credentials.expires_in)
        : true;

    // Get connected by user info
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
      tokenExpiresAt,
      isTokenExpired: isExpired,
      connectedBy,
    };
  },
});

/**
 * List available integration types for a community
 */
export const listAvailable = query({
  args: {
    token: v.string(),
    communityId: v.id("communities"),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);

    // Verify user is a member of this community
    const membership = await ctx.db
      .query("userCommunities")
      .withIndex("by_user_community", (q) =>
        q.eq("userId", userId).eq("communityId", args.communityId)
      )
      .first();

    if (!membership || membership.status !== 1) {
      throw new Error("Not a member of this community");
    }

    // Get existing integrations
    const existingIntegrations = await ctx.db
      .query("communityIntegrations")
      .withIndex("by_community", (q) => q.eq("communityId", args.communityId))
      .collect();

    const integrationMap = new Map(
      existingIntegrations.map((i) => [i.integrationType, i.status])
    );

    // Define available integration types
    return [
      {
        type: "planning_center",
        displayName: "Planning Center",
        description:
          "Sync people, groups, and events from Planning Center to automatically keep your community up to date.",
        isConnected: integrationMap.has("planning_center"),
        status: integrationMap.get("planning_center") || null,
      },
    ];
  },
});

// ============================================================================
// Mutations (public API - schedules internal actions)
// ============================================================================
// Following Convex best practice: "Don't invoke actions directly from your app"
// Mutations are called by clients and schedule actions for HTTP operations.

/**
 * Start Planning Center OAuth flow (mutation wrapper)
 * Returns authorization URL synchronously since no HTTP calls are needed.
 *
 * Note: This particular operation doesn't need an action because generating
 * the OAuth URL is synchronous. However, it's kept here for consistency
 * with the other integration operations and for future extensibility.
 */
export const startPlanningCenterAuthMutation = mutation({
  args: {
    token: v.string(),
    communityId: v.id("communities"),
    redirectUri: v.optional(v.string()),
    forceLogin: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    // Verify auth and admin status
    const userId = await requireAuth(ctx, args.token);
    const isAdmin = await isCommunityAdmin(ctx, args.communityId, userId);

    if (!isAdmin) {
      throw new Error("Only community admins can connect integrations");
    }

    // Get community for legacy ID (used in OAuth state)
    const community = await ctx.db.get(args.communityId);
    const communityLegacyId = community?.legacyId
      ? parseInt(community.legacyId, 10)
      : null;

    const { clientId, redirectUri: defaultRedirectUri } = getPlanningCenterCredentials();
    const redirectUri = args.redirectUri || defaultRedirectUri;

    // Generate signed state token for CSRF protection
    const stateToken = await signOAuthState(
      userId,
      communityLegacyId || 0,
      redirectUri
    );

    // Build authorization URL
    // Request all Planning Center scopes for full access
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: PLANNING_CENTER_SCOPE_STRING,
      state: stateToken,
    });

    // If forceLogin is true, add prompt=login to force PCO to show login screen
    // This allows users to switch to a different account
    if (args.forceLogin) {
      params.append("prompt", "login");
    }

    const authorizationUrl = `${OAUTH_AUTHORIZE_URL}?${params.toString()}`;

    return {
      authorizationUrl,
      state: stateToken,
    };
  },
});

/**
 * Complete Planning Center OAuth flow (mutation wrapper)
 * Schedules the internal action to exchange code for tokens.
 */
export const completePlanningCenterAuthMutation = mutation({
  args: {
    token: v.string(),
    communityId: v.id("communities"),
    code: v.string(),
    state: v.string(),
  },
  handler: async (ctx, args) => {
    // Verify auth and admin status
    const userId = await requireAuth(ctx, args.token);
    const isAdmin = await isCommunityAdmin(ctx, args.communityId, userId);

    if (!isAdmin) {
      throw new Error("Only community admins can connect integrations");
    }

    // Schedule the action to complete OAuth (HTTP calls required)
    await ctx.scheduler.runAfter(
      0,
      internal.functions.integrations.completePlanningCenterAuthInternal,
      {
        communityId: args.communityId,
        userId: userId as Id<"users">,
        code: args.code,
        state: args.state,
      }
    );

    return {
      success: true,
      message: "Processing Planning Center connection...",
    };
  },
});

/**
 * Disconnect Planning Center integration (mutation wrapper)
 * This operation doesn't require an action since it's just a database update.
 */
export const disconnectPlanningCenterMutation = mutation({
  args: {
    token: v.string(),
    communityId: v.id("communities"),
  },
  handler: async (ctx, args) => {
    // Verify auth and admin status
    const userId = await requireAuth(ctx, args.token);
    const isAdmin = await isCommunityAdmin(ctx, args.communityId, userId);

    if (!isAdmin) {
      throw new Error("Only community admins can disconnect integrations");
    }

    // Get the integration
    const integration = await ctx.db
      .query("communityIntegrations")
      .withIndex("by_community_type", (q) =>
        q.eq("communityId", args.communityId).eq("integrationType", "planning_center")
      )
      .first();

    if (!integration) {
      throw new Error("Planning Center integration not found");
    }

    // Clear credentials
    await ctx.db.patch(integration._id, {
      status: "disconnected",
      credentials: {},
      lastError: undefined,
      updatedAt: now(),
    });

    return {
      success: true,
      message: "Planning Center disconnected successfully",
    };
  },
});

// ============================================================================
// Internal Actions (for HTTP calls - scheduled by mutations)
// ============================================================================

/**
 * Complete Planning Center OAuth flow (internal action)
 * Exchanges authorization code for tokens via HTTP.
 */
export const completePlanningCenterAuthInternal = internalAction({
  args: {
    communityId: v.id("communities"),
    userId: v.id("users"),
    code: v.string(),
    state: v.string(),
  },
  handler: async (ctx, args) => {
    // Validate and decode state token
    const statePayload = await verifyOAuthState(args.state);
    if (!statePayload) {
      throw new Error("Invalid or expired state token");
    }

    // Get credentials
    const { clientId, clientSecret, redirectUri: defaultRedirectUri } =
      getPlanningCenterCredentials();
    const redirectUri = statePayload.redirectUri || defaultRedirectUri;

    // Exchange code for tokens
    const tokenResponse = await fetch(OAUTH_TOKEN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        grant_type: "authorization_code",
        code: args.code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
      }),
    });

    if (!tokenResponse.ok) {
      const errorData = await tokenResponse.json().catch(() => ({}));
      throw new Error(
        (errorData as any).error_description ||
          (errorData as any).error ||
          "Failed to exchange authorization code"
      );
    }

    const tokens: PlanningCenterTokens = await tokenResponse.json();

    // Store the integration
    await ctx.runMutation(internal.functions.integrations.storePlanningCenterIntegration, {
      communityId: args.communityId,
      userId: args.userId,
      credentials: {
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        token_type: tokens.token_type,
        expires_in: tokens.expires_in,
        created_at: tokens.created_at,
      },
    });

    return {
      success: true,
      message: "Planning Center connected successfully",
      redirectUrl: statePayload.redirectUri || null,
    };
  },
});

// ============================================================================
// Internal Mutations (called by actions)
// ============================================================================

import { internalMutation } from "../_generated/server";

/**
 * Verify admin access for integration management
 */
export const verifyAdminAccess = internalMutation({
  args: {
    token: v.string(),
    communityId: v.id("communities"),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);

    // Check if user is admin
    const isAdmin = await isCommunityAdmin(ctx, args.communityId, userId);

    // Get community for legacy ID (used in OAuth state)
    const community = await ctx.db.get(args.communityId);
    const communityLegacyId = community?.legacyId
      ? parseInt(community.legacyId, 10)
      : null;

    return {
      userId: userId as string,
      isAdmin,
      communityLegacyId,
    };
  },
});

/**
 * Store Planning Center integration credentials
 */
export const storePlanningCenterIntegration = internalMutation({
  args: {
    communityId: v.id("communities"),
    userId: v.id("users"),
    credentials: v.object({
      access_token: v.string(),
      refresh_token: v.string(),
      token_type: v.string(),
      expires_in: v.number(),
      created_at: v.number(),
      scope: v.optional(v.string()),
    }),
  },
  handler: async (ctx, args) => {
    const timestamp = now();

    // Check for existing integration
    const existing = await ctx.db
      .query("communityIntegrations")
      .withIndex("by_community_type", (q) =>
        q.eq("communityId", args.communityId).eq("integrationType", "planning_center")
      )
      .first();

    const config = {
      scopes: [...PLANNING_CENTER_SCOPES],
    };

    if (existing) {
      // Update existing integration
      await ctx.db.patch(existing._id, {
        credentials: args.credentials,
        config,
        status: "connected",
        connectedById: args.userId,
        lastError: undefined,
        updatedAt: timestamp,
      });
    } else {
      // Create new integration
      await ctx.db.insert("communityIntegrations", {
        communityId: args.communityId,
        integrationType: "planning_center",
        credentials: args.credentials,
        config,
        status: "connected",
        connectedById: args.userId,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
    }
  },
});

/**
 * Clear Planning Center integration credentials
 */
export const clearPlanningCenterIntegration = internalMutation({
  args: {
    communityId: v.id("communities"),
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const integration = await ctx.db
      .query("communityIntegrations")
      .withIndex("by_community_type", (q) =>
        q.eq("communityId", args.communityId).eq("integrationType", "planning_center")
      )
      .first();

    if (!integration) {
      throw new Error("Planning Center integration not found");
    }

    await ctx.db.patch(integration._id, {
      status: "disconnected",
      credentials: {},
      lastError: undefined,
      updatedAt: now(),
    });
  },
});

// ============================================================================
// Planning Center People Sync
// ============================================================================

/**
 * Sync a user to Planning Center when they join a community
 *
 * This is called when a user is added to a community that has Planning Center
 * integration enabled. It creates or links the user in Planning Center and
 * stores the Planning Center ID in the userCommunities.externalIds field.
 */
export const syncUserToPlanningCenter = action({
  args: {
    communityId: v.id("communities"),
    userId: v.id("users"),
  },
  handler: async (ctx, args): Promise<{ synced: boolean; reason?: string; planningCenterId?: string }> => {
    console.log("[syncUserToPlanningCenter] Starting sync", {
      communityId: args.communityId,
      userId: args.userId,
    });

    // Get the integration
    const integration = await ctx.runQuery(
      internal.functions.integrations.getIntegrationInternal,
      {
        communityId: args.communityId,
        integrationType: "planning_center",
      }
    );

    console.log("[syncUserToPlanningCenter] Integration lookup result", {
      found: !!integration,
      status: integration?.status,
      hasCredentials: !!integration?.credentials,
    });

    if (!integration || integration.status !== "connected") {
      // No Planning Center integration, nothing to do
      console.log("[syncUserToPlanningCenter] No active integration, skipping sync");
      return { synced: false, reason: "no_integration" };
    }

    const credentials = integration.credentials as PlanningCenterTokens;
    if (!credentials?.access_token) {
      console.log("[syncUserToPlanningCenter] No access token found");
      return { synced: false, reason: "no_credentials" };
    }

    // Check if token is expired and needs refresh
    let accessToken = credentials.access_token;
    const tokenExpired = isTokenExpired(credentials.created_at, credentials.expires_in);
    console.log("[syncUserToPlanningCenter] Token status", {
      isExpired: tokenExpired,
      createdAt: credentials.created_at,
      expiresIn: credentials.expires_in,
    });

    if (tokenExpired) {
      console.log("[syncUserToPlanningCenter] Refreshing expired token");
      // Refresh the token
      const { clientId, clientSecret } = getPlanningCenterCredentials();

      const refreshResponse = await fetch(OAUTH_TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          grant_type: "refresh_token",
          refresh_token: credentials.refresh_token,
          client_id: clientId,
          client_secret: clientSecret,
        }),
      });

      if (!refreshResponse.ok) {
        console.log("[syncUserToPlanningCenter] Token refresh failed", {
          status: refreshResponse.status,
        });
        // Mark integration as error
        await ctx.runMutation(internal.functions.integrations.markIntegrationError, {
          communityId: args.communityId,
          error: "Token refresh failed",
        });
        return { synced: false, reason: "token_refresh_failed" };
      }

      const newTokens: PlanningCenterTokens = await refreshResponse.json();
      accessToken = newTokens.access_token;
      console.log("[syncUserToPlanningCenter] Token refreshed successfully");

      // Store the refreshed tokens
      await ctx.runMutation(internal.functions.integrations.updateIntegrationCredentials, {
        communityId: args.communityId,
        credentials: newTokens,
      });
    }

    // Get the user details
    const user = await ctx.runQuery(internal.functions.integrations.getUserInternal, {
      userId: args.userId,
    });

    console.log("[syncUserToPlanningCenter] User lookup", {
      found: !!user,
      hasEmail: !!user?.email,
      hasPhone: !!user?.phone,
      firstName: user?.firstName,
      lastName: user?.lastName,
    });

    if (!user) {
      console.log("[syncUserToPlanningCenter] User not found, skipping sync");
      return { synced: false, reason: "user_not_found" };
    }

    // Search for existing person in Planning Center by email or phone
    // We check both to avoid creating duplicates
    let planningCenterId: string | null = null;
    let isNewPerson = false; // Track if we created a new person or linked existing

    // Normalize email for searching (lowercase, trimmed)
    const normalizedEmail = user.email?.toLowerCase().trim();

    // Normalize phone for searching (digits only, with country code)
    // Planning Center expects various formats, so we search with digits only
    const normalizedPhone = user.phone?.replace(/\D/g, "");

    console.log("[syncUserToPlanningCenter] Searching Planning Center", {
      normalizedEmail,
      normalizedPhone,
    });

    // Try to find by email first (using exact email search)
    if (normalizedEmail) {
      // First try exact email match via the emails endpoint
      console.log("[syncUserToPlanningCenter] Searching by email (exact match)");
      const emailSearchResponse = await fetch(
        `${PLANNING_CENTER_BASE_URL}/people/v2/emails?where[address]=${encodeURIComponent(normalizedEmail)}`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
        }
      );

      if (emailSearchResponse.ok) {
        const emailData = await emailSearchResponse.json();
        console.log("[syncUserToPlanningCenter] Email search results", {
          count: emailData.data?.length || 0,
        });
        if (emailData.data && emailData.data.length > 0) {
          // Get the person ID from the email record
          const personLink = emailData.data[0].relationships?.person?.data;
          if (personLink?.id) {
            planningCenterId = personLink.id;
            console.log("[syncUserToPlanningCenter] Found by exact email match", {
              planningCenterId,
            });
          }
        }
      } else {
        console.log("[syncUserToPlanningCenter] Email search failed", {
          status: emailSearchResponse.status,
        });
      }

      // Fallback to general search if exact match didn't work
      if (!planningCenterId) {
        const searchResponse = await fetch(
          `${PLANNING_CENTER_BASE_URL}/people/v2/people?where[search_name_or_email]=${encodeURIComponent(normalizedEmail)}`,
          {
            headers: {
              Authorization: `Bearer ${accessToken}`,
              "Content-Type": "application/json",
            },
          }
        );

        if (searchResponse.ok) {
          const searchData = await searchResponse.json();
          if (searchData.data && searchData.data.length > 0) {
            // Verify email actually matches (search can return partial matches)
            for (const person of searchData.data) {
              const personEmails = person.attributes?.emails || [];
              const primaryEmail = person.attributes?.primary_email?.toLowerCase();
              if (primaryEmail === normalizedEmail ||
                  personEmails.some((e: any) => e.address?.toLowerCase() === normalizedEmail)) {
                planningCenterId = person.id;
                break;
              }
            }
          }
        }
      }
    }

    // If not found by email, try phone number
    if (!planningCenterId && normalizedPhone) {
      console.log("[syncUserToPlanningCenter] Searching by phone number");
      // Try exact phone match via the phone_numbers endpoint
      const phoneSearchResponse = await fetch(
        `${PLANNING_CENTER_BASE_URL}/people/v2/phone_numbers?where[number]=${encodeURIComponent(normalizedPhone)}`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
        }
      );

      if (phoneSearchResponse.ok) {
        const phoneData = await phoneSearchResponse.json();
        console.log("[syncUserToPlanningCenter] Phone search results", {
          count: phoneData.data?.length || 0,
        });
        if (phoneData.data && phoneData.data.length > 0) {
          // Get the person ID from the phone record
          const personLink = phoneData.data[0].relationships?.person?.data;
          if (personLink?.id) {
            planningCenterId = personLink.id;
            console.log("[syncUserToPlanningCenter] Found by phone match", {
              planningCenterId,
            });
          }
        }
      } else {
        console.log("[syncUserToPlanningCenter] Phone search failed", {
          status: phoneSearchResponse.status,
        });
      }

      // Fallback to general phone search
      if (!planningCenterId) {
        const searchResponse = await fetch(
          `${PLANNING_CENTER_BASE_URL}/people/v2/people?where[search_phone_number]=${encodeURIComponent(normalizedPhone)}`,
          {
            headers: {
              Authorization: `Bearer ${accessToken}`,
              "Content-Type": "application/json",
            },
          }
        );

        if (searchResponse.ok) {
          const searchData = await searchResponse.json();
          if (searchData.data && searchData.data.length > 0) {
            planningCenterId = searchData.data[0].id;
          }
        }
      }
    }

    // If still not found, create a new person
    if (!planningCenterId) {
      console.log("[syncUserToPlanningCenter] Person not found, creating new person");
      const createResponse = await fetch(
        `${PLANNING_CENTER_BASE_URL}/people/v2/people`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            data: {
              type: "Person",
              attributes: {
                first_name: user.firstName || "",
                last_name: user.lastName || "",
              },
            },
          }),
        }
      );

      if (createResponse.ok) {
        const createData = await createResponse.json();
        planningCenterId = createData.data.id;
        isNewPerson = true;
        console.log("[syncUserToPlanningCenter] Created new person", {
          planningCenterId,
        });

        // Add email if available (requires separate API call)
        if (user.email) {
          const emailResponse = await fetch(
            `${PLANNING_CENTER_BASE_URL}/people/v2/people/${planningCenterId}/emails`,
            {
              method: "POST",
              headers: {
                Authorization: `Bearer ${accessToken}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                data: {
                  type: "Email",
                  attributes: {
                    address: user.email,
                    location: "Home",
                    primary: true,
                  },
                },
              }),
            }
          );
          if (emailResponse.ok) {
            console.log("[syncUserToPlanningCenter] Added email");
          } else {
            console.warn("[syncUserToPlanningCenter] Failed to add email", {
              status: emailResponse.status,
            });
          }
        }

        // Add phone number if available (requires separate API call)
        if (user.phone) {
          const phoneResponse = await fetch(
            `${PLANNING_CENTER_BASE_URL}/people/v2/people/${planningCenterId}/phone_numbers`,
            {
              method: "POST",
              headers: {
                Authorization: `Bearer ${accessToken}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                data: {
                  type: "PhoneNumber",
                  attributes: {
                    number: user.phone,
                    location: "Mobile",
                    primary: true,
                  },
                },
              }),
            }
          );
          if (phoneResponse.ok) {
            console.log("[syncUserToPlanningCenter] Added phone number");
          } else {
            console.warn("[syncUserToPlanningCenter] Failed to add phone", {
              status: phoneResponse.status,
            });
          }
        }

        // Add a note indicating this person was created from Togather
        // First, fetch available note categories (required by some orgs)
        const categoriesResponse = await fetch(
          `${PLANNING_CENTER_BASE_URL}/people/v2/note_categories`,
          {
            headers: {
              Authorization: `Bearer ${accessToken}`,
            },
          }
        );
        let noteCategoryId: string | null = null;
        if (categoriesResponse.ok) {
          const categoriesData = await categoriesResponse.json();
          if (categoriesData.data && categoriesData.data.length > 0) {
            // Prefer "General" category, fall back to first available
            const generalCategory = categoriesData.data.find(
              (cat: any) => cat.attributes?.name?.toLowerCase() === "general"
            );
            const selectedCategory = generalCategory || categoriesData.data[0];
            noteCategoryId = selectedCategory.id;
            console.log("[syncUserToPlanningCenter] Using note category", {
              categoryId: noteCategoryId,
              categoryName: selectedCategory.attributes?.name,
            });
          }
        }

        const noteBody: any = {
          data: {
            type: "Note",
            attributes: {
              note: `Added from Togather on ${new Date().toLocaleDateString("en-US", {
                year: "numeric",
                month: "long",
                day: "numeric",
              })}`,
            },
          },
        };

        // Add category relationship if available
        if (noteCategoryId) {
          noteBody.data.relationships = {
            note_category: {
              data: {
                type: "NoteCategory",
                id: noteCategoryId,
              },
            },
          };
        }

        const noteResponse = await fetch(
          `${PLANNING_CENTER_BASE_URL}/people/v2/people/${planningCenterId}/notes`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${accessToken}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(noteBody),
          }
        );
        if (noteResponse.ok) {
          console.log("[syncUserToPlanningCenter] Added note for new person");
        } else {
          const noteError = await noteResponse.json().catch(() => ({}));
          console.warn("[syncUserToPlanningCenter] Failed to add note for new person", {
            status: noteResponse.status,
            error: noteError,
          });
        }
      } else {
        const errorData = await createResponse.json().catch(() => ({}));
        console.error("Failed to create Planning Center person:", errorData);
        return { synced: false, reason: "create_failed" };
      }
    }

    // Store the Planning Center ID in userCommunities.externalIds
    if (planningCenterId) {
      console.log("[syncUserToPlanningCenter] Syncing user to Planning Center", {
        planningCenterId,
        isNewPerson,
        userId: args.userId,
        communityId: args.communityId,
      });

      // If this was an existing person we linked to (not newly created),
      // add a note that they joined via Togather
      if (!isNewPerson) {
        console.log("[syncUserToPlanningCenter] Adding note for existing person");

        // Fetch available note categories (required by some orgs)
        const categoriesResponse = await fetch(
          `${PLANNING_CENTER_BASE_URL}/people/v2/note_categories`,
          {
            headers: {
              Authorization: `Bearer ${accessToken}`,
            },
          }
        );
        let noteCategoryId: string | null = null;
        if (categoriesResponse.ok) {
          const categoriesData = await categoriesResponse.json();
          if (categoriesData.data && categoriesData.data.length > 0) {
            // Prefer "General" category, fall back to first available
            const generalCategory = categoriesData.data.find(
              (cat: any) => cat.attributes?.name?.toLowerCase() === "general"
            );
            const selectedCategory = generalCategory || categoriesData.data[0];
            noteCategoryId = selectedCategory.id;
          }
        }

        const noteBody: any = {
          data: {
            type: "Note",
            attributes: {
              note: `Joined community via Togather on ${new Date().toLocaleDateString("en-US", {
                year: "numeric",
                month: "long",
                day: "numeric",
              })}`,
            },
          },
        };

        if (noteCategoryId) {
          noteBody.data.relationships = {
            note_category: {
              data: {
                type: "NoteCategory",
                id: noteCategoryId,
              },
            },
          };
        }

        const noteResponse = await fetch(
          `${PLANNING_CENTER_BASE_URL}/people/v2/people/${planningCenterId}/notes`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${accessToken}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(noteBody),
          }
        );
        if (noteResponse.ok) {
          console.log("[syncUserToPlanningCenter] Added note for existing person");
        } else {
          const noteError = await noteResponse.json().catch(() => ({}));
          console.warn("[syncUserToPlanningCenter] Failed to add note for existing person", {
            status: noteResponse.status,
            error: noteError,
          });
        }
      }

      await ctx.runMutation(internal.functions.integrations.updateUserCommunityExternalIds, {
        userId: args.userId,
        communityId: args.communityId,
        planningCenterId,
      });

      console.log("[syncUserToPlanningCenter] Sync complete", {
        synced: true,
        planningCenterId,
      });

      return { synced: true, planningCenterId };
    }

    console.log("[syncUserToPlanningCenter] Sync failed - no Planning Center ID obtained");
    return { synced: false, reason: "unknown" };
  },
});

// ============================================================================
// Additional Internal Functions
// ============================================================================

import { internalQuery } from "../_generated/server";

/**
 * Get integration for internal use
 */
export const getIntegrationInternal = internalQuery({
  args: {
    communityId: v.id("communities"),
    integrationType: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("communityIntegrations")
      .withIndex("by_community_type", (q) =>
        q.eq("communityId", args.communityId).eq("integrationType", args.integrationType)
      )
      .first();
  },
});

/**
 * Get user for internal use
 */
export const getUserInternal = internalQuery({
  args: {
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.userId);
  },
});

/**
 * Mark integration as having an error
 */
export const markIntegrationError = internalMutation({
  args: {
    communityId: v.id("communities"),
    error: v.string(),
  },
  handler: async (ctx, args) => {
    const integration = await ctx.db
      .query("communityIntegrations")
      .withIndex("by_community_type", (q) =>
        q.eq("communityId", args.communityId).eq("integrationType", "planning_center")
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

/**
 * Update integration credentials after token refresh
 */
export const updateIntegrationCredentials = internalMutation({
  args: {
    communityId: v.id("communities"),
    credentials: v.object({
      access_token: v.string(),
      refresh_token: v.string(),
      token_type: v.string(),
      expires_in: v.number(),
      created_at: v.number(),
      scope: v.optional(v.string()),
    }),
  },
  handler: async (ctx, args) => {
    const integration = await ctx.db
      .query("communityIntegrations")
      .withIndex("by_community_type", (q) =>
        q.eq("communityId", args.communityId).eq("integrationType", "planning_center")
      )
      .first();

    if (integration) {
      await ctx.db.patch(integration._id, {
        credentials: args.credentials,
        updatedAt: now(),
      });
    }
  },
});

/**
 * Update userCommunities.externalIds with Planning Center ID
 */
export const updateUserCommunityExternalIds = internalMutation({
  args: {
    userId: v.id("users"),
    communityId: v.id("communities"),
    planningCenterId: v.string(),
  },
  handler: async (ctx, args) => {
    const membership = await ctx.db
      .query("userCommunities")
      .withIndex("by_user_community", (q) =>
        q.eq("userId", args.userId).eq("communityId", args.communityId)
      )
      .first();

    if (membership) {
      await ctx.db.patch(membership._id, {
        externalIds: {
          ...((membership.externalIds as Record<string, string>) || {}),
          planningCenterId: args.planningCenterId,
        },
        updatedAt: now(),
      });
    }
  },
});
