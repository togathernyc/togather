import { useState, useCallback } from "react";

/**
 * Hook to handle pull-to-refresh for groups
 *
 * Note: With Convex, queries are reactive and auto-update.
 * This hook maintains compatibility with existing refresh UI patterns
 * but the actual refresh is handled automatically by Convex subscriptions.
 */
export function useGroupRefresh(refetch?: () => void) {
  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);

    // With Convex, data is automatically synced in real-time.
    // The refetch param is kept for compatibility but Convex doesn't need it.
    // We just need to show the refresh indicator briefly.
    if (refetch) {
      refetch();
    }

    // Simulate a brief delay to show the refresh indicator
    await new Promise((resolve) => setTimeout(resolve, 300));

    setRefreshing(false);
  }, [refetch]);

  return {
    refreshing,
    onRefresh,
  };
}
