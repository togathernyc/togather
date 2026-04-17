/**
 * useExploreFilters Hook
 *
 * Manages URL params for groups filters on the Groups tab.
 * Enables prefiltered links (e.g., share a URL with a specific group type filter).
 */

import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useCallback, useRef } from 'react';

export type DateFilterPreset = 'all' | 'today' | 'this_week' | 'this_month' | 'custom';

export interface ExploreFilters {
  // Groups filters
  groupType: string | number | null; // Support both Convex string IDs and legacy numeric IDs
  meetingType: number | null;
}

/**
 * Legacy filter shape that still powers the stand-alone `EventsFilterModal`
 * (used from the "Group events" modal screen). The Groups tab no longer owns
 * events filters, so this type is kept only to type-check the modal's props
 * without pulling the modal's filter shape into its own module.
 */
export interface EventsFilterShape {
  dateFilter: DateFilterPreset | null;
  startDate: string | null;
  endDate: string | null;
  hostingGroups: string[]; // Group IDs
}

export function useExploreFilters() {
  const params = useLocalSearchParams<Record<string, string>>();
  const router = useRouter();

  // Stabilize individual params to prevent unnecessary re-renders
  const stableGroupType = params.groupType || undefined;
  const stableMeetingType = params.meetingType || undefined;

  // Keep a ref to the previous filters to detect actual changes
  const prevFiltersRef = useRef<ExploreFilters | null>(null);

  // Parse URL params into typed filter state
  const filters = useMemo<ExploreFilters>(() => {
    // Parse groupType - keep as string if not numeric (Convex ID), otherwise convert to number
    let groupType: string | number | null = null;
    if (stableGroupType) {
      const numValue = Number(stableGroupType);
      groupType = isNaN(numValue) ? stableGroupType : numValue;
    }
    const newFilters: ExploreFilters = {
      groupType,
      meetingType: stableMeetingType ? Number(stableMeetingType) : null,
    };

    // Return previous filters if nothing actually changed (for referential stability)
    if (prevFiltersRef.current) {
      const prev = prevFiltersRef.current;
      if (
        newFilters.groupType === prev.groupType &&
        newFilters.meetingType === prev.meetingType
      ) {
        return prev;
      }
    }

    prevFiltersRef.current = newFilters;
    return newFilters;
  }, [stableGroupType, stableMeetingType]);

  // Build URL path with query string
  const buildUrl = useCallback((urlParams: Record<string, string>) => {
    const queryString = new URLSearchParams(urlParams).toString();
    return queryString ? `/(tabs)/search?${queryString}` : '/(tabs)/search';
  }, []);

  // Update URL params when filters change
  const setFilters = useCallback((updates: Partial<ExploreFilters>) => {
    const merged = { ...filters, ...updates };

    // Check if anything actually changed to prevent infinite loops
    const hasChanges =
      merged.groupType !== filters.groupType ||
      merged.meetingType !== filters.meetingType;

    if (!hasChanges) {
      return; // Skip URL update if nothing changed
    }

    // Build clean params object (omit null values)
    const urlParams: Record<string, string> = {};

    if (merged.groupType !== null) {
      urlParams.groupType = String(merged.groupType);
    }
    if (merged.meetingType !== null) {
      urlParams.meetingType = String(merged.meetingType);
    }

    // Use replace to completely replace URL (not merge params)
    router.replace(buildUrl(urlParams));
  }, [filters, router, buildUrl]);

  // Reset all group filters
  const resetFilters = useCallback(() => {
    router.replace(buildUrl({}));
  }, [router, buildUrl]);

  // Reset only group filters (alias of resetFilters, kept for call-site compatibility)
  const resetGroupFilters = useCallback(() => {
    setFilters({
      groupType: null,
      meetingType: null,
    });
  }, [setFilters]);

  // Check if any filters are active
  const hasActiveGroupFilters = filters.groupType !== null || filters.meetingType !== null;
  const hasActiveFilters = hasActiveGroupFilters;

  // Count active filters
  const activeGroupFilterCount =
    (filters.groupType !== null ? 1 : 0) +
    (filters.meetingType !== null ? 1 : 0);

  return {
    filters,
    setFilters,
    resetFilters,
    resetGroupFilters,
    hasActiveFilters,
    hasActiveGroupFilters,
    activeGroupFilterCount,
  };
}
