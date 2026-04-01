import { useAuthenticatedQuery, useAuthenticatedMutation, api, useAction } from '@services/api/convex';
import { useAuth } from '@providers/AuthProvider';
import type { Id } from '@services/api/convex';

/**
 * Get current user's profile
 *
 * Returns full user profile with community memberships.
 * Uses the Convex user ID from the auth context.
 *
 * @example
 * const { data: profile } = useProfile();
 * console.log(profile?.firstName, profile?.email);
 */
export function useProfile() {
  const { user } = useAuth();
  const userId = user?.id as Id<"users"> | undefined;

  const data = useAuthenticatedQuery(
    api.functions.users.me,
    userId ? {} : "skip"
  );

  return { data, isLoading: data === undefined && !!userId };
}

/**
 * Update current user's profile
 *
 * Updates basic profile fields like name, phone, date of birth.
 * Convex mutations auto-invalidate queries, no manual invalidation needed.
 *
 * @example
 * const updateProfile = useUpdateProfile();
 * await updateProfile({
 *   firstName: 'John',
 *   lastName: 'Doe',
 * });
 */
export function useUpdateProfile() {
  const { user, refreshUser } = useAuth();
  const userId = user?.id as Id<"users"> | undefined;
  const updateMutation = useAuthenticatedMutation(api.functions.users.update);

  const mutateAsync = async (data: {
    firstName?: string;
    lastName?: string;
    timezone?: string;
    profilePhoto?: string;
  }) => {
    if (!userId) throw new Error("User not authenticated");
    const result = await updateMutation({ ...data });
    // Refresh user in auth context to keep it in sync
    await refreshUser();
    return result;
  };

  return { mutateAsync };
}

/**
 * Update profile photo
 *
 * Uses Convex storage for file uploads.
 * 1. Get upload URL from Convex
 * 2. Upload file to that URL
 * 3. Confirm upload and update user profile
 *
 * @example
 * const updatePhoto = useUpdateProfilePhoto();
 * const result = await updatePhoto.mutateAsync({
 *   fileName: 'photo.jpg',
 *   contentType: 'image/jpeg'
 * });
 */
export function useUpdateProfilePhoto() {
  const { user, refreshUser } = useAuth();
  const userId = user?.id as Id<"users"> | undefined;
  const generateUploadUrl = useAuthenticatedMutation(api.functions.uploads.generateUploadUrl);
  const confirmUpload = useAuthenticatedMutation(api.functions.uploads.confirmUpload);

  const mutateAsync = async (data: { fileName: string; contentType: string }) => {
    if (!userId) throw new Error("User not authenticated");

    // Step 1: Get upload URL
    const uploadUrl = await generateUploadUrl({});

    // Return the upload URL - caller will upload the file and then confirm
    return {
      uploadUrl,
      confirmUpload: async (storageId: Id<"_storage">) => {
        // Step 2: Confirm upload and update user profile in one step
        const result = await confirmUpload({
          storageId,
          entityType: "user",
          entityId: userId,
          folder: "profiles",
        });

        await refreshUser();
        return { publicUrl: result.url };
      },
    };
  };

  return { mutateAsync };
}

/**
 * Remove profile photo
 *
 * Removes the user's profile photo by setting it to undefined.
 *
 * @example
 * const removePhoto = useRemoveProfilePhoto();
 * await removePhoto.mutateAsync();
 */
export function useRemoveProfilePhoto() {
  const { user, refreshUser } = useAuth();
  const userId = user?.id as Id<"users"> | undefined;
  const updateMutation = useAuthenticatedMutation(api.functions.users.update);

  const mutateAsync = async () => {
    if (!userId) throw new Error("User not authenticated");
    await updateMutation({ profilePhoto: undefined });
    await refreshUser();
  };

  return { mutateAsync };
}

/**
 * Get another user's profile by ID
 *
 * Returns basic info for non-admins, full details for admins or self.
 *
 * @example
 * const { data: user } = useUserById({ userId: '123' });
 * console.log(user?.firstName, user?.email);
 */
export function useUserById(input: { userId: string }) {
  const data = useAuthenticatedQuery(
    api.functions.users.getById,
    { userId: input.userId as Id<"users"> }
  );

  return { data, isLoading: data === undefined };
}

/**
 * Search for users
 *
 * Note: User search is not yet implemented in Convex.
 * This is a placeholder that returns empty results.
 *
 * @example
 * const { data: users } = useSearchUsers({ query: 'John', communityId: 1 });
 */
export function useSearchUsers(input: { query: string; communityId?: number }) {
  // TODO: Implement user search in Convex
  // For now, return empty results
  return {
    data: [],
    isLoading: false,
  };
}

/**
 * Get user's communities
 *
 * Returns list of communities the user belongs to (not blocked).
 *
 * @example
 * const { data: communities } = useMyCommunities();
 * console.log(communities?.map(c => c.name));
 */
export function useMyCommunities() {
  const { user } = useAuth();
  const userId = user?.id as Id<"users"> | undefined;

  const data = useAuthenticatedQuery(
    api.functions.communities.listForUser,
    userId ? {} : "skip"
  );

  return { data, isLoading: data === undefined && !!userId };
}

/**
 * Get current community details
 *
 * This is a convenience hook that fetches the user's profile and derives
 * the current community from their activeCommunityId.
 *
 * @example
 * const { data: community } = useCurrentCommunity();
 * console.log(community?.name);
 */
export function useCurrentCommunity() {
  const { user } = useAuth();
  const userId = user?.id as Id<"users"> | undefined;

  const profile = useAuthenticatedQuery(
    api.functions.users.me,
    userId ? {} : "skip"
  );

  const communities = useAuthenticatedQuery(
    api.functions.communities.listForUser,
    userId ? {} : "skip"
  );

  if (!profile?.activeCommunityId || !communities) {
    return { data: null };
  }

  const currentCommunity = communities.find(
    (c) => c && c._id === profile.activeCommunityId
  );

  return { data: currentCommunity || null };
}

/**
 * Delete user account
 *
 * Note: Account deletion requires OTP verification.
 * Use the auth.sendPhoneOTP action first, then call this with the code.
 *
 * @example
 * const deleteAccount = useDeleteAccount();
 * await deleteAccount.mutateAsync({ code: '123456' });
 */
export function useDeleteAccount() {
  const { user, token } = useAuth();
  const deleteAccount = useAction(api.functions.auth.phoneOtp.deleteAccount);

  const mutateAsync = async (data: { code: string }) => {
    if (!user?.phone || !token) throw new Error("User not authenticated");
    return deleteAccount({
      token,
      phone: user.phone,
      code: data.code,
    });
  };

  return { mutateAsync };
}

/**
 * Get user settings
 *
 * Returns notification preferences and other settings.
 *
 * @example
 * const { data: settings } = useUserSettings();
 * console.log(settings?.notificationsEnabled);
 */
export function useUserSettings() {
  const { user } = useAuth();
  const userId = user?.id as Id<"users"> | undefined;

  const data = useAuthenticatedQuery(
    api.functions.notifications.preferences.getChannelPreferences,
    userId ? {} : "skip"
  );

  return { data, isLoading: data === undefined && !!userId };
}

/**
 * Update user settings
 *
 * Updates notification preferences and other settings.
 *
 * @example
 * const updateSettings = useUpdateUserSettings();
 * await updateSettings.mutateAsync({ push: true });
 */
export function useUpdateUserSettings() {
  const { user } = useAuth();
  const userId = user?.id as Id<"users"> | undefined;
  const updateMutation = useAuthenticatedMutation(api.functions.notifications.preferences.updateChannelPreferences);

  const mutateAsync = async (data: {
    push?: boolean;
    email?: boolean;
    sms?: boolean;
  }) => {
    if (!userId) throw new Error("User not authenticated");
    return await updateMutation({ ...data });
  };

  return { mutateAsync };
}
