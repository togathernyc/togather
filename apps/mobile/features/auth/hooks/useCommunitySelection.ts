// useCommunitySelection hook - handles community selection and initialization

import { useState, useEffect, useRef, useCallback } from "react";
import { useLocalSearchParams } from "expo-router";
import { useAuth } from "@providers/AuthProvider";
import { useConvex, api } from "@services/api/convex";
import { communityStorage } from "../utils/communityStorage";
import { Community } from "../types";

export function useCommunitySelection() {
  const { setCommunity: setCommunityContext, isAuthenticated, user, isLoading: authIsLoading } = useAuth();
  const params = useLocalSearchParams();
  const convex = useConvex();
  const [community, setCommunity] = useState<Community | null>(null);
  const [showCommunitySearch, setShowCommunitySearch] = useState(false);
  const hasInitialized = useRef(false);

  useEffect(() => {
    let isMounted = true;
    const timestamp = new Date().toISOString();

    // Only check storage on initial mount or when slug changes
    // Skip if already initialized (prevents re-checking after selection)
    if (hasInitialized.current) {
      console.log(`[CommunitySelection] [${timestamp}] Already initialized, skipping`);
      return;
    }

    hasInitialized.current = true;
    console.log(`[CommunitySelection] [${timestamp}] Initializing community selection`, {
      isAuthenticated,
      hasUser: !!user,
      userId: user?.id || null,
      authIsLoading,
    });

    // CRITICAL: If user is authenticated, don't show community search
    // Let AuthGuard handle navigation for authenticated users
    if (isAuthenticated && user) {
      console.log(`[CommunitySelection] [${timestamp}] User is authenticated, not showing community search`, {
        userId: user.id,
      });
      setShowCommunitySearch(false);
      return;
    }

    // Check for community in storage first
    communityStorage.getCommunity().then((communityData) => {
      if (!isMounted) return; // Only check if component is mounted

      console.log(`[CommunitySelection] [${timestamp}] Community from storage:`, {
        hasCommunity: !!communityData,
        communityId: communityData?.id || null,
      });

      if (communityData) {
        setCommunity(communityData);
        setCommunityContext(communityData).catch(console.error);
        setShowCommunitySearch(false);
        console.log(`[CommunitySelection] [${timestamp}] Community found, not showing search`);
      } else {
        // Check for community ID in storage
        communityStorage.getCommunityId().then((communityId) => {
          if (!isMounted) return; // Only check if component is mounted

          console.log(`[CommunitySelection] [${timestamp}] Community ID from storage:`, {
            hasCommunityId: !!communityId,
            communityId: communityId || null,
            isAuthenticated,
          });

          // Don't show search if user is authenticated (even without community)
          if (isAuthenticated && user) {
            console.log(`[CommunitySelection] [${timestamp}] User authenticated, not showing search even without community`);
            setShowCommunitySearch(false);
          } else if (!communityId) {
            console.log(`[CommunitySelection] [${timestamp}] No community ID, showing search`);
            setShowCommunitySearch(true);
          } else {
            console.log(`[CommunitySelection] [${timestamp}] Community ID found, not showing search`);
            setShowCommunitySearch(false);
          }
        });
      }
    });

    // Handle community subdomain from URL query (like Next.js router.query.slug)
    if (params.slug && typeof params.slug === "string") {
      console.log(`[CommunitySelection] [${timestamp}] Searching community by domain:`, params.slug);
      // Use Convex query directly
      convex.query(api.functions.resources.communitySearchBySubdomain, { subdomain: params.slug })
        .then((communityData) => {
          if (!isMounted) return; // Only proceed if component is mounted

          if (communityData) {
            console.log(`[CommunitySelection] [${timestamp}] Community found by domain:`, {
              communityId: communityData.id,
              communityName: communityData.name,
            });
            // Convert null to undefined for Community type compatibility
            const community = {
              id: communityData.id,
              name: communityData.name,
              subdomain: communityData.subdomain ?? undefined,
              logo: communityData.logo ?? undefined,
            };
            setCommunity(community);
            setCommunityContext(community).catch(console.error);
            communityStorage.setCommunity(community).catch(console.error);
            communityStorage.setCommunityId(community.id).catch(console.error);
            setShowCommunitySearch(false);
          } else {
            console.log(`[CommunitySelection] [${timestamp}] No community found for domain:`, params.slug);
          }
        })
        .catch((err) => {
          console.error(`[CommunitySelection] [${timestamp}] Community search error:`, err);
        });
    }

    return () => {
      isMounted = false;
    };
    // Removed setCommunityContext from dependencies - it's stable (useCallback) and causes loops
    // Added isAuthenticated and user to dependencies so we re-check when auth state changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.slug, isAuthenticated, user?.id]); // Re-run when slug, auth state, or user changes

  const selectCommunity = useCallback(async (selectedCommunity: Community) => {
    const timestamp = new Date().toISOString();
    console.log(`[CommunitySelection] [${timestamp}] Selecting community:`, {
      communityId: selectedCommunity.id,
      communityName: selectedCommunity.name,
    });

    try {
      // Mark as initialized to prevent useEffect from re-running
      hasInitialized.current = true;

      // Update UI state first (immediate feedback)
      setCommunity(selectedCommunity);
      setShowCommunitySearch(false);

      // Then update context and storage (fire and forget - don't await to avoid blocking)
      setCommunityContext(selectedCommunity).catch(console.error);
      communityStorage.setCommunity(selectedCommunity).catch(console.error);
      communityStorage.setCommunityId(selectedCommunity.id).catch(console.error);
      console.log(`[CommunitySelection] [${timestamp}] Community selected successfully`);
    } catch (err) {
      console.error(`[CommunitySelection] [${timestamp}] Error selecting community:`, err);
      // Reset on error
      hasInitialized.current = false;
      setShowCommunitySearch(true);
    }
  }, [setCommunityContext]);

  const handleCommunityChange = useCallback(() => {
    const timestamp = new Date().toISOString();
    console.log(`[CommunitySelection] [${timestamp}] Handling community change`);
    setCommunity(null);
    setShowCommunitySearch(true);
    communityStorage.removeCommunity().catch(console.error);
  }, []);

  return {
    community,
    showCommunitySearch,
    setShowCommunitySearch,
    selectCommunity,
    handleCommunityChange,
  };
}
