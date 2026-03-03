/**
 * Image upload utilities for chat messages
 *
 * Provides validation and helper functions for image uploads.
 * Actual upload logic is in useImageUpload hook which uses Convex storage.
 */

export interface ImageUploadResult {
  url: string;
  error?: string;
}

/**
 * Validate that an image URI is valid before upload
 *
 * @param imageUri - The image URI to validate
 * @returns true if valid, false otherwise
 */
export function isValidImageUri(imageUri: string): boolean {
  if (!imageUri) return false;

  // Check for local file URI (file://)
  if (imageUri.startsWith('file://')) return true;

  // Check for data URI (data:image/...)
  if (imageUri.startsWith('data:image/')) return true;

  // Check for content URI (content://) on Android
  if (imageUri.startsWith('content://')) return true;

  // Check for asset-library URI on iOS (older picker versions)
  if (imageUri.startsWith('assets-library://')) return true;

  // Check for ph:// URI on iOS (Photos framework)
  if (imageUri.startsWith('ph://')) return true;

  return false;
}

/**
 * Extract content type from image URI
 *
 * @param imageUri - The image URI to extract content type from
 * @returns Content type string (e.g., 'image/jpeg')
 */
export function getContentTypeFromUri(imageUri: string): string {
  const filename = imageUri.split('/').pop() || '';
  const match = /\.(\w+)$/.exec(filename);
  const ext = match ? match[1].toLowerCase() : 'jpg';

  const contentTypes: Record<string, string> = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    gif: 'image/gif',
    webp: 'image/webp',
    heic: 'image/heic',
    heif: 'image/heif',
  };

  return contentTypes[ext] || 'image/jpeg';
}

/**
 * Check if an image extension is supported
 *
 * @param filename - The filename or URI to check
 * @returns true if supported, false otherwise
 */
export function isSupportedImageType(filename: string): boolean {
  const supportedExtensions = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'heif'];
  const match = /\.(\w+)$/.exec(filename.toLowerCase());
  const ext = match ? match[1] : '';
  return supportedExtensions.includes(ext);
}
