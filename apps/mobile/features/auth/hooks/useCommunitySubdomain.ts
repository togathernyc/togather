import { useEffect } from "react";
import { useLocalSearchParams } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useQuery, api } from "@services/api/convex";
import { useAuth } from "@providers/AuthProvider";

/**
 * Hook to handle community subdomain from URL query parameter
 * Searches for community by domain and sets it in auth context
 */
export function useCommunitySubdomain() {
  const params = useLocalSearchParams();
  const { setCommunity } = useAuth();

  const subdomain = typeof params.slug === "string" ? params.slug : undefined;

  // Use Convex query - pass "skip" when no subdomain
  const community = useQuery(
    api.functions.resources.communitySearchBySubdomain,
    subdomain ? { subdomain } : "skip"
  );

  useEffect(() => {
    if (community) {
      // Convert null to undefined for Community type compatibility
      const normalizedCommunity = {
        id: community.id,
        name: community.name,
        subdomain: community.subdomain ?? undefined,
        logo: community.logo ?? undefined,
      };
      setCommunity(normalizedCommunity);
      AsyncStorage.setItem("current_community", JSON.stringify(normalizedCommunity));
      AsyncStorage.setItem("newCommunityId", String(normalizedCommunity.id));
    }
    // setCommunity is stable (useCallback) - don't include in deps
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [community]);
}
