import { useMemo, useState, useCallback, useEffect } from "react";
import { useQuery, api } from "@services/api/convex";
import type { Id } from "@services/api/convex";
import { useAuth } from "@providers/AuthProvider";

// Response type from the paginated list endpoint
interface PaginatedMembersResponse {
  items: any[];
  totalCount: number;
  nextCursor?: string;
  hasMore: boolean;
}

interface UseGroupMembersOptions {
  search?: string;
  sortBy?: string;
  noAttendanceDays?: number;
  rsvpStatus?: "going" | "not_going" | "not_answered";
  rsvpDate?: string;
  role?: "leader" | "member"; // Note: "admin" role is mapped to "leader" in Convex
  enabled?: boolean;
  /**
   * When true, automatically fetches all pages of members.
   * Useful for attendance tracking where all members need to be visible.
   * Default: false
   */
  loadAllMembers?: boolean;
}

export function useGroupMembers(
  groupId: string | number,
  options?: UseGroupMembersOptions
) {
  const { token } = useAuth();
  const {
    search = "",
    sortBy = "-membership__role,last_name,first_name,id",
    noAttendanceDays,
    rsvpStatus,
    rsvpDate,
    role,
    enabled = true,
    loadAllMembers = false,
  } = options || {};

  // Pagination state
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [accumulatedMembers, setAccumulatedMembers] = useState<any[]>([]);
  const [isFetchingNextPage, setIsFetchingNextPage] = useState(false);

  // Use Convex to fetch group members (groupId is now a Convex ID)
  // SECURITY: token is required to access member list (only members/admins can see)
  const rawData = useQuery(
    api.functions.groupMembers.list,
    groupId && enabled
      ? {
          groupId: String(groupId) as Id<"groups">,
          includeInactive: false,
          role: role,
          cursor: cursor,
          token: token ?? undefined,
        }
      : "skip"
  );

  // Parse the response - handle both old array format and new paginated format
  const data = useMemo((): PaginatedMembersResponse | undefined => {
    if (!rawData) return undefined;

    // Check if it's an array first (old format)
    if (Array.isArray(rawData)) {
      return {
        items: rawData,
        totalCount: rawData.length,
        hasMore: false,
        nextCursor: undefined,
      };
    }

    // New paginated format (has 'items' property)
    if (typeof rawData === 'object' && 'items' in rawData) {
      return rawData as unknown as PaginatedMembersResponse;
    }

    return undefined;
  }, [rawData]);

  const isLoading = data === undefined && enabled && !!groupId && !cursor;
  const error: Error | null = null; // Convex throws on error, handle with ErrorBoundary

  // Reset pagination when filters change
  useEffect(() => {
    setCursor(undefined);
    setAccumulatedMembers([]);
  }, [groupId, role]);

  // Transform member data
  const transformMember = useCallback((member: any) => ({
    _id: member.id,
    id: member.id,
    role: member.role,
    joined_at: member.joinedAt,
    left_at: member.leftAt,
    notifications_enabled: member.notificationsEnabled,
    first_name: member.user?.firstName || '',
    last_name: member.user?.lastName || '',
    email: member.user?.email || '',
    profile_photo: member.user?.profileImage || null,
    user: {
      _id: member.user?.id,
      id: member.user?.id,
      first_name: member.user?.firstName,
      last_name: member.user?.lastName,
      email: member.user?.email,
      profile_photo: member.user?.profileImage,
    },
  }), []);

  // Update accumulated members when new data arrives
  useEffect(() => {
    if (__DEV__) {
      console.log('🔧 useGroupMembers data received:', {
        rawDataType: rawData ? (Array.isArray(rawData) ? 'array' : typeof rawData) : 'undefined',
        hasItems: !!data?.items,
        itemsLength: data?.items?.length,
        totalCount: data?.totalCount,
        hasMore: data?.hasMore,
      });
    }

    if (!data?.items) {
      if (data !== undefined && !cursor) {
        // Clear members if we got an empty response on initial load
        setAccumulatedMembers([]);
        setIsFetchingNextPage(false);
      }
      return;
    }

    const transformedItems = data.items.map(transformMember);

    if (cursor) {
      // Append to existing members for pagination
      // Using functional update ensures we have the latest state for deduplication
      // The Set is built from ALL accumulated members (prev), not just current page
      setAccumulatedMembers(prev => {
        const existingIds = new Set(prev.map(m => m.id));
        // Filter out any items that already exist in our accumulated list
        // This handles duplicates that may appear across page boundaries
        const newItems = transformedItems.filter((m: any) => !existingIds.has(m.id));
        return [...prev, ...newItems];
      });
    } else {
      // Replace members for initial load or filter change - no deduplication needed
      setAccumulatedMembers(transformedItems);
    }
    setIsFetchingNextPage(false);
  }, [data, cursor, transformMember]);

  // Auto-load all pages when loadAllMembers is enabled
  // This is useful for attendance tracking where all members need to be visible
  useEffect(() => {
    if (loadAllMembers && data?.hasMore && data?.nextCursor && !isFetchingNextPage) {
      // Automatically fetch the next page
      setIsFetchingNextPage(true);
      setCursor(data.nextCursor);
    }
  }, [loadAllMembers, data?.hasMore, data?.nextCursor, isFetchingNextPage]);

  // Apply client-side search filter only (sorting is done by backend)
  const members = useMemo(() => {
    // No search filter - return accumulated members in backend order
    if (!search || !search.trim()) {
      return accumulatedMembers;
    }

    // Apply search filter
    const searchLower = search.toLowerCase().trim();
    return accumulatedMembers.filter((m: any) => {
      const firstName = m.first_name?.toLowerCase() || "";
      const lastName = m.last_name?.toLowerCase() || "";
      const email = m.email?.toLowerCase() || "";
      return (
        firstName.includes(searchLower) ||
        lastName.includes(searchLower) ||
        email.includes(searchLower)
      );
    });
  }, [accumulatedMembers, search]);

  const fetchNextPage = useCallback(() => {
    if (data?.hasMore && data?.nextCursor && !isFetchingNextPage) {
      setIsFetchingNextPage(true);
      setCursor(data.nextCursor);
    }
  }, [data?.hasMore, data?.nextCursor, isFetchingNextPage]);

  const refetch = useCallback(() => {
    setCursor(undefined);
    setAccumulatedMembers([]);
  }, []);

  const totalCount = data?.totalCount ?? 0;
  const hasMore = data?.hasMore ?? false;

  if (__DEV__) {
    console.log('🔢 useGroupMembers pagination:', {
      totalCount,
      hasMore,
      nextCursor: data?.nextCursor,
      accumulatedCount: accumulatedMembers.length,
    });
  }

  return {
    data: members,
    isLoading,
    error,
    members,
    totalCount,
    hasNextPage: hasMore,
    fetchNextPage,
    isFetchingNextPage,
    refetch,
    isRefetching: false,
  };
}
