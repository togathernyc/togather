/**
 * API Route for Nearme Link Previews
 *
 * Handles bot requests for /nearme URLs by returning HTML with Open Graph meta tags.
 * Regular users are passed through to the page component.
 *
 * This replaces the Cloudflare Worker for nearme link previews.
 */

import { DOMAIN_CONFIG } from "@togather/shared";

const BRAND_NAME = DOMAIN_CONFIG.brandName;
const BASE_DOMAIN = DOMAIN_CONFIG.baseDomain;

// Bot user agents that need link previews
const BOT_USER_AGENTS = [
  "facebookexternalhit",
  "Facebot",
  "Twitterbot",
  "LinkedInBot",
  "WhatsApp",
  "Slackbot",
  "TelegramBot",
  "Discordbot",
  "Pinterest",
  "Googlebot",
  "bingbot",
  "Applebot",
  "bot",
  "crawl",
  "spider",
  "preview",
];

function isBot(userAgent: string | null): boolean {
  if (!userAgent) return false;
  const ua = userAgent.toLowerCase();
  return BOT_USER_AGENTS.some((bot) => ua.includes(bot.toLowerCase()));
}

function escapeHtml(str: string | null | undefined): string {
  if (!str) return "";
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/**
 * Extract subdomain from hostname
 * e.g., "fount" from "fount.togather.nyc"
 */
function getSubdomain(hostname: string): string | null {
  const parts = hostname.split(".");
  const domainParts = BASE_DOMAIN.split(".");
  const mainDomain = domainParts[0]; // e.g., "togather" from "togather.nyc"

  // Handle subdomain.{BASE_DOMAIN} pattern (e.g., fount.togather.nyc)
  if (parts.length >= 3 && parts[parts.length - 2] === mainDomain) {
    return parts[0];
  }
  return null;
}

interface CommunityData {
  name?: string;
  logo?: string;
  logoFallback?: string;
}

interface GroupTypeData {
  name?: string;
  slug?: string;
}

interface LinkPreviewData {
  community?: CommunityData;
  groupType?: GroupTypeData;
  error?: string;
}

function generateNearmeOgHtml(
  data: LinkPreviewData,
  subdomain: string,
  originalUrl: string
): string {
  const communityName = escapeHtml(data.community?.name || "Community");
  const groupTypeName = data.groupType?.name;

  // Build title: "Find a [GroupType] Near You" or "Find a Group Near You"
  const title = groupTypeName
    ? `Find a ${escapeHtml(groupTypeName)} Near You`
    : "Find a Group Near You";

  const description = groupTypeName
    ? `Discover ${escapeHtml(groupTypeName)} groups in ${communityName}`
    : `Discover groups near you in ${communityName}`;

  // Use original S3 bucket URL - compressed bucket may return 403 for community logos
  const imageUrl = data.community?.logo || data.community?.logoFallback || "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">

  <!-- Primary Meta Tags -->
  <title>${title} | ${communityName}</title>
  <meta name="title" content="${title} | ${communityName}">
  <meta name="description" content="${description}">

  <!-- Open Graph / Facebook -->
  <meta property="og:type" content="website">
  <meta property="og:url" content="${originalUrl}">
  <meta property="og:title" content="${title} | ${communityName}">
  <meta property="og:description" content="${description}">
  <meta property="og:site_name" content="${communityName}">
  ${imageUrl ? `<meta property="og:image" content="${imageUrl}">` : ""}
  ${imageUrl ? `<meta property="og:image:secure_url" content="${imageUrl}">` : ""}
  ${imageUrl ? `<meta property="og:image:type" content="image/jpeg">` : ""}
  ${imageUrl ? `<meta property="og:image:width" content="400">` : ""}
  ${imageUrl ? `<meta property="og:image:height" content="400">` : ""}

  <!-- Twitter -->
  <meta name="twitter:card" content="summary">
  <meta name="twitter:url" content="${originalUrl}">
  <meta name="twitter:title" content="${title} | ${communityName}">
  <meta name="twitter:description" content="${description}">
  ${imageUrl ? `<meta name="twitter:image" content="${imageUrl}">` : ""}

  <!-- Redirect real users to the app -->
  <meta http-equiv="refresh" content="0;url=${originalUrl}">

  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      max-width: 600px;
      margin: 40px auto;
      padding: 20px;
      text-align: center;
      background-color: #FDF8F3;
    }
    h1 { color: #333; }
    p { color: #666; }
    a { color: #D4A574; }
    .loading { color: #999; font-size: 14px; }
  </style>
</head>
<body>
  <h1>${title}</h1>
  <p>${communityName}</p>
  <p class="loading">Redirecting to the app...</p>
  <p><a href="${originalUrl}">Click here if not redirected</a></p>
</body>
</html>`;
}

function generateErrorHtml(subdomain: string | null, originalUrl: string): string {
  const communityName = subdomain || "Community";
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Find a Group Near You | ${escapeHtml(communityName)}</title>
  <meta property="og:title" content="Find a Group Near You | ${escapeHtml(communityName)}">
  <meta property="og:description" content="Discover groups near you">
  <meta property="og:type" content="website">
  <meta http-equiv="refresh" content="0;url=${originalUrl}">
</head>
<body>
  <p>Redirecting...</p>
  <p><a href="${originalUrl}">Click here if not redirected</a></p>
</body>
</html>`;
}

export async function GET(request: Request): Promise<Response | undefined> {
  const userAgent = request.headers.get("user-agent");

  // Only intercept bot requests - let regular users through to the page component
  if (!isBot(userAgent)) {
    return undefined; // Falls through to page component
  }

  const url = new URL(request.url);
  const originalUrl = url.href;

  // Extract subdomain from hostname
  const subdomain = getSubdomain(url.hostname);

  if (!subdomain) {
    // No subdomain, return error HTML
    return new Response(generateErrorHtml(null, originalUrl), {
      status: 200,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }

  // Get group type from query parameter
  const groupTypeSlug = url.searchParams.get("type");

  // Get Convex URL from environment
  const convexCloudUrl = process.env.EXPO_PUBLIC_CONVEX_URL;

  if (!convexCloudUrl) {
    console.error("EXPO_PUBLIC_CONVEX_URL not set");
    return new Response(generateErrorHtml(subdomain, originalUrl), {
      status: 200,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }

  // Convex HTTP endpoints use .site domain, not .cloud
  // EXPO_PUBLIC_CONVEX_URL is the .cloud URL for the Convex client
  const convexSiteUrl = convexCloudUrl.replace('.convex.cloud', '.convex.site');

  try {
    // Build API URL with optional group type
    let apiUrl = `${convexSiteUrl}/link-preview/community?communitySubdomain=${encodeURIComponent(subdomain)}`;
    if (groupTypeSlug) {
      apiUrl += `&groupTypeSlug=${encodeURIComponent(groupTypeSlug)}`;
    }

    const response = await fetch(apiUrl, {
      headers: { "Content-Type": "application/json" },
    });

    if (!response.ok) {
      console.error(`Convex community fetch failed: ${response.status}`);
      return new Response(generateErrorHtml(subdomain, originalUrl), {
        status: 200,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }

    const data: LinkPreviewData = await response.json();

    if (data.error) {
      return new Response(generateErrorHtml(subdomain, originalUrl), {
        status: 200,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }

    return new Response(generateNearmeOgHtml(data, subdomain, originalUrl), {
      status: 200,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  } catch (error) {
    console.error(`Error fetching nearme preview for ${subdomain}:`, error);
    return new Response(generateErrorHtml(subdomain, originalUrl), {
      status: 200,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }
}
