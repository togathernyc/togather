/**
 * Context for managing blocked users state across chat components.
 *
 * Provides:
 * - Set of blocked user IDs (Convex user IDs)
 * - Function to check if a user is blocked
 *
 * State is derived directly from the Convex query. Convex's useQuery is
 * reactive — mutations trigger automatic re-fetches, so local optimistic
 * updates are unnecessary and would be overwritten on the next render.
 */
import React, { createContext, useContext, useCallback, useMemo, ReactNode } from 'react';
import { useQuery, api, useStoredAuthToken } from '@services/api/convex';

interface BlockedUsersContextValue {
  blockedUserIds: Set<string>;
  isLoading: boolean;
  isUserBlocked: (userId: string | undefined) => boolean;
}

const BlockedUsersContext = createContext<BlockedUsersContextValue | null>(null);

export function BlockedUsersProvider({ children }: { children: ReactNode }) {
  const token = useStoredAuthToken();

  const blockedUsers = useQuery(
    api.functions.messaging.blocking.getBlockedUsers,
    token ? { token } : "skip"
  );

  const blockedUserIds = useMemo(
    () => new Set<string>(blockedUsers?.map(u => u._id as string) ?? []),
    [blockedUsers]
  );

  const isLoading = blockedUsers === undefined && !!token;

  const isUserBlocked = useCallback(
    (userId: string | undefined): boolean => {
      if (!userId) return false;
      return blockedUserIds.has(userId);
    },
    [blockedUserIds]
  );

  const value = useMemo(
    () => ({ blockedUserIds, isLoading, isUserBlocked }),
    [blockedUserIds, isLoading, isUserBlocked]
  );

  return (
    <BlockedUsersContext.Provider value={value}>
      {children}
    </BlockedUsersContext.Provider>
  );
}

export function useBlockedUsersContext() {
  const context = useContext(BlockedUsersContext);
  if (!context) {
    throw new Error('useBlockedUsersContext must be used within a BlockedUsersProvider');
  }
  return context;
}

/**
 * Safe version that returns null outside provider (for use in shared components)
 */
export function useBlockedUsersContextSafe() {
  return useContext(BlockedUsersContext);
}
