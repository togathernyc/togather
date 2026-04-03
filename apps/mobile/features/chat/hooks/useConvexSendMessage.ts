/**
 * useSendMessage Hook (Convex Version)
 *
 * Send mutation with optimistic updates for the Convex messaging system.
 * Shows messages immediately in the UI with "sending" status, then updates
 * to "sent" when the server confirms.
 *
 * Supports offline queuing: messages sent while disconnected are queued
 * and automatically flushed when the connection restores.
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { useMutation, api, useStoredAuthToken } from '@services/api/convex';
import type { Id } from '@services/api/convex';
import { useAuth } from '@providers/AuthProvider';
import { useConnectionStatus } from '@providers/ConnectionProvider';

interface Attachment {
  type: string;
  url: string;
  name?: string;
  size?: number;
  mimeType?: string;
  thumbnailUrl?: string;
  waveform?: number[];
  duration?: number;
}

interface SendMessageOptions {
  attachments?: Attachment[];
  mentionedUserIds?: Id<"users">[];
  parentMessageId?: Id<"chatMessages">;
  hideLinkPreview?: boolean;
}

interface OptimisticMessage {
  _id: string;
  channelId: Id<"chatChannels">;
  senderId: Id<"users">;
  content: string;
  contentType: string;
  attachments?: Attachment[];
  parentMessageId?: Id<"chatMessages">;
  createdAt: number;
  isDeleted: false;
  senderName: string;
  senderProfilePhoto?: string;
  mentionedUserIds?: Id<"users">[];
  _optimistic: true;
  _status: 'sending' | 'sent' | 'error' | 'queued';
}

interface QueueItem {
  optimisticId: string;
  content: string;
  options?: SendMessageOptions;
}

interface UseSendMessageResult {
  sendMessage: (content: string, options?: SendMessageOptions) => Promise<void>;
  optimisticMessages: OptimisticMessage[];
  isSending: boolean;
  retryMessage: (optimisticId: string) => Promise<void>;
  dismissMessage: (optimisticId: string) => void;
}

/**
 * Send messages with optimistic updates
 *
 * @param channelId - The channel ID to send messages to, or null to disable
 * @returns sendMessage function, optimistic messages, sending state, retry, and dismiss
 *
 * @example
 * ```tsx
 * const { sendMessage, optimisticMessages, isSending, retryMessage, dismissMessage } = useSendMessage(channelId);
 *
 * const handleSend = async () => {
 *   await sendMessage("Hello!", {
 *     mentionedUserIds: [userId],
 *   });
 * };
 * ```
 */
export function useSendMessage(
  channelId: Id<"chatChannels"> | null,
  viewingGroupId?: Id<"groups"> | null
): UseSendMessageResult {
  const { user } = useAuth();
  const token = useStoredAuthToken();
  const sendMessageMutation = useMutation(api.functions.messaging.messages.sendMessage);
  const { status: connectionStatus, isEffectivelyOffline } = useConnectionStatus();

  // Track optimistic messages (messages that are being sent)
  const [optimisticMessages, setOptimisticMessages] = useState<OptimisticMessage[]>([]);
  const [isSending, setIsSending] = useState(false);

  // Counter for generating unique optimistic IDs
  const optimisticIdCounter = useRef(0);

  // Queue for messages sent while offline
  const messageQueueRef = useRef<QueueItem[]>([]);

  /**
   * Internal function to actually send a message via mutation
   */
  const executeSend = useCallback(
    async (optimisticId: string, content: string, options?: SendMessageOptions) => {
      if (!channelId || !token) return;

      // Update status to sending
      setOptimisticMessages((prev) =>
        prev.map((msg) =>
          msg._id === optimisticId
            ? { ...msg, _status: 'sending' as const }
            : msg
        )
      );

      try {
        // Send message to server
        const messageId = await sendMessageMutation({
          token,
          channelId,
          content,
          attachments: options?.attachments,
          parentMessageId: options?.parentMessageId,
          mentionedUserIds: options?.mentionedUserIds,
          hideLinkPreview: options?.hideLinkPreview,
          ...(viewingGroupId ? { viewingGroupId } : {}),
        });

        // Update optimistic message status to "sent"
        setOptimisticMessages((prev) =>
          prev.map((msg) =>
            msg._id === optimisticId
              ? { ...msg, _status: 'sent' as const }
              : msg
          )
        );

        // Remove optimistic message after a delay as state cleanup fallback.
        // MessageList deduplicates visually (hides 'sent' optimistic messages
        // once the matching real message arrives from the subscription), so this
        // timeout only needs to clean up state — keep it generous to avoid a
        // disappearing-message gap on slow/reconnecting connections.
        setTimeout(() => {
          setOptimisticMessages((prev) =>
            prev.filter((msg) => msg._id !== optimisticId)
          );
        }, 3000);

        console.log('[useSendMessage] Message sent successfully:', messageId);
      } catch (error) {
        console.error('[useSendMessage] Failed to send message:', error);

        // Mark optimistic message as error (NO auto-removal - user must retry or dismiss)
        setOptimisticMessages((prev) =>
          prev.map((msg) =>
            msg._id === optimisticId
              ? { ...msg, _status: 'error' as const }
              : msg
          )
        );

        throw error;
      }
    },
    [channelId, token, sendMessageMutation, viewingGroupId]
  );

  /**
   * Send a message with optimistic update
   */
  const sendMessage = useCallback(
    async (content: string, options?: SendMessageOptions) => {
      if (!channelId || !token || !user) {
        console.warn('[useSendMessage] Cannot send message: missing channelId, token, or user');
        return;
      }

      // Generate optimistic message
      const optimisticId = `optimistic-${Date.now()}-${optimisticIdCounter.current++}`;
      const now = Date.now();

      // Determine content type
      let contentType = "text";
      if (options?.attachments && options.attachments.length > 0) {
        const hasImage = options.attachments.some((a) => a.type === "image");
        const hasFile = options.attachments.some((a) => a.type === "file");
        if (hasImage) contentType = "image";
        else if (hasFile) contentType = "file";
      }

      const isOffline = isEffectivelyOffline;

      const optimisticMessage: OptimisticMessage = {
        _id: optimisticId,
        channelId,
        senderId: user.id as Id<"users">,
        content,
        contentType,
        attachments: options?.attachments,
        parentMessageId: options?.parentMessageId,
        createdAt: now,
        isDeleted: false,
        senderName: `${user.first_name} ${user.last_name}`.trim() || 'You',
        senderProfilePhoto: user.profile_photo,
        mentionedUserIds: options?.mentionedUserIds,
        _optimistic: true,
        _status: isOffline ? 'queued' : 'sending',
      };

      // Add optimistic message to state
      setOptimisticMessages((prev) => [...prev, optimisticMessage]);

      if (isOffline) {
        // Queue for later
        messageQueueRef.current.push({ optimisticId, content, options });
        return;
      }

      setIsSending(true);

      try {
        await executeSend(optimisticId, content, options);
      } catch (error) {
        console.error('[useSendMessage] Failed to send:', error);
        throw error;
      } finally {
        setIsSending(false);
      }
    },
    [channelId, token, user, isEffectivelyOffline, executeSend]
  );

  // Flush queue when connection restores
  useEffect(() => {
    if (!isEffectivelyOffline && messageQueueRef.current.length > 0) {
      const queue = [...messageQueueRef.current];
      messageQueueRef.current = [];

      const flushQueue = async () => {
        for (const item of queue) {
          try {
            await executeSend(item.optimisticId, item.content, item.options);
          } catch (error) {
            console.error('[useSendMessage] Failed to flush queued message:', error);
          }
        }
      };

      flushQueue();
    }
  }, [connectionStatus, isEffectivelyOffline, executeSend]);

  /**
   * Retry a failed message
   */
  const retryMessage = useCallback(
    async (optimisticId: string) => {
      const msg = optimisticMessages.find((m) => m._id === optimisticId);
      if (!msg || msg._status !== 'error') return;

      try {
        await executeSend(optimisticId, msg.content);
      } catch (error) {
        console.error('[useSendMessage] Retry failed:', error);
      }
    },
    [optimisticMessages, executeSend]
  );

  /**
   * Dismiss a failed message (remove from optimistic list)
   */
  const dismissMessage = useCallback(
    (optimisticId: string) => {
      setOptimisticMessages((prev) => prev.filter((msg) => msg._id !== optimisticId));
    },
    []
  );

  return {
    sendMessage,
    optimisticMessages,
    isSending,
    retryMessage,
    dismissMessage,
  };
}
