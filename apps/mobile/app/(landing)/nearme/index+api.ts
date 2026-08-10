/**
 * API Route for Nearme Link Previews
 *
 * Handles bot requests for /nearme URLs by returning HTML with Open Graph meta tags.
 * Regular users are passed through to the page component.
 *
 * This replaces the Cloudflare Worker for nearme link previews.
 */

import { DOMAIN_CONFIG } from "@togather/shared";

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

// Flat meta shape returned by GET /link-preview/meta — see
// apps/convex/functions/linkPreviewMeta.ts for the source of truth. All
// fields are already final/ready to render.
interface LinkPreviewMeta {
  title: string;
  description: string;
  image: string | null;
  url: string;
  siteName: string;
  imageAlt?: string;
}

function generateOgHtml(meta: LinkPreviewMeta): string {
  const title = escapeHtml(meta.title);
  const description = escapeHtml(meta.description);
  const siteName = escapeHtml(meta.siteName);
  const imageUrl = meta.image || "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">

  <!-- Primary Meta Tags -->
  <title>${title}</title>
  <meta name="title" content="${title}">
  <meta name="description" content="${description}">

  <!-- Open Graph / Facebook -->
  <meta property="og:type" content="website">
  <meta property="og:url" content="${meta.url}">
  <meta property="og:title" content="${title}">
  <meta property="og:description" content="${description}">
  <meta property="og:site_name" content="${siteName}">
  ${imageUrl ? `<meta property="og:image" content="${imageUrl}">` : ""}
  ${imageUrl ? `<meta property="og:image:secure_url" content="${imageUrl}">` : ""}
  ${imageUrl ? `<meta property="og:image:type" content="image/jpeg">` : ""}
  ${imageUrl ? `<meta property="og:image:width" content="400">` : ""}
  ${imageUrl ? `<meta property="og:image:height" content="400">` : ""}

  <!-- Twitter -->
  <meta name="twitter:card" content="summary">
  <meta name="twitter:url" content="${meta.url}">
  <meta name="twitter:title" content="${title}">
  <meta name="twitter:description" content="${description}">
  ${imageUrl ? `<meta name="twitter:image" content="${imageUrl}">` : ""}

  <!-- Redirect real users to the app -->
  <meta http-equiv="refresh" content="0;url=${meta.url}">

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
  <p>${siteName}</p>
  <p class="loading">Redirecting to the app...</p>
  <p><a href="${meta.url}">Click here if not redirected</a></p>
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
    // The meta endpoint dispatches on the incoming request URL itself —
    // hostname (subdomain) and any ?type= query param carry through
    // unchanged, so we just forward the original request URL as-is.
    const apiUrl = `${convexSiteUrl}/link-preview/meta?url=${encodeURIComponent(originalUrl)}`;

    const response = await fetch(apiUrl, {
      headers: { "Content-Type": "application/json" },
    });

    if (!response.ok) {
      console.error(`Convex link-preview fetch failed: ${response.status}`);
      return new Response(generateErrorHtml(subdomain, originalUrl), {
        status: 200,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }

    const meta: LinkPreviewMeta = await response.json();

    return new Response(generateOgHtml(meta), {
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
