/**
 * Media URL utilities for the mobile app
 *
 * Mirrors the backend getMediaUrl logic from apps/convex/lib/utils.ts
 * to resolve storage paths (r2:, s3 legacy) to full URLs on the client.
 */

// R2 public URL - this is the Cloudflare CDN endpoint for images
const R2_PUBLIC_URL = process.env.EXPO_PUBLIC_IMAGE_CDN_URL || 'https://images.togather.nyc';

// Legacy S3 bucket URL (for backwards compatibility with old images)
const S3_BUCKET_URL = process.env.EXPO_PUBLIC_LEGACY_S3_URL || 'https://togather-s3.s3.us-east-1.amazonaws.com';

/**
 * Convert a stored media path to a full URL
 *
 * Supports:
 * - Full URLs (http:// or https://) - returned as-is
 * - R2 paths (r2:folder/file.jpg) - converted to R2 CDN URL
 * - Legacy S3 paths (folder/file.jpg) - converted to S3 URL
 *
 * @param path - The stored path or URL
 * @returns Full URL string, or undefined if path is empty
 *
 * @example
 * getMediaUrl('r2:profiles/abc-123.jpg')
 * // => '{R2_PUBLIC_URL}/profiles/abc-123.jpg'
 *
 * getMediaUrl('https://example.com/image.jpg')
 * // => 'https://example.com/image.jpg'
 *
 * getMediaUrl('images/profiles/old-photo.jpg')
 * // => '{S3_BUCKET_URL}/images/profiles/old-photo.jpg'
 */
export function getMediaUrl(path: string | null | undefined): string | undefined {
  if (!path) {
    return undefined;
  }

  // If it's already a full URL, return as-is
  if (path.startsWith('http://') || path.startsWith('https://')) {
    return path;
  }

  // Local file URIs (from image picker) - return as-is for preview
  if (path.startsWith('file://')) {
    return path;
  }

  // R2 storage (new format with r2: prefix)
  if (path.startsWith('r2:')) {
    const r2Path = path.slice(3); // Remove "r2:" prefix
    return `${R2_PUBLIC_URL}/${r2Path}`;
  }

  // Legacy S3 path (backwards compatibility)
  return `${S3_BUCKET_URL}/${path}`;
}

/**
 * Get media URL with Cloudflare Image Transformations
 *
 * Only works for R2 images. Falls back to base URL for legacy images.
 *
 * @param path - The stored path or URL
 * @param options - Transformation options
 * @returns Transformed image URL
 *
 * @example
 * getMediaUrlWithTransform('r2:profiles/abc.jpg', { width: 100, height: 100 })
 * // => '{R2_PUBLIC_URL}/cdn-cgi/image/width=100,height=100,fit=cover,format=auto/profiles/abc.jpg'
 */
export function getMediaUrlWithTransform(
  path: string | null | undefined,
  options: {
    width?: number;
    height?: number;
    fit?: 'cover' | 'contain' | 'scale-down' | 'crop';
    quality?: number;
  } = {}
): string | undefined {
  const baseUrl = getMediaUrl(path);
  if (!baseUrl) return undefined;

  // Only apply transforms to R2 images
  if (!baseUrl.startsWith(R2_PUBLIC_URL)) {
    return baseUrl; // Legacy images - no transforms available
  }

  // Build transform options
  const transforms: string[] = [];
  if (options.width) transforms.push(`width=${options.width}`);
  if (options.height) transforms.push(`height=${options.height}`);
  if (options.fit) transforms.push(`fit=${options.fit}`);
  if (options.quality) transforms.push(`quality=${options.quality}`);
  transforms.push('format=auto'); // Always optimize format (WebP/AVIF)

  const transformString = transforms.join(',');

  // Extract the path from the full R2 URL for same-zone transformation
  // e.g., "{R2_PUBLIC_URL}/profiles/abc.jpg" -> "profiles/abc.jpg"
  const imagePath = baseUrl.replace(`${R2_PUBLIC_URL}/`, '');

  // Cloudflare Image Transformations URL format (same-zone)
  // Use R2_PUBLIC_URL since that's where the R2 bucket is configured
  return `${R2_PUBLIC_URL}/cdn-cgi/image/${transformString}/${imagePath}`;
}

/**
 * Preset transformations for common use cases
 */
export const ImagePresets = {
  /** Small avatar (100x100) */
  avatarSmall: { width: 100, height: 100, fit: 'cover' as const },
  /** Medium avatar (200x200) */
  avatarMedium: { width: 200, height: 200, fit: 'cover' as const },
  /** Card/list thumbnail (400x300) */
  thumbnail: { width: 400, height: 300, fit: 'cover' as const },
  /** Chat image preview */
  chatPreview: { width: 600, quality: 85 },
  /** Full image with optimization */
  optimized: { quality: 85 },
} as const;
