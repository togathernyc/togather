import { Platform } from "react-native";
import { getLinkingURL } from "expo-linking";
import { DOMAIN_CONFIG } from "@togather/shared";

/**
 * Reserved subdomains that should not be treated as community subdomains
 */
const RESERVED_SUBDOMAINS = ["api", "www", "app", "staging", "dev"];

const PRODUCTION_DOMAIN = DOMAIN_CONFIG.domainSuffix;
const LOCAL_DOMAIN = ".localhost";

/**
 * Parse community subdomain from a hostname.
 *
 * Examples:
 * - "fount.<baseDomain>" -> "fount"
 * - "api.<baseDomain>" -> null (reserved)
 * - "localhost" -> null
 * - "<baseDomain>" -> null (no subdomain)
 */
export function parseSubdomainFromHostname(hostname: string): string | null {
  if (hostname.endsWith(LOCAL_DOMAIN)) {
    const subdomain = hostname.slice(0, -LOCAL_DOMAIN.length);
    if (!subdomain || RESERVED_SUBDOMAINS.includes(subdomain.toLowerCase())) {
      return null;
    }
    return subdomain.toLowerCase();
  }
  if (hostname.endsWith(PRODUCTION_DOMAIN)) {
    const subdomain = hostname.slice(0, -PRODUCTION_DOMAIN.length);

    if (!subdomain || RESERVED_SUBDOMAINS.includes(subdomain.toLowerCase())) {
      return null;
    }

    return subdomain.toLowerCase();
  }

  return null;
}

/**
 * Parse subdomain from a full universal link / deep link URL string.
 * Used on native where `getInitialURL()` may omit the hostname (path-only).
 */
export function parseSubdomainFromLinkUrl(url: string | null): string | null {
  if (!url) {
    return null;
  }
  try {
    return parseSubdomainFromHostname(new URL(url).hostname);
  } catch {
    return null;
  }
}

// Capture subdomain from the initial universal link URL at module load time,
// before Expo Router consumes the URL for routing. getLinkingURL() is synchronous
// and available immediately. On web, subdomain comes from window.location instead.
const _capturedLinkSubdomain: string | null =
  Platform.OS !== "web" ? parseSubdomainFromLinkUrl(getLinkingURL()) : null;

export function getCapturedLinkSubdomain(): string | null {
  return _capturedLinkSubdomain;
}
