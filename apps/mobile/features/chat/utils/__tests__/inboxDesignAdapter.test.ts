import { toDesignGroups, type InboxGroup } from '../inboxDesignAdapter';

const now = new Date('2026-04-20T14:00:00Z');

function buildGroup(overrides: Partial<InboxGroup> = {}): InboxGroup {
  return {
    group: {
      _id: 'group-1' as any,
      name: 'Young Adults',
      preview: 'https://example.com/ya.jpg',
      groupTypeId: 'gt-1' as any,
      groupTypeName: 'Small Groups',
      groupTypeSlug: 'small-groups',
      isAnnouncementGroup: false,
    },
    channels: [
      {
        _id: 'ch-1' as any,
        slug: 'general',
        channelType: 'main',
        name: 'General',
        lastMessagePreview: 'Bring a chair Thursday.',
        lastMessageAt: now.getTime() - 9 * 60 * 1000,
        lastMessageSenderName: 'Maya',
        lastMessageSenderId: 'user-1' as any,
        unreadCount: 3,
      },
    ],
    userRole: 'member',
    ...overrides,
  };
}

describe('toDesignGroups', () => {
  test('returns [] for null / undefined', () => {
    expect(toDesignGroups(null)).toEqual([]);
    expect(toDesignGroups(undefined)).toEqual([]);
  });

  test('returns [] for empty input', () => {
    expect(toDesignGroups([])).toEqual([]);
  });

  test('maps a single group with a main channel', () => {
    const out = toDesignGroups([buildGroup()], now);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      _id: 'group-1',
      name: 'Young Adults',
      image: 'https://example.com/ya.jpg',
      groupTypeName: 'Small Groups',
      userRole: 'member',
      channels: [
        {
          _id: 'ch-1',
          slug: 'general',
          channelType: 'main',
          name: 'General',
          lastMessagePreview: 'Bring a chair Thursday.',
          lastSender: 'Maya',
          lastWhen: '9m',
          unreadCount: 3,
        },
      ],
    });
  });

  test('preserves unread counts', () => {
    const out = toDesignGroups(
      [
        buildGroup({
          channels: [
            {
              _id: 'a' as any, slug: 'general', channelType: 'main', name: 'General',
              lastMessagePreview: null, lastMessageAt: null, lastMessageSenderName: null,
              lastMessageSenderId: null, unreadCount: 7,
            },
          ],
        }),
      ],
      now,
    );
    expect(out[0].channels[0].unreadCount).toBe(7);
  });

  test('handles leader role + multi-channel group', () => {
    const out = toDesignGroups(
      [
        buildGroup({
          userRole: 'leader',
          channels: [
            {
              _id: 'main' as any, slug: 'general', channelType: 'main', name: 'General',
              lastMessagePreview: 'Sat 10am sharp.', lastMessageAt: now.getTime() - 25 * 60 * 60 * 1000,
              lastMessageSenderName: 'Ade', lastMessageSenderId: 'u' as any, unreadCount: 0,
            },
            {
              _id: 'leaders' as any, slug: 'leaders', channelType: 'leaders', name: 'Leaders',
              lastMessagePreview: 'Setlist draft.', lastMessageAt: now.getTime() - 26 * 60 * 60 * 1000,
              lastMessageSenderName: 'Ade', lastMessageSenderId: 'u' as any, unreadCount: 1,
            },
          ],
        }),
      ],
      now,
    );
    expect(out[0].userRole).toBe('leader');
    expect(out[0].channels).toHaveLength(2);
    expect(out[0].channels[0].lastWhen).toBe('Yesterday');
    expect(out[0].channels[1].lastWhen).toBe('Yesterday');
  });

  test('nullifies image when group has no preview url', () => {
    const out = toDesignGroups([buildGroup({ group: { ...buildGroup().group, preview: undefined } })], now);
    expect(out[0].image).toBeNull();
  });

  test('falls back to "Groups" when groupTypeName is missing', () => {
    const out = toDesignGroups([buildGroup({ group: { ...buildGroup().group, groupTypeName: undefined } })], now);
    expect(out[0].groupTypeName).toBe('Groups');
  });

  test('emits null lastWhen when lastMessageAt is null', () => {
    const out = toDesignGroups(
      [
        buildGroup({
          channels: [
            {
              _id: 'x' as any, slug: 'general', channelType: 'main', name: 'General',
              lastMessagePreview: null, lastMessageAt: null, lastMessageSenderName: null,
              lastMessageSenderId: null, unreadCount: 0,
            },
          ],
        }),
      ],
      now,
    );
    expect(out[0].channels[0].lastWhen).toBeNull();
  });
});
