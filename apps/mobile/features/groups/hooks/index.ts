// Groups Hooks - Barrel Export
// All hooks now use Convex for data fetching

// Individual hook files (these have more complete implementations)
export * from "./useGroupDetails";
export * from "./useGroupChannels";
export * from "./useGroupRefresh";
export * from "./useGroupSearch";
export * from "./useWithdrawJoinRequest";
export * from "./useMyPendingJoinRequests";
export * from "./useCreateGroup";
export * from "./useUpdateGroup";
export * from "./useArchiveGroup";
export * from "./useJoinGroup";
export * from "./useLeaveGroup";
export * from "./useRequestGroup";
export * from "./useRespondToChannelInvite";

// Additional Convex hooks from useGroups.ts
// (excludes useCreateGroup, useUpdateGroup, useArchiveGroup, useJoinGroup, useLeaveGroup
// which are exported above with more complete implementations)
export {
  useMyGroups,
  useGroupById,
  useGroupMembers,
  useAddMember,
  useRemoveMember,
  useGroupMeetings,
  useGroupChats,
  useGroupList,
  useGroupSearchQuery,
  useGroupTypes,
  useCancelJoinRequest,
  useUpdateMemberRole,
  useCreateMeeting,
  useUpdateMeeting,
  useDeleteMeeting,
  useMeetingById,
  useMeetingAttendance,
  useRecordAttendance,
} from "./useGroups";
