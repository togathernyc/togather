import React from 'react';
import { render } from '@testing-library/react-native';

jest.mock('@expo/vector-icons', () => {
  const React = require('react');
  const { View } = require('react-native');
  const Icon = (props: any) => React.createElement(View, { ...props });
  return { Ionicons: Icon, MaterialCommunityIcons: Icon };
});

jest.mock('@components/ui', () => {
  const React = require('react');
  const { View } = require('react-native');
  return { AppImage: (props: any) => React.createElement(View, { testID: 'AppImage-mock' }) };
});

import { HearthInbox } from '../HearthInbox';
import type { DesignGroup } from '../../../utils/inboxDesignAdapter';

const fixture: DesignGroup[] = [
  {
    _id: 'ya',
    name: 'Young Adults',
    image: null,
    groupTypeName: 'Small Groups',
    userRole: 'member',
    channels: [
      {
        _id: 'ya-m', slug: 'general', channelType: 'main', name: 'General',
        lastMessagePreview: 'Bring a chair Thursday.', lastSender: 'Maya',
        lastWhen: '9m', unreadCount: 3,
      },
    ],
  },
  {
    _id: 'wt',
    name: 'Worship Team',
    image: null,
    groupTypeName: 'Teams',
    userRole: 'leader',
    channels: [
      {
        _id: 'wt-m', slug: 'general', channelType: 'main', name: 'General',
        lastMessagePreview: 'Saturday 10am.', lastSender: 'Ade',
        lastWhen: 'Yesterday', unreadCount: 0,
      },
      {
        _id: 'wt-l', slug: 'leaders', channelType: 'leaders', name: 'Leaders',
        lastMessagePreview: 'Setlist draft.', lastSender: 'Ade',
        lastWhen: 'Yesterday', unreadCount: 1,
      },
    ],
  },
];

describe('HearthInbox', () => {
  test('renders group names', () => {
    const { getByText } = render(
      <HearthInbox items={fixture} loading={false} onGroupPress={jest.fn()} onChannelPress={jest.fn()} />,
    );
    expect(getByText('Young Adults')).toBeTruthy();
    expect(getByText('Worship Team')).toBeTruthy();
  });

  test('renders the "Inbox" title in full-screen mode', () => {
    const { getByText } = render(
      <HearthInbox items={fixture} loading={false} onGroupPress={jest.fn()} onChannelPress={jest.fn()} />,
    );
    expect(getByText('Inbox')).toBeTruthy();
  });

  test('hides the title in sidebar mode', () => {
    const { queryByText } = render(
      <HearthInbox items={fixture} loading={false} sidebarMode onGroupPress={jest.fn()} onChannelPress={jest.fn()} />,
    );
    expect(queryByText('Inbox')).toBeNull();
  });

  test('empty state renders a friendly message', () => {
    const { getByText } = render(
      <HearthInbox items={[]} loading={false} onGroupPress={jest.fn()} onChannelPress={jest.fn()} />,
    );
    expect(getByText('No messages yet')).toBeTruthy();
  });

  test('renders secondary channels only when they have unread messages', () => {
    const { getByText, queryByText } = render(
      <HearthInbox items={fixture} loading={false} onGroupPress={jest.fn()} onChannelPress={jest.fn()} />,
    );
    // Worship Team's leader channel has unread=1 → visible
    expect(getByText('Leaders')).toBeTruthy();
    // Young Adults main preview with sender prefix is visible
    expect(queryByText(/Maya:/)).toBeTruthy();
  });

  test('tapping a group fires onGroupPress with the id', () => {
    const onGroup = jest.fn();
    const { getByText } = render(
      <HearthInbox items={fixture} loading={false} onGroupPress={onGroup} onChannelPress={jest.fn()} />,
    );
    // Press the group row by tapping its name's containing Pressable
    const groupName = getByText('Young Adults');
    // Walk up to the nearest Pressable and invoke onPress via props
    let node: any = groupName;
    while (node && !node.props?.onPress) node = node.parent;
    node?.props?.onPress?.();
    expect(onGroup).toHaveBeenCalledWith('ya');
  });
});
