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

import { ConservatoryInbox } from '../ConservatoryInbox';
import type { DesignGroup } from '../../../utils/inboxDesignAdapter';

const fixture: DesignGroup[] = [
  {
    _id: 'ya', name: 'Young Adults', image: null, groupTypeName: 'Small Groups', userRole: 'member',
    channels: [
      { _id: 'ya-m', slug: 'general', channelType: 'main', name: 'General',
        lastMessagePreview: 'Bring a chair Thursday.', lastSender: 'Maya',
        lastWhen: '9m', unreadCount: 3 },
    ],
  },
];

describe('ConservatoryInbox', () => {
  test('renders the title in full-screen mode', () => {
    const { getByText } = render(
      <ConservatoryInbox items={fixture} loading={false} onGroupPress={jest.fn()} onChannelPress={jest.fn()} />,
    );
    expect(getByText('Inbox')).toBeTruthy();
  });

  test('hides the title in sidebar mode', () => {
    const { queryByText } = render(
      <ConservatoryInbox items={fixture} loading={false} sidebarMode onGroupPress={jest.fn()} onChannelPress={jest.fn()} />,
    );
    expect(queryByText('Inbox')).toBeNull();
  });

  test('renders empty state', () => {
    const { getByText } = render(
      <ConservatoryInbox items={[]} loading={false} onGroupPress={jest.fn()} onChannelPress={jest.fn()} />,
    );
    expect(getByText('Quiet here')).toBeTruthy();
  });

  test('tapping a group fires onGroupPress', () => {
    const onGroup = jest.fn();
    const { getByText } = render(
      <ConservatoryInbox items={fixture} loading={false} onGroupPress={onGroup} onChannelPress={jest.fn()} />,
    );
    let node: any = getByText('Young Adults');
    while (node && !node.props?.onPress) node = node.parent;
    node?.props?.onPress?.();
    expect(onGroup).toHaveBeenCalledWith('ya');
  });
});
