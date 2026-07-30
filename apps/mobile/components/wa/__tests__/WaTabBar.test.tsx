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
import {
  WA_TAB_INK_LIGHT,
  WA_TAB_ISLAND_HEIGHT,
  WA_TAB_CONTENT_CLEARANCE,
  waTabBarBottomOffset,
  waTabBarStripHeight,
} from '../metrics';

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

/**
 * The band a flag-on screen reserves as page background under the island.
 *
 * This is the regression the owner reported twice (2026-07-29, 2026-07-30):
 * the island is inset 20pt from each screen edge and 64pt tall, so reserving
 * only the strip BELOW it left list rows rendering beside and under the island
 * — "the bottom of these pages is still not a uniform color". The band has to
 * cover the island's FULL height, not just the gap under it.
 */
describe('waTabBarStripHeight — the island band', () => {
  it.each([0, 20, 34, 59])('covers the whole island at inset %p', (inset) => {
    const islandTop = waTabBarBottomOffset(inset) + WA_TAB_ISLAND_HEIGHT;
    expect(waTabBarStripHeight(inset)).toBeGreaterThanOrEqual(islandTop);
  });

  it('is the island top plus a breathing gap — 80 at inset 0, 86 at inset 34', () => {
    expect(waTabBarStripHeight(0)).toBe(80);
    expect(waTabBarStripHeight(34)).toBe(86);
  });

  it('keeps scroll clearance to breathing room — the band already clears the island', () => {
    // Regression guard: when the clearance also had to cover the island it was
    // 76, which double-counted the island once the band grew to include it.
    expect(WA_TAB_CONTENT_CLEARANCE).toBeLessThan(WA_TAB_ISLAND_HEIGHT);
  });
});
