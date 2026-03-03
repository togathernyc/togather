/**
 * Hook for handling chat list refresh.
 *
 * With Convex, queries are reactive and auto-update in real-time,
 * so explicit invalidation isn't typically needed. This hook provides
 * a simple refreshing state for UI feedback during pull-to-refresh gestures.
 *
 * Note: Convex queries automatically sync when data changes on the backend,
 * so the refresh action is primarily for user-initiated refresh gestures
 * to provide visual feedback.
 */
import { useState, useCallback } from "react";

export function useChatRefresh() {
  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);

    // Convex queries are reactive - data updates automatically
    // This delay provides visual feedback for the refresh gesture
    // In practice, Convex will have already synced any new data
    await new Promise((resolve) => setTimeout(resolve, 500));

    setRefreshing(false);
  }, []);

  return {
    refreshing,
    onRefresh,
  };
}
