/**
 * Centralized Query Key Factories
 * 
 * Provides consistent query key patterns across the app.
 * Makes it easier to invalidate related queries and maintain consistency.
 * 
 * Usage:
 *   import { queryKeys } from '@togather/shared/utils/query-keys';
 *   
 *   // In hooks
 *   queryKey: queryKeys.chat.messages(chatId)
 *   
 *   // In invalidation
 *   queryClient.invalidateQueries({ queryKey: queryKeys.chat.rooms() })
 */

export const queryKeys = {
  // Auth
  auth: {
    user: () => ['auth', 'user'] as const,
    profile: () => ['auth', 'profile'] as const,
  },

  // Chat
  chat: {
    rooms: () => ['chat', 'rooms'] as const,
    messages: (roomId: string | number) => ['chat', 'messages', roomId] as const,
  },

  // Groups
  groups: {
    all: () => ['groups'] as const,
    detail: (groupId: string | number) => ['groups', groupId] as const,
    members: (groupId: string | number) => ['groups', groupId, 'members'] as const,
    search: (query?: string, zipCode?: string | null, type?: number | null) => ['groups', 'search', query || '', zipCode || '', type || ''] as const,
    userGroups: () => ['userGroups'] as const,
    types: () => ['groupTypes'] as const,
  },

  // Leader Tools
  leaderTools: {
    groups: (userId?: string | number) =>
      ['leader-tools', 'groups', ...(userId ? [userId] : [])] as const,
    attendance: (groupId: string | number, meetingId?: string | number) =>
      meetingId
        ? ['attendance', groupId, meetingId] as const
        : ['leader-tools', 'attendance', groupId] as const,
    members: (groupId: string | number) =>
      ['leader-tools', 'members', groupId] as const,
    meetingDates: (groupId: string | number, month?: string) =>
      ['leader-tools', 'meeting-dates', groupId, ...(month ? [month] : [])] as const,
    meetings: (groupId: string | number, past?: number, next?: number) =>
      ['meetings', groupId, `past-${past || 90}`, `next-${next || 90}`] as const,
    recentMeetings: (groupId: string | number) =>
      ['recent-meetings', groupId] as const,
    attendanceReport: (groupId: string | number, eventDate: string) =>
      ['leaderAttendanceReport', groupId, eventDate] as const,
    rsvpStats: (groupId: string | number, dateStr: string) =>
      ['rsvpStats', groupId, dateStr] as const,
    groupMembers: (groupId: string | number, context?: string) =>
      ['groupMembers', groupId, ...(context ? [context] : [])] as const,
    groupMemberCounts: (groupIds: number[]) =>
      ['leaderGroupMemberCounts', groupIds] as const,
    recentAttendanceStats: (groupId: string | number, limit?: number) =>
      ['recentAttendanceStats', groupId, ...(limit ? [limit] : [])] as const,
  },

  // Home
  home: {
    userData: () => ['home', 'user-data'] as const,
    latestMessage: (communityId?: string | number) =>
      ['home', 'latest-message', ...(communityId ? [communityId] : [])] as const,
    communitySettings: (communityId?: string | number) =>
      ['home', 'community-settings', ...(communityId ? [communityId] : [])] as const,
  },

  // Admin
  admin: {
    totalAttendance: (dateRange: { startDate: string; endDate: string } | null, communityId?: string | number) =>
      ['totalAttendance', dateRange, ...(communityId ? [communityId] : [])] as const,
    newSignups: (dateRange: { startDate: string; endDate: string } | null, communityId?: string | number) =>
      ['newSignups', dateRange, ...(communityId ? [communityId] : [])] as const,
    groups: () => ['adminGroups'] as const,
    pendingRequests: () => ['admin', 'pending-requests'] as const,
    userHistory: (userId: number) => ['admin', 'user-history', userId] as const,
    duplicateAccounts: () => ['admin', 'duplicateAccounts'] as const,
    mergedAccounts: () => ['admin', 'mergedAccounts'] as const,
  },

  // Services
  services: {
    list: (communityId?: string | number) =>
      ['services', ...(communityId ? [communityId] : [])] as const,
  },

  // Subscriptions
  subscriptions: {
    list: () => ['subscriptions'] as const,
  },

  // Profile
  profile: {
    profile: () => ['profile'] as const,
  },
} as const;

