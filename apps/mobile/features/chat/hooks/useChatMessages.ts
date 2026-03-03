/**
 * Hook for fetching chat messages from Stream Chat via Convex.
 *
 * Note: This hook is typically used for initial message loading or background fetching.
 * For real-time message updates, Stream Chat SDK's MessageList component handles
 * subscriptions automatically on the client side.
 */
import { useMemo, useEffect, useState, useCallback } from "react";
import { authenticatedConvexVanilla, api } from "@services/api/convex";
import type { Id } from "@services/api/convex";

type ChatIdentifier = string | number | string[] | null | undefined;

interface Message {
  _id: string;
  id?: string; // Optional for backward compatibility
  content?: string;
  text?: string; // Legacy field
  createdAt?: number;
  created_at?: string; // Legacy field
  created_at_time?: Date; // Legacy field
  senderId?: string;
  senderName?: string;
  senderProfilePhoto?: string;
  user?: {
    id?: string;
    name?: string;
    image?: string;
  } | null;
  [key: string]: unknown;
}

function normalizeChatId(chatId: ChatIdentifier): string | null {
  if (Array.isArray(chatId)) {
    return chatId[0] ?? null;
  }
  if (chatId === undefined || chatId === null) {
    return null;
  }
  const value = String(chatId).trim();
  return value.length > 0 ? value : null;
}

export function useChatMessages(chatIdInput: ChatIdentifier) {
  const chatId = normalizeChatId(chatIdInput);
  const isEnabled = !!chatId;

  const [data, setData] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [rawData, setRawData] = useState<Message[] | null>(null);

  // Use the vanilla client for imperative query calls
  // Note: getMessages is a query in the messaging module, not an action

  const fetchMessages = useCallback(async () => {
    if (!chatId) return;

    setIsLoading(true);
    setError(null);

    try {
      // Use authenticated vanilla client to call the query imperatively
      const result = await authenticatedConvexVanilla.query(
        api.functions.messaging.messages.getMessages,
        {
          channelId: chatId as Id<"chatChannels">,
          limit: 50,
        }
      );

      // Handle the response which returns { messages, hasMore, cursor }
      const messages = result?.messages ?? [];

      setRawData(messages as Message[]);
    } catch (err) {
      console.error("Failed to fetch messages:", err);
      setError(err instanceof Error ? err : new Error("Failed to fetch messages"));
    } finally {
      setIsLoading(false);
    }
  }, [chatId]);

  // Fetch messages when chatId changes
  useEffect(() => {
    if (isEnabled) {
      fetchMessages();
    }
  }, [isEnabled, fetchMessages]);

  // Sort messages by createdAt (oldest first, newest last)
  const sortedMessages = useMemo(() => {
    if (!rawData) return [];

    // Sort by createdAt timestamp (ascending - oldest first)
    // Handle both Convex format (createdAt as number) and legacy format (created_at as string)
    return [...rawData].sort((a, b) => {
      const timeA = a.createdAt ?? (a.created_at ? new Date(a.created_at).getTime() : 0);
      const timeB = b.createdAt ?? (b.created_at ? new Date(b.created_at).getTime() : 0);
      return timeA - timeB;
    });
  }, [rawData]);

  // Update data when sorted messages change
  useEffect(() => {
    setData(isEnabled ? sortedMessages : []);
  }, [sortedMessages, isEnabled]);

  return {
    data,
    isLoading: isLoading || !isEnabled,
    error,
    messagesData: rawData,
    // Provide refetch for manual refresh
    refetch: fetchMessages,
  };
}
