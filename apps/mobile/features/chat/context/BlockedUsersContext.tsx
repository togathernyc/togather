/**
 * Context for managing blocked users state across chat components.
 *
 * Provides:
 * - Set of blocked user IDs (Convex user IDs)
 * - Functions to check if a user is blocked
 * - Functions to update blocked users list
 *
 * Uses Convex messaging blocking functions instead of StreamChat.
 */
import React, { createContext, useContext, useState, useEffect, useCallback, useMemo, ReactNode } from 'react';
import { useAuth } from '@providers/AuthProvider';
import { useQuery, api } from '@services/api/convex';
import type { Id } from '@services/api/convex';

interface BlockedUsersContextValue {
  blockedUserIds: Set<string>;
  isLoading: boolean;
  isUserBlocked: (userId: string | undefined) => boolean;
  addBlockedUser: (userId: string) => void;
  removeBlockedUser: (userId: string) => void;
  refreshBlockedUsers: () => Promise<void>;
}

const BlockedUsersContext = createContext<BlockedUsersContextValue | null>(null);

export function BlockedUsersProvider({ children }: { children: ReactNode }) {
  const { token } = useAuth();
  const [blockedUserIds, setBlockedUserIds] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(true);

  // Fetch blocked users from Convex
  // useQuery returns data directly (or undefined when loading)
  const blockedUsers = useQuery(
    api.functions.messaging.blocking.getBlockedUsers,
    token ? { token } : "skip"
  );

  // Update local state when query data changes
  useEffect(() => {
    // Loading state: undefined means loading, defined means loaded (even if empty array)
    setIsLoading(blockedUsers === undefined && !!token);
    
    if (blockedUsers) {
      // blockedUsers is an array of user objects with _id
      const ids = new Set(blockedUsers.map(u => u._id));
      setBlockedUserIds(ids);
      console.log('[BlockedUsersContext] Loaded blocked users:', ids.size);
    }
  }, [blockedUsers, token]);

  // Refresh blocked users (re-fetch from Convex)
  const refreshBlockedUsers = useCallback(async () => {
    // The query will automatically refetch when token changes
    // This is mainly for manual refresh scenarios
    setIsLoading(true);
    // Query will update automatically via useQuery
  }, []);

  // Check if a user ID is blocked (accepts Convex ID or legacy ID)
  const isUserBlocked = useCallback((userId: string | undefined): boolean => {
    if (!userId) return false;
    return blockedUserIds.has(userId);
  }, [blockedUserIds]);

  // Add a user to blocked list (optimistic update)
  const addBlockedUser = useCallback((userId: string) => {
    setBlockedUserIds(prev => {
      const next = new Set(prev);
      next.add(userId);
      return next;
    });
    console.log('[BlockedUsersContext] Added blocked user:', userId);
  }, []);

  // Remove a user from blocked list (optimistic update)
  const removeBlockedUser = useCallback((userId: string) => {
    setBlockedUserIds(prev => {
      const next = new Set(prev);
      next.delete(userId);
      return next;
    });
    console.log('[BlockedUsersContext] Removed blocked user:', userId);
  }, []);

  const value = useMemo(() => ({
    blockedUserIds,
    isLoading,
    isUserBlocked,
    addBlockedUser,
    removeBlockedUser,
    refreshBlockedUsers,
  }), [blockedUserIds, isLoading, isUserBlocked, addBlockedUser, removeBlockedUser, refreshBlockedUsers]);

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
