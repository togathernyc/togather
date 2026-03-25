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
  // Production app signing key fingerprint
  production: [
    // Upload key fingerprint (for debug/development)
    // Release key fingerprint (managed by Google Play)
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

  // Paths to exclude from universal links (landing/static pages)
  const excludedPaths = [
    "/",
    "/android",
    "/android-staging",
    "/download",
    "/privacy",
    "/terms",
    "/contribute",
    "/issue",
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
const LANDING_PAGE_PATHS = ["/", "/download", "/legal", "/legal/privacy", "/legal/terms", "/contribute", "/issue"];

// Path prefixes that should go to the landing page (multi-segment routes)
const LANDING_PAGE_PREFIXES = ["/onboarding/", "/admin/", "/billing/"];

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
 * Fetch event data from Convex HTTP endpoint
 */
async function fetchEventData(shortId, convexSiteUrl) {
  if (!convexSiteUrl) {
    console.error("CONVEX_SITE_URL not configured");
    return null;
  }

  const url = `${convexSiteUrl}/link-preview/event?shortId=${encodeURIComponent(shortId)}`;

  try {
    const response = await fetch(url, {
      headers: { "Content-Type": "application/json" },
    });

    if (!response.ok) {
      console.error(`Convex event fetch failed: ${response.status}`);
      return null;
    }

    const data = await response.json();
    return data?.error ? null : data;
  } catch (error) {
    console.error("Convex event fetch error:", error);
    return null;
  }
}

/**
 * Fetch group data from Convex HTTP endpoint
 */
async function fetchGroupData(shortId, convexSiteUrl) {
  if (!convexSiteUrl) {
    console.error("CONVEX_SITE_URL not configured");
    return null;
  }

  const url = `${convexSiteUrl}/link-preview/group?shortId=${encodeURIComponent(shortId)}`;

  try {
    const response = await fetch(url, {
      headers: { "Content-Type": "application/json" },
    });

    if (!response.ok) {
      console.error(`Convex group fetch failed: ${response.status}`);
      return null;
    }

    const data = await response.json();
    return data?.error ? null : data;
  } catch (error) {
    console.error("Convex group fetch error:", error);
    return null;
  }
}

/**
 * Fetch tool data from Convex HTTP endpoint
 */
async function fetchToolData(shortId, convexSiteUrl) {
  if (!convexSiteUrl) {
    console.error("CONVEX_SITE_URL not configured");
    return null;
  }

  const url = `${convexSiteUrl}/link-preview/tool?shortId=${encodeURIComponent(shortId)}`;

  try {
    const response = await fetch(url, {
      headers: { "Content-Type": "application/json" },
    });

    if (!response.ok) {
      console.error(`Convex tool fetch failed: ${response.status}`);
      return null;
    }

    const data = await response.json();
    return data?.error ? null : data;
  } catch (error) {
    console.error("Convex tool fetch error:", error);
    return null;
  }
}

/**
 * Fetch community data from Convex HTTP endpoint (for /nearme)
 */
async function fetchCommunityData(communitySubdomain, groupTypeSlug, convexSiteUrl) {
  if (!convexSiteUrl) {
    console.error("CONVEX_SITE_URL not configured");
    return null;
  }

  let url = `${convexSiteUrl}/link-preview/community?communitySubdomain=${encodeURIComponent(communitySubdomain)}`;
  if (groupTypeSlug) {
    url += `&groupTypeSlug=${encodeURIComponent(groupTypeSlug)}`;
  }

  try {
    const response = await fetch(url, {
      headers: { "Content-Type": "application/json" },
    });

    if (!response.ok) {
      console.error(`Convex community fetch failed: ${response.status}`);
      return null;
    }

    const data = await response.json();
    return data?.error ? null : data;
  } catch (error) {
    console.error("Convex community fetch error:", error);
    return null;
  }
}

/**
 * Fetch channel invite data from Convex HTTP endpoint
 */
async function fetchChannelData(shortId, convexSiteUrl) {
  if (!convexSiteUrl) {
    console.error("CONVEX_SITE_URL not configured");
    return null;
  }

  const url = `${convexSiteUrl}/link-preview/channel?shortId=${encodeURIComponent(shortId)}`;

  try {
    const response = await fetch(url, {
      headers: { "Content-Type": "application/json" },
    });

    if (!response.ok) {
      console.error(`Convex channel fetch failed: ${response.status}`);
      return null;
    }

    const data = await response.json();
    return data?.error ? null : data;
  } catch (error) {
    console.error("Convex channel fetch error:", error);
    return null;
  }
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
 * Format ISO date to human-readable string
 */
function formatDate(isoDate) {
  if (!isoDate) return "";
  try {
    const date = new Date(isoDate);
    return date.toLocaleDateString("en-US", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
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
 * Generate event OG HTML for bots
 * @param {Object} event - Event data from Convex
 * @param {string} shortId - Event short ID
 * @param {Object} config - Environment-specific configuration
 */
function generateEventOgHtml(event, shortId, config) {
  const eventTitle = escapeHtml(event.title || "Event");
  const title = `RSVP to ${eventTitle}`;
  const groupName = escapeHtml(event.groupName || "");
  const communityName = escapeHtml(event.communityName || BRAND_NAME);
  const dateStr = formatDate(event.scheduledAt);
  const location = escapeHtml(event.locationOverride || "");

  // Build a rich description
  let richDescription = "";
  if (dateStr) richDescription += dateStr;
  if (location) richDescription += richDescription ? ` - ${location}` : location;
  if (event.note) {
    richDescription += richDescription ? `\n\n${escapeHtml(event.note)}` : escapeHtml(event.note);
  }
  if (!richDescription) {
    richDescription = `Join ${groupName} for this event`;
  }

  // Fallback chain: event cover -> group preview -> community logo
  const imageUrl =
    event.coverImageFallback ||
    event.coverImage ||
    event.groupImageFallback ||
    event.groupImage ||
    event.communityLogo ||
    "";
  const eventUrl = `${config.baseUrl}/e/${shortId}`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">

  <!-- Primary Meta Tags -->
  <title>${title} | ${communityName}</title>
  <meta name="title" content="${title} | ${communityName}">
  <meta name="description" content="${richDescription.substring(0, 200)}">

  <!-- Open Graph / Facebook -->
  <meta property="og:type" content="website">
  <meta property="og:url" content="${eventUrl}">
  <meta property="og:title" content="${title} | ${communityName}">
  <meta property="og:description" content="${richDescription.substring(0, 200)}">
  <meta property="og:site_name" content="${communityName}">
  ${imageUrl ? `<meta property="og:image" content="${imageUrl}">` : ""}
  ${imageUrl ? `<meta property="og:image:secure_url" content="${imageUrl}">` : ""}
  ${imageUrl ? `<meta property="og:image:type" content="image/jpeg">` : ""}
  ${imageUrl ? `<meta property="og:image:width" content="1200">` : ""}
  ${imageUrl ? `<meta property="og:image:height" content="630">` : ""}

  <!-- Twitter -->
  <meta name="twitter:card" content="${imageUrl ? "summary_large_image" : "summary"}">
  <meta name="twitter:url" content="${eventUrl}">
  <meta name="twitter:title" content="${title} | ${communityName}">
  <meta name="twitter:description" content="${richDescription.substring(0, 200)}">
  ${imageUrl ? `<meta name="twitter:image" content="${imageUrl}">` : ""}
  ${imageUrl ? `<meta name="twitter:image:alt" content="${eventTitle}">` : ""}

  <!-- Redirect real users to the app -->
  <meta http-equiv="refresh" content="0;url=${eventUrl}">

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
  <p>${groupName}${communityName ? ` - ${communityName}` : ""}</p>
  ${dateStr ? `<p>${dateStr}</p>` : ""}
  ${location ? `<p>${location}</p>` : ""}
  <p class="loading">Redirecting to the app...</p>
  <p><a href="${eventUrl}">Click here if not redirected</a></p>
</body>
</html>`;
}

/**
 * Generate event error HTML (fallback when API fails)
 * @param {string} shortId - Event short ID
 * @param {Object} config - Environment-specific configuration
 */
function generateEventErrorHtml(shortId, config) {
  const eventUrl = `${config.baseUrl}/e/${shortId}`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Event | ${BRAND_NAME}</title>
  <meta property="og:title" content="Event | ${BRAND_NAME}">
  <meta property="og:description" content="View this event on ${BRAND_NAME}">
  <meta property="og:type" content="website">
  <meta http-equiv="refresh" content="0;url=${eventUrl}">
</head>
<body>
  <p>Redirecting...</p>
  <p><a href="${eventUrl}">Click here if not redirected</a></p>
</body>
</html>`;
}

/**
 * Generate group OG HTML for bots
 * @param {Object} group - Group data from Convex
 * @param {string} shortId - Group short ID
 * @param {Object} config - Environment-specific configuration
 */
function generateGroupOgHtml(group, shortId, config) {
  const groupName = escapeHtml(group.name || "Group");
  const title = `Join ${groupName}`;
  const communityName = escapeHtml(group.communityName || BRAND_NAME);
  const location = group.city && group.state ? `${escapeHtml(group.city)}, ${escapeHtml(group.state)}` : "";
  const memberCount = group.memberCount || 0;

  // Build a rich description
  let richDescription = "";
  if (group.groupTypeName) {
    richDescription = escapeHtml(group.groupTypeName);
  }
  if (location) {
    richDescription += richDescription ? ` - ${location}` : location;
  }
  if (memberCount > 0) {
    richDescription += richDescription ? ` - ${memberCount} members` : `${memberCount} members`;
  }
  if (group.description) {
    richDescription += richDescription ? `\n\n${escapeHtml(group.description)}` : escapeHtml(group.description);
  }
  if (!richDescription) {
    richDescription = `Join ${groupName} on ${communityName}`;
  }

  // Fallback chain: group preview -> community logo
  const imageUrl = group.preview || group.communityLogo || "";
  const groupUrl = `${config.baseUrl}/g/${shortId}`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">

  <!-- Primary Meta Tags -->
  <title>${title} | ${communityName}</title>
  <meta name="title" content="${title} | ${communityName}">
  <meta name="description" content="${richDescription.substring(0, 200)}">

  <!-- Open Graph / Facebook -->
  <meta property="og:type" content="website">
  <meta property="og:url" content="${groupUrl}">
  <meta property="og:title" content="${title} | ${communityName}">
  <meta property="og:description" content="${richDescription.substring(0, 200)}">
  <meta property="og:site_name" content="${communityName}">
  ${imageUrl ? `<meta property="og:image" content="${imageUrl}">` : ""}
  ${imageUrl ? `<meta property="og:image:secure_url" content="${imageUrl}">` : ""}
  ${imageUrl ? `<meta property="og:image:type" content="image/jpeg">` : ""}
  ${imageUrl ? `<meta property="og:image:width" content="1200">` : ""}
  ${imageUrl ? `<meta property="og:image:height" content="630">` : ""}

  <!-- Twitter -->
  <meta name="twitter:card" content="${imageUrl ? "summary_large_image" : "summary"}">
  <meta name="twitter:url" content="${groupUrl}">
  <meta name="twitter:title" content="${title} | ${communityName}">
  <meta name="twitter:description" content="${richDescription.substring(0, 200)}">
  ${imageUrl ? `<meta name="twitter:image" content="${imageUrl}">` : ""}
  ${imageUrl ? `<meta name="twitter:image:alt" content="${groupName}">` : ""}

  <!-- Redirect real users to the app -->
  <meta http-equiv="refresh" content="0;url=${groupUrl}">

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
  <p>${communityName}</p>
  ${location ? `<p>${location}</p>` : ""}
  ${memberCount > 0 ? `<p>${memberCount} members</p>` : ""}
  <p class="loading">Redirecting to the app...</p>
  <p><a href="${groupUrl}">Click here if not redirected</a></p>
</body>
</html>`;
}

/**
 * Generate group error HTML (fallback when API fails)
 * @param {string} shortId - Group short ID
 * @param {Object} config - Environment-specific configuration
 */
function generateGroupErrorHtml(shortId, config) {
  const groupUrl = `${config.baseUrl}/g/${shortId}`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Group | ${BRAND_NAME}</title>
  <meta property="og:title" content="Group | ${BRAND_NAME}">
  <meta property="og:description" content="View this group on ${BRAND_NAME}">
  <meta property="og:type" content="website">
  <meta http-equiv="refresh" content="0;url=${groupUrl}">
</head>
<body>
  <p>Redirecting...</p>
  <p><a href="${groupUrl}">Click here if not redirected</a></p>
</body>
</html>`;
}

/**
 * Generate tool OG HTML for bots
 * @param {Object} tool - Tool data from Convex
 * @param {string} shortId - Tool short ID
 * @param {Object} config - Environment-specific configuration
 */
function generateToolOgHtml(tool, shortId, config) {
  const groupName = escapeHtml(tool.groupName || "Group");
  const communityName = escapeHtml(tool.communityName || BRAND_NAME);

  let title, description, imageUrl;

  if (tool.toolType === "runsheet") {
    title = `${groupName} - Run Sheet`;
    description = `View the run sheet for ${groupName}`;
    // Run sheet has no dedicated image — use group image or community logo
    imageUrl = tool.groupImage || tool.communityLogo || "";
  } else if (tool.toolType === "resource") {
    const resourceTitle = escapeHtml(tool.resourceTitle || "Resource");
    title = `${groupName} - ${resourceTitle}`;
    description = `View ${resourceTitle} from ${groupName}`;
    // Resource image > group image > community logo
    imageUrl = tool.resourceImage || tool.groupImage || tool.communityLogo || "";
  } else {
    title = `${groupName} - Tool`;
    description = `View this tool from ${groupName}`;
    imageUrl = tool.groupImage || tool.communityLogo || "";
  }

  const toolUrl = `${config.baseUrl}/t/${shortId}`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">

  <!-- Primary Meta Tags -->
  <title>${title} | ${communityName}</title>
  <meta name="title" content="${title} | ${communityName}">
  <meta name="description" content="${escapeHtml(description).substring(0, 200)}">

  <!-- Open Graph / Facebook -->
  <meta property="og:type" content="website">
  <meta property="og:url" content="${toolUrl}">
  <meta property="og:title" content="${title} | ${communityName}">
  <meta property="og:description" content="${escapeHtml(description).substring(0, 200)}">
  <meta property="og:site_name" content="${communityName}">
  ${imageUrl ? `<meta property="og:image" content="${imageUrl}">` : ""}
  ${imageUrl ? `<meta property="og:image:secure_url" content="${imageUrl}">` : ""}
  ${imageUrl ? `<meta property="og:image:type" content="image/jpeg">` : ""}
  ${imageUrl ? `<meta property="og:image:width" content="1200">` : ""}
  ${imageUrl ? `<meta property="og:image:height" content="630">` : ""}

  <!-- Twitter -->
  <meta name="twitter:card" content="${imageUrl ? "summary_large_image" : "summary"}">
  <meta name="twitter:url" content="${toolUrl}">
  <meta name="twitter:title" content="${title} | ${communityName}">
  <meta name="twitter:description" content="${escapeHtml(description).substring(0, 200)}">
  ${imageUrl ? `<meta name="twitter:image" content="${imageUrl}">` : ""}
  ${imageUrl ? `<meta name="twitter:image:alt" content="${title}">` : ""}

  <!-- Redirect real users to the app -->
  <meta http-equiv="refresh" content="0;url=${toolUrl}">

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
  <p>${communityName}</p>
  <p class="loading">Redirecting to the app...</p>
  <p><a href="${toolUrl}">Click here if not redirected</a></p>
</body>
</html>`;
}

/**
 * Generate tool error HTML (fallback when API fails)
 * @param {string} shortId - Tool short ID
 * @param {Object} config - Environment-specific configuration
 */
function generateToolErrorHtml(shortId, config) {
  const toolUrl = `${config.baseUrl}/t/${shortId}`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Tool | ${BRAND_NAME}</title>
  <meta property="og:title" content="Tool | ${BRAND_NAME}">
  <meta property="og:description" content="View this tool on ${BRAND_NAME}">
  <meta property="og:type" content="website">
  <meta http-equiv="refresh" content="0;url=${toolUrl}">
</head>
<body>
  <p>Redirecting...</p>
  <p><a href="${toolUrl}">Click here if not redirected</a></p>
</body>
</html>`;
}

/**
 * Generate nearme OG HTML for bots
 */
function generateNearmeOgHtml(data, originalUrl) {
  const communityName = escapeHtml(data.community?.name || "Community");
  const groupTypeName = data.groupType?.name;

  // Build title: "Find a [GroupType] Near You" or "Find a Group Near You"
  const title = groupTypeName
    ? `Find a ${escapeHtml(groupTypeName)} Near You`
    : "Find a Group Near You";

  const description = groupTypeName
    ? `Discover ${escapeHtml(groupTypeName)} groups in ${communityName}`
    : `Discover groups near you in ${communityName}`;

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
    }
    h1 { color: #333; }
    p { color: #666; }
    a { color: #8C10FE; }
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

/**
 * Generate nearme error HTML (fallback when API fails)
 */
function generateNearmeErrorHtml(originalUrl) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Find a Group Near You | ${BRAND_NAME}</title>
  <meta property="og:title" content="Find a Group Near You | ${BRAND_NAME}">
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

/**
 * Generate community landing page OG HTML for bots
 */
function generateCommunityOgHtml(data, slug, config) {
  const communityName = escapeHtml(data.community?.name || "Community");
  const title = communityName;
  const description = `Join ${communityName} on Togather`;
  const imageUrl = data.community?.logo || data.community?.logoFallback || "";
  const pageUrl = `${config.baseUrl}/${slug}`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">

  <!-- Primary Meta Tags -->
  <title>${title} | ${BRAND_NAME}</title>
  <meta name="title" content="${title} | ${BRAND_NAME}">
  <meta name="description" content="${description}">

  <!-- Open Graph / Facebook -->
  <meta property="og:type" content="website">
  <meta property="og:url" content="${pageUrl}">
  <meta property="og:title" content="${title}">
  <meta property="og:description" content="${description}">
  <meta property="og:site_name" content="${BRAND_NAME}">
  ${imageUrl ? `<meta property="og:image" content="${imageUrl}">` : ""}
  ${imageUrl ? `<meta property="og:image:secure_url" content="${imageUrl}">` : ""}
  ${imageUrl ? `<meta property="og:image:type" content="image/jpeg">` : ""}
  ${imageUrl ? `<meta property="og:image:width" content="400">` : ""}
  ${imageUrl ? `<meta property="og:image:height" content="400">` : ""}

  <!-- Twitter -->
  <meta name="twitter:card" content="summary">
  <meta name="twitter:url" content="${pageUrl}">
  <meta name="twitter:title" content="${title}">
  <meta name="twitter:description" content="${description}">
  ${imageUrl ? `<meta name="twitter:image" content="${imageUrl}">` : ""}

  <!-- Redirect real users to the app -->
  <meta http-equiv="refresh" content="0;url=${config.baseUrl}/c/${slug}">

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
  <p class="loading">Redirecting to the app...</p>
  <p><a href="${config.baseUrl}/c/${slug}">Click here if not redirected</a></p>
</body>
</html>`;
}

/**
 * Generate community error HTML (fallback when API fails)
 */
function generateCommunityErrorHtml(slug, config) {
  const pageUrl = `${config.baseUrl}/${slug}`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${BRAND_NAME}</title>
  <meta property="og:title" content="${BRAND_NAME}">
  <meta property="og:description" content="Connect with your community on Togather">
  <meta property="og:type" content="website">
  <meta http-equiv="refresh" content="0;url=${config.baseUrl}/c/${slug}">
</head>
<body>
  <p>Redirecting...</p>
  <p><a href="${config.baseUrl}/c/${slug}">Click here if not redirected</a></p>
</body>
</html>`;
}

/**
 * Generate channel invite OG HTML for bots
 * @param {Object} channel - Channel data from Convex
 * @param {string} shortId - Channel invite short ID
 * @param {Object} config - Environment-specific configuration
 */
function generateChannelOgHtml(channel, shortId, config) {
  const channelName = escapeHtml(channel.channelName || "Channel");
  const groupName = escapeHtml(channel.groupName || "Group");
  const communityName = escapeHtml(channel.communityName || BRAND_NAME);
  const title = `Join #${channelName} in ${groupName}`;
  const description = channel.channelDescription
    ? escapeHtml(channel.channelDescription)
    : `Join the #${channelName} channel in ${groupName} on ${communityName}`;
  const memberCount = channel.memberCount || 0;

  // Fallback chain: group image -> community logo
  const imageUrl = channel.groupImage || channel.communityLogo || "";
  const channelUrl = `${config.baseUrl}/ch/${shortId}`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">

  <!-- Primary Meta Tags -->
  <title>${title} | ${communityName}</title>
  <meta name="title" content="${title} | ${communityName}">
  <meta name="description" content="${description.substring(0, 200)}">

  <!-- Open Graph / Facebook -->
  <meta property="og:type" content="website">
  <meta property="og:url" content="${channelUrl}">
  <meta property="og:title" content="${title} | ${communityName}">
  <meta property="og:description" content="${description.substring(0, 200)}">
  <meta property="og:site_name" content="${communityName}">
  ${imageUrl ? `<meta property="og:image" content="${imageUrl}">` : ""}
  ${imageUrl ? `<meta property="og:image:secure_url" content="${imageUrl}">` : ""}
  ${imageUrl ? `<meta property="og:image:type" content="image/jpeg">` : ""}
  ${imageUrl ? `<meta property="og:image:width" content="1200">` : ""}
  ${imageUrl ? `<meta property="og:image:height" content="630">` : ""}

  <!-- Twitter -->
  <meta name="twitter:card" content="${imageUrl ? "summary_large_image" : "summary"}">
  <meta name="twitter:url" content="${channelUrl}">
  <meta name="twitter:title" content="${title} | ${communityName}">
  <meta name="twitter:description" content="${description.substring(0, 200)}">
  ${imageUrl ? `<meta name="twitter:image" content="${imageUrl}">` : ""}
  ${imageUrl ? `<meta name="twitter:image:alt" content="${title}">` : ""}

  <!-- Redirect real users to the app -->
  <meta http-equiv="refresh" content="0;url=${channelUrl}">

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
  <p>${communityName}</p>
  ${memberCount > 0 ? `<p>${memberCount} member${memberCount !== 1 ? "s" : ""}</p>` : ""}
  <p class="loading">Redirecting to the app...</p>
  <p><a href="${channelUrl}">Click here if not redirected</a></p>
</body>
</html>`;
}

/**
 * Generate channel invite error HTML (fallback when API fails)
 * @param {string} shortId - Channel invite short ID
 * @param {Object} config - Environment-specific configuration
 */
function generateChannelErrorHtml(shortId, config) {
  const channelUrl = `${config.baseUrl}/ch/${shortId}`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Channel | ${BRAND_NAME}</title>
  <meta property="og:title" content="Channel | ${BRAND_NAME}">
  <meta property="og:description" content="Join this channel on ${BRAND_NAME}">
  <meta property="og:type" content="website">
  <meta http-equiv="refresh" content="0;url=${channelUrl}">
</head>
<body>
  <p>Redirecting...</p>
  <p><a href="${channelUrl}">Click here if not redirected</a></p>
</body>
</html>`;
}

/**
 * Extract subdomain from hostname (e.g., "fount" from "fount.togather.nyc")
 */
function getSubdomain(hostname) {
  const baseDomain = "togather.nyc";
  const parts = hostname.split(".");
  const domainParts = baseDomain.split(".");
  const mainDomain = domainParts[0]; // "togather"

  // Handle subdomain.togather.nyc pattern
  if (parts.length >= 3 && parts[parts.length - 2] === mainDomain) {
    return parts[0];
  }
  return null;
}

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

    // 3. Handle /e/:shortId (event pages)
    if (pathname.startsWith("/e/")) {
      const shortIdMatch = pathname.match(/^\/e\/([a-zA-Z0-9]+)\/?$/);
      if (shortIdMatch && isBot(userAgent)) {
        const shortId = shortIdMatch[1];

        try {
          const event = await fetchEventData(shortId, convexSiteUrl);

          if (!event) {
            return new Response(generateEventErrorHtml(shortId, config), {
              status: 200,
              headers: { "Content-Type": "text/html; charset=utf-8" },
            });
          }

          return new Response(generateEventOgHtml(event, shortId, config), {
            status: 200,
            headers: { "Content-Type": "text/html; charset=utf-8" },
          });
        } catch (error) {
          console.error(`Error fetching event ${shortId}:`, error);
          return new Response(generateEventErrorHtml(shortId, config), {
            status: 200,
            headers: { "Content-Type": "text/html; charset=utf-8" },
          });
        }
      }
      // Pass through for humans or invalid format
      return passToApp(request, config);
    }

    // 4. Handle /g/:shortId (group pages)
    if (pathname.startsWith("/g/")) {
      const shortIdMatch = pathname.match(/^\/g\/([a-zA-Z0-9]+)\/?$/);
      if (shortIdMatch && isBot(userAgent)) {
        const shortId = shortIdMatch[1];

        try {
          const group = await fetchGroupData(shortId, convexSiteUrl);

          if (!group) {
            return new Response(generateGroupErrorHtml(shortId, config), {
              status: 200,
              headers: { "Content-Type": "text/html; charset=utf-8" },
            });
          }

          return new Response(generateGroupOgHtml(group, shortId, config), {
            status: 200,
            headers: { "Content-Type": "text/html; charset=utf-8" },
          });
        } catch (error) {
          console.error(`Error fetching group ${shortId}:`, error);
          return new Response(generateGroupErrorHtml(shortId, config), {
            status: 200,
            headers: { "Content-Type": "text/html; charset=utf-8" },
          });
        }
      }
      // Pass through for humans or invalid format
      return passToApp(request, config);
    }

    // 5. Handle /t/:shortId (tool pages)
    if (pathname.startsWith("/t/")) {
      const shortIdMatch = pathname.match(/^\/t\/([a-zA-Z0-9]+)\/?$/);
      if (shortIdMatch && isBot(userAgent)) {
        const shortId = shortIdMatch[1];

        try {
          const tool = await fetchToolData(shortId, convexSiteUrl);

          if (!tool) {
            return new Response(generateToolErrorHtml(shortId, config), {
              status: 200,
              headers: { "Content-Type": "text/html; charset=utf-8" },
            });
          }

          return new Response(generateToolOgHtml(tool, shortId, config), {
            status: 200,
            headers: { "Content-Type": "text/html; charset=utf-8" },
          });
        } catch (error) {
          console.error(`Error fetching tool ${shortId}:`, error);
          return new Response(generateToolErrorHtml(shortId, config), {
            status: 200,
            headers: { "Content-Type": "text/html; charset=utf-8" },
          });
        }
      }
      // Pass through for humans or invalid format
      return passToApp(request, config);
    }

    // 6. Handle /ch/:shortId (channel invite links)
    if (pathname.startsWith("/ch/")) {
      const shortIdMatch = pathname.match(/^\/ch\/([a-zA-Z0-9]+)\/?$/);
      if (shortIdMatch && isBot(userAgent)) {
        const shortId = shortIdMatch[1];

        try {
          const channel = await fetchChannelData(shortId, convexSiteUrl);

          if (!channel) {
            return new Response(generateChannelErrorHtml(shortId, config), {
              status: 200,
              headers: { "Content-Type": "text/html; charset=utf-8" },
            });
          }

          return new Response(generateChannelOgHtml(channel, shortId, config), {
            status: 200,
            headers: { "Content-Type": "text/html; charset=utf-8" },
          });
        } catch (error) {
          console.error(`Error fetching channel ${shortId}:`, error);
          return new Response(generateChannelErrorHtml(shortId, config), {
            status: 200,
            headers: { "Content-Type": "text/html; charset=utf-8" },
          });
        }
      }
      // Pass through for humans or invalid format
      return passToApp(request, config);
    }

    // 7. Handle /nearme routes
    if (pathname === "/nearme" || pathname === "/nearme/") {
      if (isBot(userAgent)) {
        const subdomain = getSubdomain(url.hostname);

        if (!subdomain) {
          // No subdomain - return generic nearme OG or pass through
          return new Response(generateNearmeErrorHtml(url.href), {
            status: 200,
            headers: { "Content-Type": "text/html; charset=utf-8" },
          });
        }

        // Get group type from query parameter
        const groupTypeSlug = url.searchParams.get("type");

        try {
          const data = await fetchCommunityData(subdomain, groupTypeSlug, convexSiteUrl);

          if (!data) {
            return new Response(generateNearmeErrorHtml(url.href), {
              status: 200,
              headers: { "Content-Type": "text/html; charset=utf-8" },
            });
          }

          return new Response(generateNearmeOgHtml(data, url.href), {
            status: 200,
            headers: { "Content-Type": "text/html; charset=utf-8" },
          });
        } catch (error) {
          console.error(`Error fetching nearme preview for ${subdomain}:`, error);
          return new Response(generateNearmeErrorHtml(url.href), {
            status: 200,
            headers: { "Content-Type": "text/html; charset=utf-8" },
          });
        }
      }
      // Pass through for humans
      return passToApp(request, config);
    }

    // 8. Community landing page: /:slug
    // Single-segment paths that aren't known app routes are assumed to be community slugs.
    // For bots: return OG HTML with community logo and name.
    // For humans: redirect to /c/:slug in the Expo app.
    const segments = pathname.split("/").filter(Boolean);
    if (segments.length === 1) {
      const slug = segments[0];
      // Only handle if it looks like a slug (lowercase, digits, hyphens) and isn't a known app route
      if (/^[a-z0-9][a-z0-9-]*$/.test(slug) && !KNOWN_APP_ROUTES.has(slug)) {
        if (isBot(userAgent)) {
          try {
            const data = await fetchCommunityData(slug, null, convexSiteUrl);

            if (!data) {
              return new Response(generateCommunityErrorHtml(slug, config), {
                status: 200,
                headers: { "Content-Type": "text/html; charset=utf-8" },
              });
            }

            return new Response(generateCommunityOgHtml(data, slug, config), {
              status: 200,
              headers: { "Content-Type": "text/html; charset=utf-8" },
            });
          } catch (error) {
            console.error(`Error fetching community preview for ${slug}:`, error);
            return new Response(generateCommunityErrorHtml(slug, config), {
              status: 200,
              headers: { "Content-Type": "text/html; charset=utf-8" },
            });
          }
        }

        // Redirect humans to /c/:slug
        const redirectUrl = new URL(`/c/${slug}${url.search}`, url.origin);
        return Response.redirect(redirectUrl.toString(), 302);
      }
    }

    // 9. All other paths - pass through to origin
    return passToApp(request, config);
  },
};
