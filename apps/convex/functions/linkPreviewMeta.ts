/**
 * Link Preview Meta Resolver
 *
 * Single typed resolver that assembles link-preview metadata (title,
 * description, image, canonical url, siteName) for every shareable app path.
 * Backs `GET /link-preview/meta?url=<full request url>` in http.ts, which
 * replaced the five per-type `/link-preview/{event,group,tool,community,channel}`
 * endpoints. See ADR-009 for the full link-preview architecture.
 *
 * Design: path dispatch and per-type meta building are pure functions (no
 * ctx, no I/O) so they're unit-testable without a Convex test DB. The only
 * piece that talks to Convex is `resolveLinkPreviewMeta`, which dispatches on
 * the parsed path and calls the same queries the old per-type endpoints used.
 */

import type { ActionCtx } from "../_generated/server";
import { api } from "../_generated/api";
import { safeSliceForJson } from "../lib/utils";

const BRAND_NAME = "Togather";
const MAX_DESCRIPTION_LENGTH = 300;

// ============================================================================
// Response types
// ============================================================================

export interface LinkPreviewMeta {
  title: string;
  description: string;
  image: string | null;
  url: string;
  siteName: string;
  imageAlt?: string;
  // Square (400x400) community-logo previews (nearme, community) override
  // these; the worker's renderOgHtml falls back to 1200x630 when omitted.
  imageWidth?: number;
  imageHeight?: number;
}

export interface LinkPreviewError {
  error: string;
}

export interface LinkPreviewResult {
  status: number;
  body: LinkPreviewMeta | LinkPreviewError;
}

// ============================================================================
// Path dispatch
// ============================================================================

export type LinkPreviewTarget =
  | { type: "event"; shortId: string }
  | { type: "group"; shortId: string }
  | { type: "tool"; shortId: string }
  | { type: "channel"; shortId: string }
  | { type: "nearme"; subdomain: string | null; groupTypeSlug?: string }
  | { type: "community"; slug: string }
  | { type: "unknown" };

const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;

/**
 * Extract the community subdomain from a hostname, e.g. "fount" from
 * "fount.togather.nyc". Ported from getSubdomain() in
 * apps/link-preview/cloudflare-worker.js to keep /nearme behavior identical.
 */
function getSubdomain(hostname: string): string | null {
  const baseDomain = "togather.nyc";
  const parts = hostname.split(".");
  const mainDomain = baseDomain.split(".")[0]; // "togather"
  if (parts.length >= 3 && parts[parts.length - 2] === mainDomain) {
    return parts[0];
  }
  return null;
}

/**
 * Parse a full request URL (pathname/host/query) into a dispatch target.
 * Pure — no I/O. Returns `{ type: "unknown" }` for anything that doesn't
 * match a known pattern, including a malformed `url`.
 */
export function parseLinkPreviewTarget(requestUrl: string): LinkPreviewTarget {
  let parsed: URL;
  try {
    parsed = new URL(requestUrl);
  } catch {
    return { type: "unknown" };
  }

  const pathname = parsed.pathname;

  const eventMatch = pathname.match(/^\/e\/([a-zA-Z0-9]+)\/?$/);
  if (eventMatch) return { type: "event", shortId: eventMatch[1] };

  const groupMatch = pathname.match(/^\/g\/([a-zA-Z0-9]+)\/?$/);
  if (groupMatch) return { type: "group", shortId: groupMatch[1] };

  const toolMatch = pathname.match(/^\/t\/([a-zA-Z0-9]+)\/?$/);
  if (toolMatch) return { type: "tool", shortId: toolMatch[1] };

  const channelMatch = pathname.match(/^\/ch\/([a-zA-Z0-9]+)\/?$/);
  if (channelMatch) return { type: "channel", shortId: channelMatch[1] };

  if (pathname === "/nearme" || pathname === "/nearme/") {
    return {
      type: "nearme",
      subdomain: getSubdomain(parsed.hostname),
      groupTypeSlug: parsed.searchParams.get("type") || undefined,
    };
  }

  const segments = pathname.split("/").filter(Boolean);
  if (segments.length === 1 && SLUG_RE.test(segments[0])) {
    return { type: "community", slug: segments[0] };
  }

  return { type: "unknown" };
}

// ============================================================================
// Date formatting
// ============================================================================

/**
 * Format an ISO date string to a human-readable string in the given IANA
 * timezone, e.g. "Thursday, January 15, 2026 at 2:00 PM EST".
 *
 * Ported from formatDate() in apps/link-preview/cloudflare-worker.js. Falls
 * back to America/New_York (the app's default, see
 * apps/mobile/app/e/[shortId]/EventPageClient.tsx) when the timezone is
 * missing, since a legacy/malformed IANA zone string can make
 * toLocaleDateString throw a RangeError.
 */
export function formatDate(
  isoDate: string | null | undefined,
  timeZone: string | null | undefined
): string {
  if (!isoDate) return "";
  const date = new Date(isoDate);
  const options: Intl.DateTimeFormatOptions = {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  };
  for (const zone of [timeZone, "America/New_York"]) {
    if (!zone) continue;
    try {
      return date.toLocaleDateString("en-US", { ...options, timeZone: zone });
    } catch {
      // Try the next zone.
    }
  }
  return "";
}

// ============================================================================
// Per-type meta builders (pure — take fetched docs, return the meta object)
// ============================================================================

function truncateDescription(text: string): string {
  return safeSliceForJson(text, MAX_DESCRIPTION_LENGTH);
}

export interface EventPreviewSource {
  title?: string | null;
  scheduledAt?: string | null;
  timezone?: string | null;
  locationOverride?: string | null;
  note?: string | null;
  coverImage?: string | null;
  groupName?: string | null;
  groupImage?: string | null;
  communityName?: string | null;
  communityLogo?: string | null;
}

/**
 * Build event preview meta. Image fallback chain: cover image -> group image
 * -> community logo (mirrors generateEventOgHtml() in the worker; the old
 * `/link-preview/event` endpoint's coverImageFallback/groupImageFallback were
 * always identical to coverImage/groupImage, so they're folded away here).
 */
export function buildEventMeta(
  event: EventPreviewSource,
  opts: { shortId: string; origin: string }
): LinkPreviewMeta {
  const eventTitle = event.title || "Event";
  const groupName = event.groupName || "";
  const communityName = event.communityName || BRAND_NAME;
  const dateStr = formatDate(event.scheduledAt, event.timezone);
  const location = event.locationOverride || "";

  let richDescription = "";
  if (dateStr) richDescription += dateStr;
  if (location) richDescription += richDescription ? ` - ${location}` : location;
  if (event.note) {
    richDescription += richDescription ? `\n\n${event.note}` : event.note;
  }
  if (!richDescription) {
    richDescription = `Join ${groupName} for this event`;
  }

  const image = event.coverImage || event.groupImage || event.communityLogo || null;

  return {
    title: `RSVP to ${eventTitle} | ${communityName}`,
    description: truncateDescription(richDescription),
    image,
    url: `${opts.origin}/e/${opts.shortId}`,
    siteName: communityName,
    imageAlt: eventTitle,
  };
}

export interface GroupPreviewSource {
  name?: string | null;
  description?: string | null;
  preview?: string | null;
  memberCount?: number | null;
  communityName?: string | null;
  communityLogo?: string | null;
  city?: string | null;
  state?: string | null;
  groupTypeName?: string | null;
}

/**
 * Build group preview meta. Image fallback chain: group preview -> community
 * logo (mirrors generateGroupOgHtml() in the worker).
 */
export function buildGroupMeta(
  group: GroupPreviewSource,
  opts: { shortId: string; origin: string }
): LinkPreviewMeta {
  const groupName = group.name || "Group";
  const communityName = group.communityName || BRAND_NAME;
  const location = group.city && group.state ? `${group.city}, ${group.state}` : "";
  const memberCount = group.memberCount || 0;

  let richDescription = "";
  if (group.groupTypeName) richDescription = group.groupTypeName;
  if (location) richDescription += richDescription ? ` - ${location}` : location;
  if (memberCount > 0) {
    richDescription += richDescription ? ` - ${memberCount} members` : `${memberCount} members`;
  }
  if (group.description) {
    richDescription += richDescription ? `\n\n${group.description}` : group.description;
  }
  if (!richDescription) {
    richDescription = `Join ${groupName} on ${communityName}`;
  }

  const image = group.preview || group.communityLogo || null;

  return {
    title: `Join ${groupName} | ${communityName}`,
    description: truncateDescription(richDescription),
    image,
    url: `${opts.origin}/g/${opts.shortId}`,
    siteName: communityName,
    imageAlt: groupName,
  };
}

export interface ToolPreviewSource {
  toolType?: string | null;
  groupName?: string | null;
  communityName?: string | null;
  groupImage?: string | null;
  communityLogo?: string | null;
  resourceTitle?: string | null;
  resourceImage?: string | null;
}

/**
 * Build tool preview meta (run sheet or resource). Mirrors
 * generateToolOgHtml() in the worker.
 */
export function buildToolMeta(
  tool: ToolPreviewSource,
  opts: { shortId: string; origin: string }
): LinkPreviewMeta {
  const groupName = tool.groupName || "Group";
  const communityName = tool.communityName || BRAND_NAME;

  let title: string;
  let description: string;
  let image: string | null;

  if (tool.toolType === "runsheet") {
    title = `${groupName} - Run Sheet`;
    description = `View the run sheet for ${groupName}`;
    image = tool.groupImage || tool.communityLogo || null;
  } else if (tool.toolType === "resource") {
    const resourceTitle = tool.resourceTitle || "Resource";
    title = `${groupName} - ${resourceTitle}`;
    description = `View ${resourceTitle} from ${groupName}`;
    image = tool.resourceImage || tool.groupImage || tool.communityLogo || null;
  } else {
    title = `${groupName} - Tool`;
    description = `View this tool from ${groupName}`;
    image = tool.groupImage || tool.communityLogo || null;
  }

  return {
    title: `${title} | ${communityName}`,
    description: truncateDescription(description),
    image,
    url: `${opts.origin}/t/${opts.shortId}`,
    siteName: communityName,
    imageAlt: title,
  };
}

export interface ChannelPreviewSource {
  channelName?: string | null;
  channelDescription?: string | null;
  groupName?: string | null;
  groupImage?: string | null;
  communityName?: string | null;
  communityLogo?: string | null;
}

/**
 * Build channel invite preview meta. Image fallback chain: group image ->
 * community logo (mirrors generateChannelOgHtml() in the worker).
 */
export function buildChannelMeta(
  channel: ChannelPreviewSource,
  opts: { shortId: string; origin: string }
): LinkPreviewMeta {
  const channelName = channel.channelName || "Channel";
  const groupName = channel.groupName || "Group";
  const communityName = channel.communityName || BRAND_NAME;
  const title = `Join #${channelName} in ${groupName}`;
  const description =
    channel.channelDescription ||
    `Join the #${channelName} channel in ${groupName} on ${communityName}`;
  const image = channel.groupImage || channel.communityLogo || null;

  return {
    title: `${title} | ${communityName}`,
    description: truncateDescription(description),
    image,
    url: `${opts.origin}/ch/${opts.shortId}`,
    siteName: communityName,
    imageAlt: title,
  };
}

export interface CommunityPreviewSource {
  community: {
    name?: string | null;
    logo?: string | null;
  };
  groupType?: { name: string } | null;
}

/**
 * Build "near me" preview meta (community + optional group type). Mirrors
 * generateNearmeOgHtml() in the worker. Unlike the other types, /nearme's
 * canonical url is the request url itself — the worker rendered og:url and
 * the refresh redirect straight from the incoming request, with no `/c/`
 * rewrite.
 */
export function buildNearmeMeta(
  data: CommunityPreviewSource,
  opts: { canonicalUrl: string }
): LinkPreviewMeta {
  const communityName = data.community?.name || "Community";
  const groupTypeName = data.groupType?.name;

  const title = groupTypeName ? `Find a ${groupTypeName} Near You` : "Find a Group Near You";
  const description = groupTypeName
    ? `Discover ${groupTypeName} groups in ${communityName}`
    : `Discover groups near you in ${communityName}`;

  return {
    title: `${title} | ${communityName}`,
    description: truncateDescription(description),
    image: data.community?.logo || null,
    url: opts.canonicalUrl,
    siteName: communityName,
    imageWidth: 400,
    imageHeight: 400,
  };
}

/**
 * Build community landing page preview meta. Mirrors
 * generateCommunityOgHtml() in the worker. Canonical url rewrites the bare
 * slug path to `/c/:slug` (e.g. "/fount" -> "<origin>/c/fount"), matching the
 * worker's redirect-humans-to-/c/:slug behavior.
 */
export function buildCommunityMeta(
  data: CommunityPreviewSource,
  opts: { slug: string; origin: string }
): LinkPreviewMeta {
  const communityName = data.community?.name || "Community";

  return {
    title: `${communityName} | ${BRAND_NAME}`,
    description: truncateDescription(`Join ${communityName} on ${BRAND_NAME}`),
    image: data.community?.logo || null,
    url: `${opts.origin}/c/${opts.slug}`,
    siteName: communityName,
    imageWidth: 400,
    imageHeight: 400,
  };
}

// ============================================================================
// Orchestrator (the only piece that talks to Convex)
// ============================================================================

/**
 * Resolve `GET /link-preview/meta?url=<requestUrl>` into a typed meta
 * response. Dispatches on the parsed path, fetches the relevant doc via the
 * same queries the old per-type endpoints used, and builds the meta object.
 * Returns `{ status: 404, body: { error } }` for both "known pattern, entity
 * missing" and "no pattern matched".
 */
export async function resolveLinkPreviewMeta(
  ctx: ActionCtx,
  requestUrl: string
): Promise<LinkPreviewResult> {
  const target = parseLinkPreviewTarget(requestUrl);

  if (target.type === "unknown") {
    return { status: 404, body: { error: "No preview available for this URL" } };
  }

  const parsedUrl = new URL(requestUrl);
  const origin = parsedUrl.origin;

  switch (target.type) {
    case "event": {
      const event = await ctx.runQuery(api.functions.meetings.index.getByShortId, {
        shortId: target.shortId,
      });
      if (!event) return { status: 404, body: { error: "Event not found" } };
      return {
        status: 200,
        body: buildEventMeta(event, { shortId: target.shortId, origin }),
      };
    }

    case "group": {
      const group = await ctx.runQuery(api.functions.groups.index.getByShortId, {
        shortId: target.shortId,
      });
      if (!group) return { status: 404, body: { error: "Group not found" } };
      return {
        status: 200,
        body: buildGroupMeta(group, { shortId: target.shortId, origin }),
      };
    }

    case "tool": {
      const tool = await ctx.runQuery(api.functions.toolShortLinks.index.getByShortId, {
        shortId: target.shortId,
      });
      if (!tool) return { status: 404, body: { error: "Tool not found" } };
      return {
        status: 200,
        body: buildToolMeta(tool as ToolPreviewSource, { shortId: target.shortId, origin }),
      };
    }

    case "channel": {
      const channel = await ctx.runQuery(api.functions.messaging.channelInvites.getByShortId, {
        shortId: target.shortId,
      });
      if (!channel) return { status: 404, body: { error: "Channel not found" } };
      return {
        status: 200,
        body: buildChannelMeta(channel, { shortId: target.shortId, origin }),
      };
    }

    case "nearme": {
      if (!target.subdomain) {
        return { status: 404, body: { error: "Community not found" } };
      }
      try {
        const data = await ctx.runQuery(api.functions.groupSearch.publicLinkPreview, {
          communitySubdomain: target.subdomain,
          groupTypeSlug: target.groupTypeSlug,
        });
        return {
          status: 200,
          body: buildNearmeMeta(data, { canonicalUrl: parsedUrl.href }),
        };
      } catch (error) {
        if (error instanceof Error && error.message.includes("not found")) {
          return { status: 404, body: { error: "Community not found" } };
        }
        throw error;
      }
    }

    case "community": {
      try {
        const data = await ctx.runQuery(api.functions.groupSearch.publicLinkPreview, {
          communitySubdomain: target.slug,
        });
        return {
          status: 200,
          body: buildCommunityMeta(data, { slug: target.slug, origin }),
        };
      } catch (error) {
        if (error instanceof Error && error.message.includes("not found")) {
          return { status: 404, body: { error: "Community not found" } };
        }
        throw error;
      }
    }
  }
}
