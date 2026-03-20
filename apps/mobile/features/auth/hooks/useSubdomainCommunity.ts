import { useState, useEffect, useMemo } from "react";
import { Platform } from "react-native";
import * as Linking from "expo-linking";
import { useLocalSearchParams } from "expo-router";
import { useQuery, api } from "@services/api/convex";
import { DOMAIN_CONFIG } from "@togather/shared";

/**
 * Reserved subdomains that should not be treated as community subdomains
 */
const RESERVED_SUBDOMAINS = ["api", "www", "app", "staging", "dev"];

/**
 * Domain suffixes for subdomain parsing
 */
const PRODUCTION_DOMAIN = DOMAIN_CONFIG.domainSuffix;
const LOCAL_DOMAIN = ".localhost";

/**
 * Parse subdomain from hostname
 *
 * Examples:
 * - "fount.<baseDomain>" -> "fount"
 * - "api.<baseDomain>" -> null (reserved)
 * - "localhost" -> null
 * - "<baseDomain>" -> null (no subdomain)
 */
function parseSubdomainFromHostname(hostname: string): string | null {
  // Check if it's a production domain subdomain
  if (hostname.endsWith(LOCAL_DOMAIN)) {
    const subdomain = hostname.slice(0, -LOCAL_DOMAIN.length);
    if (!subdomain || RESERVED_SUBDOMAINS.includes(subdomain.toLowerCase())) {
      return null;
    }
    return subdomain.toLowerCase();
  }
  if (hostname.endsWith(PRODUCTION_DOMAIN)) {
    const subdomain = hostname.slice(0, -PRODUCTION_DOMAIN.length);

    // Skip if no subdomain or reserved
    if (!subdomain || RESERVED_SUBDOMAINS.includes(subdomain.toLowerCase())) {
      return null;
    }

    return subdomain.toLowerCase();
  }

  return null;
}

/**
 * Hook to get community from subdomain
 *
 * On web:
 * - Parses subdomain from window.location.hostname (e.g., fount.<baseDomain>)
 * - Falls back to ?subdomain= query param for local development
 *
 * On native:
 * - Parses subdomain from initial URL hostname (e.g., fount.togather.nyc/nearme)
 * - Falls back to ?subdomain= query param from deep links
 *
 * Returns:
 * - community: The community data if found
 * - subdomain: The parsed subdomain string
 * - isLoading: Whether the community query is loading
 * - error: Any error that occurred
 */
export function useSubdomainCommunity() {
  const params = useLocalSearchParams();
  const [hostnameSubdomain, setHostnameSubdomain] = useState<string | null>(
    null
  );
  const [isHydrated, setIsHydrated] = useState(false);
  const [isCheckingInitialUrl, setIsCheckingInitialUrl] = useState(
    Platform.OS !== "web"
  );

  // Parse hostname on web after hydration
  useEffect(() => {
    if (Platform.OS === "web" && typeof window !== "undefined") {
      const parsed = parseSubdomainFromHostname(window.location.hostname);
      setHostnameSubdomain(parsed);
    }
    setIsHydrated(true);
  }, []);

  // On native: parse subdomain from deep link URLs
  // - Cold start: getInitialURL() returns the launch URL
  // - Warm start: addEventListener catches new URLs when app is in background
  useEffect(() => {
    if (Platform.OS !== "web") {
      // Helper to parse and set subdomain from URL
      const handleUrl = (url: string | null) => {
        if (url) {
          try {
            const parsed = new URL(url);
            const sub = parseSubdomainFromHostname(parsed.hostname);
            if (sub) {
              setHostnameSubdomain(sub);
            }
          } catch {
            // Ignore parse errors
          }
        }
      };

      // Handle cold start - get the URL that launched the app
      Linking.getInitialURL()
        .then(handleUrl)
        .finally(() => setIsCheckingInitialUrl(false));

      // Handle warm start - listen for new URLs when app is already running
      const subscription = Linking.addEventListener("url", (event) => {
        handleUrl(event.url);
      });

      return () => {
        subscription.remove();
      };
    }
  }, []);

  // Determine subdomain source: hostname (web or native from URL) or query param
  const subdomain = useMemo(() => {
    // Prefer hostname (web production or native from initial URL)
    if (hostnameSubdomain) {
      return hostnameSubdomain;
    }

    // Fall back to query param (for local dev or explicit ?subdomain= in link)
    const paramSubdomain = params.subdomain;
    if (typeof paramSubdomain === "string" && paramSubdomain.length > 0) {
      return paramSubdomain.toLowerCase();
    }

    return null;
  }, [hostnameSubdomain, params.subdomain]);

  // Fetch community by subdomain using Convex
  // Pass "skip" when no subdomain to skip the query
  const community = useQuery(
    api.functions.resources.communitySearchBySubdomain,
    subdomain ? { subdomain } : "skip"
  );

  // Convex queries return undefined while loading
  const isLoading = subdomain ? community === undefined : false;

  // On web, wait for hydration to complete before reporting isLoading as false
  const isWaitingForHydration = Platform.OS === "web" && !isHydrated;
  // On native, wait for initial URL check (may contain subdomain from hostname)
  const isWaitingForInitialUrl = Platform.OS !== "web" && isCheckingInitialUrl && !params.subdomain;

  return {
    community: community ?? null,
    subdomain,
    isLoading: isWaitingForHydration || isWaitingForInitialUrl || isLoading,
    error: null, // Convex throws on error, caught by error boundary
  };
}
