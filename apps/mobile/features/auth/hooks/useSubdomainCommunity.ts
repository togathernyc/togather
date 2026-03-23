import { useState, useEffect, useMemo } from "react";
import { Platform } from "react-native";
import { useLinkingURL } from "expo-linking";
import { useLocalSearchParams } from "expo-router";
import { useQuery, api } from "@services/api/convex";
import {
  parseSubdomainFromHostname,
  parseSubdomainFromLinkUrl,
} from "@/features/auth/utils/communitySubdomain";

/**
 * Hook to get community from subdomain
 *
 * On web:
 * - Parses subdomain from window.location.hostname (e.g., fount.<baseDomain>)
 * - Falls back to ?subdomain= query param for local development
 *
 * On native:
 * - Parses subdomain from the universal link URL (expo-linking useLinkingURL), which
 *   preserves the full https://community.example/nearme hostname. RN getInitialURL()
 *   often returns only the path (/nearme), which would incorrectly show "Community Required".
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
  const linkingUrl = useLinkingURL();
  const [webHostnameSubdomain, setWebHostnameSubdomain] = useState<string | null>(
    null
  );
  const [isHydrated, setIsHydrated] = useState(false);

  // Parse hostname on web after hydration
  useEffect(() => {
    if (Platform.OS === "web" && typeof window !== "undefined") {
      const parsed = parseSubdomainFromHostname(window.location.hostname);
      setWebHostnameSubdomain(parsed);
    }
    setIsHydrated(true);
  }, []);

  const nativeSubdomainFromLink = useMemo(
    () =>
      Platform.OS !== "web" ? parseSubdomainFromLinkUrl(linkingUrl) : null,
    [linkingUrl]
  );

  // Determine subdomain source: hostname (web or native from full link URL) or query param
  const subdomain = useMemo(() => {
    if (Platform.OS === "web") {
      if (webHostnameSubdomain) {
        return webHostnameSubdomain;
      }
    } else if (nativeSubdomainFromLink) {
      return nativeSubdomainFromLink;
    }

    const paramSubdomain = params.subdomain;
    if (typeof paramSubdomain === "string" && paramSubdomain.length > 0) {
      return paramSubdomain.toLowerCase();
    }

    return null;
  }, [webHostnameSubdomain, nativeSubdomainFromLink, params.subdomain]);

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

  return {
    community: community ?? null,
    subdomain,
    isLoading: isWaitingForHydration || isLoading,
    error: null, // Convex throws on error, caught by error boundary
  };
}
