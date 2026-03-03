import { useState, useEffect, useMemo } from "react";
import { useQuery, api } from "@services/api/convex";
import { useAuth } from "@providers/AuthProvider";
import type { Id } from "@services/api/convex";

/**
 * Hook to handle group search with debouncing
 * Supports text search and type filtering via Convex
 */
export function useGroupSearch(selectedType?: string | null) {
  const { community, user, token } = useAuth();
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");

  // Debounce search query
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(searchQuery);
    }, 500); // 500ms delay

    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Memoize query args to prevent infinite re-renders
  const queryArgs = useMemo(() => {
    if (!community?.id) {
      return "skip" as const;
    }
    // For authenticated queries, require token
    if (user?.id && !token) {
      return "skip" as const;
    }

    const baseArgs = {
      communityId: community.id as Id<"communities">,
      query: debouncedQuery.trim() || undefined,
      groupTypeId: selectedType as Id<"groupTypes"> | undefined,
      limit: 50,
    };

    // Add token for authenticated queries
    if (user?.id && token) {
      return { ...baseArgs, token };
    }

    return baseArgs;
  }, [community?.id, user?.id, token, debouncedQuery, selectedType]);

  // Use searchGroupsWithMembership if user is logged in, otherwise use searchGroups
  const groups = useQuery(
    user?.id
      ? api.functions.groupSearch.searchGroupsWithMembership
      : api.functions.groupSearch.searchGroups,
    queryArgs
  );

  // Convex returns array directly
  const groupsList = groups || [];

  // Loading state: still debouncing or Convex query is loading
  const isLoading = searchQuery !== debouncedQuery || groups === undefined;

  return {
    searchQuery,
    setSearchQuery,
    debouncedQuery,
    groupsList,
    isLoading,
    error: null, // Convex throws on error, handled by ErrorBoundary
  };
}
