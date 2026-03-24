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

  // On native, useLinkingURL() returns null on the first render before the
  // universal-link URL resolves. We wait briefly for it to arrive so screens
  // don't flash "Community Required" before the subdomain can be parsed.
  const [isNativeLinkResolved, setIsNativeLinkResolved] = useState(
    Platform.OS === "web"
  );

  // Mark resolved once a linking URL arrives on native
  useEffect(() => {
    if (Platform.OS === "web") return;
    if (linkingUrl) {
      setIsNativeLinkResolved(true);
    }
  }, [linkingUrl]);

  // Timeout fallback: if no linking URL arrives within 1 s (normal app launch,
  // not via deep link), stop waiting so the screen can render normally.
  useEffect(() => {
    if (Platform.OS === "web" || isNativeLinkResolved) return;
    const timer = setTimeout(() => setIsNativeLinkResolved(true), 1000);
    return () => clearTimeout(timer);
  }, [isNativeLinkResolved]);

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
  // On native, wait for the linking URL to resolve (or timeout)
  const isWaitingForNativeLink = Platform.OS !== "web" && !isNativeLinkResolved;

  return {
    community: community ?? null,
    subdomain,
    isLoading: isWaitingForHydration || isWaitingForNativeLink || isLoading,
    error: null, // Convex throws on error, caught by error boundary
  };
}
