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
      let filename: string;
      let contentType: string;
      let webBlob: Blob | null = null;

      if (Platform.OS === 'web') {
        // Fetch the blob first so we can read its real MIME (expo-image-picker on web
        // returns extensionless blob: URIs, but the Blob object carries the correct type).
        const response = await fetch(imageUri);
        webBlob = await response.blob();
        contentType = webBlob.type || 'image/jpeg';
        const ext = contentType.split('/')[1] || 'jpg';
        const rawName = imageUri.split('/').pop() || 'chat-image';
        filename = /\.\w+$/.test(rawName) ? rawName : `${rawName}.${ext}`;
      } else {
        filename = imageUri.split('/').pop() || 'chat-image.jpg';
        const match = /\.(\w+)$/.exec(filename);
        const ext = match ? match[1].toLowerCase() : 'jpg';
        contentType = `image/${ext === 'jpg' ? 'jpeg' : ext}`;
      }

      setProgress(10);
      const { uploadUrl, storagePath } = await getR2UploadUrl({
        fileName: filename,
        contentType,
        folder: 'chat',
      });

      // Upload file to R2 (web requires R2 CORS to be configured)
      setProgress(20);

      if (Platform.OS === 'web') {
        const uploadResponse = await fetch(uploadUrl, {
          method: 'PUT',
          body: webBlob!,
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
