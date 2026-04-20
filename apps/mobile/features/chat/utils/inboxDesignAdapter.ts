/**
 * Adapt the production `getInboxChannels` query result into the shape expected
 * by the design-theme inbox components (HearthInbox / ConsoleInbox / ConservatoryInbox).
 *
 * The design components were prototyped against a slightly richer mock shape;
 * this adapter is the bridge. All three designs consume the same output, so
 * they stay in sync with real data by construction.
 */
import type { Id } from '@services/api/convex';
import { formatInboxTime } from './formatInboxTime';

// Matches the `inboxChannels` result from api.functions.messaging.channels.getInboxChannels.
// Mirrored here (not imported) because this utility is platform-agnostic and
// shouldn't drag in Convex generated types.
export type InboxGroupChannel = {
  _id: Id<'chatChannels'>;
  slug: string;
  channelType: string;
  name: string;
  lastMessagePreview: string | null;
  lastMessageAt: number | null;
  lastMessageSenderName: string | null;
  lastMessageSenderId: Id<'users'> | null;
  unreadCount: number;
  isShared?: boolean;
};

export type InboxGroup = {
  group: {
    _id: Id<'groups'>;
    name: string;
    preview: string | undefined;
    groupTypeId: Id<'groupTypes'>;
    groupTypeName: string | undefined;
    groupTypeSlug: string | undefined;
    isAnnouncementGroup: boolean | undefined;
  };
  channels: InboxGroupChannel[];
  userRole: 'leader' | 'member';
};

// The shape design components render from.
export type DesignChannel = {
  _id: string;
  slug: string;
  channelType: string;
  name: string;
  lastMessagePreview: string | null;
  lastSender: string | null;
  lastWhen: string | null; // human-readable ("9m", "Yesterday", "Jan 15")
  unreadCount: number;
};

export type DesignGroup = {
  _id: string;
  name: string;
  /** Image URL or null if the group has no cover image (callers show initials). */
  image: string | null;
  groupTypeName: string;
  userRole: 'leader' | 'member';
  channels: DesignChannel[];
};

/**
 * Convert a production inbox query result into the design shape.
 *
 * @param inboxGroups  Result from `getInboxChannels`. Undefined / null yield [].
 * @param now          Injectable clock for deterministic tests; defaults to `new Date()`.
 */
export function toDesignGroups(
  inboxGroups: InboxGroup[] | undefined | null,
  now: Date = new Date(),
): DesignGroup[] {
  if (!inboxGroups) return [];
  return inboxGroups.map((entry) => ({
    _id: String(entry.group._id),
    name: entry.group.name,
    image: entry.group.preview ?? null,
    groupTypeName: entry.group.groupTypeName ?? 'Groups',
    userRole: entry.userRole,
    channels: entry.channels.map((ch) => ({
      _id: String(ch._id),
      slug: ch.slug,
      channelType: ch.channelType,
      name: ch.name,
      lastMessagePreview: ch.lastMessagePreview,
      lastSender: ch.lastMessageSenderName,
      lastWhen: ch.lastMessageAt != null ? formatInboxTime(ch.lastMessageAt, now) : null,
      unreadCount: ch.unreadCount,
    })),
  }));
}
