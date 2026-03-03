/**
 * Hook for sending chat messages via Convex mutation.
 *
 * Provides optimistic updates for immediate UI feedback while the message
 * is being sent to the Convex backend.
 */
import { useState, useCallback } from "react";
import { useAuth } from "@providers/AuthProvider";
import { useMutation, api } from "@services/api/convex";
import type { Id } from "@services/api/convex";
import type { Message } from "../types";

interface SendMessageParams {
  chatId: string;
  text: string;
  imageIds?: Array<{ file_path: string; image_url: string }>;
  user: {
    id?: string; // Convex _id
    legacyId?: number;
    first_name?: string;
    last_name?: string;
    profile_photo?: string;
  };
  onSuccess?: () => void;
  onError?: (error: Error) => void;
}

interface UseSendMessageReturn {
  mutate: (params: { text: string; imageIds?: Array<{ file_path: string; image_url: string }> }) => void;
  mutateAsync: (params: { text: string; imageIds?: Array<{ file_path: string; image_url: string }> }) => Promise<{
    id: string;
    text?: string;
    createdAt?: string;
    senderId: string;
    sender: {
      id: string;
      firstName?: string;
      lastName?: string;
      profilePhoto?: string;
    };
    images: Array<{ filePath: string; imageUrl: string }>;
  }>;
  isPending: boolean;
  isError: boolean;
  error: Error | null;
  reset: () => void;
}

export function useSendMessage({
  chatId,
  user,
  onSuccess,
  onError,
}: Omit<SendMessageParams, "text" | "imageIds">): UseSendMessageReturn {
  const [isPending, setIsPending] = useState(false);
  const [isError, setIsError] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const { token } = useAuth();

  const userId = user?.id as Id<"users"> | undefined;
  const sendMessageMutation = useMutation(api.functions.messaging.messages.sendMessage);

  const reset = useCallback(() => {
    setIsPending(false);
    setIsError(false);
    setError(null);
  }, []);

  const sendMessage = useCallback(
    async (params: { text: string; imageIds?: Array<{ file_path: string; image_url: string }> }) => {
      if (!userId || !token) {
        throw new Error("User not authenticated");
      }

      setIsPending(true);
      setIsError(false);
      setError(null);

      try {
        // Transform image format from legacy to Convex format
        const attachments = params.imageIds?.map((img) => ({
          type: "image" as const,
          url: img.image_url,
          name: img.file_path,
        }));

        // Call the mutation with the correct argument names
        const messageId = await sendMessageMutation({
          token,
          channelId: chatId as Id<"chatChannels">,
          content: params.text,
          attachments,
        });

        // Return a simplified result structure
        const result = {
          id: messageId,
          text: params.text,
          createdAt: new Date().toISOString(),
          senderId: userId as string,
          sender: {
            id: userId as string,
            firstName: user?.first_name,
            lastName: user?.last_name,
            profilePhoto: user?.profile_photo,
          },
          images: params.imageIds?.map((img) => ({
            filePath: img.file_path,
            imageUrl: img.image_url,
          })) ?? [],
        };

        setIsPending(false);
        onSuccess?.();

        return result;
      } catch (err) {
        const error = err instanceof Error ? err : new Error("Failed to send message");
        console.error("sendMessage error:", error);
        setIsPending(false);
        setIsError(true);
        setError(error);
        onError?.(error);
        throw error;
      }
    },
    [userId, chatId, onSuccess, onError, sendMessageMutation, token, user]
  );

  const mutate = useCallback(
    (params: { text: string; imageIds?: Array<{ file_path: string; image_url: string }> }) => {
      sendMessage(params).catch(() => {
        // Error is already handled in sendMessage
      });
    },
    [sendMessage]
  );

  return {
    mutate,
    mutateAsync: sendMessage,
    isPending,
    isError,
    error,
    reset,
  };
}
