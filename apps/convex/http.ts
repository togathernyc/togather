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
import { verifySlackSignature } from "./functions/slackServiceBot/slack";

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
            internal.functions.billing.handleCheckoutCompleted,
            {
              stripeCustomerId: session.customer,
              stripeSubscriptionId: session.subscription,
              communityId: session.metadata.communityId,
              proposalId: session.metadata.proposalId,
            }
          );
          break;
        }
        case "customer.subscription.updated": {
          const subscription = event.data.object;
          await ctx.runMutation(
            internal.functions.billing.handleSubscriptionUpdated,
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
            internal.functions.billing.handleSubscriptionUpdated,
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
            internal.functions.billing.handlePaymentFailed,
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

export default http;
