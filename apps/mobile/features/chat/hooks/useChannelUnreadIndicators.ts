/**
 * Hook to get unread indicators for chat channels within a group.
 *
 * Uses existing channel resolution and unread count hooks to determine
 * if the general (main) or leaders channels have unread messages.
 */
import type { Id } from '@services/api/convex';
import { useConvexChannelFromGroup } from './useConvexChannelFromGroup';
import { useAllUnreadCounts } from './useReadState';

export interface ChannelUnreadIndicators {
  /** Whether the general (main) channel has unread messages */
  generalHasUnread: boolean;
  /** Whether the leaders channel has unread messages */
  leadersHasUnread: boolean;
  /** Whether the unread data is still loading */
  isLoading: boolean;
}

/**
 * Get unread indicators for a group's chat channels.
 *
 * @param groupId - The group ID to get channel unread status for
 * @returns Unread indicators for general and leaders channels
 *
 * @example
 * ```tsx
 * const { generalHasUnread, leadersHasUnread } = useChannelUnreadIndicators(groupId);
 *
 * // Show dot indicator on inactive tab with unread messages
 * {activeTab !== 'general' && generalHasUnread && <UnreadDot />}
 * ```
 */
export function useChannelUnreadIndicators(
  groupId: Id<"groups"> | null
): ChannelUnreadIndicators {
  // Get channel IDs for this group
  const mainChannelId = useConvexChannelFromGroup(groupId, "main");
  const leadersChannelId = useConvexChannelFromGroup(groupId, "leaders");

  // Get all unread counts for the user
  const { unreadCounts, isLoading } = useAllUnreadCounts();

  // Check if each channel has unread messages
  const generalHasUnread = mainChannelId
    ? (unreadCounts[mainChannelId] ?? 0) > 0
    : false;

  const leadersHasUnread = leadersChannelId
    ? (unreadCounts[leadersChannelId] ?? 0) > 0
    : false;

  return {
    generalHasUnread,
    leadersHasUnread,
    isLoading,
  };
}
