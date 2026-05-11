/**
 * Hooks for Clearstream and Flodesk marketing integrations.
 *
 * These platforms use API keys (not OAuth) and sync community members into a
 * single destination list/segment chosen by the admin. The two integrations
 * have parallel shapes: status query, connect mutation, set-destination mutation,
 * list-destinations action, disconnect mutation.
 */

import { useAction, useMutation, useQuery } from "convex/react";
import { api, Id } from "@services/api/convex";
import { useAuth } from "@providers/AuthProvider";

// ============================================================================
// Clearstream
// ============================================================================

export function useClearstreamStatus(enabled = true) {
  const { token, community } = useAuth();
  const result = useQuery(
    api.functions.integrations.clearstream.status,
    enabled && token && community?.id
      ? { token, communityId: community.id as Id<"communities"> }
      : "skip",
  );
  return {
    data: result ?? null,
    isLoading: result === undefined && enabled,
  };
}

export function useConnectClearstream() {
  const connect = useMutation(api.functions.integrations.clearstream.connect);
  const { token, community } = useAuth();
  return async (args: {
    apiKey: string;
    listId?: string;
    listName?: string;
  }) => {
    if (!token || !community?.id) throw new Error("Not authenticated");
    return await connect({
      token,
      communityId: community.id as Id<"communities">,
      ...args,
    });
  };
}

export function useSetClearstreamList() {
  const setList = useMutation(
    api.functions.integrations.clearstream.setDestinationList,
  );
  const { token, community } = useAuth();
  return async (args: { listId: string; listName?: string }) => {
    if (!token || !community?.id) throw new Error("Not authenticated");
    return await setList({
      token,
      communityId: community.id as Id<"communities">,
      ...args,
    });
  };
}

export function useDisconnectClearstream() {
  const disconnect = useMutation(
    api.functions.integrations.clearstream.disconnect,
  );
  const { token, community } = useAuth();
  return async () => {
    if (!token || !community?.id) throw new Error("Not authenticated");
    return await disconnect({
      token,
      communityId: community.id as Id<"communities">,
    });
  };
}

export function useListClearstreamGroups() {
  const listGroups = useAction(
    api.functions.integrations.clearstream.listGroups,
  );
  const { token, community } = useAuth();
  return async (apiKey?: string) => {
    if (!token || !community?.id) throw new Error("Not authenticated");
    return await listGroups({
      token,
      communityId: community.id as Id<"communities">,
      apiKey,
    });
  };
}

// ============================================================================
// Flodesk
// ============================================================================

export function useFlodeskStatus(enabled = true) {
  const { token, community } = useAuth();
  const result = useQuery(
    api.functions.integrations.flodesk.status,
    enabled && token && community?.id
      ? { token, communityId: community.id as Id<"communities"> }
      : "skip",
  );
  return {
    data: result ?? null,
    isLoading: result === undefined && enabled,
  };
}

export function useConnectFlodesk() {
  const connect = useMutation(api.functions.integrations.flodesk.connect);
  const { token, community } = useAuth();
  return async (args: {
    apiKey: string;
    segmentId?: string;
    segmentName?: string;
  }) => {
    if (!token || !community?.id) throw new Error("Not authenticated");
    return await connect({
      token,
      communityId: community.id as Id<"communities">,
      ...args,
    });
  };
}

export function useSetFlodeskSegment() {
  const setSegment = useMutation(
    api.functions.integrations.flodesk.setDestinationSegment,
  );
  const { token, community } = useAuth();
  return async (args: { segmentId: string; segmentName?: string }) => {
    if (!token || !community?.id) throw new Error("Not authenticated");
    return await setSegment({
      token,
      communityId: community.id as Id<"communities">,
      ...args,
    });
  };
}

export function useDisconnectFlodesk() {
  const disconnect = useMutation(
    api.functions.integrations.flodesk.disconnect,
  );
  const { token, community } = useAuth();
  return async () => {
    if (!token || !community?.id) throw new Error("Not authenticated");
    return await disconnect({
      token,
      communityId: community.id as Id<"communities">,
    });
  };
}

export function useListFlodeskSegments() {
  const listSegments = useAction(
    api.functions.integrations.flodesk.listSegments,
  );
  const { token, community } = useAuth();
  return async (apiKey?: string) => {
    if (!token || !community?.id) throw new Error("Not authenticated");
    return await listSegments({
      token,
      communityId: community.id as Id<"communities">,
      apiKey,
    });
  };
}
