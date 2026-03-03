/**
 * Hook for fetching link previews
 *
 * Fetches Open Graph metadata for URLs to display preview cards in chat.
 * Includes in-memory caching to avoid redundant fetches.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { Environment } from '@services/environment';

// ============================================================================
// Types
// ============================================================================

export interface LinkPreviewData {
  url: string;
  title?: string;
  description?: string;
  image?: string;
  siteName?: string;
  favicon?: string;
}

export interface UseLinkPreviewResult {
  preview: LinkPreviewData | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
  dismiss: () => void;
  isDismissed: boolean;
}

// ============================================================================
// Cache
// ============================================================================

// In-memory cache for link previews (persists across component mounts)
const previewCache = new Map<string, LinkPreviewData | null>();

// Cache duration (15 minutes)
const CACHE_DURATION_MS = 15 * 60 * 1000;

// Track cache timestamps
const cacheTimestamps = new Map<string, number>();

/**
 * Check if a cached entry is still valid
 */
function isCacheValid(url: string): boolean {
  const timestamp = cacheTimestamps.get(url);
  if (!timestamp) return false;
  return Date.now() - timestamp < CACHE_DURATION_MS;
}

/**
 * Get cached preview if valid
 */
function getCachedPreview(url: string): LinkPreviewData | null | undefined {
  if (isCacheValid(url)) {
    return previewCache.get(url);
  }
  // Clear stale cache
  previewCache.delete(url);
  cacheTimestamps.delete(url);
  return undefined;
}

/**
 * Set cached preview
 */
function setCachedPreview(url: string, preview: LinkPreviewData | null): void {
  previewCache.set(url, preview);
  cacheTimestamps.set(url, Date.now());
}

// ============================================================================
// Hook
// ============================================================================

/**
 * Hook to fetch link preview for a URL
 *
 * @param url - The URL to fetch preview for (or null to skip)
 * @returns Object with preview data, loading state, error, and control functions
 *
 * @example
 * ```tsx
 * const { preview, loading, error, dismiss } = useLinkPreview(url);
 *
 * if (loading) return <ActivityIndicator />;
 * if (preview && !isDismissed) {
 *   return <LinkPreviewCard preview={preview} onDismiss={dismiss} />;
 * }
 * ```
 */
export function useLinkPreview(url: string | null): UseLinkPreviewResult {
  // Initialize state from cache synchronously to avoid flash of empty state
  const initialCached = url ? getCachedPreview(url) : undefined;
  const hasInitialCache = initialCached !== undefined;

  const [preview, setPreview] = useState<LinkPreviewData | null>(
    hasInitialCache ? (initialCached ?? null) : null
  );
  const [loading, setLoading] = useState(!hasInitialCache && !!url);
  const [error, setError] = useState<string | null>(
    hasInitialCache && initialCached === null ? 'Failed to fetch preview' : null
  );
  const [isDismissed, setIsDismissed] = useState(false);

  // Track current fetch to avoid race conditions
  const fetchIdRef = useRef(0);

  const fetchPreview = useCallback(async () => {
    if (!url) {
      setPreview(null);
      setLoading(false);
      setError(null);
      return;
    }

    // Check cache first
    const cached = getCachedPreview(url);
    if (cached !== undefined) {
      setPreview(cached);
      setLoading(false);
      setError(cached === null ? 'Failed to fetch preview' : null);
      return;
    }

    // Start fetch
    setLoading(true);
    setError(null);

    const currentFetchId = ++fetchIdRef.current;

    try {
      // Get the Convex HTTP URL
      const baseUrl = Environment.getApiBaseUrl();
      const encodedUrl = encodeURIComponent(url);
      const endpoint = `${baseUrl}/api/link-preview?url=${encodedUrl}`;

      const response = await fetch(endpoint, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
        },
      });

      // Check if this fetch is still relevant
      if (currentFetchId !== fetchIdRef.current) {
        return;
      }

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `HTTP ${response.status}`);
      }

      const data: LinkPreviewData = await response.json();

      // Cache the result
      setCachedPreview(url, data);

      // Update state
      setPreview(data);
      setLoading(false);
    } catch (err) {
      // Check if this fetch is still relevant
      if (currentFetchId !== fetchIdRef.current) {
        return;
      }

      console.warn('[useLinkPreview] Failed to fetch:', url, err);

      // Cache the failure to avoid repeated fetches
      setCachedPreview(url, null);

      setPreview(null);
      setLoading(false);
      setError(err instanceof Error ? err.message : 'Failed to fetch preview');
    }
  }, [url]);

  // Reset dismissed state when URL changes
  useEffect(() => {
    setIsDismissed(false);
  }, [url]);

  // Fetch on mount and URL change
  useEffect(() => {
    fetchPreview();
  }, [fetchPreview]);

  const dismiss = useCallback(() => {
    setIsDismissed(true);
  }, []);

  const refetch = useCallback(() => {
    // Clear cache for this URL and refetch
    if (url) {
      previewCache.delete(url);
      cacheTimestamps.delete(url);
    }
    setIsDismissed(false);
    fetchPreview();
  }, [url, fetchPreview]);

  return {
    preview,
    loading,
    error,
    refetch,
    dismiss,
    isDismissed,
  };
}

/**
 * Clear the entire link preview cache
 * Useful for testing or when the user logs out
 */
export function clearLinkPreviewCache(): void {
  previewCache.clear();
  cacheTimestamps.clear();
}

/**
 * Batch fetch link previews for multiple URLs
 * Returns a Map of URL -> preview data
 *
 * @param urls - Array of URLs to fetch previews for
 * @returns Promise resolving to Map<url, LinkPreviewData | null>
 */
export async function fetchLinkPreviewBatch(
  urls: string[]
): Promise<Map<string, LinkPreviewData | null>> {
  const results = new Map<string, LinkPreviewData | null>();

  if (urls.length === 0) {
    return results;
  }

  // Deduplicate URLs
  const uniqueUrls = [...new Set(urls)];

  // Check cache first, collect uncached URLs
  const uncachedUrls: string[] = [];
  for (const url of uniqueUrls) {
    const cached = getCachedPreview(url);
    if (cached !== undefined) {
      results.set(url, cached);
    } else {
      uncachedUrls.push(url);
    }
  }

  // Fetch uncached URLs in parallel
  const fetchPromises = uncachedUrls.map(async (url) => {
    try {
      const baseUrl = Environment.getApiBaseUrl();
      const encodedUrl = encodeURIComponent(url);
      const endpoint = `${baseUrl}/api/link-preview?url=${encodedUrl}`;

      const response = await fetch(endpoint, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
        },
      });

      if (!response.ok) {
        setCachedPreview(url, null);
        return { url, preview: null };
      }

      const data: LinkPreviewData = await response.json();
      setCachedPreview(url, data);
      return { url, preview: data };
    } catch (err) {
      console.warn('[fetchLinkPreviewBatch] Failed to fetch:', url, err);
      setCachedPreview(url, null);
      return { url, preview: null };
    }
  });

  const fetchResults = await Promise.all(fetchPromises);

  for (const { url, preview } of fetchResults) {
    results.set(url, preview);
  }

  return results;
}

/**
 * Get cached preview synchronously (for components that have prefetched data)
 */
export function getCachedLinkPreview(url: string): LinkPreviewData | null | undefined {
  return getCachedPreview(url);
}

/**
 * Set cached preview (for prefetch system to populate cache)
 */
export function setCachedLinkPreview(url: string, preview: LinkPreviewData | null): void {
  setCachedPreview(url, preview);
}
