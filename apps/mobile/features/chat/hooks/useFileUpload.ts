/**
 * Hook for uploading files in chat messages
 *
 * Provides file upload functionality with progress tracking and state management.
 * Uses Cloudflare R2 for file uploads. Supports documents, audio, and video files.
 *
 * Requires expo-document-picker native module to be available.
 */

import { useState, useCallback } from 'react';
import { Platform } from 'react-native';
import { uploadAsync, FileSystemUploadType } from 'expo-file-system/legacy';
import { useAuthenticatedAction, api } from '@services/api/convex';
import {
  validateFileForUpload,
  getFileCategoryFromFilename,
  isDocumentPickerSupported,
  type FileCategory,
} from '../utils/fileTypes';

// ============================================================================
// Types
// ============================================================================

export interface FileUploadResult {
  /** The storage path (r2:...) to store in the message attachment */
  storagePath: string;
  /** The file name */
  name: string;
  /** The file category (document, audio, video) */
  category: FileCategory;
  /** Error message if upload failed */
  error?: string;
}

export interface SelectedFile {
  uri: string;
  name: string;
  size: number;
  mimeType: string;
}

export interface UseFileUploadResult {
  /** Upload a file and return the storage path */
  uploadFile: (file: SelectedFile) => Promise<FileUploadResult>;
  /** Current upload status */
  uploading: boolean;
  /** Upload progress (0-100) */
  progress: number;
  /** Reset upload state */
  reset: () => void;
  /** Whether document picker is available (native module check) */
  isAvailable: boolean;
}

// ============================================================================
// Hook
// ============================================================================

/**
 * Hook for uploading files with progress tracking
 *
 * Uses Cloudflare R2 for file uploads:
 * 1. Validates file type and size
 * 2. Gets presigned upload URL from Convex (via R2)
 * 3. Client uploads file directly to R2
 * 4. Returns the R2 storage path for the message attachment
 *
 * @returns Object containing upload function, state, and progress
 *
 * @example
 * ```tsx
 * const { uploadFile, uploading, progress, isAvailable } = useFileUpload();
 *
 * if (!isAvailable) {
 *   return <Text>Update app to use file uploads</Text>;
 * }
 *
 * const handleFilePick = async (file: SelectedFile) => {
 *   const result = await uploadFile(file);
 *   if (result.error) {
 *     Alert.alert('Upload Failed', result.error);
 *   } else {
 *     console.log('Uploaded to:', result.storagePath);
 *   }
 * };
 * ```
 */
export function useFileUpload(): UseFileUploadResult {
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);

  const getR2FileUploadUrl = useAuthenticatedAction(api.functions.uploads.getR2FileUploadUrl);

  const isAvailable = isDocumentPickerSupported();

  const uploadFile = useCallback(async (file: SelectedFile): Promise<FileUploadResult> => {
    // Validate file
    const validation = validateFileForUpload({
      name: file.name,
      size: file.size,
      mimeType: file.mimeType,
    });

    if (!validation.valid) {
      return {
        storagePath: '',
        name: file.name,
        category: 'unknown',
        error: validation.error,
      };
    }

    const category = getFileCategoryFromFilename(file.name);

    setUploading(true);
    setProgress(0);

    try {
      // Step 1: Get R2 presigned upload URL
      setProgress(10);
      const { uploadUrl, storagePath } = await getR2FileUploadUrl({
        fileName: file.name,
        contentType: file.mimeType,
        fileSize: file.size,
        folder: 'chat',
      });

      // Step 2: Upload file to R2
      setProgress(20);

      if (Platform.OS === 'web') {
        // Web: Use fetch/blob
        const response = await fetch(file.uri);
        const blob = await response.blob();

        const uploadResponse = await fetch(uploadUrl, {
          method: 'PUT',
          body: blob,
          headers: {
            'Content-Type': file.mimeType,
          },
        });

        if (!uploadResponse.ok) {
          throw new Error(`Failed to upload file: ${uploadResponse.statusText}`);
        }

        setProgress(90);
      } else {
        // Native (iOS/Android): Use expo-file-system for proper file handling
        const uploadResult = await uploadAsync(uploadUrl, file.uri, {
          httpMethod: 'PUT',
          uploadType: FileSystemUploadType.BINARY_CONTENT,
          headers: {
            'Content-Type': file.mimeType,
          },
        });

        if (uploadResult.status < 200 || uploadResult.status >= 300) {
          throw new Error(`Failed to upload file: ${uploadResult.status}`);
        }

        setProgress(90);
      }

      setUploading(false);
      setProgress(100);

      return {
        storagePath,
        name: file.name,
        category,
      };
    } catch (error) {
      console.error('[useFileUpload] Upload error:', error);
      setUploading(false);
      setProgress(0);

      return {
        storagePath: '',
        name: file.name,
        category,
        error: error instanceof Error ? error.message : 'Failed to upload file',
      };
    }
  }, [getR2FileUploadUrl]);

  const reset = useCallback(() => {
    setUploading(false);
    setProgress(0);
  }, []);

  return {
    uploadFile,
    uploading,
    progress,
    reset,
    isAvailable,
  };
}
