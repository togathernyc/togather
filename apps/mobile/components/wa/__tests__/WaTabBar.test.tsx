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
    'covers the island exactly at inset %p, so the last row is never under it',
    (inset) => {
      expect(waTabBarContentClearance(inset)).toBeGreaterThanOrEqual(
        waTabBarIslandTop(inset)
      );
    }
  );

  it('lands the last row exactly on the island top — 72 at inset 0, 78 at inset 34', () => {
    expect(waTabBarContentClearance(0)).toBe(72);
    expect(waTabBarContentClearance(34)).toBe(78);
  });

  /**
   * The gap is 0 on purpose. Any positive value paints empty page between the
   * last row and the pill at rest, which the owner reported three times as
   * "the white bar on the bottom" — at 124pt, then 12, then 8. Don't reinstate
   * one; the list is meant to run right up to the pill's edge.
   */
  it('leaves NO empty band above the island', () => {
    expect(WA_TAB_CONTENT_CLEARANCE).toBe(0);
    for (const inset of [0, 20, 34, 59]) {
      expect(waTabBarContentClearance(inset)).toBe(waTabBarIslandTop(inset));
    }
  });

  /**
   * The band-era clearance was the bare 12pt breathing constant, because the
   * container reserved the island's height. If someone reinstates the band,
   * this is the value that shrinks back — so pin that it covers the island's
   * full height, not just the gap above it.
   */
  it('still covers the whole island height, so the last row stays tappable', () => {
    expect(waTabBarContentClearance(0)).toBeGreaterThanOrEqual(WA_TAB_ISLAND_HEIGHT);
    expect(waTabBarContentClearance(34)).toBeGreaterThanOrEqual(WA_TAB_ISLAND_HEIGHT);
  });
});
