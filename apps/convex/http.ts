/**
 * Convex HTTP Routes
 *
 * Exposes HTTP endpoints for external services that need to fetch data
 * from Convex without using the Convex SDK (e.g., Cloudflare Workers).
 *
 * These endpoints are publicly accessible at:
 * https://<deployment>.convex.site/<path>
 *
 * @see ADR-009 for link preview system documentation
 */

import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { api, internal } from "./_generated/api";
import { Id } from "./_generated/dataModel";
import { verifySlackSignature } from "./functions/slackServiceBot/slack";
import { hashApiKey } from "./lib/apiKeys";
import { putR2Object } from "./lib/r2";

const http = httpRouter();

// ============================================================================
// CORS Headers
// ============================================================================

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

/**
 * Handle CORS preflight requests
 */
function handleCorsOptions(): Response {
  return new Response(null, {
    status: 204,
    headers: corsHeaders,
  });
}

/**
 * Create a JSON response with CORS headers
 */
function jsonResponse(
  data: unknown,
  status: number = 200
): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders,
    },
  });
}

// ============================================================================
// Stripe Signature Verification
// ============================================================================

/**
 * Constant-time string comparison to prevent timing attacks.
 * Compares every character regardless of where a mismatch occurs.
 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

/**
 * Verify a Stripe webhook signature using the Web Crypto API (HMAC-SHA256).
 *
 * We can't use the Stripe SDK's `constructEvent` here because httpAction
 * runs in a serverless Convex environment without Node.js crypto. Instead,
 * we manually parse the `stripe-signature` header, recompute the HMAC, and
 * compare it to the expected `v1` signature.
 *
 * Also enforces a 5-minute timestamp tolerance to prevent replay attacks.
 */
async function verifyStripeSignature(
  payload: string,
  signature: string,
  secret: string
): Promise<boolean> {
  try {
    // Parse signature header into timestamp and all v1 signatures.
    // Stripe may send multiple v1 signatures during secret rotation,
    // so we collect them all and match against any one.
    let timestamp = "";
    const v1Signatures: string[] = [];

    for (const part of signature.split(",")) {
      const [key, value] = part.split("=");
      const trimmedKey = key.trim();
      if (trimmedKey === "t") {
        timestamp = value;
      } else if (trimmedKey === "v1") {
        v1Signatures.push(value);
      }
    }

    if (!timestamp || v1Signatures.length === 0) return false;

    // Check timestamp is within 5 minutes
    const currentTime = Math.floor(Date.now() / 1000);
    if (Math.abs(currentTime - parseInt(timestamp)) > 300) return false;

    const signedPayload = `${timestamp}.${payload}`;
    const encoder = new TextEncoder();

    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );

    const signatureBytes = await crypto.subtle.sign(
      "HMAC",
      key,
      encoder.encode(signedPayload)
    );

    const computedSig = Array.from(new Uint8Array(signatureBytes))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    // Accept if any v1 signature matches (constant-time comparison)
    return v1Signatures.some((sig) => timingSafeEqual(sig, computedSig));
  } catch {
    return false;
  }
}

// ============================================================================
// Link Preview Endpoints (for Cloudflare Worker)
// ============================================================================

/**
 * GET /link-preview/event?shortId=<shortId>
 *
 * Returns event data for link preview generation (OG tags).
 * Used by the Cloudflare Worker when bots request /e/[shortId] URLs.
 *
 * Response shape matches what the Cloudflare Worker expects:
 * - id, shortId, title, scheduledAt, status
 * - coverImage, coverImageFallback
 * - groupName, groupImage, groupImageFallback
 * - communityName, communityLogo
 * - locationOverride, note
 */
http.route({
  path: "/link-preview/event",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const url = new URL(request.url);
    const shortId = url.searchParams.get("shortId");

    if (!shortId) {
      return jsonResponse({ error: "Missing shortId parameter" }, 400);
    }

    try {
      const result = await ctx.runQuery(
        api.functions.meetings.index.getByShortId,
        { shortId }
      );

      if (!result) {
        return jsonResponse({ error: "Event not found" }, 404);
      }

      // Transform to match the expected shape for API routes
      // Include fallback fields (same as primary since we don't store separate versions)
      return jsonResponse({
        id: result.id,
        shortId: result.shortId,
        title: result.title,
        scheduledAt: result.scheduledAt,
        status: result.status,
        coverImage: result.coverImage,
        coverImageFallback: result.coverImage, // Same as coverImage
        groupName: result.groupName,
        groupImage: result.groupImage,
        groupImageFallback: result.groupImage, // Same as groupImage
        communityName: result.communityName,
        communityLogo: result.communityLogo,
        timezone: result.timezone,
        locationOverride: result.locationOverride,
        note: result.note,
      });
    } catch (error) {
      console.error("Error fetching event for link preview:", error);
      return jsonResponse({ error: "Failed to fetch event" }, 500);
    }
  }),
});

// Handle CORS preflight for /link-preview/event
http.route({
  path: "/link-preview/event",
  method: "OPTIONS",
  handler: httpAction(async () => handleCorsOptions()),
});

/**
 * GET /link-preview/group?shortId=<shortId>
 *
 * Returns group data needed for social sharing previews.
 * Used by the Cloudflare Worker when bots request /g/<shortId> URLs.
 *
 * Response shape:
 * - id, shortId, name, description
 * - preview (group image)
 * - memberCount
 * - communityName, communityLogo
 * - city, state (location)
 * - groupTypeName
 */
http.route({
  path: "/link-preview/group",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const url = new URL(request.url);
    const shortId = url.searchParams.get("shortId");

    if (!shortId) {
      return jsonResponse({ error: "Missing shortId parameter" }, 400);
    }

    try {
      const result = await ctx.runQuery(
        api.functions.groups.index.getByShortId,
        { shortId }
      );

      if (!result) {
        return jsonResponse({ error: "Group not found" }, 404);
      }

      // Transform to match the expected shape for API routes
      // Include fallback fields (same as primary since we don't store separate versions)
      return jsonResponse({
        id: result.id,
        shortId: result.shortId,
        name: result.name,
        description: result.description,
        preview: result.preview,
        previewFallback: result.preview, // Same as preview
        memberCount: result.memberCount,
        communityName: result.communityName,
        communityLogo: result.communityLogo,
        communityLogoFallback: result.communityLogo, // Same as communityLogo
        city: result.city,
        state: result.state,
        groupTypeName: result.groupTypeName,
        isPublic: result.isPublic,
      });
    } catch (error) {
      console.error("Error fetching group for link preview:", error);
      return jsonResponse({ error: "Failed to fetch group" }, 500);
    }
  }),
});

// Handle CORS preflight for /link-preview/group
http.route({
  path: "/link-preview/group",
  method: "OPTIONS",
  handler: httpAction(async () => handleCorsOptions()),
});

/**
 * GET /link-preview/tool?shortId=<shortId>
 *
 * Returns tool data for link preview generation (OG tags).
 * Used by the Cloudflare Worker when bots request /t/[shortId] URLs.
 *
 * Response shape:
 * - shortId, toolType, groupId, groupName
 * - groupImage, communityName, communityLogo
 * - resourceTitle?, resourceIcon?, resourceImage? (for resource tools)
 */
http.route({
  path: "/link-preview/tool",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const url = new URL(request.url);
    const shortId = url.searchParams.get("shortId");

    if (!shortId) {
      return jsonResponse({ error: "Missing shortId parameter" }, 400);
    }

    try {
      const result = await ctx.runQuery(
        api.functions.toolShortLinks.index.getByShortId,
        { shortId }
      );

      if (!result) {
        return jsonResponse({ error: "Tool not found" }, 404);
      }

      return jsonResponse(result);
    } catch (error) {
      console.error("Error fetching tool for link preview:", error);
      return jsonResponse({ error: "Failed to fetch tool" }, 500);
    }
  }),
});

// Handle CORS preflight for /link-preview/tool
http.route({
  path: "/link-preview/tool",
  method: "OPTIONS",
  handler: httpAction(async () => handleCorsOptions()),
});

/**
 * GET /link-preview/community?communitySubdomain=<subdomain>&groupTypeSlug=<slug>
 *
 * Returns community and optional group type data for "near me" link previews.
 * Used by the Cloudflare Worker when bots request /nearme URLs.
 *
 * Response shape:
 * {
 *   community: { id, name, subdomain, logo, logoFallback },
 *   groupType: { id, name, slug, description } | null
 * }
 */
http.route({
  path: "/link-preview/community",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const url = new URL(request.url);
    const communitySubdomain = url.searchParams.get("communitySubdomain");
    const groupTypeSlug = url.searchParams.get("groupTypeSlug") || undefined;

    if (!communitySubdomain) {
      return jsonResponse(
        { error: "Missing communitySubdomain parameter" },
        400
      );
    }

    try {
      const result = await ctx.runQuery(
        api.functions.groupSearch.publicLinkPreview,
        { communitySubdomain, groupTypeSlug }
      );

      // Add logoFallback field (null for Convex, but worker expects it)
      return jsonResponse({
        community: {
          ...result.community,
          logoFallback: null,
        },
        groupType: result.groupType,
      });
    } catch (error) {
      console.error("Error fetching community for link preview:", error);

      // Check if it's a "not found" error
      if (error instanceof Error && error.message.includes("not found")) {
        return jsonResponse({ error: "Community not found" }, 404);
      }

      return jsonResponse({ error: "Failed to fetch community" }, 500);
    }
  }),
});

// Handle CORS preflight for /link-preview/community
http.route({
  path: "/link-preview/community",
  method: "OPTIONS",
  handler: httpAction(async () => handleCorsOptions()),
});

/**
 * GET /link-preview/channel?shortId=<shortId>
 *
 * Returns channel data for invite link preview generation (OG tags).
 * Used by the Cloudflare Worker when bots request /ch/[shortId] URLs.
 *
 * Response shape:
 * - channelName, groupName, groupImage, memberCount
 * - communityName, communityLogo
 * - joinMode
 */
http.route({
  path: "/link-preview/channel",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const url = new URL(request.url);
    const shortId = url.searchParams.get("shortId");

    if (!shortId) {
      return jsonResponse({ error: "Missing shortId parameter" }, 400);
    }

    try {
      const result = await ctx.runQuery(
        api.functions.messaging.channelInvites.getByShortId,
        { shortId }
      );

      if (!result) {
        return jsonResponse({ error: "Channel not found" }, 404);
      }

      return jsonResponse({
        channelName: result.channelName,
        channelDescription: result.channelDescription,
        groupName: result.groupName,
        groupImage: result.groupImage,
        communityName: result.communityName,
        communityLogo: result.communityLogo,
        memberCount: result.memberCount,
        joinMode: result.joinMode,
      });
    } catch (error) {
      console.error("Error fetching channel for link preview:", error);
      return jsonResponse({ error: "Failed to fetch channel" }, 500);
    }
  }),
});

// Handle CORS preflight for /link-preview/channel
http.route({
  path: "/link-preview/channel",
  method: "OPTIONS",
  handler: httpAction(async () => handleCorsOptions()),
});

// ============================================================================
// External Link Preview Endpoint (for chat link previews)
// ============================================================================

/**
 * GET /api/link-preview?url=<encoded-url>
 *
 * Fetches Open Graph metadata for external URLs to display link preview cards
 * in chat messages. This endpoint acts as a proxy to avoid CORS issues.
 *
 * Response shape:
 * {
 *   url: string;
 *   title?: string;
 *   description?: string;
 *   image?: string;
 *   siteName?: string;
 *   favicon?: string;
 * }
 */
http.route({
  path: "/api/link-preview",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const url = new URL(request.url);
    const targetUrl = url.searchParams.get("url");

    if (!targetUrl) {
      return jsonResponse({ error: "Missing url parameter" }, 400);
    }

    // Decode the URL
    let decodedUrl: string;
    try {
      decodedUrl = decodeURIComponent(targetUrl);
    } catch {
      return jsonResponse({ error: "Invalid url encoding" }, 400);
    }

    try {
      const result = await ctx.runAction(
        internal.functions.linkPreview.fetchLinkPreview,
        { url: decodedUrl }
      );

      if (!result) {
        return jsonResponse({ error: "Failed to fetch preview" }, 404);
      }

      // Cache for 1 hour
      return new Response(JSON.stringify(result), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "public, max-age=3600",
          ...corsHeaders,
        },
      });
    } catch (error) {
      console.error("Error fetching link preview:", error);
      return jsonResponse({ error: "Failed to fetch preview" }, 500);
    }
  }),
});

// Handle CORS preflight for /api/link-preview
http.route({
  path: "/api/link-preview",
  method: "OPTIONS",
  handler: httpAction(async () => handleCorsOptions()),
});

// ============================================================================
// Slack Service Bot Webhook
// ============================================================================

/**
 * POST /slack/events
 *
 * Receives Slack Events API webhooks for the FOUNT service planning bot.
 * Handles URL verification challenge and routes message events.
 */
http.route({
  path: "/slack/events",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const bodyText = await request.text();

    // Parse body
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(bodyText);
    } catch {
      return new Response("Invalid JSON", { status: 400 });
    }

    // Signature Verification (must happen before any response)
    const signingSecret = process.env.SLACK_SIGNING_SECRET;
    if (!signingSecret) {
      console.error("[SlackServiceBot] SLACK_SIGNING_SECRET not configured");
      return new Response("Server configuration error", { status: 500 });
    }

    const slackSignature = request.headers.get("x-slack-signature") || "";
    const slackTimestamp =
      request.headers.get("x-slack-request-timestamp") || "";

    if (
      !(await verifySlackSignature(
        signingSecret,
        slackSignature,
        slackTimestamp,
        bodyText
      ))
    ) {
      console.warn("[SlackServiceBot] Invalid Slack signature");
      return new Response("Invalid signature", { status: 401 });
    }

    // Drop Slack retries — once the webhook succeeds and schedules processThreadReply,
    // retries are unnecessary. Downstream dedup (isMessageProcessed) exists as a safety
    // net but isn't atomic, so retries could still cause duplicate agent runs.
    const retryNum = request.headers.get("x-slack-retry-num");
    if (retryNum) {
      console.log(`[SlackServiceBot] Dropping Slack retry #${retryNum} (original already scheduled)`);
      return new Response("OK", { status: 200 });
    }

    // URL Verification Challenge (Slack setup requirement)
    if (body.type === "url_verification") {
      return new Response(
        JSON.stringify({ challenge: body.challenge }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }

    // Process message events in threads
    if (body.type === "event_callback") {
      const event = body.event as Record<string, unknown> | undefined;

      console.log("[SlackServiceBot] Event received:", JSON.stringify({
        type: event?.type,
        subtype: event?.subtype,
        thread_ts: event?.thread_ts,
        bot_id: event?.bot_id,
        channel: event?.channel,
        text: String(event?.text || "").slice(0, 100),
      }));

      if (
        event &&
        event.type === "message" &&
        event.thread_ts &&
        !event.bot_id &&
        event.subtype === undefined
      ) {
        const text = String(event.text || "");
        const channelId = String(event.channel);

        // Look up bot config from DB by channel to get botSlackUserId
        const botConfig = await ctx.runQuery(
          internal.functions.slackServiceBot.index.getConfigByChannel,
          { slackChannelId: channelId }
        );

        if (botConfig && botConfig.enabled) {
          const mentionsBot = text.includes(`<@${botConfig.botSlackUserId}>`);

          if (mentionsBot) {
            // Schedule async processing, return 200 immediately (Slack 3s requirement)
            await ctx.scheduler.runAfter(
              0,
              internal.functions.slackServiceBot.actions.processThreadReply,
              {
                channelId,
                threadTs: String(event.thread_ts),
                messageTs: String(event.ts),
                text,
                userId: String(event.user || ""),
              }
            );
          }
        }
      }
    }

    return new Response("OK", { status: 200 });
  }),
});

// ============================================================================
// Stripe Webhook
// ============================================================================

/**
 * POST /stripe-webhook
 *
 * Receives Stripe webhook events for billing lifecycle management.
 * Verifies the Stripe signature using Web Crypto API (HMAC-SHA256) and
 * dispatches to the appropriate internal billing mutation.
 *
 * Handled events:
 * - checkout.session.completed -> activates community subscription
 * - customer.subscription.updated -> syncs subscription status
 * - customer.subscription.deleted -> marks subscription as canceled
 * - invoice.payment_failed -> marks subscription as past_due
 */
http.route({
  path: "/stripe-webhook",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const body = await request.text();
    const signature = request.headers.get("stripe-signature");

    if (!signature) {
      return new Response("Missing stripe-signature header", { status: 400 });
    }

    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!webhookSecret) {
      console.error("[StripeWebhook] STRIPE_WEBHOOK_SECRET not configured");
      return new Response("Webhook not configured", { status: 500 });
    }

    // Verify signature using Web Crypto API
    const isValid = await verifyStripeSignature(body, signature, webhookSecret);
    if (!isValid) {
      console.error("[StripeWebhook] Invalid signature");
      return new Response("Invalid signature", { status: 400 });
    }

    const event = JSON.parse(body);

    try {
      switch (event.type) {
        case "checkout.session.completed": {
          const session = event.data.object;
          await ctx.runMutation(
            internal.functions.ee.billing.handleCheckoutCompleted,
            {
              stripeCustomerId: session.customer,
              stripeSubscriptionId: session.subscription,
              communityId: session.metadata.communityId,
              proposalId: session.metadata.proposalId,
              monthlyPrice: session.metadata.monthlyPrice
                ? Number(session.metadata.monthlyPrice)
                : undefined,
            }
          );
          break;
        }
        case "customer.subscription.updated": {
          const subscription = event.data.object;
          await ctx.runMutation(
            internal.functions.ee.billing.handleSubscriptionUpdated,
            {
              stripeSubscriptionId: subscription.id,
              status: subscription.status,
            }
          );
          break;
        }
        case "customer.subscription.deleted": {
          const subscription = event.data.object;
          await ctx.runMutation(
            internal.functions.ee.billing.handleSubscriptionUpdated,
            {
              stripeSubscriptionId: subscription.id,
              status: "canceled",
            }
          );
          break;
        }
        case "invoice.payment_failed": {
          const invoice = event.data.object;
          await ctx.runMutation(
            internal.functions.ee.billing.handlePaymentFailed,
            {
              stripeCustomerId: invoice.customer,
            }
          );
          break;
        }
        default:
          console.log(
            `[StripeWebhook] Unhandled event type: ${event.type}`
          );
      }

      return new Response(JSON.stringify({ received: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    } catch (error) {
      console.error("[StripeWebhook] Error processing event:", error);
      return new Response("Webhook processing failed", { status: 500 });
    }
  }),
});

// ============================================================================
// Public Attendance API (external integrations)
// ============================================================================

/**
 * CORS headers for the authenticated API. Unlike the link-preview endpoints,
 * this one accepts an Authorization / x-api-key header, so those must be listed
 * as allowed request headers for browser-based clients.
 */
const apiCorsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, x-api-key",
};

/** JSON response using the API CORS headers. */
function apiJsonResponse(data: unknown, status: number = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...apiCorsHeaders },
  });
}

/**
 * Extract the API key from a request.
 * Accepts either `Authorization: Bearer <key>` or `x-api-key: <key>`.
 */
function extractApiKey(request: Request): string | null {
  const auth = request.headers.get("authorization");
  if (auth && auth.toLowerCase().startsWith("bearer ")) {
    const key = auth.slice(7).trim();
    if (key) return key;
  }
  const headerKey = request.headers.get("x-api-key");
  if (headerKey && headerKey.trim()) return headerKey.trim();
  return null;
}

/**
 * Parse a timestamp query param that may be Unix milliseconds or an ISO date
 * string. Returns undefined when absent, or null when present but invalid.
 */
function parseTimestampParam(value: string | null): number | undefined | null {
  if (value === null) return undefined;
  if (/^\d+$/.test(value)) return Number(value);
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

const VALID_MEETING_STATUSES = ["scheduled", "completed", "cancelled"];

/**
 * GET /api/v1/attendance
 *
 * Returns aggregated attendance for every group in the community that owns the
 * API key. No personal information is exposed — counts only.
 *
 * Auth: `Authorization: Bearer <api-key>` or `x-api-key: <api-key>`.
 *
 * Query params (all optional):
 * - since / until: bound event date (Unix ms or ISO date string).
 * - groupType: group type slug (e.g. "dinner-parties").
 * - status: "scheduled" | "completed" | "cancelled".
 * - limit: max events to return (default 200, max 1000).
 */
http.route({
  path: "/api/v1/attendance",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const apiKey = extractApiKey(request);
    if (!apiKey) {
      return apiJsonResponse(
        { error: "Missing API key. Provide an Authorization: Bearer <key> header." },
        401
      );
    }

    const keyHash = await hashApiKey(apiKey);
    const verified = await ctx.runMutation(internal.functions.publicApi.verifyApiKey, {
      keyHash,
    });
    if (!verified) {
      return apiJsonResponse({ error: "Invalid or revoked API key" }, 401);
    }

    const url = new URL(request.url);

    const since = parseTimestampParam(url.searchParams.get("since"));
    if (since === null) {
      return apiJsonResponse({ error: "Invalid 'since' parameter" }, 400);
    }
    const until = parseTimestampParam(url.searchParams.get("until"));
    if (until === null) {
      return apiJsonResponse({ error: "Invalid 'until' parameter" }, 400);
    }

    const status = url.searchParams.get("status") || undefined;
    if (status && !VALID_MEETING_STATUSES.includes(status)) {
      return apiJsonResponse(
        { error: `Invalid 'status'. Must be one of: ${VALID_MEETING_STATUSES.join(", ")}` },
        400
      );
    }

    const limitParam = url.searchParams.get("limit");
    let limit: number | undefined;
    if (limitParam !== null) {
      const parsed = Number(limitParam);
      if (!Number.isInteger(parsed) || parsed < 1) {
        return apiJsonResponse({ error: "Invalid 'limit' parameter" }, 400);
      }
      limit = parsed;
    }

    try {
      const data = await ctx.runQuery(
        internal.functions.publicApi.getCommunityAttendanceAggregate,
        {
          communityId: verified.communityId,
          since: since ?? undefined,
          until: until ?? undefined,
          groupTypeSlug: url.searchParams.get("groupType") || undefined,
          status,
          limit,
        }
      );
      return apiJsonResponse(data);
    } catch (error) {
      console.error("[AttendanceAPI] Error building attendance response:", error);
      return apiJsonResponse({ error: "Failed to fetch attendance data" }, 500);
    }
  }),
});

// Handle CORS preflight for /api/v1/attendance
http.route({
  path: "/api/v1/attendance",
  method: "OPTIONS",
  handler: httpAction(async () => {
    return new Response(null, { status: 204, headers: apiCorsHeaders });
  }),
});

/**
 * GET /api/v1/attendance/summary
 *
 * A lighter, rolled-up companion to /api/v1/attendance: returns one row per
 * (group, calendar day) with summed attendance/guest/RSVP counts instead of one
 * row per event. Dates are bucketed in the community's time zone. No personal
 * information is exposed.
 *
 * Auth and `since`/`until`/`groupType`/`status` filters match /api/v1/attendance.
 * There is no `limit` — response size is bounded by the date window and the
 * number of groups; `truncated: true` means the internal scan cap was hit
 * (narrow the window for complete buckets).
 */
http.route({
  path: "/api/v1/attendance/summary",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const apiKey = extractApiKey(request);
    if (!apiKey) {
      return apiJsonResponse(
        { error: "Missing API key. Provide an Authorization: Bearer <key> header." },
        401
      );
    }

    const keyHash = await hashApiKey(apiKey);
    const verified = await ctx.runMutation(internal.functions.publicApi.verifyApiKey, {
      keyHash,
    });
    if (!verified) {
      return apiJsonResponse({ error: "Invalid or revoked API key" }, 401);
    }

    const url = new URL(request.url);

    const since = parseTimestampParam(url.searchParams.get("since"));
    if (since === null) {
      return apiJsonResponse({ error: "Invalid 'since' parameter" }, 400);
    }
    const until = parseTimestampParam(url.searchParams.get("until"));
    if (until === null) {
      return apiJsonResponse({ error: "Invalid 'until' parameter" }, 400);
    }

    const status = url.searchParams.get("status") || undefined;
    if (status && !VALID_MEETING_STATUSES.includes(status)) {
      return apiJsonResponse(
        { error: `Invalid 'status'. Must be one of: ${VALID_MEETING_STATUSES.join(", ")}` },
        400
      );
    }

    try {
      const data = await ctx.runQuery(
        internal.functions.publicApi.getCommunityAttendanceSummary,
        {
          communityId: verified.communityId,
          since: since ?? undefined,
          until: until ?? undefined,
          groupTypeSlug: url.searchParams.get("groupType") || undefined,
          status,
        }
      );
      return apiJsonResponse(data);
    } catch (error) {
      console.error("[AttendanceAPI] Error building attendance summary:", error);
      return apiJsonResponse({ error: "Failed to fetch attendance summary" }, 500);
    }
  }),
});

// Handle CORS preflight for /api/v1/attendance/summary
http.route({
  path: "/api/v1/attendance/summary",
  method: "OPTIONS",
  handler: httpAction(async () => {
    return new Response(null, { status: 204, headers: apiCorsHeaders });
  }),
});

// ============================================================================
// Health Check
// ============================================================================

/**
 * GET /health
 *
 * Simple health check endpoint for monitoring.
 */
http.route({
  path: "/health",
  method: "GET",
  handler: httpAction(async () => {
    return jsonResponse({
      status: "ok",
      timestamp: new Date().toISOString(),
    });
  }),
});

/**
 * Verify a dev-assistant routine callback signature.
 *
 * The routine signs the raw request body with HMAC-SHA256 using
 * DEV_ASSISTANT_CALLBACK_SECRET and sends the hex digest in the
 * `x-togather-signature` header. We recompute and constant-time compare.
 */
async function verifyDevAssistantSignature(
  payload: string,
  signature: string,
  secret: string
): Promise<boolean> {
  try {
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );
    const signatureBytes = await crypto.subtle.sign(
      "HMAC",
      key,
      encoder.encode(payload)
    );
    const computedSig = Array.from(new Uint8Array(signatureBytes))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    return timingSafeEqual(signature, computedSig);
  } catch {
    return false;
  }
}

const DEV_ASSISTANT_CALLBACK_STATUSES = [
  // Spec-drafting mode (ADR-029): the routine delivers `spec` (+ `riskLevel`)
  // and moves a dashboard contribution DRAFT -> IN_REVIEW.
  "IN_REVIEW",
  "IN_PROGRESS",
  "CODE_REVIEW",
  "READY_TO_MERGE",
  "MERGED",
  "REJECTED",
];

const DEV_ASSISTANT_RISK_LEVELS = ["low", "medium", "high"];

const DEV_ASSISTANT_SCOPES = ["buildable", "split", "design_needed"];

const DEV_ASSISTANT_REVIEW_VERDICTS = ["approved", "changes_requested"];

/**
 * POST /dev-assistant/callback
 *
 * Inbound callback from the Claude Code Routine handling a dev-assistant bug.
 * Verifies the HMAC signature, then hands off to handleRoutineCallback (which
 * applies the transition + posts a bot message into the thread). Returns 200
 * fast — chat fanout and idempotency are handled downstream.
 *
 * Body: { bugId, routineRunId, status, prUrl?, screenshots?: string[],
 *         message?, spec?, riskLevel?, aiTitle?, area?, scope?,
 *         verifyOnStaging?, reviewVerdict?, reviewSummary? }
 *
 * Review-mode runs report `reviewVerdict` ("approved" | "changes_requested")
 * plus a short `reviewSummary` against status CODE_REVIEW; an approved
 * verdict advances the bug to READY_TO_MERGE downstream.
 */
http.route({
  path: "/dev-assistant/callback",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const body = await request.text();
    const signature = request.headers.get("x-togather-signature");
    if (!signature) {
      return new Response("Missing x-togather-signature header", { status: 401 });
    }

    const secret = process.env.DEV_ASSISTANT_CALLBACK_SECRET;
    if (!secret) {
      console.error("[DevAssistant] DEV_ASSISTANT_CALLBACK_SECRET not configured");
      return new Response("Callback not configured", { status: 500 });
    }

    const isValid = await verifyDevAssistantSignature(body, signature, secret);
    if (!isValid) {
      console.error("[DevAssistant] Invalid callback signature");
      return new Response("Invalid signature", { status: 401 });
    }

    let payload: {
      bugId?: string;
      routineRunId?: string;
      status?: string;
      prUrl?: string;
      screenshots?: string[];
      message?: string;
      spec?: string;
      riskLevel?: string;
      aiTitle?: string;
      area?: string;
      scope?: string;
      verifyOnStaging?: boolean;
      reviewVerdict?: string;
      reviewSummary?: string;
    };
    try {
      payload = JSON.parse(body);
    } catch {
      return new Response("Invalid JSON", { status: 400 });
    }

    const {
      bugId,
      routineRunId,
      status,
      prUrl,
      screenshots,
      message,
      spec,
      riskLevel,
      aiTitle,
      area,
      scope,
      verifyOnStaging,
      reviewVerdict,
      reviewSummary,
    } = payload;
    if (!bugId || !routineRunId || !status) {
      return new Response("Missing bugId, routineRunId, or status", { status: 400 });
    }
    if (!DEV_ASSISTANT_CALLBACK_STATUSES.includes(status)) {
      return new Response(`Unsupported status: ${status}`, { status: 400 });
    }
    if (spec !== undefined && typeof spec !== "string") {
      return new Response("Invalid spec: must be a string", { status: 400 });
    }
    if (riskLevel !== undefined && !DEV_ASSISTANT_RISK_LEVELS.includes(riskLevel)) {
      return new Response(`Unsupported riskLevel: ${riskLevel}`, { status: 400 });
    }
    if (aiTitle !== undefined && typeof aiTitle !== "string") {
      return new Response("Invalid aiTitle: must be a string", { status: 400 });
    }
    if (area !== undefined && typeof area !== "string") {
      return new Response("Invalid area: must be a string", { status: 400 });
    }
    if (scope !== undefined && !DEV_ASSISTANT_SCOPES.includes(scope)) {
      return new Response(`Unsupported scope: ${scope}`, { status: 400 });
    }
    if (verifyOnStaging !== undefined && typeof verifyOnStaging !== "boolean") {
      return new Response("Invalid verifyOnStaging: must be a boolean", {
        status: 400,
      });
    }
    if (
      reviewVerdict !== undefined &&
      !DEV_ASSISTANT_REVIEW_VERDICTS.includes(reviewVerdict)
    ) {
      return new Response(`Unsupported reviewVerdict: ${reviewVerdict}`, {
        status: 400,
      });
    }
    if (reviewSummary !== undefined && typeof reviewSummary !== "string") {
      return new Response("Invalid reviewSummary: must be a string", {
        status: 400,
      });
    }
    // Screenshots must be fetchable http(s) URLs — a `data:` URI is dropped by
    // getMediaUrl and would render blank. Routines publish images via
    // POST /dev-assistant/upload and send back the returned URL.
    if (
      screenshots !== undefined &&
      (!Array.isArray(screenshots) ||
        !screenshots.every(
          (s) => typeof s === "string" && /^https?:\/\//.test(s)
        ))
    ) {
      return new Response(
        "Invalid screenshots: must be an array of http(s) URLs",
        { status: 400 }
      );
    }

    await ctx.scheduler.runAfter(
      0,
      internal.functions.devAssistant.actions.handleRoutineCallback,
      {
        bugId: bugId as Id<"devBugs">,
        routineRunId,
        status: status as
          | "IN_REVIEW"
          | "IN_PROGRESS"
          | "CODE_REVIEW"
          | "READY_TO_MERGE"
          | "MERGED"
          | "REJECTED",
        prUrl,
        screenshots,
        message,
        spec,
        riskLevel: riskLevel as "low" | "medium" | "high" | undefined,
        aiTitle,
        area,
        scope: scope as "buildable" | "split" | "design_needed" | undefined,
        verifyOnStaging,
        reviewVerdict: reviewVerdict as
          | "approved"
          | "changes_requested"
          | undefined,
        reviewSummary,
      }
    );

    return new Response(JSON.stringify({ received: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }),
});

/** Image content types a routine may upload for before/after mocks. */
const DEV_ASSISTANT_UPLOAD_CONTENT_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
];

/** Max decoded upload size (5 MB) — mock screenshots are far smaller. */
const DEV_ASSISTANT_UPLOAD_MAX_BYTES = 5 * 1024 * 1024;

/**
 * POST /dev-assistant/upload
 *
 * Lets a headless Claude Code Routine publish a generated image (e.g. a
 * before/after mock) to R2 and get back a fetchable https URL to drop into the
 * `screenshots` array of its callback. A routine has no user auth token and no
 * image host, and `getMediaUrl` rejects `data:` URIs — so without this the
 * dashboard could only ever show inline ASCII/markdown mocks.
 *
 * Auth reuses the callback's HMAC scheme: `x-togather-signature` =
 * HMAC-SHA256(DEV_ASSISTANT_CALLBACK_SECRET, rawBody). No new secret.
 *
 * Body: { dataBase64: string, contentType?: string, fileName?: string }
 * Returns: { url: string } — a public `${R2_PUBLIC_URL}/<key>` URL.
 */
http.route({
  path: "/dev-assistant/upload",
  method: "POST",
  handler: httpAction(async (_ctx, request) => {
    const body = await request.text();
    const signature = request.headers.get("x-togather-signature");
    if (!signature) {
      return new Response("Missing x-togather-signature header", { status: 401 });
    }

    const secret = process.env.DEV_ASSISTANT_CALLBACK_SECRET;
    if (!secret) {
      console.error("[DevAssistant] DEV_ASSISTANT_CALLBACK_SECRET not configured");
      return new Response("Upload not configured", { status: 500 });
    }

    const isValid = await verifyDevAssistantSignature(body, signature, secret);
    if (!isValid) {
      console.error("[DevAssistant] Invalid upload signature");
      return new Response("Invalid signature", { status: 401 });
    }

    let payload: {
      dataBase64?: string;
      contentType?: string;
      fileName?: string;
    };
    try {
      payload = JSON.parse(body);
    } catch {
      return new Response("Invalid JSON", { status: 400 });
    }

    const contentType = payload.contentType ?? "image/png";
    if (!DEV_ASSISTANT_UPLOAD_CONTENT_TYPES.includes(contentType)) {
      return new Response(`Unsupported contentType: ${contentType}`, {
        status: 400,
      });
    }
    if (typeof payload.dataBase64 !== "string" || payload.dataBase64.length === 0) {
      return new Response("Missing dataBase64", { status: 400 });
    }

    const publicBase = process.env.R2_PUBLIC_URL;
    if (!publicBase) {
      console.error("[DevAssistant] R2_PUBLIC_URL not configured");
      return new Response("Storage not configured", { status: 500 });
    }

    // Tolerate a full `data:<type>;base64,<data>` URI by taking the tail.
    const base64 = payload.dataBase64.includes(",")
      ? payload.dataBase64.slice(payload.dataBase64.indexOf(",") + 1)
      : payload.dataBase64;

    let buffer: ArrayBuffer;
    try {
      const binary = atob(base64);
      buffer = new ArrayBuffer(binary.length);
      const view = new Uint8Array(buffer);
      for (let i = 0; i < binary.length; i++) {
        view[i] = binary.charCodeAt(i);
      }
    } catch {
      return new Response("Invalid base64", { status: 400 });
    }
    if (buffer.byteLength === 0) {
      return new Response("Empty image", { status: 400 });
    }
    if (buffer.byteLength > DEV_ASSISTANT_UPLOAD_MAX_BYTES) {
      return new Response("Image too large", { status: 413 });
    }

    const { key } = await putR2Object({
      folder: "dev-assistant",
      fileName: payload.fileName ?? "mock.png",
      contentType,
      body: buffer,
    });

    return new Response(
      JSON.stringify({ url: `${publicBase}/${key}` }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }),
});

// ============================================================================
// GitHub Webhook (ADR-029 Phase 2)
// ============================================================================

/**
 * Verify a GitHub webhook signature (`X-Hub-Signature-256`) using the Web
 * Crypto API — same HMAC-SHA256 + constant-time-compare pattern as the Stripe
 * handler. GitHub sends `sha256=<hex digest of the raw body>`.
 */
async function verifyGithubSignature(
  payload: string,
  signature: string,
  secret: string
): Promise<boolean> {
  try {
    const prefix = "sha256=";
    if (!signature.startsWith(prefix)) return false;
    const provided = signature.slice(prefix.length).toLowerCase();

    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );
    const signatureBytes = await crypto.subtle.sign(
      "HMAC",
      key,
      encoder.encode(payload)
    );
    const computedSig = Array.from(new Uint8Array(signatureBytes))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    return timingSafeEqual(provided, computedSig);
  } catch {
    return false;
  }
}

/**
 * POST /github/webhook
 *
 * Inbound GitHub webhook for the contributor dev dashboard (ADR-029 Phase 2).
 * Replaces polling: a merged PR flips the correlated devBug to MERGED (+
 * shippedAt, thread message, push) even when the merge happened directly on
 * GitHub; a PR closed without merging flags the item for a maintainer.
 *
 * Only `pull_request` events with action "closed" do anything — everything
 * else (ping, other events, other actions) returns 200 "ignored" fast.
 * Correlation to a devBug happens in the scheduled internalMutation
 * (handleGithubPrClosed): primarily by the Routine's `claude/devbug-<bugId>`
 * head-branch convention, falling back to matching html_url against stored
 * prUrl. Responds 200 immediately after scheduling (async-schedule-then-200,
 * like the Slack handler).
 */
http.route({
  path: "/github/webhook",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const body = await request.text();

    // Falls back to the dev-assistant callback secret so a single shared
    // secret can serve both inbound channels; set GITHUB_WEBHOOK_SECRET to
    // split them without a code change.
    const secret =
      process.env.GITHUB_WEBHOOK_SECRET ??
      process.env.DEV_ASSISTANT_CALLBACK_SECRET;
    if (!secret) {
      console.error("[GithubWebhook] GITHUB_WEBHOOK_SECRET not configured");
      return new Response("GitHub webhook not configured", { status: 503 });
    }

    const signature = request.headers.get("x-hub-signature-256");
    if (!signature) {
      return new Response("Missing x-hub-signature-256 header", {
        status: 401,
      });
    }
    const isValid = await verifyGithubSignature(body, signature, secret);
    if (!isValid) {
      console.error("[GithubWebhook] Invalid signature");
      return new Response("Invalid signature", { status: 401 });
    }

    // Only closed pull requests matter; ack everything else immediately.
    const event = request.headers.get("x-github-event");
    if (event !== "pull_request") {
      return new Response("ignored", { status: 200 });
    }

    let payload: {
      action?: string;
      pull_request?: {
        merged?: boolean;
        html_url?: string;
        head?: { ref?: string };
      };
    };
    try {
      payload = JSON.parse(body);
    } catch {
      return new Response("Invalid JSON", { status: 400 });
    }

    if (payload.action !== "closed") {
      return new Response("ignored", { status: 200 });
    }

    const pr = payload.pull_request;
    const branchRef = pr?.head?.ref;
    if (!pr || typeof pr.merged !== "boolean" || typeof branchRef !== "string") {
      return new Response("Invalid pull_request payload", { status: 400 });
    }

    await ctx.scheduler.runAfter(
      0,
      internal.functions.devAssistant.bugs.handleGithubPrClosed,
      {
        branchRef,
        prUrl: typeof pr.html_url === "string" ? pr.html_url : undefined,
        merged: pr.merged,
      }
    );

    return new Response(JSON.stringify({ received: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }),
});

export default http;
