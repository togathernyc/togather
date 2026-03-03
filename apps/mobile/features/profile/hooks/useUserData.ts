import { useQuery, api } from "@services/api/convex";
import { useAuth } from "@providers/AuthProvider";

/**
 * Hook to get user data with community memberships
 *
 * Uses the authenticated users.me query which returns full user profile
 * including community memberships.
 */
export function useUserData(enabled: boolean = true) {
  const { isAuthenticated, token } = useAuth();

  // Use the me query which returns full user data with community memberships
  const data = useQuery(
    api.functions.users.me,
    enabled && isAuthenticated && token ? { token } : "skip"
  );

  const isLoading = data === undefined && enabled && isAuthenticated;

  // Transform Convex response to snake_case for backward compatibility
  const transformedData = data ? {
    id: data.id,
    user_id: data.id,
    legacy_id: data.legacyId,
    first_name: data.firstName,
    last_name: data.lastName,
    email: data.email,
    phone: data.phone,
    phone_verified: data.phoneVerified,
    profile_photo: data.profilePhoto,
    date_of_birth: data.dateOfBirth,
    timezone: data.timezone,
    active_community_id: data.activeCommunityId,
    active_community_name: data.activeCommunityName,
    // Transform community memberships to snake_case, filtering out null entries
    community_memberships: data.communityMemberships
      ?.filter((m): m is NonNullable<typeof m> => m !== null)
      .map(m => ({
        community_id: m.communityId,
        community_legacy_id: m.communityLegacyId,
        community_name: m.communityName,
        role: m.role,
        is_admin: m.isAdmin,
        is_primary_admin: m.isPrimaryAdmin,
        status: m.status,
        community_anniversary: m.communityAnniversary,
      })) ?? [],
    // Add group_memberships field that the HomeScreen expects
    group_memberships: [],
  } : undefined;

  return {
    data: transformedData,
    isLoading,
    isError: false, // Convex throws on error, wrapped in ErrorBoundary
    error: null,
  };
}
