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
  WA_TAB_ISLAND_BOTTOM_GAP,
  waTabBarBottomOffset,
  waTabBarContentClearance,
  waTabBarIslandTop,
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
 * Content clearance — the ONLY padding a flag-on screen adds for the island.
 *
 * The island floats over live content: rows scroll behind it and through its
 * 20pt side margins. An earlier cut reserved the island's whole zone as
 * `paddingBottom` on the page container instead, which froze a dead
 * page-colored band across the bottom of every tab and stopped content
 * scrolling past it — the island read as a docked bar (owner, 2026-09-02).
 * These guards pin the scroll-past model: the clearance goes on scroll
 * CONTENT, and it is measured from the screen edge so it covers the island.
 */
describe('waTabBarContentClearance — scroll clearance for the floating island', () => {
  it.each([0, 20, 34, 59])(
    'clears the island and leaves exactly the breathing gap at inset %p',
    (inset) => {
      expect(waTabBarContentClearance(inset) - waTabBarIslandTop(inset)).toBe(
        WA_TAB_CONTENT_CLEARANCE
      );
    }
  );

  it('is the island top plus a breathing gap — 80 at inset 0, 86 at inset 34', () => {
    expect(waTabBarContentClearance(0)).toBe(80);
    expect(waTabBarContentClearance(34)).toBe(86);
  });

  it('uses the same gap above the island as below it', () => {
    expect(WA_TAB_CONTENT_CLEARANCE).toBe(WA_TAB_ISLAND_BOTTOM_GAP);
  });

  /**
   * The band-era clearance was the bare 12pt breathing constant, because the
   * container reserved the island's height. If someone reinstates the band,
   * this is the value that shrinks back — so pin that it covers the island's
   * full height, not just the gap above it.
   */
  it('covers the whole island, not just the breathing gap', () => {
    expect(waTabBarContentClearance(0)).toBeGreaterThan(
      WA_TAB_CONTENT_CLEARANCE + WA_TAB_ISLAND_HEIGHT - 1
    );
    expect(waTabBarContentClearance(0)).not.toBe(WA_TAB_CONTENT_CLEARANCE);
  });
});
