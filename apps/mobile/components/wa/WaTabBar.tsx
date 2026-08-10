/**
 * WaTabBar — the floating rounded-island tab bar current WhatsApp iOS uses in
 * place of an edge-to-edge opaque bar (WA-VISUAL-DELTAS.md S2).
 *
 * Drop-in `tabBar` prop for React Navigation's bottom tabs (which is what
 * Expo Router's `<Tabs>` is), so the flag-on branch keeps using the framework's
 * navigator rather than hand-rolling one. Anatomy, per the reference:
 *
 *   - a pill inset `WA_TAB_ISLAND_MARGIN_H` from each screen edge, sitting
 *     `WA_TAB_ISLAND_BOTTOM_GAP` above the bottom safe inset, ~64pt tall /
 *     fully rounded, near-white translucent fill + soft shadow;
 *   - absolutely positioned, so it takes no layout space. Flag-on screens pair
 *     that with two paddings: `waTabBarStripHeight(insets.bottom)` on the
 *     container carrying the page background — the BAND, running from the
 *     screen's bottom edge to 8pt above the island's top, so the island's whole
 *     zone (including the 20pt of page either side of it) paints as page
 *     background rather than as whatever row happens to be there — and
 *     `WA_TAB_CONTENT_CLEARANCE` on the scroll content, which is now only
 *     breathing room above that band;
 *   - thin-line 24pt glyphs and 10pt labels, all in ONE neutral ink whether
 *     focused or not. The active tab is marked by a highlight pill wrapped
 *     around its icon+label — never by a green tint (S2.2, the single loudest
 *     "not WhatsApp" signal in the audit);
 *   - unread badges ride the icon's top-right corner as a green capsule.
 *
 * Translucency is an rgba fill, not `expo-blur` — no native module is added
 * for this (ADR-013: gated-native-dependency discipline).
 */
import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@hooks/useTheme';
import {
  WA_TAB_ISLAND_HEIGHT,
  WA_TAB_ISLAND_RADIUS,
  WA_TAB_ISLAND_MARGIN_H,
  waTabBarBottomOffset,
  WA_TAB_ISLAND_FILL_LIGHT,
  WA_TAB_ISLAND_FILL_DARK,
  WA_TAB_ICON_SIZE,
  WA_TAB_LABEL_GAP,
  WA_TAB_LABEL_SIZE,
  WA_TAB_INK_LIGHT,
  WA_TAB_INK_DARK,
  WA_TAB_ACTIVE_PILL_LIGHT,
  WA_TAB_ACTIVE_PILL_DARK,
  WA_TAB_ACTIVE_PILL_RADIUS,
  WA_TAB_BADGE_OFFSET,
  WA_ISLAND_SHADOW,
  WA_DEFAULT_ACCENT,
  WA_WEIGHT_SEMIBOLD,
} from './metrics';

export interface WaTabBarProps extends BottomTabBarProps {
  /** Fill for unread badges. Falls back to WhatsApp's own green. */
  badgeColor?: string;
}

export function WaTabBar({ state, descriptors, navigation, badgeColor }: WaTabBarProps) {
  const insets = useSafeAreaInsets();
  const { isDark } = useTheme();

  const ink = isDark ? WA_TAB_INK_DARK : WA_TAB_INK_LIGHT;
  const fill = isDark ? WA_TAB_ISLAND_FILL_DARK : WA_TAB_ISLAND_FILL_LIGHT;
  const activePill = isDark ? WA_TAB_ACTIVE_PILL_DARK : WA_TAB_ACTIVE_PILL_LIGHT;

  // Expo Router implements `href: null` by stamping `tabBarItemStyle: {display:
  // 'none'}` on the screen rather than removing it from the navigator state, so
  // every hidden route is still in `state.routes` — filter them out here or the
  // island renders a slot for each one.
  const visible = state.routes.filter((route) => {
    const itemStyle = descriptors[route.key]?.options?.tabBarItemStyle as
      | { display?: string }
      | undefined;
    return itemStyle?.display !== 'none';
  });

  return (
    <View
      style={[
        styles.wrapper,
        { paddingBottom: waTabBarBottomOffset(insets.bottom) },
      ]}
      pointerEvents="box-none"
    >
      <View style={[styles.island, WA_ISLAND_SHADOW, { backgroundColor: fill }]}>
        {visible.map((route) => {
          const { options } = descriptors[route.key];
          const focused = state.routes[state.index]?.key === route.key;
          const label = (options.title ?? route.name) as string;
          const badge = options.tabBarBadge;

          const onPress = () => {
            const event = navigation.emit({
              type: 'tabPress',
              target: route.key,
              canPreventDefault: true,
            });
            if (!focused && !event.defaultPrevented) {
              navigation.navigate(route.name, route.params);
            }
          };

          return (
            <Pressable
              key={route.key}
              onPress={onPress}
              accessibilityRole="button"
              accessibilityState={{ selected: focused }}
              accessibilityLabel={options.tabBarAccessibilityLabel ?? label}
              style={styles.tab}
            >
              <View
                style={[
                  styles.tabPill,
                  focused && { backgroundColor: activePill },
                ]}
              >
                <View>
                  {options.tabBarIcon?.({
                    focused,
                    // Neutral ink for BOTH states — S2.2.
                    color: ink,
                    size: WA_TAB_ICON_SIZE,
                  })}
                  {badge != null && badge !== '' ? (
                    <View
                      style={[
                        styles.badge,
                        { backgroundColor: badgeColor ?? WA_DEFAULT_ACCENT },
                      ]}
                    >
                      <Text style={styles.badgeText} numberOfLines={1}>
                        {badge}
                      </Text>
                    </View>
                  ) : null}
                </View>
                <Text style={[styles.label, { color: ink }]} numberOfLines={1}>
                  {label}
                </Text>
              </View>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: WA_TAB_ISLAND_MARGIN_H,
  },
  island: {
    flexDirection: 'row',
    alignItems: 'center',
    height: WA_TAB_ISLAND_HEIGHT,
    borderRadius: WA_TAB_ISLAND_RADIUS,
    paddingHorizontal: 6,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabPill: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: WA_TAB_ACTIVE_PILL_RADIUS,
  },
  label: {
    fontSize: WA_TAB_LABEL_SIZE,
    fontWeight: WA_WEIGHT_SEMIBOLD,
    marginTop: WA_TAB_LABEL_GAP,
  },
  badge: {
    position: 'absolute',
    top: WA_TAB_BADGE_OFFSET,
    right: WA_TAB_BADGE_OFFSET - 4,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '700',
  },
});
