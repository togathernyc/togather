/**
 * useParentMessage Hook
 *
 * Fetches a single message by ID for thread views.
 * Used to display the parent message at the top of thread pages.
 */

import { useQuery, api, useStoredAuthToken } from '@services/api/convex';
import type { Id } from '@services/api/convex';

interface ParentMessage {
  _id: Id<"chatMessages">;
  _creationTime: number;
  channelId: Id<"chatChannels">;
  senderId?: Id<"users">;
  content: string;
  contentType: string;
  createdAt: number;
  editedAt?: number;
  isDeleted: boolean;
  senderName?: string;
  senderProfilePhoto?: string;
  attachments?: Array<{
    type: string;
    url: string;
    name?: string;
  }>;
  threadReplyCount?: number;
}

interface UseParentMessageResult {
  message: ParentMessage | null;
  isLoading: boolean;
}

/**
 * Fetch a single message by ID
 *
 * @param messageId - The message ID to fetch, or null to skip
 * @returns The message and loading state
 */
export function useParentMessage(
  messageId: Id<"chatMessages"> | null
): UseParentMessageResult {
  const token = useStoredAuthToken();

  const shouldSkip = !messageId || !token;

  const result = useQuery(
    api.functions.messaging.messages.getMessage,
    shouldSkip ? "skip" : {
      token: token as string,
      messageId,
    }
  );

  return {
    message: result ?? null,
    isLoading: result === undefined && !shouldSkip,
  };
}
