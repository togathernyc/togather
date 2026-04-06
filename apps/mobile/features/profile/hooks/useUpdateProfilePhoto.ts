import { Alert, Platform } from 'react-native';
import { uploadAsync, FileSystemUploadType } from 'expo-file-system/legacy';
import { useAuth } from '@providers/AuthProvider';
import { useAuthenticatedMutation, useAuthenticatedAction, api } from '@services/api/convex';
import type { Id } from '@services/api/convex';
import { formatError } from "@/utils/error-handling";

/**
 * Hook to update user profile photo
 *
 * Uses Cloudflare R2 for file uploads:
 * 1. Gets presigned upload URL from Convex (via R2)
 * 2. Client uploads file directly to R2
 * 3. Updates profile_photo field with r2:path
 */
export function useUpdateProfilePhoto() {
  const { user, refreshUser } = useAuth();
  const userId = user?.id as Id<"users"> | undefined;

  const getR2UploadUrl = useAuthenticatedAction(api.functions.uploads.getR2UploadUrl);
  const updateUser = useAuthenticatedMutation(api.functions.users.update);

  const mutateAsync = async (photoUri: string) => {
    if (!userId) {
      Alert.alert('Error', 'User not authenticated');
      throw new Error('User not authenticated');
    }

    try {
      // Extract filename and content type
      const filename = photoUri.split('/').pop() || 'profile-photo.jpg';
      const match = /\.(\w+)$/.exec(filename);
      const ext = match ? match[1].toLowerCase() : 'jpg';
      const contentType = `image/${ext === 'jpg' ? 'jpeg' : ext}`;

      // Step 1: Get R2 presigned upload URL
      const { uploadUrl, storagePath, publicUrl } = await getR2UploadUrl({
        fileName: filename,
        contentType,
        folder: 'profiles',
      });

      // Step 2: Upload file directly to R2
      if (Platform.OS === 'web') {
        // Web: Use fetch/blob
        const response = await fetch(photoUri);
        const blob = await response.blob();

        const uploadResponse = await fetch(uploadUrl, {
          method: 'PUT',
          body: blob,
          headers: {
            'Content-Type': contentType,
          },
        });

        if (!uploadResponse.ok) {
          throw new Error(`Failed to upload photo: ${uploadResponse.statusText}`);
        }
      } else {
        // Native (iOS/Android): Use expo-file-system for proper file handling
        const uploadResult = await uploadAsync(uploadUrl, photoUri, {
          httpMethod: 'PUT',
          uploadType: FileSystemUploadType.BINARY_CONTENT,
          headers: {
            'Content-Type': contentType,
          },
        });

        if (uploadResult.status < 200 || uploadResult.status >= 300) {
          throw new Error(`Failed to upload photo: ${uploadResult.status}`);
        }
      }

      // Step 3: Update user profile with the R2 storage path
      await updateUser({
        profilePhoto: storagePath, // e.g., "r2:profiles/uuid-filename.jpg"
      });

      await refreshUser();
      Alert.alert('Success', 'Profile photo updated successfully');
      return { publicUrl };
    } catch (error: any) {
      console.error('Photo upload error:', error);
      const errorMessage = formatError(error, 'Failed to update profile photo');
      Alert.alert('Error', errorMessage);
      throw error;
    }
  };

  const mutate = (photoUri: string, options?: { onSuccess?: () => void; onError?: (error: any) => void }) => {
    mutateAsync(photoUri)
      .then(() => options?.onSuccess?.())
      .catch((error) => options?.onError?.(error));
  };

  return {
    mutateAsync,
    mutate,
    isPending: false, // Convex doesn't provide pending state directly
  };
}

/**
 * Hook to remove user profile photo
 */
export function useRemoveProfilePhoto() {
  const { user, refreshUser } = useAuth();
  const userId = user?.id as Id<"users"> | undefined;
  const updateMutation = useAuthenticatedMutation(api.functions.users.update);

  const mutateAsync = async () => {
    if (!userId) {
      Alert.alert('Error', 'User not authenticated');
      throw new Error('User not authenticated');
    }

    try {
      // Set profilePhoto to empty string to clear it
      await updateMutation({
        profilePhoto: "",
      });

      await refreshUser();
      Alert.alert('Success', 'Profile photo removed');
    } catch (error: any) {
      const errorMessage = formatError(error, 'Failed to remove profile photo');
      Alert.alert('Error', errorMessage);
      throw error;
    }
  };

  const mutate = (options?: { onSuccess?: () => void; onError?: (error: any) => void }) => {
    mutateAsync()
      .then(() => options?.onSuccess?.())
      .catch((error) => options?.onError?.(error));
  };

  return {
    mutateAsync,
    mutate,
    isPending: false,
  };
}
