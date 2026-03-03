/**
 * Hooks for managing integrations.
 *
 * These hooks provide access to community integrations data via Convex.
 */

import { useQuery } from "convex/react";
import { api, Id } from "@services/api/convex";
import { useAuth } from "@providers/AuthProvider";

/**
 * Fetch Planning Center connection status.
 *
 * @param enabled - Whether the query should run (default: true)
 */
export function usePlanningCenterStatus(enabled = true) {
  const { token, community } = useAuth();

  const result = useQuery(
    api.functions.integrations.planningCenterStatus,
    enabled && token && community?.id
      ? { token, communityId: community.id as Id<"communities"> }
      : "skip"
  );

  // Transform the result to match expected interface
  const data = result
    ? {
        is_connected: result.isConnected,
        status: result.status,
        last_sync_at: result.lastSyncAt,
        last_error: result.lastError,
        token_expires_at: result.tokenExpiresAt,
        is_token_expired: result.isTokenExpired,
        connected_by: result.connectedBy,
      }
    : {
        is_connected: false,
        status: null,
        last_sync_at: null,
        last_error: null,
        token_expires_at: null,
        is_token_expired: false,
        connected_by: null,
      };

  return {
    data,
    isLoading: result === undefined && enabled,
    isError: false,
    error: null,
    // Note: Convex queries auto-update, no manual refetch needed
    refetch: async () => {},
  };
}

/**
 * Fetch all available integration types with connection status.
 *
 * @param enabled - Whether the query should run (default: true)
 */
export function useAvailableIntegrations(enabled = true) {
  const { token, community } = useAuth();

  const result = useQuery(
    api.functions.integrations.listAvailable,
    enabled && token && community?.id
      ? { token, communityId: community.id as Id<"communities"> }
      : "skip"
  );

  // Transform the result to match expected interface
  const data = result?.map((item) => ({
    type: item.type,
    display_name: item.displayName,
    description: item.description,
    is_connected: item.isConnected,
    status: item.status,
  })) ?? [
    {
      type: "planning_center",
      display_name: "Planning Center",
      description: "Sync members and groups with Planning Center",
      is_connected: false,
      status: null,
    },
  ];

  return {
    data,
    isLoading: result === undefined && enabled,
    isRefetching: false,
    isError: false,
    error: null,
    refetch: async () => {},
  };
}

/**
 * Fetch all integrations for the current community.
 *
 * @param enabled - Whether the query should run (default: true)
 */
export function useIntegrations(enabled = true) {
  // For now, just use the available integrations query
  // In the future, this could return more detailed integration data
  const { data, isLoading, isError, error } = useAvailableIntegrations(enabled);

  return {
    data,
    isLoading,
    isError,
    error,
    refetch: async () => {},
  };
}
