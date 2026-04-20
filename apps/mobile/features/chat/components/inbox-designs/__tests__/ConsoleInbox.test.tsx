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
  return { AppImage: () => React.createElement(View, { testID: 'AppImage-mock' }) };
});

import { ConsoleInbox } from '../ConsoleInbox';
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
];

describe('ConsoleInbox', () => {
  test('renders the terminal-style title in full-screen mode', () => {
    const { queryAllByText } = render(
      <ConsoleInbox items={fixture} loading={false} onGroupPress={jest.fn()} onChannelPress={jest.fn()} />,
    );
    // The header is "inbox_" composed as nested Text nodes; both halves should appear.
    expect(queryAllByText(/inbox/).length).toBeGreaterThan(0);
  });

  test('hides the title in sidebar mode', () => {
    const { queryAllByText } = render(
      <ConsoleInbox items={fixture} loading={false} sidebarMode onGroupPress={jest.fn()} onChannelPress={jest.fn()} />,
    );
    expect(queryAllByText(/inbox/)).toHaveLength(0);
  });

  test('renders #tag-style group type badge', () => {
    const { getByText } = render(
      <ConsoleInbox items={fixture} loading={false} onGroupPress={jest.fn()} onChannelPress={jest.fn()} />,
    );
    expect(getByText('#small-groups')).toBeTruthy();
  });

  test('shows empty state with terminal copy', () => {
    const { getByText } = render(
      <ConsoleInbox items={[]} loading={false} onGroupPress={jest.fn()} onChannelPress={jest.fn()} />,
    );
    expect(getByText(/inbox\.list/)).toBeTruthy();
  });

  test('tapping a group fires onGroupPress', () => {
    const onGroup = jest.fn();
    const { getByText } = render(
      <ConsoleInbox items={fixture} loading={false} onGroupPress={onGroup} onChannelPress={jest.fn()} />,
    );
    let node: any = getByText('Young Adults');
    while (node && !node.props?.onPress) node = node.parent;
    node?.props?.onPress?.();
    expect(onGroup).toHaveBeenCalledWith('ya');
  });
});
