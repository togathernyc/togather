import { queryKeys } from '../query-keys';

describe('queryKeys', () => {
  describe('auth', () => {
    it('should generate user query key', () => {
      expect(queryKeys.auth.user()).toEqual(['auth', 'user']);
    });

    it('should generate profile query key', () => {
      expect(queryKeys.auth.profile()).toEqual(['auth', 'profile']);
    });
  });

  describe('chat', () => {
    it('should generate rooms query key', () => {
      expect(queryKeys.chat.rooms()).toEqual(['chat', 'rooms']);
    });

    it('should generate messages query key with roomId', () => {
      expect(queryKeys.chat.messages('room-1')).toEqual(['chat', 'messages', 'room-1']);
      expect(queryKeys.chat.messages(123)).toEqual(['chat', 'messages', 123]);
    });
  });

  describe('groups', () => {
    it('should generate all groups query key', () => {
      expect(queryKeys.groups.all()).toEqual(['groups']);
    });

    it('should generate detail query key with groupId', () => {
      expect(queryKeys.groups.detail('group-1')).toEqual(['groups', 'group-1']);
      expect(queryKeys.groups.detail(456)).toEqual(['groups', 456]);
    });

    it('should generate members query key with groupId', () => {
      expect(queryKeys.groups.members('group-1')).toEqual(['groups', 'group-1', 'members']);
      expect(queryKeys.groups.members(456)).toEqual(['groups', 456, 'members']);
    });

    it('should generate search query key', () => {
      expect(queryKeys.groups.search()).toEqual(['groups', 'search', '', '', '']);
      expect(queryKeys.groups.search('test')).toEqual(['groups', 'search', 'test', '', '']);
      expect(queryKeys.groups.search('test', '12345')).toEqual(['groups', 'search', 'test', '12345', '']);
      expect(queryKeys.groups.search('test', '12345', 1)).toEqual(['groups', 'search', 'test', '12345', 1]);
    });

    it('should generate userGroups query key', () => {
      expect(queryKeys.groups.userGroups()).toEqual(['userGroups']);
    });
  });

  describe('leaderTools', () => {
    it('should generate groups query key', () => {
      expect(queryKeys.leaderTools.groups()).toEqual(['leader-tools', 'groups']);
      expect(queryKeys.leaderTools.groups(123)).toEqual(['leader-tools', 'groups', 123]);
    });

    it('should generate attendance query key', () => {
      expect(queryKeys.leaderTools.attendance('group-1')).toEqual(['leader-tools', 'attendance', 'group-1']);
    });

    it('should generate members query key', () => {
      expect(queryKeys.leaderTools.members('group-1')).toEqual(['leader-tools', 'members', 'group-1']);
    });

    it('should generate meetingDates query key', () => {
      expect(queryKeys.leaderTools.meetingDates('group-1')).toEqual(['leader-tools', 'meeting-dates', 'group-1']);
      expect(queryKeys.leaderTools.meetingDates('group-1', '2024-01')).toEqual(['leader-tools', 'meeting-dates', 'group-1', '2024-01']);
    });

    it('should generate attendanceReport query key', () => {
      expect(queryKeys.leaderTools.attendanceReport('group-1', '2024-01-01')).toEqual(['leaderAttendanceReport', 'group-1', '2024-01-01']);
    });

    it('should generate groupMembers query key', () => {
      expect(queryKeys.leaderTools.groupMembers('group-1')).toEqual(['groupMembers', 'group-1']);
      expect(queryKeys.leaderTools.groupMembers('group-1', 'context')).toEqual(['groupMembers', 'group-1', 'context']);
    });

    it('should generate groupMemberCounts query key', () => {
      expect(queryKeys.leaderTools.groupMemberCounts([1, 2, 3])).toEqual(['leaderGroupMemberCounts', [1, 2, 3]]);
    });

    it('should generate recentAttendanceStats query key', () => {
      expect(queryKeys.leaderTools.recentAttendanceStats('group-1')).toEqual(['recentAttendanceStats', 'group-1']);
      expect(queryKeys.leaderTools.recentAttendanceStats('group-1', 10)).toEqual(['recentAttendanceStats', 'group-1', 10]);
    });
  });

  describe('home', () => {
    it('should generate userData query key', () => {
      expect(queryKeys.home.userData()).toEqual(['home', 'user-data']);
    });

    it('should generate latestMessage query key', () => {
      expect(queryKeys.home.latestMessage()).toEqual(['home', 'latest-message']);
      expect(queryKeys.home.latestMessage(123)).toEqual(['home', 'latest-message', 123]);
    });

    it('should generate communitySettings query key', () => {
      expect(queryKeys.home.communitySettings()).toEqual(['home', 'community-settings']);
      expect(queryKeys.home.communitySettings(123)).toEqual(['home', 'community-settings', 123]);
    });
  });

  describe('admin', () => {
    it('should generate totalAttendance query key', () => {
      expect(queryKeys.admin.totalAttendance(null)).toEqual(['totalAttendance', null]);
      const dateRange = { startDate: '2024-01-01', endDate: '2024-01-31' };
      expect(queryKeys.admin.totalAttendance(dateRange)).toEqual(['totalAttendance', dateRange]);
      expect(queryKeys.admin.totalAttendance(dateRange, 123)).toEqual(['totalAttendance', dateRange, 123]);
    });

    it('should generate newSignups query key', () => {
      expect(queryKeys.admin.newSignups(null)).toEqual(['newSignups', null]);
      const dateRange = { startDate: '2024-01-01', endDate: '2024-01-31' };
      expect(queryKeys.admin.newSignups(dateRange)).toEqual(['newSignups', dateRange]);
      expect(queryKeys.admin.newSignups(dateRange, 123)).toEqual(['newSignups', dateRange, 123]);
    });

    it('should generate groups query key', () => {
      expect(queryKeys.admin.groups()).toEqual(['adminGroups']);
    });
  });

  describe('profile', () => {
    it('should generate profile query key', () => {
      expect(queryKeys.profile.profile()).toEqual(['profile']);
    });
  });
});

