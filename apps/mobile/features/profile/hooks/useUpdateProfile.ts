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
      // Transform snake_case to camelCase for Convex API
      const result = await updateMutation({
        firstName: data.first_name,
        lastName: data.last_name,
        dateOfBirth: data.date_of_birth,
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
