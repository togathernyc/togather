/**
 * Cloudflare Worker for Togather (togather.nyc)
 *
 * This worker handles all traffic for togather.nyc and routes it appropriately:
 * - Static pages (/, /android, /download, /_expo/*) -> pass through to EAS Hosting
 * - OG tag routes (/e/:shortId, /g/:shortId, /nearme, /) for bots -> return OG HTML
 * - All other traffic -> pass through to EAS Hosting (origin)
 *
 * Deploy:
 *   Production: npx wrangler deploy
 *   Staging: npx wrangler deploy -c wrangler.staging.toml
 *
 * Environment Variables:
 * - CONVEX_SITE_URL: Convex HTTP endpoint URL (e.g., https://your-deployment.convex.site)
 *
 * @see docs/architecture/ADR-009-link-preview-system.md
 */

// Environment-specific configuration
// The worker detects staging vs production based on hostname
const ENVIRONMENTS = {
  production: {
    appOrigin: "https://togather.expo.app",
    landingPage: "https://togather-landing.pages.dev",
    baseUrl: "https://togather.nyc",
  },
  staging: {
    appOrigin: "https://togather--staging.expo.app",
    landingPage: "https://staging.togather-landing.pages.dev",
    baseUrl: "https://staging.togather.nyc",
  },
};

// Universal Links / App Links configuration
// Apple Team ID - required for Universal Links AASA file generation.
// For forks, set APPLE_TEAM_ID as a wrangler secret and use env.APPLE_TEAM_ID instead.
const APPLE_TEAM_ID = "647N4W6575";

// iOS Bundle Identifiers
const IOS_BUNDLE_IDS = {
  production: "app.gatherful.mobile",
  staging: "life.togather.staging",
};

// Android package names
const ANDROID_PACKAGES = {
  production: "app.gatherful.mobile",
  staging: "life.togather.staging",
};

// Android SHA256 fingerprints - get from Google Play Console or EAS credentials
// Run: eas credentials -p android to view fingerprints
const ANDROID_SHA256_FINGERPRINTS = {
  // Production fingerprints. App Links verification matches the signing cert of
  // the installed APK, so we list every key a production build can be signed with.
  // Source: Play Console → App integrity → App signing.
  production: [
    // Google Play App Signing key — apps installed from Play are re-signed with
    // this key on Google's servers. REQUIRED for App Links on Play-distributed builds.
    "00:76:C0:E6:BD:96:C1:96:C0:68:1C:29:07:3F:C2:57:FD:E4:39:84:95:FA:42:D2:7D:76:12:2D:0B:CE:0A:C0",
    // EAS upload key — covers EAS-built APKs (internal distribution / R2 sideload).
    "D0:4F:1D:A8:37:A3:B9:CF:91:66:08:09:AA:01:BE:E5:DC:CC:0E:6F:80:A5:C5:BE:DE:60:8B:0A:E0:A5:42:F1",
    // Previously-configured fingerprint (origin unclear); retained so any build
    // already signed with it continues to verify.
    "FA:C6:17:45:DC:09:03:78:6F:B9:ED:E6:2A:96:2B:39:9F:73:48:F0:BB:6F:89:9B:83:32:66:75:91:03:3B:9C"
  ],
  // Staging app signing key fingerprint
  staging: [
    "6B:5B:E8:CA:F5:FF:8A:C2:07:02:9D:C5:C7:46:00:77:4F:98:05:86:E2:97:D9:7F:48:87:E2:70:C3:17:ED:23"
  ],
};

/**
 * Generate Apple App Site Association file for Universal Links
 * This tells iOS which paths should open in which app
 *
 * IMPORTANT: Using exclusion patterns so new app routes work via OTA!
 * Only landing pages are excluded - everything else opens in the app.
 * To add new app routes, just add the route files - no AASA update needed.
 */
function generateAppleAppSiteAssociation(hostname) {
  const env = getEnvironment(hostname);

  // Each domain only includes its own app — no cross-listing
  const appID = env === "staging"
    ? `${APPLE_TEAM_ID}.${IOS_BUNDLE_IDS.staging}`
    : `${APPLE_TEAM_ID}.${IOS_BUNDLE_IDS.production}`;

  // Paths to exclude from universal links (landing/static pages).
  // These are served by the Vite web app (apps/web), not the Expo app — if the
  // app claimed them it would render a "Page Not Found" screen. Every content
  // route needs BOTH its exact path and a `/*` variant, otherwise sub-pages
  // (e.g. /contribute/ai, /guides/branding) fall through to the `*` catch-all
  // below and get captured by the app. Keep this in sync with the web routes in
  // apps/web/src/main.tsx and WEB_ONLY_ROOTS in apps/mobile/app/+native-intent.ts.
  const excludedPaths = [
    "/",
    "/android",
    "/android-staging",
    "/download",
    "/legal",
    "/legal/*",
    "/contribute",
    "/contribute/*",
    "/issue",
    "/guides",
    "/guides/*",
    "/developers",
    "/developers/*",
    "/onboarding/*",
    "/admin/*",
    "/billing/*",
  ];

  return {
    applinks: {
      // Modern "components" format (iOS 13+, recommended by Apple)
      details: [
        {
          appIDs: [appID],
          components: [
            // Exclude landing/static pages
            ...excludedPaths.map(path => ({ "/": path, exclude: true })),
            // Exclude Expo internal routes
            { "/": "/_expo/*", exclude: true },
            // Match everything else (app routes like /g/*, /e/*, /nearme)
            { "/": "*" },
          ],
        },
      ],
    },
    webcredentials: {
      apps: [appID],
    },
  };
}

/**
 * Generate Android Asset Links file for App Links
 * This tells Android which app should handle which URLs
 */
function generateAssetLinks(hostname) {
  const env = getEnvironment(hostname);

  // Each domain only includes its own app — no cross-listing
  const pkg = env === "staging" ? ANDROID_PACKAGES.staging : ANDROID_PACKAGES.production;
  const fingerprints = env === "staging"
    ? ANDROID_SHA256_FINGERPRINTS.staging
    : ANDROID_SHA256_FINGERPRINTS.production;

  return [
    {
      relation: ["delegate_permission/common.handle_all_urls"],
      target: {
        namespace: "android_app",
        package_name: pkg,
        sha256_cert_fingerprints: fingerprints,
      },
    },
  ];
}

/**
 * Detect environment based on hostname
 */
function getEnvironment(hostname) {
  if (hostname === "staging.togather.nyc" || hostname.endsWith(".staging.togather.nyc")) {
    return "staging";
  }
  return "production";
}

/**
 * Get environment-specific configuration
 */
function getConfig(hostname) {
  const env = getEnvironment(hostname);
  return ENVIRONMENTS[env];
}

// Brand configuration
const BRAND_NAME = "Togather";

// Default OG image for link previews
const DEFAULT_OG_IMAGE = "https://togather.nyc/og-image.png";

// Static paths that should go to the landing page (not the app)
// Note: /android path handling is environment-aware (see isLandingPagePath)
const LANDING_PAGE_PATHS = ["/", "/download", "/legal", "/legal/privacy", "/legal/terms", "/contribute", "/issue", "/guides", "/developers"];

// Multi-segment landing page routes served by the Vite site.
// "/guides/" covers the church onboarding guide pages (e.g. /guides/branding).
// "/contribute/" covers the contribution sub-pages (e.g. /contribute/ai).
// Trailing slash keeps these from matching community slugs like /guidesxyz.
const LANDING_PAGE_PREFIXES = ["/guides/", "/contribute/"];

// Known single-segment app routes that should NOT be redirected to /c/:slug.
// These come from Expo Router route groups: (tabs), (auth), (user), (landing), and root-level routes.
const KNOWN_APP_ROUTES = new Set([
  // (tabs)
  "admin", "chat", "groups", "profile", "search",
  // (auth)
  "claim-account", "confirm-identity", "join-flow", "new-user-profile",
  "register-phone", "reset-password", "select-community", "signin",
  "signup", "user-type", "verify-email", "welcome",
  // (user)
  "create-event", "create-group", "dinner-party-search", "edit-profile",
  "group-events", "leader-tools", "redirect", "request-group", "settings",
  // (landing)
  "demo", "get-started", "nearme", "our-story", "support",
  // root
  "inbox", "ui-test", "planning-center",
  // contributor dev dashboard (the dashboard lives at /dev in the app)
  "dev",
  // onboarding & billing (browser-only, served by Expo web app)
  "onboarding", "billing",
]);

// Static asset extensions that should go to the landing page (when at root level)
const LANDING_PAGE_ASSET_EXTENSIONS = [
  ".css",
  ".js",
  ".svg",
  ".png",
  ".ico",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".woff",
  ".woff2",
  ".ttf",
  ".eot",
  ".txt",
  ".xml",
  ".json",
];

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

/**
 * Check if the User-Agent belongs to a bot/crawler
 */
function isBot(userAgent) {
  if (!userAgent) return false;
  const ua = userAgent.toLowerCase();
  return BOT_USER_AGENTS.some((bot) => ua.includes(bot.toLowerCase()));
}

/**
 * Check if the path should go to the landing page
 */
function isLandingPagePath(pathname) {
  // Exact matches for landing page paths
  if (LANDING_PAGE_PATHS.includes(pathname)) {
    return true;
  }
  // Trailing slash versions
  if (LANDING_PAGE_PATHS.includes(pathname.replace(/\/$/, ""))) {
    return true;
  }
  // Paths starting with /android (including /android-staging)
  if (pathname.startsWith("/android")) {
    return true;
  }
  // Multi-segment landing page routes (onboarding, admin, billing)
  if (LANDING_PAGE_PREFIXES.some(prefix => pathname.startsWith(prefix))) {
    return true;
  }
  // Landing page assets directory (Vite builds to /assets/)
  // BUT exclude Expo assets which also use /assets/ (e.g., /assets/__node_modules/...)
  if (pathname.startsWith("/assets/") && !pathname.includes("__node_modules")) {
    return true;
  }
  // Landing page images directory
  if (pathname.startsWith("/images/")) {
    return true;
  }
  // Root-level static assets (e.g., /styles.css, /script.js, /favicon.svg)
  // These don't have subdirectories (only one segment after the /)
  const segments = pathname.split("/").filter(Boolean);
  if (segments.length === 1) {
    const filename = segments[0];
    if (LANDING_PAGE_ASSET_EXTENSIONS.some((ext) => filename.endsWith(ext))) {
      return true;
    }
  }
  return false;
}

/**
 * Check if the path is an Expo asset that should go to the app
 */
function isExpoAsset(pathname) {
  return pathname.startsWith("/_expo/");
}

/**
 * Get Convex site URL from environment
 */
function getConvexSiteUrl(env) {
  return env?.CONVEX_SITE_URL || "";
}

/**
 * Fetch fully-rendered link preview metadata from the Convex HTTP endpoint.
 *
 * Convex owns all per-entity-type logic (events/groups/tools/channels/
 * communities/nearme): building titles and descriptions, resolving image
 * fallback chains, and formatting dates. The worker just renders whatever
 * comes back — see `renderOgHtml` below.
 *
 * @param {string} requestUrl - The full original request URL (not just the path)
 * @param {string} convexSiteUrl - Convex HTTP endpoint base URL
 * @returns {Promise<Object|null>} Preview metadata, or null if unavailable
 */
async function fetchPreviewMeta(requestUrl, convexSiteUrl) {
  if (!convexSiteUrl) {
    console.error("CONVEX_SITE_URL not configured");
    return null;
  }

  const metaUrl = `${convexSiteUrl}/link-preview/meta?url=${encodeURIComponent(requestUrl)}`;

  const response = await fetch(metaUrl, {
    headers: { "Content-Type": "application/json" },
  });

  if (!response.ok) {
    console.error(`Convex link-preview meta fetch failed: ${response.status}`);
    return null;
  }

  return response.json();
}

/**
 * Escape HTML special characters
 */
function escapeHtml(str) {
  if (!str) return "";
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/**
 * Generate homepage OG HTML for bots
 * @param {Object} config - Environment-specific configuration
 */
function generateHomepageOgHtml(config) {
  const title = `${BRAND_NAME} - Connect Your Community`;
  const description = "Togather brings your groups, messaging, and events together in one place. The all-in-one platform for churches and communities.";
  const pageUrl = config.baseUrl;

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
  <meta property="og:url" content="${pageUrl}">
  <meta property="og:title" content="${title}">
  <meta property="og:description" content="${description}">
  <meta property="og:site_name" content="${BRAND_NAME}">
  ${DEFAULT_OG_IMAGE ? `<meta property="og:image" content="${DEFAULT_OG_IMAGE}">` : ""}

  <!-- Twitter -->
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:url" content="${pageUrl}">
  <meta name="twitter:title" content="${title}">
  <meta name="twitter:description" content="${description}">
  ${DEFAULT_OG_IMAGE ? `<meta name="twitter:image" content="${DEFAULT_OG_IMAGE}">` : ""}

  <!-- Redirect real users to the app -->
  <meta http-equiv="refresh" content="0;url=${pageUrl}">

  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      max-width: 600px;
      margin: 40px auto;
      padding: 20px;
      text-align: center;
    }
    h1 { color: #333; }
    p { color: #666; }
    a { color: #8C10FE; }
    .loading { color: #999; font-size: 14px; }
  </style>
</head>
<body>
  <h1>${BRAND_NAME}</h1>
  <p>${description}</p>
  <p class="loading">Redirecting to the app...</p>
  <p><a href="${pageUrl}">Click here if not redirected</a></p>
</body>
</html>`;
}

/**
 * Render the shared bot-preview OG HTML template from Convex-provided metadata.
 *
 * All entity-specific logic (event/group/tool/channel/community/nearme titles,
 * descriptions, image fallback chains) lives in Convex — this just escapes and
 * lays out whatever `fetchPreviewMeta` returned.
 * @param {Object} meta - Preview metadata from the Convex `/link-preview/meta` endpoint
 * @param {string} meta.title
 * @param {string} meta.description
 * @param {string|null} meta.image
 * @param {string} meta.url - Absolute canonical destination for the meta-refresh redirect
 * @param {string} meta.siteName
 * @param {string} [meta.imageAlt]
 * @param {number} [meta.imageWidth] - Defaults to 1200 (og:image:width) when omitted
 * @param {number} [meta.imageHeight] - Defaults to 630 (og:image:height) when omitted
 */
function renderOgHtml(meta) {
  const title = escapeHtml(meta.title || "");
  const description = escapeHtml(meta.description || "");
  const siteName = escapeHtml(meta.siteName || BRAND_NAME);
  // Escape the raw fallback, not `title` (already escaped) — escaping it again
  // would turn e.g. "&amp;" into "&amp;amp;".
  const imageAlt = escapeHtml(meta.imageAlt || meta.title || "");
  const imageUrl = meta.image || "";
  const pageUrl = meta.url;
  const imageWidth = meta.imageWidth || 1200;
  const imageHeight = meta.imageHeight || 630;

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
  <meta property="og:url" content="${pageUrl}">
  <meta property="og:title" content="${title}">
  <meta property="og:description" content="${description}">
  <meta property="og:site_name" content="${siteName}">
  ${imageUrl ? `<meta property="og:image" content="${imageUrl}">` : ""}
  ${imageUrl ? `<meta property="og:image:secure_url" content="${imageUrl}">` : ""}
  ${imageUrl ? `<meta property="og:image:type" content="image/jpeg">` : ""}
  ${imageUrl ? `<meta property="og:image:width" content="${imageWidth}">` : ""}
  ${imageUrl ? `<meta property="og:image:height" content="${imageHeight}">` : ""}

  <!-- Twitter -->
  <meta name="twitter:card" content="${imageUrl ? "summary_large_image" : "summary"}">
  <meta name="twitter:url" content="${pageUrl}">
  <meta name="twitter:title" content="${title}">
  <meta name="twitter:description" content="${description}">
  ${imageUrl ? `<meta name="twitter:image" content="${imageUrl}">` : ""}
  ${imageUrl ? `<meta name="twitter:image:alt" content="${imageAlt}">` : ""}

  <!-- Redirect real users to the app -->
  <meta http-equiv="refresh" content="0;url=${pageUrl}">

  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      max-width: 600px;
      margin: 40px auto;
      padding: 20px;
      text-align: center;
    }
    h1 { color: #333; }
    p { color: #666; }
    a { color: #8C10FE; }
    .loading { color: #999; font-size: 14px; }
  </style>
</head>
<body>
  <h1>${title}</h1>
  <p>${siteName}</p>
  <p class="loading">Redirecting to the app...</p>
  <p><a href="${pageUrl}">Click here if not redirected</a></p>
</body>
</html>`;
}

/**
 * Render the shared fallback HTML for bot-preview routes when the Convex
 * meta endpoint returns a 404 (unknown entity) or the fetch itself fails.
 * @param {string} targetUrl - Absolute URL to redirect to. Callers compute
 *   this per-route (see `errorTarget` on each PREVIEW_ROUTES entry) so the
 *   original query string survives and the community route can target its
 *   canonical /c/:slug path instead of the bare slug it was matched on.
 */
function renderPreviewErrorHtml(targetUrl) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${BRAND_NAME}</title>
  <meta property="og:title" content="${BRAND_NAME}">
  <meta property="og:description" content="View this on ${BRAND_NAME}">
  <meta property="og:type" content="website">
  ${DEFAULT_OG_IMAGE ? `<meta property="og:image" content="${DEFAULT_OG_IMAGE}">` : ""}
  <meta http-equiv="refresh" content="0;url=${targetUrl}">
</head>
<body>
  <p>Redirecting...</p>
  <p><a href="${targetUrl}">Click here if not redirected</a></p>
</body>
</html>`;
}

// Matches /e/:shortId, /g/:shortId, /t/:shortId, /ch/:shortId (event, group,
// tool, channel-invite short links). A trailing slash is allowed; anything
// else (e.g. punctuation in the shortId) does not match.
const SHORT_ID_ROUTE_PATTERN = /^\/(e|g|t|ch)\/([a-zA-Z0-9]+)\/?$/;

/**
 * Table of bot-preview routes: paths where crawlers get server-rendered OG
 * tags instead of the SPA shell. Every route delegates its actual preview
 * content (title/description/image) to the Convex `/link-preview/meta`
 * endpoint via `fetchPreviewMeta` + `renderOgHtml` — this table only decides
 * whether a path is a preview route, and how *humans* on that path should be
 * routed (passthrough to the app, vs. redirected to a canonical app route).
 */
const PREVIEW_ROUTES = [
  // /e/:shortId, /g/:shortId, /t/:shortId, /ch/:shortId
  {
    match: (pathname) => SHORT_ID_ROUTE_PATTERN.test(pathname),
    human: (request, config) => passToApp(request, config),
    // No canonical rewrite for short-link routes — the original request URL is the target.
    errorTarget: (url) => url.href,
  },
  // /nearme
  {
    match: (pathname) => pathname === "/nearme" || pathname === "/nearme/",
    human: (request, config) => passToApp(request, config),
    errorTarget: (url) => url.href,
  },
  // /:slug community landing page. Single-segment paths that aren't known
  // app routes are assumed to be community slugs.
  {
    match: (pathname) => {
      const segments = pathname.split("/").filter(Boolean);
      if (segments.length !== 1) return false;
      const slug = segments[0];
      // Only handle if it looks like a slug (lowercase, digits, hyphens) and isn't a known app route
      return /^[a-z0-9][a-z0-9-]*$/.test(slug) && !KNOWN_APP_ROUTES.has(slug);
    },
    // Humans get redirected to the app's /c/:slug route rather than passed through.
    human: (request, config, url) => {
      const slug = url.pathname.split("/").filter(Boolean)[0];
      const redirectUrl = new URL(`/c/${slug}${url.search}`, url.origin);
      return Response.redirect(redirectUrl.toString(), 302);
    },
    // Error fallback targets the canonical /c/:slug route (config.baseUrl,
    // not the request's own origin) — same destination as the human redirect,
    // just anchored to the environment's canonical domain.
    errorTarget: (url, config) => {
      const slug = url.pathname.split("/").filter(Boolean)[0];
      return `${config.baseUrl}/c/${slug}${url.search}`;
    },
  },
];

/**
 * Pass request to the app (EAS Hosting)
 * @param {Request} request - Incoming request
 * @param {Object} config - Environment-specific configuration
 */
async function passToApp(request, config) {
  const url = new URL(request.url);
  const originUrl = new URL(config.appOrigin);

  // Construct the origin request URL
  const targetUrl = new URL(url.pathname + url.search, originUrl);

  // Create a new request to the origin
  const originRequest = new Request(targetUrl, {
    method: request.method,
    headers: request.headers,
    body: request.body,
    redirect: "follow",
  });

  return fetch(originRequest);
}

/**
 * Pass request to the landing page (Cloudflare Pages)
 * @param {Request} request - Incoming request
 * @param {Object} config - Environment-specific configuration
 * @param {string} env - Environment name ('staging' or 'production')
 */
async function passToLandingPage(request, config, env) {
  const url = new URL(request.url);
  const landingUrl = new URL(config.landingPage);

  // Rewrite /android to /android-staging for staging environment
  // This way staging.togather.nyc/android shows the staging download page
  // Handle both /android and /android/ (with trailing slash)
  let pathname = url.pathname;
  if (env === "staging" && (pathname === "/android" || pathname === "/android/")) {
    pathname = "/android-staging";
  }

  // Construct the landing page request URL
  const targetUrl = new URL(pathname + url.search, landingUrl);

  // Create a new request to the landing page
  const landingRequest = new Request(targetUrl, {
    method: request.method,
    headers: request.headers,
    body: request.body,
    redirect: "follow",
  });

  return fetch(landingRequest);
}

export default {
  /**
   * Main request handler
   * @param {Request} request - Incoming request
   * @param {Object} env - Environment bindings (from wrangler.toml vars or secrets)
   */
  async fetch(request, env) {
    const url = new URL(request.url);
    const userAgent = request.headers.get("User-Agent") || "";
    const pathname = url.pathname;

    // Skip worker processing for the image CDN domain - let R2 handle it directly
    // The R2 custom domain handles these requests
    const imageCdnHostname = env?.IMAGE_CDN_HOSTNAME || "images.togather.nyc";
    if (url.hostname === imageCdnHostname) {
      // Return 502 with helpful message - R2 should handle this, not the worker
      // If we're here, DNS might not be configured correctly for R2
      return new Response("R2 storage domain - request should not reach this worker", {
        status: 502,
        headers: { "Content-Type": "text/plain" },
      });
    }

    // Get environment-specific configuration based on hostname
    const envName = getEnvironment(url.hostname);
    const config = getConfig(url.hostname);

    // Get Convex site URL from environment
    const convexSiteUrl = getConvexSiteUrl(env);

    // 0. Handle .well-known files for Universal Links / App Links
    if (pathname === "/.well-known/apple-app-site-association") {
      const aasa = generateAppleAppSiteAssociation(url.hostname);
      return new Response(JSON.stringify(aasa, null, 2), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "public, max-age=3600", // Cache for 1 hour
        },
      });
    }

    if (pathname === "/.well-known/assetlinks.json") {
      const assetLinks = generateAssetLinks(url.hostname);
      return new Response(JSON.stringify(assetLinks, null, 2), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "public, max-age=3600", // Cache for 1 hour
        },
      });
    }

    // 1. Expo assets go to the app
    if (isExpoAsset(pathname)) {
      return passToApp(request, config);
    }

    // 2. Landing page paths (/, /android, /download)
    if (isLandingPagePath(pathname)) {
      if (isBot(userAgent) && (pathname === "/" || pathname === "")) {
        // Return homepage OG tags for bots on root only
        // (The landing page HTML already has OG tags, but we can customize for bots)
        return new Response(generateHomepageOgHtml(config), {
          status: 200,
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
      }
      // Pass to landing page for humans (and bots on /android, /download)
      return passToLandingPage(request, config, envName);
    }

    // 3. Bot-preview routes: /e/:shortId, /g/:shortId, /t/:shortId,
    // /ch/:shortId, /nearme, and community slug landing pages (/:slug).
    // Humans get routed per-entry (passthrough or redirect); bots get a
    // shared OG template rendered from Convex-provided metadata.
    for (const route of PREVIEW_ROUTES) {
      if (!route.match(pathname)) continue;

      if (!isBot(userAgent)) {
        return route.human(request, config, url);
      }

      try {
        const meta = await fetchPreviewMeta(request.url, convexSiteUrl);

        if (!meta) {
          return new Response(renderPreviewErrorHtml(pathname, config), {
            status: 200,
            headers: { "Content-Type": "text/html; charset=utf-8" },
          });
        }

        return new Response(renderOgHtml(meta), {
          status: 200,
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
      } catch (error) {
        console.error(`Error fetching link preview for ${pathname}:`, error);
        return new Response(renderPreviewErrorHtml(pathname, config), {
          status: 200,
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
      }
    }

    // 4. All other paths - pass through to origin
    return passToApp(request, config);
  },
};
