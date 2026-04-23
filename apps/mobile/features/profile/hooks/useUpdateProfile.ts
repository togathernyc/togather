import { useRouter } from 'expo-router';
import { Alert } from 'react-native';
import { useAuth } from '@providers/AuthProvider';
import { useAuthenticatedMutation, api } from '@services/api/convex';
import { ProfileFormData } from '../types';
import type { Id } from '@services/api/convex';
import { formatError } from "@/utils/error-handling";

/**
 * Hook to update user profile information
 */
export function useUpdateProfile() {
  const router = useRouter();
  const { user, refreshUser } = useAuth();
  const userId = user?.id as Id<"users"> | undefined;
  const updateMutation = useAuthenticatedMutation(api.functions.users.update);

  const mutateAsync = async (data: ProfileFormData) => {
    if (!userId) {
      Alert.alert('Error', 'User not authenticated');
      throw new Error('User not authenticated');
    }

    try {
      // Birthday M/D split. Empty string clears the stored month/day so the
      // user can wipe their birthday via the form. MM/DD is enforced by
      // zod upstream.
      let birthdayMonth: number | undefined;
      let birthdayDay: number | undefined;
      if (data.birthday_md !== undefined) {
        const trimmed = (data.birthday_md || '').trim();
        if (trimmed === '') {
          // Explicit clear — send 0 for both so the server patches to undefined.
          birthdayMonth = 0;
          birthdayDay = 0;
        } else {
          const [m, d] = trimmed.split('/').map(Number);
          if (Number.isFinite(m) && Number.isFinite(d)) {
            birthdayMonth = m;
            birthdayDay = d;
          }
        }
      }

      // Transform snake_case to camelCase for Convex API
      const result = await updateMutation({
        firstName: data.first_name,
        lastName: data.last_name,
        dateOfBirth: data.date_of_birth,
        zipCode: data.zip_code,
        bio: data.bio,
        instagramHandle: data.instagram_handle,
        linkedinHandle: data.linkedin_handle,
        birthdayMonth,
        birthdayDay,
        location: data.location,
      });

      // Refresh user data in auth context
      await refreshUser();
      Alert.alert('Success', 'Profile updated successfully');
      router.back();
      return result;
    } catch (error: any) {
      const errorMessage = formatError(error, 'Failed to update profile');
      Alert.alert('Error', errorMessage);
      throw error;
    }
  };

  const mutate = (data: ProfileFormData, options?: { onSuccess?: () => void; onError?: (error: any) => void }) => {
    mutateAsync(data)
      .then(() => options?.onSuccess?.())
      .catch((error) => options?.onError?.(error));
  };

  return {
    mutateAsync,
    mutate,
    isPending: false, // Convex doesn't provide pending state directly
  };
}
