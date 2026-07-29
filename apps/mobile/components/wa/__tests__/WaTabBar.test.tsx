/**
 * Smoke tests for WaTabBar — the floating island tab bar (WA-VISUAL-DELTAS.md S2).
 *
 * The two behaviors worth pinning: hidden tabs (Expo Router implements
 * `href: null` as `tabBarItemStyle: {display:'none'}`, leaving the route in
 * navigator state) must not render a slot, and every glyph must be handed the
 * SAME neutral ink whether focused or not — the green active tint was the
 * single loudest "not WhatsApp" signal in the audit.
 */
import React from 'react';
import { Text } from 'react-native';
import { render, fireEvent } from '@testing-library/react-native';
import { WaTabBar } from '../WaTabBar';
import { WA_TAB_INK_LIGHT } from '../metrics';

type FakeRoute = {
  key: string;
  name: string;
  title: string;
  hidden?: boolean;
  badge?: string;
};

function buildProps(routes: FakeRoute[], index: number, iconColors?: string[]) {
  const descriptors = Object.fromEntries(
    routes.map((route) => [
      route.key,
      {
        options: {
          title: route.title,
          tabBarBadge: route.badge,
          tabBarItemStyle: route.hidden ? { display: 'none' } : undefined,
          tabBarIcon: ({ color }: { color: string }) => {
            iconColors?.push(color);
            return <Text>{`icon:${route.name}`}</Text>;
          },
        },
      },
    ])
  );
  return {
    state: { index, routes: routes.map(({ key, name }) => ({ key, name })) },
    descriptors,
    navigation: {
      emit: jest.fn(() => ({ defaultPrevented: false })),
      navigate: jest.fn(),
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

describe('WaTabBar', () => {
  const routes: FakeRoute[] = [
    { key: 'chat-1', name: 'chat', title: 'Chats' },
    { key: 'events-1', name: 'events', title: 'Events' },
    { key: 'admin-1', name: 'admin', title: 'Admin', hidden: true },
    { key: 'profile-1', name: 'profile', title: 'You' },
  ];

  it('renders a slot per visible tab and skips href:null tabs', () => {
    const { getByText, queryByText } = render(<WaTabBar {...buildProps(routes, 0)} />);
    expect(getByText('Chats')).toBeTruthy();
    expect(getByText('Events')).toBeTruthy();
    expect(getByText('You')).toBeTruthy();
    expect(queryByText('Admin')).toBeNull();
  });

  it('hands every tab the same neutral ink, focused or not', () => {
    const iconColors: string[] = [];
    render(<WaTabBar {...buildProps(routes, 0, iconColors)} />);
    expect(iconColors.length).toBe(3);
    expect(new Set(iconColors)).toEqual(new Set([WA_TAB_INK_LIGHT]));
  });

  it('emits tabPress and navigates on tapping an unfocused tab', () => {
    const props = buildProps(routes, 0);
    const { getByText } = render(<WaTabBar {...props} />);
    fireEvent.press(getByText('Events'));
    expect(props.navigation.emit).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'tabPress', target: 'events-1' })
    );
    expect(props.navigation.navigate).toHaveBeenCalledWith('events', undefined);
  });

  it('does not navigate when the focused tab is tapped', () => {
    const props = buildProps(routes, 0);
    const { getByText } = render(<WaTabBar {...props} />);
    fireEvent.press(getByText('Chats'));
    expect(props.navigation.navigate).not.toHaveBeenCalled();
  });

  it('renders an unread badge riding the icon corner', () => {
    const withBadge = routes.map((r) => (r.name === 'chat' ? { ...r, badge: '7' } : r));
    const { getByText } = render(<WaTabBar {...buildProps(withBadge, 0)} />);
    expect(getByText('7')).toBeTruthy();
  });
});
