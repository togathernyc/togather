/**
 * Test to document the authenticated mutation pattern
 *
 * This test serves as documentation for how to properly use mutations
 * that require authentication.
 *
 * IMPORTANT: All mutations that require authentication should use
 * `useAuthenticatedMutation` instead of raw `useMutation`.
 *
 * Exception: Mutations that use `authToken` instead of `token` for auth
 * (like notifications.registerToken) must use raw useMutation.
 */

describe('Authenticated Mutation Documentation', () => {
  it('documents the correct pattern for authenticated mutations', () => {
    // This test documents the pattern, not validates it at runtime

    const correctPattern = `
    // CORRECT: Use useAuthenticatedMutation for mutations requiring auth
    import { useAuthenticatedMutation, api } from "@services/api/convex";

    const updateMeeting = useAuthenticatedMutation(api.functions.meetings.index.update);

    // Token is auto-injected, no need to pass it
    await updateMeeting({
      meetingId: "xxx",
      title: "New Title",
    });
    `;

    const incorrectPattern = `
    // INCORRECT: Using raw useMutation requires manual token handling
    import { useMutation, api } from "@services/api/convex";
    import { useAuth } from "@providers/AuthProvider";

    const { token } = useAuth();
    const updateMeeting = useMutation(api.functions.meetings.index.update);

    // Easy to forget the token!
    await updateMeeting({
      token,  // Must remember to include this
      meetingId: "xxx",
      title: "New Title",
    });
    `;

    const exceptionPattern = `
    // EXCEPTION: Some mutations use 'authToken' instead of 'token'
    // These CANNOT use useAuthenticatedMutation and must pass authToken manually
    // Example: notifications.registerToken (token = push token, authToken = auth)

    import { useMutation, api } from "@services/api/convex";
    import { useAuth } from "@providers/AuthProvider";

    const { token: authToken } = useAuth();
    const registerToken = useMutation(api.functions.notifications.tokens.registerToken);

    await registerToken({
      authToken,  // Auth token
      token: pushToken,  // Push notification token
      platform: "ios",
    });
    `;

    // Test passes - it's documentation
    expect(correctPattern).toBeDefined();
    expect(incorrectPattern).toBeDefined();
    expect(exceptionPattern).toBeDefined();
  });

  it('lists mutations that require authentication', () => {
    // These mutations require authentication via token field
    // and should use useAuthenticatedMutation
    const authenticatedMutations = [
      // Meetings
      'meetings.create',
      'meetings.update',
      'meetings.cancel',
      'meetings.markAttendance',
      'meetings.addGuest',
      'meetings.selfReportAttendance',

      // Groups
      'groups.create',
      'groups.update',

      // Group Members
      'groupMembers.add',
      'groupMembers.remove',
      'groupMembers.updateRole',
      'groupMembers.createJoinRequest',
      'groupMembers.cancelJoinRequest',

      // Meeting RSVPs
      'meetingRsvps.submit',
      'meetingRsvps.remove',

      // Users
      'users.update',
      'users.clearActiveCommunity',

      // Communities
      'communities.leave',

      // Group Bots
      'groupBots.updateConfig',
      'groupBots.toggle',
      'groupBots.resetConfig',

      // Member Followups
      'memberFollowups.add',
      'memberFollowups.snooze',
      'memberFollowups.updateAttendance',
      'memberFollowups.unsnooze',

      // Admin
      'admin.reviewPendingRequest',
      'admin.updateMemberRole',
      'admin.transferPrimaryAdmin',
      'admin.updateCommunitySettings',
      'admin.createGroupType',
      'admin.updateGroupType',
      'admin.mergeDuplicateAccounts',

      // Uploads
      'uploads.generateUploadUrl',
      'uploads.confirmUpload',

      // Notifications (use 'token' field)
      'notifications.markRead',
      'notifications.markAllRead',
      'notifications.setGroupNotifications',
      'notifications.updatePreferences',
      'notifications.updateChannelPreferences',

      // Chat
      'chat.ensureMentionable',
    ];

    // These mutations use 'authToken' instead of 'token'
    // They must use raw useMutation, NOT useAuthenticatedMutation
    const authTokenMutations = [
      'notifications.registerToken', // token = push token, authToken = auth
    ];

    expect(authenticatedMutations.length).toBeGreaterThan(0);
    expect(authTokenMutations.length).toBeGreaterThan(0);
  });
});
