import { useEffect } from "react";
import { useQuery, api } from "@services/api/convex";
import type { Id } from "@services/api/convex";
import type { Group } from "../types";
import { useAuth } from "@providers/AuthProvider";
import { useGroupCache } from "@/stores/groupCache";

/**
 * Check if a string is a valid Convex ID format.
 * Convex IDs are strings that look like: "k7d8s9..."
 */
function isValidId(str: string): boolean {
  // Convex IDs are non-empty strings
  return typeof str === "string" && str.length > 0;
}

/**
 * Hook to fetch group details by Group ID using Convex.
 *
 * Fetches full group details including members and leaders.
 * Integrates with groupCache for offline/stale-while-revalidate support.
 */
export function useGroupDetails(groupId: string | null | undefined) {
  const { token } = useAuth();
  const enabled = !!groupId && isValidId(groupId);

  // Use groupId directly as Convex ID
  const convexGroupId = groupId as Id<"groups"> | undefined;

  // Cache accessors
  const { setFullGroupData, getFullGroupData } = useGroupCache();

  // Fetch basic group info using Convex ID
  // Pass token to get user-specific data (role, request status)
  const group = useQuery(
    api.functions.groups.index.getById,
    enabled && convexGroupId ? { groupId: convexGroupId, token: token ?? undefined } : "skip"
  );

  // Fetch group members using Convex ID
  // SECURITY: token is required to access member list (only members/admins can see)
  const membersResponse = useQuery(
    api.functions.groupMembers.list,
    enabled && convexGroupId ? { groupId: convexGroupId, token: token ?? undefined } : "skip"
  );
  // Extract items from paginated response (handles both old array format and new object format)
  const members = membersResponse
    ? (Array.isArray(membersResponse) ? membersResponse : membersResponse.items)
    : undefined;

  // Fetch group leaders using Convex ID
  // SECURITY: token is required to access leader list (only members/admins can see)
  const leaders = useQuery(
    api.functions.groups.index.getLeaders,
    enabled && convexGroupId ? { groupId: convexGroupId, token: token ?? undefined } : "skip"
  );

  // Fetch member preview (public data - always available even for non-members)
  // This provides avatars and count for the group page even when user is not a member
  const memberPreview = useQuery(
    api.functions.groupMembers.getMemberPreview,
    enabled && convexGroupId ? { groupId: convexGroupId, limit: 5 } : "skip"
  );

  // Fetch group type details if we have the group
  const groupTypeId = group?.groupTypeId;
  // Note: Group type info is included in the group query via groupTypeName, groupTypeSlug

  // Cache live data when all queries resolve
  useEffect(() => {
    if (group && members !== undefined && leaders !== undefined && memberPreview !== undefined && groupId) {
      setFullGroupData(groupId, {
        details: group,
        members: members,
        leaders: leaders,
        memberPreview: memberPreview,
      });
    }
  }, [group, members, leaders, memberPreview, groupId, setFullGroupData]);

  // Determine loading state
  const isLoading =
    enabled && (group === undefined || membersResponse === undefined || leaders === undefined || memberPreview === undefined);

  // Check cache for stale-while-revalidate
  const cached = isLoading && groupId ? getFullGroupData(groupId) : null;
  const isStale = !!cached;

  // Use cached data for building the response if live data is still loading
  const effectiveGroup = group ?? cached?.details;
  const effectiveMembers = members ?? cached?.members;
  const effectiveLeaders = leaders ?? cached?.leaders;
  const effectiveMemberPreview = memberPreview ?? cached?.memberPreview;

  // Transform to snake_case format for compatibility with existing components
  // Note: Using `as any` casts where needed for Convex ID types to match legacy number types
  const transformedData: Group | undefined = effectiveGroup
    ? {
        _id: effectiveGroup._id, // Convex document ID - used for mutations
        id: effectiveGroup._id,
        uuid: effectiveGroup._id,
        shortId: effectiveGroup.shortId || null, // For shareable links
        name: effectiveGroup.name,
        title: effectiveGroup.name,
        description: effectiveGroup.description || null,
        // Legacy code expects number but Convex uses string IDs
        // Cast to any since Group.group_type expects number
        group_type: undefined, // Set to undefined since we can't convert string ID to number
        group_type_name: (effectiveGroup as any).groupTypeName || null,
        user_role: (effectiveGroup as any).userRole || null,
        user_request_status: (effectiveGroup as any).userRequestStatus || null,
        // SECURITY: These fields may be undefined for non-members (gated by backend)
        address_line1: (effectiveGroup as any).addressLine1 || null,
        address_line2: (effectiveGroup as any).addressLine2 || null,
        city: (effectiveGroup as any).city || null,
        state: (effectiveGroup as any).state || null,
        zip_code: (effectiveGroup as any).zipCode || null,
        default_day: effectiveGroup.defaultDay ?? null,
        default_start_time: effectiveGroup.defaultStartTime || null,
        default_end_time: effectiveGroup.defaultEndTime || null,
        default_meeting_type: effectiveGroup.defaultMeetingType ?? null,
        default_meeting_link: effectiveGroup.defaultMeetingLink || null,
        preview: (effectiveGroup as any).preview || null,
        is_announcement_group: effectiveGroup.isAnnouncementGroup || false,
        // Use actual members count if available, fallback to preview count for non-members
        members_count: (effectiveMembers?.length || 0) + (effectiveLeaders?.length || 0) > 0
          ? (effectiveMembers?.length || 0) + (effectiveLeaders?.length || 0)
          : effectiveMemberPreview?.totalCount || 0,
        // Flatten member data to match GroupMember type expected by MembersRow
        members:
          effectiveMembers?.map((m: any) => ({
            id: m.user?.id || "", // Convex user ID (string)
            first_name: m.user?.firstName || "",
            last_name: m.user?.lastName || "",
            email: m.user?.email || "",
            profile_photo: m.user?.profileImage || undefined,
          })) || [],
        leaders:
          effectiveLeaders?.map((l: any) => ({
            id: l.userId || l._id || "", // Convex user ID (string)
            first_name: l.firstName || "",
            last_name: l.lastName || "",
            email: l.email || "",
            profile_photo: l.profilePhoto || undefined,
          })) || [],
        highlights: [], // Not yet available in Convex
      }
    : undefined;

  // Return extended data with additional fields not in Group type
  const extendedData = transformedData
    ? {
        ...transformedData,
        // Additional fields for Convex compatibility
        group_type_id: effectiveGroup?.groupTypeId, // Keep the string ID for Convex operations
        group_type_slug: (effectiveGroup as any)?.groupTypeSlug || null,
        is_archived: effectiveGroup?.isArchived || false,
        archived_at: null, // Not tracked in current Convex schema
        created_at: effectiveGroup?.createdAt,
        updated_at: effectiveGroup?.updatedAt,
        main_channel_id: (effectiveGroup as any)?.mainChannelId || null,
        leaders_channel_id: (effectiveGroup as any)?.leadersChannelId || null,
        is_on_break: effectiveGroup?.isOnBreak || null,
        break_until: effectiveGroup?.breakUntil || null,
        externalChatLink: (effectiveGroup as any)?.externalChatLink || null,
        // Member preview for non-members (shows avatars without full access)
        member_preview: effectiveMemberPreview?.members?.map((m: any) => ({
          id: m.id || "",
          first_name: m.firstName || "",
          last_name: m.lastName || "",
          profile_photo: m.profileImage || undefined,
          role: m.role || "member",
        })) || [],
      }
    : undefined;

  return {
    data: extendedData,
    isLoading: isLoading && !cached, // Not "loading" if we have cached data
    isStale,
    error: undefined, // Convex throws on error, handled by ErrorBoundary
    isRefetching: false, // Convex uses reactive queries, not explicit refetching
    // Note: Convex queries are reactive, no explicit refetch needed
    refetch: () => {},
  };
}
