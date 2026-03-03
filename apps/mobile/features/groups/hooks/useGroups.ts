/**
 * Groups Hooks - Convex Implementation
 *
 * This file provides hooks for group operations using Convex.
 * All hooks follow the pattern of using useQuery for reads and useMutation for writes.
 */

import { useMemo } from "react";
import { useQuery, useAuthenticatedMutation, api } from "@services/api/convex";
import { useAuth } from "@providers/AuthProvider";
import type { Id } from "@services/api/convex";

/**
 * Get all groups for the current user
 *
 * @example
 * const groups = useMyGroups();
 */
export function useMyGroups() {
  const { user, community, token } = useAuth();

  // Memoize query args to prevent infinite re-renders
  const queryArgs = useMemo(() => {
    if (!user?.id || !community?.id || !token) {
      return "skip" as const;
    }
    return {
      token,
      communityId: community.id as Id<"communities">,
    };
  }, [user?.id, community?.id, token]);

  const data = useQuery(api.functions.groups.queries.listForUser, queryArgs);

  return {
    data,
    isLoading: data === undefined,
  };
}

/**
 * Get a specific group by ID
 *
 * @example
 * const group = useGroupById({ groupId: 'abc-123' });
 */
export function useGroupById(
  params: { groupId: string },
  options?: { enabled?: boolean }
) {
  const enabled = options?.enabled !== false && !!params.groupId;

  const data = useQuery(
    api.functions.groups.index.getById,
    enabled ? { groupId: params.groupId as Id<"groups"> } : "skip"
  );

  return {
    data,
    isLoading: data === undefined && enabled,
  };
}

/**
 * Create a new group
 *
 * @example
 * const createGroup = useCreateGroup();
 * await createGroup({
 *   name: 'My New Group',
 *   groupTypeId: 'abc-123',
 *   description: 'A great group'
 * });
 */
export function useCreateGroup() {
  const createGroup = useAuthenticatedMutation(api.functions.groups.index.create);
  return createGroup;
}

/**
 * Update an existing group
 *
 * @example
 * const updateGroup = useUpdateGroup();
 * await updateGroup({
 *   groupId: 'abc-123',
 *   name: 'Updated Name',
 *   description: 'Updated description'
 * });
 */
export function useUpdateGroup() {
  const updateGroup = useAuthenticatedMutation(api.functions.groups.index.update);
  return updateGroup;
}

/**
 * Archive a group (soft delete)
 *
 * Only group admins can archive groups.
 *
 * Note: Convex doesn't have an archive mutation yet - this would need to be added
 * to the Convex backend if required.
 *
 * @example
 * const archiveGroup = useArchiveGroup();
 * await archiveGroup({ groupId: 'abc-123' });
 */
export function useArchiveGroup() {
  // TODO: Add archive mutation to Convex backend
  const updateGroup = useAuthenticatedMutation(api.functions.groups.index.update);

  // Return a wrapper that sets isArchived to true
  // Note: useAuthenticatedMutation auto-injects the token
  return async (args: { groupId: string }) => {
    return updateGroup({
      groupId: args.groupId as Id<"groups">,
      isArchived: true,
    });
  };
}

/**
 * Get members of a group
 *
 * SECURITY: token is required to access member list (only members/admins can see)
 *
 * @example
 * const members = useGroupMembers({
 *   groupId: 'abc-123',
 *   role: 'member' // optional filter by role
 * });
 */
export function useGroupMembers(
  params: {
    groupId: string;
    includeInactive?: boolean;
    role?: "member" | "leader";
  },
  options?: { enabled?: boolean }
) {
  const { token } = useAuth();
  const enabled = options?.enabled !== false && !!params.groupId;

  const response = useQuery(
    api.functions.groupMembers.list,
    enabled
      ? {
          groupId: params.groupId as Id<"groups">,
          includeInactive: params.includeInactive,
          role: params.role,
          token: token ?? undefined,
        }
      : "skip"
  );

  // Extract items from paginated response (handles both old array format and new object format)
  const data = response
    ? (Array.isArray(response) ? response : response.items)
    : undefined;

  return {
    data,
    isLoading: response === undefined && enabled,
  };
}

/**
 * Add a member to a group
 *
 * Only group leaders can add members.
 *
 * @example
 * const addMember = useAddMember();
 * await addMember({
 *   groupId: 'abc-123',
 *   userId: '456',
 *   role: 'member'
 * });
 */
export function useAddMember() {
  const addMember = useAuthenticatedMutation(api.functions.groupMembers.add);

  // Note: useAuthenticatedMutation auto-injects the token
  return async (args: { groupId: string; userId: string; role?: string }) => {
    return addMember({
      groupId: args.groupId as Id<"groups">,
      userId: args.userId as Id<"users">,
      role: args.role as any,
    });
  };
}

/**
 * Remove a member from a group
 *
 * Users can remove themselves, or group leaders can remove others.
 *
 * @example
 * const removeMember = useRemoveMember();
 * await removeMember({
 *   groupId: 'abc-123',
 *   userId: '456'
 * });
 */
export function useRemoveMember() {
  const removeMember = useAuthenticatedMutation(api.functions.groupMembers.remove);

  // Note: useAuthenticatedMutation auto-injects the token
  return async (args: { groupId: string; userId: string }) => {
    return removeMember({
      groupId: args.groupId as Id<"groups">,
      userId: args.userId as Id<"users">,
    });
  };
}

/**
 * Join a group (create join request)
 *
 * Creates a pending join request that must be approved by group leaders.
 *
 * @example
 * const joinGroup = useJoinGroup();
 * await joinGroup({ groupId: 'abc-123' });
 */
export function useJoinGroup() {
  const createJoinRequest = useAuthenticatedMutation(
    api.functions.groupMembers.createJoinRequest
  );

  // Note: useAuthenticatedMutation auto-injects the token
  return async (args: { groupId: string }) => {
    return createJoinRequest({
      groupId: args.groupId as Id<"groups">,
    });
  };
}

/**
 * Leave a group (remove yourself)
 *
 * @example
 * const leaveGroup = useLeaveGroup();
 * await leaveGroup({
 *   groupId: 'abc-123',
 *   userId: 'current-user-id'
 * });
 */
export function useLeaveGroup() {
  return useRemoveMember();
}

/**
 * Get meetings for a group
 *
 * @example
 * const meetings = useGroupMeetings({
 *   groupId: 'abc-123',
 *   includeCompleted: false,
 *   includeCancelled: false
 * });
 */
export function useGroupMeetings(
  params: {
    groupId: string;
    status?: "scheduled" | "cancelled" | "completed";
    startAfter?: number;
    startBefore?: number;
  },
  options?: { enabled?: boolean }
) {
  const enabled = options?.enabled !== false && !!params.groupId;

  const data = useQuery(
    api.functions.meetings.index.listByGroup,
    enabled
      ? {
          groupId: params.groupId as Id<"groups">,
          status: params.status,
          startAfter: params.startAfter,
          startBefore: params.startBefore,
        }
      : "skip"
  );

  return {
    data,
    isLoading: data === undefined && enabled,
  };
}

/**
 * Get Stream Chat channels for a group
 *
 * Note: This returns the channel IDs that can be used with Stream Chat SDK.
 * The actual channel data is fetched from Stream Chat.
 *
 * @example
 * const group = useGroupChats({ groupId: 'abc-123' });
 * console.log(group?.mainChannelId, group?.leadersChannelId);
 */
export function useGroupChats(
  params: { groupId: string },
  options?: { enabled?: boolean }
) {
  const enabled = options?.enabled !== false && !!params.groupId;

  const data = useQuery(
    api.functions.groups.index.getById,
    enabled ? { groupId: params.groupId as Id<"groups"> } : "skip"
  );

  // Channel IDs are computed from group data using Stream Chat channel ID format
  // The actual channel IDs are built by Stream SDK, this just provides group info needed
  const channelData = data
    ? {
        // Channel IDs would be built externally using group's legacyId
        // For now, return the group ID which can be used to construct channel IDs
        groupId: data._id,
        legacyId: data.legacyId,
        // Access any computed channel IDs if they exist on the response
        mainChannelId: (data as any).mainChannelId,
        leadersChannelId: (data as any).leadersChannelId,
      }
    : undefined;

  return {
    data: channelData,
    isLoading: data === undefined && enabled,
  };
}

/**
 * List all groups in the community (basic list)
 *
 * @example
 * const groups = useGroupList({
 *   groupTypeSlug: 'small-groups'
 * });
 */
export function useGroupList(
  params?: {
    groupTypeSlug?: string;
    includeArchived?: boolean;
  },
  options?: { enabled?: boolean }
) {
  const { community } = useAuth();
  const enabled = options?.enabled !== false && !!community?.id;

  // Memoize query args to prevent infinite re-renders
  const queryArgs = useMemo(() => {
    if (!enabled || !community?.id) {
      return "skip" as const;
    }
    return {
      communityId: community.id as Id<"communities">,
      includePrivate: params?.includeArchived,
    };
  }, [enabled, community?.id, params?.includeArchived]);

  const data = useQuery(api.functions.groups.index.listByCommunity, queryArgs);

  return {
    data,
    isLoading: data === undefined && enabled,
  };
}

/**
 * Search for groups in the community with text search, type filtering, and pagination
 *
 * @example
 * const groups = useGroupSearchQuery({
 *   query: 'bible study',
 *   groupTypeId: 'abc-123',
 *   limit: 20
 * });
 */
export function useGroupSearchQuery(
  params?: {
    query?: string;
    groupTypeId?: string;
    limit?: number;
    offset?: number;
  },
  options?: { enabled?: boolean }
) {
  const { community, user, token } = useAuth();
  const enabled = options?.enabled !== false && !!community?.id;

  // Memoize query args to prevent infinite re-renders
  const queryArgs = useMemo(() => {
    // For authenticated queries, require token
    if (user?.id && !token) {
      return "skip" as const;
    }
    if (!enabled || !community?.id) {
      return "skip" as const;
    }
    const baseArgs = {
      communityId: community.id as Id<"communities">,
      query: params?.query,
      groupTypeId: params?.groupTypeId as Id<"groupTypes"> | undefined,
      limit: params?.limit ?? 50,
    };
    // Add token for authenticated queries
    if (user?.id && token) {
      return { ...baseArgs, token };
    }
    return baseArgs;
  }, [enabled, community?.id, params?.query, params?.groupTypeId, params?.limit, user?.id, token]);

  // Use searchGroupsWithMembership if user is logged in, otherwise use searchGroups
  const data = useQuery(
    user?.id
      ? api.functions.groupSearch.searchGroupsWithMembership
      : api.functions.groupSearch.searchGroups,
    queryArgs
  );

  return {
    data,
    isLoading: data === undefined && enabled,
  };
}

/**
 * Get group types for the community
 *
 * @example
 * const types = useGroupTypes();
 */
export function useGroupTypes(options?: { enabled?: boolean }) {
  const { community } = useAuth();
  const enabled = options?.enabled !== false && !!community?.id;

  // Memoize query args to prevent infinite re-renders
  const queryArgs = useMemo(() => {
    if (!enabled || !community?.id) {
      return "skip" as const;
    }
    return { communityId: community.id as Id<"communities"> };
  }, [enabled, community?.id]);

  const data = useQuery(api.functions.groupSearch.listTypes, queryArgs);

  return {
    data,
    isLoading: data === undefined && enabled,
  };
}

/**
 * Cancel your own join request
 *
 * @example
 * const cancelRequest = useCancelJoinRequest();
 * await cancelRequest({ groupId: 'abc-123' });
 */
export function useCancelJoinRequest() {
  const cancelRequest = useAuthenticatedMutation(
    api.functions.groupMembers.cancelJoinRequest
  );

  // Note: useAuthenticatedMutation auto-injects the token
  return async (args: { groupId: string }) => {
    return cancelRequest({
      groupId: args.groupId as Id<"groups">,
    });
  };
}

/**
 * Update a member's role in a group
 *
 * Only community admins can change member roles.
 *
 * @example
 * const updateRole = useUpdateMemberRole();
 * await updateRole({
 *   groupId: 'abc-123',
 *   userId: '456',
 *   role: 'leader'
 * });
 */
export function useUpdateMemberRole() {
  const updateRole = useAuthenticatedMutation(api.functions.groupMembers.updateRole);

  // Note: useAuthenticatedMutation auto-injects the token
  return async (args: {
    groupId: string;
    userId: string;
    role: "member" | "leader";
  }) => {
    return updateRole({
      groupId: args.groupId as Id<"groups">,
      userId: args.userId as Id<"users">,
      role: args.role,
    });
  };
}

/**
 * Create a meeting for a group
 *
 * Only group leaders can create meetings.
 *
 * @example
 * const createMeeting = useCreateMeeting();
 * await createMeeting({
 *   groupId: 'abc-123',
 *   title: 'Weekly Meeting',
 *   scheduledAt: '2025-12-20T18:00:00Z',
 *   meetingType: 2
 * });
 */
export function useCreateMeeting() {
  const createMeeting = useAuthenticatedMutation(api.functions.meetings.index.create);
  return createMeeting;
}

/**
 * Update a meeting
 *
 * Only group leaders can update meetings.
 *
 * @example
 * const updateMeeting = useUpdateMeeting();
 * await updateMeeting({
 *   meetingId: 'meeting-123',
 *   title: 'Updated Title',
 *   status: 'confirmed'
 * });
 */
export function useUpdateMeeting() {
  const updateMeeting = useAuthenticatedMutation(api.functions.meetings.index.update);
  return updateMeeting;
}

/**
 * Delete (cancel) a meeting
 *
 * Only group leaders can delete meetings.
 *
 * @example
 * const deleteMeeting = useDeleteMeeting();
 * await deleteMeeting({
 *   meetingId: 'meeting-123',
 *   cancellationReason: 'Weather conditions'
 * });
 */
export function useDeleteMeeting() {
  const deleteMeeting = useAuthenticatedMutation(api.functions.meetings.index.cancel);
  return deleteMeeting;
}

/**
 * Get a specific meeting by ID
 *
 * @example
 * const meeting = useMeetingById({ meetingId: 'meeting-123' });
 */
export function useMeetingById(
  params: { meetingId: string },
  options?: { enabled?: boolean }
) {
  const enabled = options?.enabled !== false && !!params.meetingId;

  const data = useQuery(
    api.functions.meetings.index.getById,
    enabled ? { meetingId: params.meetingId as Id<"meetings"> } : "skip"
  );

  return {
    data,
    isLoading: data === undefined && enabled,
  };
}

/**
 * Get attendance for a meeting
 *
 * Pass token if available to get full access (if user has RSVPed)
 *
 * @example
 * const attendance = useMeetingAttendance({ meetingId: 'meeting-123' });
 */
export function useMeetingAttendance(
  params: { meetingId: string },
  options?: { enabled?: boolean }
) {
  const { token } = useAuth();
  const enabled = options?.enabled !== false && !!params.meetingId;

  const data = useQuery(
    api.functions.meetingRsvps.list,
    enabled ? { meetingId: params.meetingId as Id<"meetings">, token: token ?? undefined } : "skip"
  );

  return {
    data,
    isLoading: data === undefined && enabled,
  };
}

/**
 * Record attendance for a meeting
 *
 * Only group leaders can record attendance.
 *
 * @example
 * const recordAttendance = useRecordAttendance();
 * await recordAttendance({
 *   meetingId: 'meeting-123',
 *   userId: '456',
 *   status: 1 // present
 * });
 */
export function useRecordAttendance() {
  const recordAttendance = useAuthenticatedMutation(api.functions.meetingRsvps.submit);
  return recordAttendance;
}
