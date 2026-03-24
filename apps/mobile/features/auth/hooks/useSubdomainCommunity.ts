import { useState, useEffect, useMemo } from "react";
import { Platform } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useQuery, api } from "@services/api/convex";
import { parseSubdomainFromHostname } from "@/features/auth/utils/communitySubdomain";

/**
 * Hook to get community from subdomain
 *
 * On web:
 * - Parses subdomain from window.location.hostname (e.g., fount.<baseDomain>)
 * - Falls back to ?subdomain= query param for local development
 *
 * On native:
 * - The +native-intent.ts hook intercepts universal link URLs before Expo Router
 *   strips the hostname. It extracts the subdomain from the hostname and appends
 *   it as ?subdomain= to the URL, so it arrives as a route parameter.
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

  // Determine subdomain source: hostname (web) or query param (native via +native-intent)
  const subdomain = useMemo(() => {
    if (Platform.OS === "web" && webHostnameSubdomain) {
      return webHostnameSubdomain;
    }

    const paramSubdomain = params.subdomain;
    if (typeof paramSubdomain === "string" && paramSubdomain.length > 0) {
      return paramSubdomain.toLowerCase();
    }

    return null;
  }, [webHostnameSubdomain, params.subdomain]);

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
