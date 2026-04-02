/**
 * useExploreFilters Hook
 *
 * Manages URL params for both groups and events filters in the Explore tab.
 * Enables prefiltered links (e.g., from group chat → events for that group).
 */

import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useCallback, useRef } from 'react';

export type DateFilterPreset = 'today' | 'this_week' | 'this_month' | 'custom';
export type ExploreView = 'groups' | 'events';
export type ExploreMode = 'groups' | 'events' | undefined;

export interface ExploreFilters {
  view: ExploreView;
  // Mode locks the view and hides the toggle (for deep-linking from group context)
  mode: ExploreMode;
  // Groups filters
  groupType: string | number | null; // Support both Convex string IDs and legacy numeric IDs
  meetingType: number | null;
  // Events filters
  dateFilter: DateFilterPreset | null;
  startDate: string | null;
  endDate: string | null;
  hostingGroups: string[]; // Group IDs
}

const defaultFilters: ExploreFilters = {
  view: 'groups',
  mode: undefined,
  groupType: null,
  meetingType: null,
  dateFilter: null,
  startDate: null,
  endDate: null,
  hostingGroups: [],
};

export function useExploreFilters() {
  const params = useLocalSearchParams<Record<string, string>>();
  const router = useRouter();

  // Stabilize individual params to prevent unnecessary re-renders
  const stableView = params.view || undefined;
  const stableMode = params.mode || undefined;
  const stableGroupType = params.groupType || undefined;
  const stableMeetingType = params.meetingType || undefined;
  const stableDateFilter = params.dateFilter || undefined;
  const stableStartDate = params.startDate || undefined;
  const stableEndDate = params.endDate || undefined;
  const stableHostingGroups = params.hostingGroups || undefined;

  // Keep a ref to the previous filters to detect actual changes
  const prevFiltersRef = useRef<ExploreFilters | null>(null);

  // Parse URL params into typed filter state
  const filters = useMemo<ExploreFilters>(() => {
    const mode = (stableMode as ExploreMode) || undefined;
    // When mode is set, it locks the view to that mode
    const view = mode || (stableView as ExploreView) || 'groups';
    // Parse groupType - keep as string if not numeric (Convex ID), otherwise convert to number
    let groupType: string | number | null = null;
    if (stableGroupType) {
      const numValue = Number(stableGroupType);
      groupType = isNaN(numValue) ? stableGroupType : numValue;
    }
    const newFilters: ExploreFilters = {
      view,
      mode,
      groupType,
      meetingType: stableMeetingType ? Number(stableMeetingType) : null,
      dateFilter: (stableDateFilter as DateFilterPreset) || null,
      startDate: stableStartDate || null,
      endDate: stableEndDate || null,
      hostingGroups: stableHostingGroups?.split(',').filter(Boolean) || [],
    };

    // Return previous filters if nothing actually changed (for referential stability)
    if (prevFiltersRef.current) {
      const prev = prevFiltersRef.current;
      const hostingGroupsEqual =
        newFilters.hostingGroups.length === prev.hostingGroups.length &&
        newFilters.hostingGroups.every((g, i) => g === prev.hostingGroups[i]);

      if (
        newFilters.view === prev.view &&
        newFilters.mode === prev.mode &&
        newFilters.groupType === prev.groupType &&
        newFilters.meetingType === prev.meetingType &&
        newFilters.dateFilter === prev.dateFilter &&
        newFilters.startDate === prev.startDate &&
        newFilters.endDate === prev.endDate &&
        hostingGroupsEqual
      ) {
        return prev;
      }
    }

    prevFiltersRef.current = newFilters;
    return newFilters;
  }, [
    stableView,
    stableMode,
    stableGroupType,
    stableMeetingType,
    stableDateFilter,
    stableStartDate,
    stableEndDate,
    stableHostingGroups,
  ]);

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
      merged.view !== filters.view ||
      merged.mode !== filters.mode ||
      merged.groupType !== filters.groupType ||
      merged.meetingType !== filters.meetingType ||
      merged.dateFilter !== filters.dateFilter ||
      merged.startDate !== filters.startDate ||
      merged.endDate !== filters.endDate ||
      merged.hostingGroups.length !== filters.hostingGroups.length ||
      merged.hostingGroups.some((g, i) => g !== filters.hostingGroups[i]);

    if (!hasChanges) {
      return; // Skip URL update if nothing changed
    }

    // Build clean params object (omit null/default values)
    const urlParams: Record<string, string> = {};

    // Mode - preserve if set (locks the view)
    if (merged.mode) {
      urlParams.mode = merged.mode;
    }

    // View - always include so router.replace explicitly sets it
    if (!merged.mode) {
      urlParams.view = merged.view;
    }

    // Groups filters
    if (merged.groupType !== null) {
      urlParams.groupType = String(merged.groupType);
    }
    if (merged.meetingType !== null) {
      urlParams.meetingType = String(merged.meetingType);
    }

    // Events filters
    if (merged.dateFilter !== null) {
      urlParams.dateFilter = merged.dateFilter;
    }
    if (merged.startDate !== null) {
      urlParams.startDate = merged.startDate;
    }
    if (merged.endDate !== null) {
      urlParams.endDate = merged.endDate;
    }
    if (merged.hostingGroups.length > 0) {
      urlParams.hostingGroups = merged.hostingGroups.join(',');
    }

    // Use replace to completely replace URL (not merge params)
    router.replace(buildUrl(urlParams));
  }, [filters, router, buildUrl]);

  // Reset all filters (keeps current view and mode)
  const resetFilters = useCallback(() => {
    const urlParams: Record<string, string> = {};
    if (filters.mode) {
      urlParams.mode = filters.mode;
    } else {
      urlParams.view = filters.view;
    }
    router.replace(buildUrl(urlParams));
  }, [filters.view, filters.mode, router, buildUrl]);

  // Reset only group filters
  const resetGroupFilters = useCallback(() => {
    setFilters({
      groupType: null,
      meetingType: null,
    });
  }, [setFilters]);

  // Reset only event filters
  const resetEventFilters = useCallback(() => {
    setFilters({
      dateFilter: null,
      startDate: null,
      endDate: null,
      hostingGroups: [],
    });
  }, [setFilters]);

  // Check if any filters are active
  const hasActiveGroupFilters = filters.groupType !== null || filters.meetingType !== null;
  const hasActiveEventFilters =
    filters.dateFilter !== null ||
    filters.startDate !== null ||
    filters.endDate !== null ||
    filters.hostingGroups.length > 0;
  const hasActiveFilters = hasActiveGroupFilters || hasActiveEventFilters;

  // Count active filters
  const activeGroupFilterCount =
    (filters.groupType !== null ? 1 : 0) +
    (filters.meetingType !== null ? 1 : 0);
  const activeEventFilterCount =
    (filters.dateFilter !== null ? 1 : 0) +
    (filters.hostingGroups.length > 0 ? 1 : 0);

  // Mode is locked when navigating from a specific context (e.g., group → events)
  const isModeLocked = filters.mode !== undefined;

  return {
    filters,
    setFilters,
    resetFilters,
    resetGroupFilters,
    resetEventFilters,
    hasActiveFilters,
    hasActiveGroupFilters,
    hasActiveEventFilters,
    activeGroupFilterCount,
    activeEventFilterCount,
    isModeLocked,
  };
}
