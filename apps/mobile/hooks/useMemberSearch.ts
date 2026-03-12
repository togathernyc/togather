/**
 * useMemberSearch - Centralized hook for member search functionality.
 *
 * Provides debounced search, pagination, and filtering for community members.
 * Used by MemberSearch component and can be used directly for custom implementations.
 *
 * Supports comma-separated search terms for multi-term search:
 * - Input: "john@email.com, jane smith, 555-1234"
 * - Backend handles the comma-separated parsing and combines results
 */
import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { useQuery, api } from "@services/api/convex";
import { useAuth } from "@providers/AuthProvider";
import type { CommunityMember } from "@/types/community";
import type { Id } from "@services/api/convex";

/**
 * Parse a search query into individual search terms.
 * Splits by comma and trims each term, filtering out empty terms.
 * Note: This is kept for any client-side validation needs, but the backend
 * handles the actual comma-separated parsing.
 */
export function parseSearchTerms(query: string): string[] {
  if (!query || !query.includes(",")) {
    return query.trim() ? [query.trim()] : [];
  }
  return query
    .split(",")
    .map((term) => term.trim())
    .filter((term) => term.length > 0);
}

export interface UseMemberSearchOptions {
  /** Debounce delay in milliseconds (default: 400ms) */
  debounceMs?: number;
  /** Number of results per page (default: 20) */
  pageSize?: number;
  /** User IDs to exclude from results (supports both legacy number IDs and Convex string IDs) */
  excludeUserIds?: (number | string)[];
  /** Filter to specific group */
  groupId?: string;
  /** Restrict results to active members of any of these groups */
  includeGroupIds?: string[];
  /** Exclude active members of this group from results (server-side) */
  excludeGroupMembersOfGroupId?: string;
  /** Minimum characters before search triggers (default: 2) */
  minSearchLength?: number;
  /** Whether search is enabled */
  enabled?: boolean;
  /** Whether to include the current user in search results (default: false) */
  includeSelf?: boolean;
}

export interface UseMemberSearchReturn {
  // Search state
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  debouncedQuery: string;

  // Data
  members: CommunityMember[];
  totalCount: number;

  // Pagination
  hasNextPage: boolean;
  fetchNextPage: () => void;
  currentPage: number;

  // Loading states
  isLoading: boolean;
  isSearching: boolean;
  isFetchingNextPage: boolean;

  // Error
  error: Error | null;

  // Actions
  clearSearch: () => void;
  refetch: () => void;
  reset: () => void;
}

/**
 * Transform Convex response to CommunityMember format.
 * The API returns camelCase, but we use snake_case for consistency.
 */
function transformMember(m: any): CommunityMember {
  return {
    user_id: m.id, // Keep as Convex Id<"users"> string
    first_name: m.firstName || "",
    last_name: m.lastName || "",
    email: m.email || "",
    phone: m.phone ?? null,
    profile_photo: m.profilePhoto ?? null,
    groups_count: m.groupsCount ?? 0,
    is_admin: m.isAdmin ?? false,
    last_login: m.lastLogin ?? null,
    created_at: null, // Backend doesn't return this field
  };
}

/**
 * Check if any search term meets the minimum length requirement.
 */
function hasValidSearchTerm(query: string, minLength: number): boolean {
  const terms = parseSearchTerms(query);
  return terms.some((term) => term.length >= minLength);
}

export function useMemberSearch(
  options: UseMemberSearchOptions = {}
): UseMemberSearchReturn {
  const {
    debounceMs = 400,
    pageSize = 20,
    excludeUserIds = [],
    groupId,
    includeGroupIds,
    excludeGroupMembersOfGroupId,
    minSearchLength = 2,
    enabled = true,
    includeSelf = false,
  } = options;

  // Get auth context for user and community IDs
  const { user, community, token } = useAuth();

  // Search state
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [allMembers, setAllMembers] = useState<CommunityMember[]>([]);
  const [prevData, setPrevData] = useState<any>(null);
  const isInitialMount = useRef(true);

  // Debounce search query
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(searchQuery);
    }, debounceMs);
    return () => clearTimeout(timer);
  }, [searchQuery, debounceMs]);

  const includeGroupIdsKey = useMemo(
    () => (includeGroupIds && includeGroupIds.length > 0 ? includeGroupIds.join(",") : ""),
    [includeGroupIds]
  );

  const normalizedIncludeGroupIds = useMemo(
    () =>
      includeGroupIds && includeGroupIds.length > 0
        ? includeGroupIds.map((id) => String(id) as Id<"groups">)
        : undefined,
    [includeGroupIdsKey]
  );

  // Reset pagination when search or filters change (but not on initial mount)
  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }
    setCurrentPage(1);
    setAllMembers([]);
  }, [debouncedQuery, groupId, includeGroupIdsKey, excludeGroupMembersOfGroupId]);

  // Determine if we should fetch - requires a valid search term
  const shouldFetch =
    enabled &&
    !!user?.id &&
    !!community?.id &&
    !!token &&
    hasValidSearchTerm(debouncedQuery, minSearchLength);

  // Use the non-admin search endpoint (works for all authenticated users)
  // Convex query: api.functions.groupSearch.searchCommunityMembers
  const queryData = useQuery(
    api.functions.groupSearch.searchCommunityMembers as any,
    shouldFetch
      ? {
          token: token as string,
          communityId: community?.id as Id<"communities">,
          search: debouncedQuery.trim(),
          excludeUserIds: excludeUserIds.map((id) => String(id) as Id<"users">),
          includeGroupIds: normalizedIncludeGroupIds,
          excludeGroupId: excludeGroupMembersOfGroupId
            ? (String(excludeGroupMembersOfGroupId) as Id<"groups">)
            : undefined,
          limit: pageSize,
          includeSelf,
        } as any
      : "skip"
  );

  // Track loading state (undefined = loading for Convex)
  const isLoading = queryData === undefined && shouldFetch;

  // Keep previous data for placeholder behavior
  useEffect(() => {
    if (queryData !== undefined) {
      setPrevData(queryData);
    }
  }, [queryData]);

  // Use current data or previous data as placeholder
  // The new endpoint returns an array directly
  const effectiveData = queryData ?? prevData;

  // Transform members when data changes
  const transformedMembers = useMemo(() => {
    if (!effectiveData || !Array.isArray(effectiveData)) return [];
    return effectiveData.map(transformMember);
  }, [effectiveData]);

  // Update allMembers when transformed members change
  useEffect(() => {
    setAllMembers(transformedMembers);
  }, [transformedMembers]);

  // Exclusions are now handled by the backend, but filter again for safety
  const filteredMembers = useMemo(() => {
    if (excludeUserIds.length === 0) return allMembers;
    const excludeSet = new Set(excludeUserIds.map(String));
    return allMembers.filter((m) => !excludeSet.has(String(m.user_id)));
  }, [allMembers, excludeUserIds]);

  // Pagination (not supported by the new endpoint, but keep interface stable)
  const hasNextPage = false;
  const isFetchingNextPage = false;

  const fetchNextPage = useCallback(() => {
    // Pagination not supported by the new endpoint
    // This is kept for interface stability
  }, []);

  // Actions
  const clearSearch = useCallback(() => {
    setSearchQuery("");
    setDebouncedQuery("");
    setCurrentPage(1);
    setAllMembers([]);
  }, []);

  const reset = useCallback(() => {
    clearSearch();
    isInitialMount.current = true;
  }, [clearSearch]);

  // Convex queries auto-refresh, so refetch is a no-op
  const refetch = useCallback(() => {
    // Convex real-time queries auto-update, no manual refetch needed
    // For manual refresh, reset the page to trigger re-render
    setCurrentPage(1);
  }, []);

  // Determine if we're actively searching (query entered but not yet debounced)
  const isSearching =
    searchQuery !== debouncedQuery && searchQuery.length >= minSearchLength;

  return {
    searchQuery,
    setSearchQuery,
    debouncedQuery,
    members: filteredMembers,
    totalCount: filteredMembers.length,
    hasNextPage,
    fetchNextPage,
    currentPage,
    isLoading,
    isSearching,
    isFetchingNextPage,
    error: null, // Convex throws errors, handle via ErrorBoundary
    clearSearch,
    refetch,
    reset,
  };
}
