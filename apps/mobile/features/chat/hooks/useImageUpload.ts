/**
 * Hook for uploading images in chat messages
 *
 * Provides image upload functionality with progress tracking and state management.
 * Uses Cloudflare R2 for file uploads with on-the-fly image transformations.
 */

import { useState, useCallback } from 'react';
import { Platform } from 'react-native';
import { uploadAsync, FileSystemUploadType } from 'expo-file-system/legacy';
import { useAuthenticatedAction, api } from '@services/api/convex';
import { isValidImageUri, ImageUploadResult } from '../utils/imageUpload';

export interface UseImageUploadResult {
  uploadImage: (imageUri: string) => Promise<ImageUploadResult>;
  uploading: boolean;
  progress: number;
  reset: () => void;
}

/**
 * Hook for uploading images with progress tracking
 *
 * Uses Cloudflare R2 for file uploads:
 * 1. Gets presigned upload URL from Convex (via R2)
 * 2. Client uploads file directly to R2
 * 3. Returns the R2 storage path for the message attachment
 *
 * @returns Object containing upload function, state, and progress
 *
 * @example
 * ```tsx
 * const { uploadImage, uploading, progress } = useImageUpload();
 *
 * const handleImagePick = async (uri: string) => {
 *   const result = await uploadImage(uri);
 *   if (result.error) {
 *     console.error('Upload failed:', result.error);
 *   } else {
 *     console.log('Uploaded to:', result.url);
 *   }
 * };
 * ```
 */
export function useImageUpload(): UseImageUploadResult {
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);

  const getR2UploadUrl = useAuthenticatedAction(api.functions.uploads.getR2UploadUrl);

  const uploadImage = useCallback(async (imageUri: string): Promise<ImageUploadResult> => {
    // Validate image URI
    if (!isValidImageUri(imageUri)) {
      return {
        url: '',
        error: 'Invalid image URI',
      };
    }

    setUploading(true);
    setProgress(0);

    try {
      // Extract filename and content type
      const filename = imageUri.split('/').pop() || 'chat-image.jpg';
      const match = /\.(\w+)$/.exec(filename);
      const ext = match ? match[1].toLowerCase() : 'jpg';
      const contentType = `image/${ext === 'jpg' ? 'jpeg' : ext}`;

      // Step 1: Get R2 presigned upload URL
      setProgress(10);
      const { uploadUrl, storagePath } = await getR2UploadUrl({
        fileName: filename,
        contentType,
        folder: 'chat',
      });

      // Step 2: Upload file to R2
      setProgress(20);

      if (Platform.OS === 'web') {
        // Web: Use fetch/blob
        const response = await fetch(imageUri);
        const blob = await response.blob();

        const uploadResponse = await fetch(uploadUrl, {
          method: 'PUT',
          body: blob,
          headers: {
            'Content-Type': contentType,
          },
        });

        if (!uploadResponse.ok) {
          throw new Error(`Failed to upload image: ${uploadResponse.statusText}`);
        }

        setProgress(90);
      } else {
        // Native (iOS/Android): Use expo-file-system for proper file handling
        const uploadResult = await uploadAsync(uploadUrl, imageUri, {
          httpMethod: 'PUT',
          uploadType: FileSystemUploadType.BINARY_CONTENT,
          headers: {
            'Content-Type': contentType,
          },
        });

        if (uploadResult.status < 200 || uploadResult.status >= 300) {
          throw new Error(`Failed to upload image: ${uploadResult.status}`);
        }

        setProgress(90);
      }

      setUploading(false);
      setProgress(100);

      // Return the R2 storage path (e.g., "r2:chat/uuid-filename.jpg")
      // MessageItem will resolve this to a full URL using getMediaUrl
      return { url: storagePath };
    } catch (error) {
      console.error('[useImageUpload] Upload error:', error);
      setUploading(false);
      setProgress(0);

      return {
        url: '',
        error: error instanceof Error ? error.message : 'Failed to upload image',
      };
    }
  }, [getR2UploadUrl]);

  const reset = useCallback(() => {
    setUploading(false);
    setProgress(0);
  }, []);

  return {
    uploadImage,
    uploading,
    progress,
    reset,
  };
}
