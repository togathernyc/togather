/**
 * Shared utility functions for Convex functions
 */

import { DOMAIN_CONFIG } from "@togather/shared/config";

/**
 * Get the current timestamp in milliseconds
 * Convex stores timestamps as numbers (milliseconds since epoch)
 */
export function now(): number {
  return Date.now();
}

/**
 * Format a timestamp for display
 */
export function formatDate(timestamp: number): string {
  return new Date(timestamp).toISOString();
}

/**
 * Pagination helper for list queries
 */
export interface PaginationOptions {
  cursor?: string;
  limit?: number;
}

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

/**
 * Normalize pagination options
 */
export function normalizePagination(options: PaginationOptions): {
  limit: number;
} {
  const limit = Math.min(options.limit ?? DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
  return { limit };
}

/**
 * Generate a display name from first/last name
 */
export function getDisplayName(
  firstName?: string | null,
  lastName?: string | null,
  displayName?: string | null
): string {
  if (displayName) return displayName;
  if (firstName && lastName) return `${firstName} ${lastName}`;
  if (firstName) return firstName;
  if (lastName) return lastName;
  return "Anonymous";
}

/**
 * Check if a string is a valid phone number (basic validation)
 */
export function isValidPhone(phone: string): boolean {
  // Remove all non-digit characters
  const digits = phone.replace(/\D/g, "");
  // Check for valid length (10-15 digits)
  return digits.length >= 10 && digits.length <= 15;
}

/**
 * Normalize phone number to E.164 format
 */
export function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  // Assume US number if 10 digits
  if (digits.length === 10) {
    return `+1${digits}`;
  }
  // Add + if not present
  if (!phone.startsWith("+")) {
    return `+${digits}`;
  }
  return `+${digits}`;
}

// ============================================================================
// JSON-Safe String Helpers
// ============================================================================

/**
 * Slice a string for JSON-safe serialization without cutting UTF-16 surrogate pairs.
 * JavaScript's slice() can split emoji/supplementary chars (stored as surrogate pairs),
 * leaving a lone high surrogate. When JSON-serialized, that produces invalid JSON
 * ("unexpected end of hex escape") because \uD800-\uDBFF must be followed by \uDC00-\uDFFF.
 */
export function safeSliceForJson(str: string, maxLen: number): string {
  if (!str || str.length <= maxLen) return str;
  let sliced = str.slice(0, maxLen);
  const lastCode = sliced.charCodeAt(sliced.length - 1);
  if (lastCode >= 0xd800 && lastCode <= 0xdbff) {
    sliced = sliced.slice(0, -1);
  }
  return sliced;
}

// ============================================================================
// User Search Helpers
// ============================================================================

/**
 * Build searchText field for full-text search on users
 * This combines firstName, lastName, email, and phone into a single searchable string
 * Used by the search_users index for efficient user search
 */
export function buildSearchText(user: {
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  phone?: string | null;
}): string {
  return [
    user.firstName || "",
    user.lastName || "",
    user.email || "",
    user.phone || "",
  ]
    .join(" ")
    .toLowerCase()
    .trim();
}

// ============================================================================
// Short ID Generation
// ============================================================================

/**
 * Generate a short ID for URLs (meetings, events, etc.)
 * Uses a combination of timestamp and random characters.
 * Format: 4 chars from timestamp (base36) + 5 random alphanumeric chars = 9 chars total
 */
export function generateShortId(): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  const timestamp = Date.now().toString(36).slice(-4);
  let random = "";
  for (let i = 0; i < 5; i++) {
    random += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return timestamp + random;
}

// ============================================================================
// Media URL Helpers
// ============================================================================

/**
 * Get media URL for a path
 * Supports R2 and full URLs
 */
export function getMediaUrl(path: string | null | undefined): string | undefined {
  if (!path) {
    return undefined;
  }

  // If it's already a full URL, return it as-is
  if (path.startsWith("http://") || path.startsWith("https://")) {
    return path;
  }

  // R2 storage (new format with r2: prefix)
  if (path.startsWith("r2:")) {
    const r2PublicUrl = process.env.R2_PUBLIC_URL;
    if (!r2PublicUrl) {
      console.warn("R2_PUBLIC_URL not configured");
      return undefined;
    }
    const r2Path = path.slice(3); // Remove "r2:" prefix
    return `${r2PublicUrl}/${r2Path}`;
  }

  // Unrecognized path format
  return undefined;
}

/**
 * Get media URL with Cloudflare Image Transformations
 * Only works for R2 images served via the image CDN (R2_PUBLIC_URL)
 *
 * @param path - The stored path (r2:path format)
 * @param options - Transformation options (width, height, fit, quality)
 * @returns Transformed image URL or base URL if transforms not available
 */
export function getMediaUrlWithTransform(
  path: string | null | undefined,
  options: {
    width?: number;
    height?: number;
    fit?: "cover" | "contain" | "scale-down" | "crop";
    quality?: number;
  } = {}
): string | undefined {
  const baseUrl = getMediaUrl(path);
  if (!baseUrl) return undefined;

  // Only apply transforms to R2 images (served via R2_PUBLIC_URL)
  const r2PublicUrl = process.env.R2_PUBLIC_URL;
  if (!r2PublicUrl || !baseUrl.startsWith(r2PublicUrl)) {
    return baseUrl; // Legacy images or R2 not configured - no transforms available
  }

  // Build transform options
  const transforms: string[] = [];
  if (options.width) transforms.push(`width=${options.width}`);
  if (options.height) transforms.push(`height=${options.height}`);
  if (options.fit) transforms.push(`fit=${options.fit}`);
  if (options.quality) transforms.push(`quality=${options.quality}`);
  transforms.push("format=auto"); // Always optimize format (WebP/AVIF)

  const transformString = transforms.join(",");

  // Cloudflare transform URL format:
  // https://{baseDomain}/cdn-cgi/image/{transforms}/{image-url}
  return `https://${DOMAIN_CONFIG.baseDomain}/cdn-cgi/image/${transformString}/${baseUrl}`;
}

/**
 * Preset transformations for common use cases
 */
export const ImagePresets = {
  /** Small avatar (100x100) */
  avatarSmall: { width: 100, height: 100, fit: "cover" as const },
  /** Medium avatar (200x200) */
  avatarMedium: { width: 200, height: 200, fit: "cover" as const },
  /** Card/list thumbnail (400x300) */
  thumbnail: { width: 400, height: 300, fit: "cover" as const },
  /** Full image with optimization */
  optimized: { quality: 85 },
} as const;

// ============================================================================
// OAuth Token Helpers
// ============================================================================

/**
 * Check if an OAuth access token is expired.
 * Adds a 5-minute (300 second) buffer to refresh before actual expiry.
 * This accounts for clock skew between servers and network latency during refresh.
 *
 * @param createdAt - The timestamp (in seconds) when the token was created
 * @param expiresIn - The token's lifetime in seconds
 * @returns true if the token is expired or will expire within 5 minutes
 */
export function isTokenExpired(createdAt: number, expiresIn: number): boolean {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const expiresAt = createdAt + expiresIn;
  return nowSeconds >= expiresAt - 300;
}
