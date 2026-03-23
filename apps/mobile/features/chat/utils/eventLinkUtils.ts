/**
 * Shared utilities for detecting and handling event links in chat messages.
 * Used by both native (stream-chat-expo) and web (stream-chat-react) implementations.
 *
 * Also includes utilities for external link detection and preview functionality.
 */
import { DOMAIN_CONFIG } from '@togather/shared';

// ============================================================================
// URL Detection Constants
// ============================================================================

/**
 * Regex to detect URLs in text
 * Matches http:// and https:// URLs
 */
/** Shared with task descriptions and other non-chat surfaces that need the same URL matching rules. */
export const URL_REGEX = /https?:\/\/[^\s<>"{}|\\^`[\]]+/gi;

/**
 * Extract event short IDs from message text
 */
export function extractEventShortIds(text: string | undefined): string[] {
  if (!text) return [];
  const regex = DOMAIN_CONFIG.eventLinkRegex();
  const matches = [...text.matchAll(regex)];
  return matches.map(m => m[1]);
}

/**
 * Check if a URL is a togather.nyc event link
 */
export function isTogatherEventLink(url: string | undefined): boolean {
  if (!url) return false;
  return DOMAIN_CONFIG.eventLinkRegexSingle().test(url);
}

/**
 * Filter out Stream Chat URL preview attachments for togather.nyc event links.
 * We render our own custom EventLinkCard for these, so we don't want the
 * duplicate Stream Chat URL preview.
 */
export function filterTogatherEventAttachments<T extends { og_scrape_url?: string; title_link?: string; asset_url?: string }>(
  attachments: T[] | undefined
): T[] {
  if (!attachments) return [];
  return attachments.filter(att => {
    // Stream Chat URL previews have type 'link' or contain og_scrape_url/title_link
    const url = att.og_scrape_url || att.title_link || att.asset_url || '';
    return !isTogatherEventLink(url);
  });
}

/**
 * Remove event links from message text for display
 */
export function stripEventLinksFromText(text: string | undefined): string {
  if (!text) return '';
  return text.replace(DOMAIN_CONFIG.eventLinkRegex(), '').trim();
}

// ============================================================================
// Tool Link Detection (Run Sheet, Resources)
// ============================================================================

/**
 * Extract tool short IDs from message text
 */
export function extractToolShortIds(text: string | undefined): string[] {
  if (!text) return [];
  const regex = DOMAIN_CONFIG.toolLinkRegex();
  const matches = [...text.matchAll(regex)];
  return matches.map(m => m[1]);
}

/**
 * Remove tool links from message text for display
 */
export function stripToolLinksFromText(text: string | undefined): string {
  if (!text) return '';
  return text.replace(DOMAIN_CONFIG.toolLinkRegex(), '').trim();
}

// ============================================================================
// Channel Invite Link Detection
// ============================================================================

/**
 * Extract channel invite short IDs from message text
 */
export function extractChannelInviteShortIds(text: string | undefined): string[] {
  if (!text) return [];
  const regex = DOMAIN_CONFIG.channelInviteLinkRegex();
  const matches = [...text.matchAll(regex)];
  return matches.map(m => m[1]);
}

/**
 * Remove channel invite links from message text for display
 */
export function stripChannelInviteLinksFromText(text: string | undefined): string {
  if (!text) return '';
  return text.replace(DOMAIN_CONFIG.channelInviteLinkRegex(), '').trim();
}

// ============================================================================
// External Link Detection
// ============================================================================

/**
 * Check if a URL is a Togather link (event, group, or app URL)
 * These get special treatment and don't need external link previews.
 */
export function isTogatherLink(url: string | undefined): boolean {
  if (!url) return false;

  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.toLowerCase();

    // Check if it's a togather domain
    const togatherDomains = [
      'togather.nyc',
      'www.togather.nyc',
      'app.togather.nyc',
      'staging.togather.nyc',
      'togather.dev',
      'www.togather.dev',
    ];

    return togatherDomains.some(domain => hostname === domain || hostname.endsWith('.' + domain));
  } catch {
    return false;
  }
}

/**
 * Extract all URLs from text
 */
export function extractUrls(text: string | undefined): string[] {
  if (!text) return [];
  const matches = text.match(URL_REGEX);
  return matches || [];
}

/**
 * Extract the first external (non-Togather) URL from text
 * Returns null if no external URLs found
 */
export function extractFirstExternalUrl(text: string | undefined): string | null {
  const urls = extractUrls(text);

  for (const url of urls) {
    if (!isTogatherLink(url)) {
      return url;
    }
  }

  return null;
}

/**
 * Check if text contains any external URLs that could have link previews
 */
export function hasExternalLinks(text: string | undefined): boolean {
  return extractFirstExternalUrl(text) !== null;
}
