/**
 * Link Preview Functions
 *
 * Fetches Open Graph metadata from external URLs for link preview cards in chat.
 * This runs server-side to avoid CORS issues and to cache results.
 */

import { v } from "convex/values";
import { internalAction } from "../_generated/server";

// ============================================================================
// Types
// ============================================================================

export interface LinkPreviewData {
  url: string;
  title?: string;
  description?: string;
  image?: string;
  siteName?: string;
  favicon?: string;
}

// ============================================================================
// Constants
// ============================================================================

// Maximum HTML size to parse (500KB)
const MAX_HTML_SIZE = 500 * 1024;

// User agent - fully browser-like to avoid being blocked by sites like YouTube
// Many sites block requests with obvious bot User-Agents or incomplete browser strings
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// ============================================================================
// Helpers
// ============================================================================

/**
 * Extract Open Graph and meta tags from HTML
 */
function extractMetaTags(html: string, baseUrl: string): LinkPreviewData {
  const result: LinkPreviewData = { url: baseUrl };

  // Helper to extract content from meta tags
  const getMetaContent = (html: string, property: string): string | undefined => {
    // Try property attribute (Open Graph style)
    const propertyMatch = html.match(
      new RegExp(`<meta[^>]*property=["']${property}["'][^>]*content=["']([^"']+)["']`, "i")
    );
    if (propertyMatch) return propertyMatch[1];

    // Try content before property
    const reverseMatch = html.match(
      new RegExp(`<meta[^>]*content=["']([^"']+)["'][^>]*property=["']${property}["']`, "i")
    );
    if (reverseMatch) return reverseMatch[1];

    // Try name attribute (standard meta style)
    const nameMatch = html.match(
      new RegExp(`<meta[^>]*name=["']${property}["'][^>]*content=["']([^"']+)["']`, "i")
    );
    if (nameMatch) return nameMatch[1];

    // Try content before name
    const reverseNameMatch = html.match(
      new RegExp(`<meta[^>]*content=["']([^"']+)["'][^>]*name=["']${property}["']`, "i")
    );
    if (reverseNameMatch) return reverseNameMatch[1];

    return undefined;
  };

  // Extract title
  result.title =
    getMetaContent(html, "og:title") ||
    getMetaContent(html, "twitter:title") ||
    html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.trim();

  // Extract description
  result.description =
    getMetaContent(html, "og:description") ||
    getMetaContent(html, "twitter:description") ||
    getMetaContent(html, "description");

  // Extract image
  const image =
    getMetaContent(html, "og:image") ||
    getMetaContent(html, "twitter:image") ||
    getMetaContent(html, "twitter:image:src");

  if (image) {
    // Resolve relative URLs
    try {
      result.image = new URL(image, baseUrl).toString();
    } catch {
      result.image = image;
    }
  }

  // Extract site name
  result.siteName =
    getMetaContent(html, "og:site_name") ||
    getMetaContent(html, "application-name");

  // Extract favicon
  const faviconMatch = html.match(
    /<link[^>]*rel=["'](?:icon|shortcut icon)["'][^>]*href=["']([^"']+)["']/i
  );
  if (faviconMatch) {
    try {
      result.favicon = new URL(faviconMatch[1], baseUrl).toString();
    } catch {
      result.favicon = faviconMatch[1];
    }
  } else {
    // Default favicon location
    try {
      const urlObj = new URL(baseUrl);
      result.favicon = `${urlObj.origin}/favicon.ico`;
    } catch {
      // Ignore
    }
  }

  // Decode HTML entities in text fields
  const decodeEntities = (text: string | undefined): string | undefined => {
    if (!text) return undefined;
    return text
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&#x27;/g, "'")
      .replace(/&#x2F;/g, "/");
  };

  result.title = decodeEntities(result.title);
  result.description = decodeEntities(result.description);
  result.siteName = decodeEntities(result.siteName);

  return result;
}

/**
 * Check if URL is a YouTube video
 */
function isYouTubeUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.toLowerCase();
    return (
      (hostname === "www.youtube.com" ||
        hostname === "youtube.com" ||
        hostname === "youtu.be" ||
        hostname === "m.youtube.com") &&
      (parsed.pathname.includes("/watch") ||
        parsed.pathname.includes("/shorts") ||
        hostname === "youtu.be")
    );
  } catch {
    return false;
  }
}

/**
 * Check if URL is a Notion page
 */
function isNotionUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.toLowerCase();
    return (
      hostname === "notion.so" ||
      hostname === "www.notion.so" ||
      hostname.endsWith(".notion.site")
    );
  } catch {
    return false;
  }
}

/**
 * Check if URL is a Spotify link (track, album, playlist, artist, episode, show)
 * Handles locale prefixes like /intl-de/track/... or /intl-en/album/...
 */
function isSpotifyUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.toLowerCase();
    // Check hostname is Spotify and pathname contains a content type
    // Use includes() to handle locale prefixes like /intl-XX/track/...
    return (
      (hostname === "open.spotify.com" || hostname === "spotify.com") &&
      /(\/track\/|\/album\/|\/playlist\/|\/artist\/|\/episode\/|\/show\/)/.test(
        parsed.pathname
      )
    );
  } catch {
    return false;
  }
}

/**
 * Fetch YouTube video metadata using oEmbed API
 */
async function fetchYouTubePreview(url: string): Promise<LinkPreviewData | null> {
  try {
    const oEmbedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`;
    const response = await fetch(oEmbedUrl);

    if (!response.ok) {
      console.warn("[linkPreview] YouTube oEmbed error:", response.status);
      return null;
    }

    const data = await response.json();

    return {
      url,
      title: data.title,
      description: data.author_name ? `Video by ${data.author_name}` : undefined,
      image: data.thumbnail_url,
      siteName: "YouTube",
      favicon: "https://www.youtube.com/favicon.ico",
    };
  } catch (error) {
    console.error("[linkPreview] YouTube oEmbed fetch error for URL:", url, error);
    return null;
  }
}

/**
 * Extract a human-readable page title from a Notion URL slug.
 * e.g., /SERVING-ROLES-2ea0e26144254f1c8d15a34fd4253105 → "Serving Roles"
 */
function extractNotionTitleFromUrl(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    const pathSegments = parsed.pathname.split("/").filter(Boolean);
    const slug = pathSegments[pathSegments.length - 1];
    if (!slug) return undefined;

    // Strip the 32-char hex page ID from the end of the slug
    const withoutId = slug.replace(/-[0-9a-f]{32}$/i, "");
    if (!withoutId || withoutId === slug) {
      if (/^[0-9a-f]{32}$/i.test(slug)) return undefined;
    }

    const titleSlug = withoutId || slug;
    return titleSlug
      .replace(/-/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase())
      .trim();
  } catch {
    return undefined;
  }
}

/**
 * Extract the 32-char hex page ID from a Notion URL and convert to UUID format.
 * e.g., /SERVING-ROLES-2ea0e26144254f1c8d15a34fd4253105 → "2ea0e261-4425-4f1c-8d15-a34fd4253105"
 */
function extractNotionPageId(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    const pathSegments = parsed.pathname.split("/").filter(Boolean);
    const slug = pathSegments[pathSegments.length - 1];
    if (!slug) return undefined;

    // Match the 32-char hex page ID at the end of the slug
    const idMatch = slug.match(/([0-9a-f]{32})$/i);
    if (idMatch) {
      const hex = idMatch[1];
      return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    }

    return undefined;
  } catch {
    return undefined;
  }
}

/**
 * Resolve a Notion image URL to a publicly accessible URL.
 * Notion-hosted images on S3 need to be proxied through Notion's image service.
 * External images (e.g. Unsplash) can be used directly.
 */
function resolveNotionImageUrl(imageUrl: string, pageId: string): string {
  if (
    imageUrl.includes("secure.notion-static.com") ||
    imageUrl.startsWith("/image")
  ) {
    return `https://www.notion.so/image/${encodeURIComponent(imageUrl)}?table=block&id=${pageId}&width=1200`;
  }
  return imageUrl;
}

/**
 * Fetch Notion page metadata via their internal loadPageChunk API.
 * This works for published pages and returns cover images, icons, and titles
 * that aren't available through HTML scraping (Notion pages are JS-rendered SPAs).
 */
async function fetchNotionPageData(
  url: string,
  pageId: string
): Promise<{ title?: string; image?: string; icon?: string } | null> {
  try {
    const response = await fetch("https://www.notion.so/api/v3/loadPageChunk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        page: { id: pageId },
        limit: 1,
        cursor: { stack: [] },
        chunkNumber: 0,
        verticalColumns: false,
      }),
    });

    if (!response.ok) return null;

    const data = await response.json();
    const block = data?.recordMap?.block?.[pageId]?.value;
    if (!block) return null;

    const format = block.format || {};
    const properties = block.properties || {};

    // Extract title from properties (Notion stores it as [[\"Title Text\"]])
    const rawTitle = properties.title;
    const title =
      Array.isArray(rawTitle) && Array.isArray(rawTitle[0])
        ? rawTitle[0][0]
        : undefined;

    // Prefer the cover image; fall back to page icon if it's an image URL
    const coverUrl = format.page_cover;
    const iconUrl = format.page_icon;

    let image: string | undefined;
    if (coverUrl) {
      image = resolveNotionImageUrl(coverUrl, pageId);
    } else if (iconUrl && iconUrl.startsWith("http")) {
      image = resolveNotionImageUrl(iconUrl, pageId);
    }

    return { title, image, icon: iconUrl };
  } catch (error) {
    console.warn("[linkPreview] Notion loadPageChunk API error:", error);
    return null;
  }
}

/**
 * Check if a title is a generic Notion default (not page-specific)
 */
function isGenericNotionTitle(title: string): boolean {
  const genericTitles = [
    "notion",
    "notion – the all-in-one workspace",
    "notion—the ai workspace that works for you.",
  ];
  return genericTitles.some((g) => title.toLowerCase().startsWith(g.toLowerCase()));
}

/**
 * Fetch Notion page metadata with fallback strategies.
 * Notion's SSR for *.notion.site pages is unreliable — bot user agents often
 * receive HTTP 500 errors instead of HTML with page-specific OG tags.
 *
 * Strategy:
 * 1. Try bot UA → may get full OG tags including image
 * 2. Try browser UA → same
 * 3. Try Notion's loadPageChunk API → gets cover image and title from page data
 * 4. Fall back to extracting title from URL slug
 */
async function fetchNotionPreview(url: string): Promise<LinkPreviewData | null> {
  const botUserAgent =
    "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)";

  let htmlPreview: LinkPreviewData | null = null;
  let favicon: string | undefined;

  // Try bot UA first — Notion serves page-specific OG tags to bots when their SSR is working
  try {
    const botResponse = await fetch(url, {
      method: "GET",
      headers: {
        "User-Agent": botUserAgent,
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
      redirect: "follow",
    });

    const contentType = botResponse.headers.get("content-type") || "";
    if (botResponse.ok && contentType.includes("text/html")) {
      const html = await botResponse.text();
      if (html.length > 0) {
        const preview = extractMetaTags(html.slice(0, MAX_HTML_SIZE), botResponse.url || url);
        if (preview.title && !isGenericNotionTitle(preview.title)) {
          // If we got both title and image from HTML, return immediately
          if (preview.image) {
            return preview;
          }
          htmlPreview = preview;
        }
        favicon = preview.favicon;
      }
    }
  } catch {
    // Bot UA failed, try browser UA
  }

  // Browser UA sometimes gets page-specific tags
  if (!htmlPreview) {
    try {
      const browserResponse = await fetch(url, {
        method: "GET",
        headers: {
          "User-Agent": USER_AGENT,
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
        },
        redirect: "follow",
      });

      const contentType = browserResponse.headers.get("content-type") || "";
      if (browserResponse.ok && contentType.includes("text/html")) {
        const html = await browserResponse.text();
        if (html.length > 0) {
          const preview = extractMetaTags(
            html.slice(0, MAX_HTML_SIZE),
            browserResponse.url || url
          );

          if (preview.title && !isGenericNotionTitle(preview.title)) {
            if (preview.image) {
              return preview;
            }
            htmlPreview = preview;
          }

          favicon = favicon || preview.favicon;
        }
      }
    } catch {
      // Both UAs failed, fall through to API-based extraction
    }
  }

  // Try Notion's loadPageChunk API to get cover image and title.
  // This works for published pages and bypasses the JS-rendering problem.
  const pageId = extractNotionPageId(url);
  if (pageId) {
    const pageData = await fetchNotionPageData(url, pageId);
    if (pageData) {
      // If we already have a good HTML preview, just add the image
      if (htmlPreview) {
        if (pageData.image) {
          htmlPreview.image = pageData.image;
        }
        return htmlPreview;
      }

      // Build a preview from API data
      const apiTitle = pageData.title;
      const slugTitle = extractNotionTitleFromUrl(url);
      const title = apiTitle || slugTitle;

      if (title || pageData.image) {
        let siteName = "Notion";
        try {
          const parsed = new URL(url);
          const hostname = parsed.hostname.toLowerCase();
          if (hostname.endsWith(".notion.site")) {
            const workspace = hostname.replace(".notion.site", "");
            if (workspace && workspace !== "www") {
              siteName = `${workspace} – Notion`;
            }
          }
        } catch {
          // ignore
        }

        return {
          url,
          title: title || undefined,
          image: pageData.image,
          siteName,
          favicon: favicon || "https://www.notion.so/images/favicon.ico",
        };
      }
    }
  }

  // Last resort: derive title from URL slug and workspace from subdomain
  const slugTitle = extractNotionTitleFromUrl(url);
  if (!slugTitle) {
    return null;
  }

  let siteName = "Notion";
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.toLowerCase();
    if (hostname.endsWith(".notion.site")) {
      const workspace = hostname.replace(".notion.site", "");
      if (workspace && workspace !== "www") {
        siteName = `${workspace} – Notion`;
      }
    }
  } catch {
    // ignore
  }

  return {
    url,
    title: slugTitle,
    siteName,
    favicon: favicon || "https://www.notion.so/images/favicon.ico",
  };
}

/**
 * Fetch Spotify metadata using oEmbed API
 * Spotify's HTML pages are SPAs that don't include OG tags, so we use oEmbed instead.
 */
async function fetchSpotifyPreview(url: string): Promise<LinkPreviewData | null> {
  try {
    const oEmbedUrl = `https://open.spotify.com/oembed?url=${encodeURIComponent(url)}`;
    const response = await fetch(oEmbedUrl);

    if (!response.ok) {
      console.warn("[linkPreview] Spotify oEmbed error:", response.status);
      return null;
    }

    const data = await response.json();

    return {
      url,
      title: data.title,
      description: data.provider_name ? `On ${data.provider_name}` : undefined,
      image: data.thumbnail_url,
      siteName: "Spotify",
      favicon: "https://open.spotify.com/favicon.ico",
    };
  } catch (error) {
    console.error("[linkPreview] Spotify oEmbed fetch error for URL:", url, error);
    return null;
  }
}

/**
 * Check if an IP address is in a private/reserved range
 */
function isPrivateIP(hostname: string): boolean {
  // Check for IPv4 address format
  const ipv4Match = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4Match) {
    const octets = ipv4Match.slice(1).map(Number);
    const [a, b] = octets;

    // Loopback: 127.0.0.0/8 (127.0.0.0 - 127.255.255.255)
    if (a === 127) return true;

    // Private 10.0.0.0/8 (10.0.0.0 - 10.255.255.255)
    if (a === 10) return true;

    // Private 172.16.0.0/12 (172.16.0.0 - 172.31.255.255)
    if (a === 172 && b >= 16 && b <= 31) return true;

    // Private 192.168.0.0/16 (192.168.0.0 - 192.168.255.255)
    if (a === 192 && b === 168) return true;

    // Link-local 169.254.0.0/16
    if (a === 169 && b === 254) return true;

    // 0.0.0.0/8 (current network)
    if (a === 0) return true;
  }

  return false;
}

/**
 * Validate URL is safe to fetch
 */
function isValidUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    // Only allow http and https
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return false;
    }
    // Block private/local IPs and hostnames
    const hostname = parsed.hostname.toLowerCase();

    // Block localhost and .local domains
    if (hostname === "localhost" || hostname.endsWith(".local")) {
      return false;
    }

    // Block private IP ranges
    if (isPrivateIP(hostname)) {
      return false;
    }

    return true;
  } catch {
    return false;
  }
}

// ============================================================================
// Actions
// ============================================================================

/**
 * Fetch Open Graph metadata for a URL
 *
 * This is an internal action called by the HTTP endpoint.
 * It fetches the URL and extracts Open Graph metadata.
 */
export const fetchLinkPreview = internalAction({
  args: {
    url: v.string(),
  },
  handler: async (_ctx, args): Promise<LinkPreviewData | null> => {
    const { url } = args;

    // Validate URL
    if (!isValidUrl(url)) {
      console.warn("[linkPreview] Invalid or blocked URL:", url);
      return null;
    }

    // Handle YouTube URLs specially via oEmbed API (more reliable than scraping)
    if (isYouTubeUrl(url)) {
      return fetchYouTubePreview(url);
    }

    // Handle Spotify URLs via oEmbed API (Spotify's HTML is a SPA without OG tags)
    if (isSpotifyUrl(url)) {
      return fetchSpotifyPreview(url);
    }

    // Handle Notion URLs with fallback strategies (Notion's SSR is unreliable)
    if (isNotionUrl(url)) {
      return fetchNotionPreview(url);
    }

    try {
      const response = await fetch(url, {
        method: "GET",
        headers: {
          "User-Agent": USER_AGENT,
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
          "Cache-Control": "no-cache",
          Pragma: "no-cache",
        },
        redirect: "follow",
      });

      // Check response
      if (!response.ok) {
        console.warn("[linkPreview] HTTP error:", response.status, url);
        return null;
      }

      // Check content type
      const contentType = response.headers.get("content-type") || "";
      if (!contentType.includes("text/html") && !contentType.includes("application/xhtml")) {
        console.warn("[linkPreview] Not HTML:", contentType, url);
        return null;
      }

      // Get HTML content (limited size)
      const html = await response.text();
      if (html.length === 0) {
        console.warn("[linkPreview] Empty HTML body for URL:", url);
        return null;
      }
      if (html.length > MAX_HTML_SIZE) {
        // Still try to parse, but truncate
      }

      // Extract metadata
      const preview = extractMetaTags(html.slice(0, MAX_HTML_SIZE), response.url || url);

      // Only return if we got at least a title
      if (!preview.title) {
        console.warn("[linkPreview] No title found:", url);
        return null;
      }

      return preview;
    } catch (error) {
      console.error("[linkPreview] Error fetching:", url, error);
      return null;
    }
  },
});
