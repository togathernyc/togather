import { useCallback, useMemo } from "react";
import { useQuery, api } from "@services/api/convex";
import { useAuth } from "@providers/AuthProvider";
import { sortChatRooms } from "../utils/sortChatRooms";
import type { ChatRoom } from "../types";
import type { Id } from "@services/api/convex";

export function useChatRooms(enabled: boolean = true) {
  const { user, token } = useAuth();
  const userId = user?.id as Id<"users"> | undefined;

  // Memoize query args to prevent unnecessary re-renders
  const queryArgs = useMemo(() => {
    if (!enabled || !userId || !token) {
      return "skip" as const;
    }
    return { token, pageSize: 50 };
  }, [enabled, userId, token]);

  // Convex queries auto-update in real-time, so no need for refetchOnMount/refetchOnWindowFocus
  const rawData = useQuery(
    api.functions.messaging.channels.getUserChannels,
    queryArgs
  );

  // Transform and sort the data
  const data = useMemo(() => {
    if (!rawData) return undefined;

    // Map the Convex response to ChatRoom type
    const mapped = rawData.map((room) => ({
      ...room,
      type: 1, // Default chat room type
    })) as unknown as ChatRoom[];

    return sortChatRooms(mapped);
  }, [rawData]);

  // Convex queries are reactive - useFocusEffect refresh is not needed
  // Data automatically updates when changes occur on the backend

  const isLoading = enabled && userId && token ? data === undefined : false;

  return {
    data,
    isLoading,
    // Convex doesn't have refetch - queries auto-update
    // Provide a no-op for compatibility
    refetch: useCallback(() => Promise.resolve(), []),
  };
}
