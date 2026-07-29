/**
 * WaScreenHeader — the large-title nav header with circular gray icon
 * buttons floating above the title, plus an optional search pill.
 *
 * WHATSAPP-DESIGN-SYSTEM.md §4: 34pt bold title, leading-aligned, sitting
 * below a row of 40pt circular buttons (`bg.grouped`-ish fill, ~18pt icon) —
 * the compose `+` is the only filled-accent circle, everything else neutral
 * gray/white. Togather adaptation: the leading "⋯" slot is the community
 * switcher (README §5 Rule 3) — pass whatever avatar/button node that screen
 * uses via `leadingSlot` rather than an icon name.
 *
 * This component renders one static layout at a time; it does not itself
 * listen to scroll position. Pass `collapsed` once the consuming screen's own
 * scroll handler decides the large title should give way to a centered 17pt
 * title (§4's standard `UINavigationController` large-title behavior).
 *
 * Presentational only: reads `useTheme()` for neutral grays; the compose
 * button's brand fill is an explicit `accent` prop.
 */
import React from 'react';
import { View, Text, Pressable, StyleSheet, StyleProp, ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@hooks/useTheme';
import {
  WA_LARGE_TITLE_SIZE,
  WA_NAV_TITLE_SIZE,
  WA_HEADER_CIRCLE_SIZE,
  WA_HEADER_CIRCLE_GAP,
  WA_HEADER_ICON_SIZE,
  WA_SEARCH_PILL_HEIGHT,
  WA_SEARCH_PILL_ICON_SIZE,
  WA_SEARCH_PILL_ICON_GAP,
  WA_SEARCH_PILL_MARGIN,
  WA_SEARCH_PILL_TOP_GAP,
  WA_ROW_LEADING_PADDING,
  WA_DEFAULT_ACCENT,
} from './metrics';

export interface WaHeaderButton {
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
  /** The one filled-accent circle among the row (the compose `+`, per §4). */
  accent?: boolean;
  accessibilityLabel?: string;
}

export interface WaScreenHeaderProps {
  title: string;
  /** Switches to the collapsed 17pt centered nav-title layout. Default false (large title at rest). */
  collapsed?: boolean;
  /** The "⋯" slot — Togather renders its community switcher here instead of a generic icon. */
  leadingSlot?: React.ReactNode;
  trailingButtons?: WaHeaderButton[];
  /** Renders the default §4 search pill with this placeholder when provided. */
  searchPlaceholder?: string;
  onSearchPress?: () => void;
  /** Full override for the search pill slot (e.g. a live filter input instead of a nav-to-search pill). */
  searchSlot?: React.ReactNode;
  /** Brand accent for any `trailingButtons` entry with `accent: true`. Falls back to WhatsApp's own default green. */
  accent?: string;
  style?: StyleProp<ViewStyle>;
}

function WaHeaderCircle({ icon, onPress, accent, accessibilityLabel, accentColor, colors }: WaHeaderButton & {
  accentColor: string;
  colors: { backgroundGrouped: string; text: string };
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={({ pressed }) => [
        styles.circle,
        {
          backgroundColor: accent ? accentColor : colors.backgroundGrouped,
          opacity: pressed ? 0.7 : 1,
        },
      ]}
    >
      <Ionicons name={icon} size={WA_HEADER_ICON_SIZE} color={accent ? '#FFFFFF' : colors.text} />
    </Pressable>
  );
}

export function WaScreenHeader({
  title,
  collapsed = false,
  leadingSlot,
  trailingButtons = [],
  searchPlaceholder,
  onSearchPress,
  searchSlot,
  accent = WA_DEFAULT_ACCENT,
  style,
}: WaScreenHeaderProps) {
  const { colors } = useTheme();

  if (collapsed) {
    return (
      <View style={[styles.collapsedBar, { backgroundColor: colors.navBarBackground }, style]}>
        <View style={styles.collapsedSide}>{leadingSlot}</View>
        <Text style={[styles.navTitle, { color: colors.text }]} numberOfLines={1}>
          {title}
        </Text>
        <View style={[styles.collapsedSide, styles.collapsedSideTrailing]}>
          {trailingButtons.map((button, i) => (
            <WaHeaderCircle key={i} {...button} accentColor={accent} colors={colors} />
          ))}
        </View>
      </View>
    );
  }

  return (
    <View style={[{ backgroundColor: colors.navBarBackground }, style]}>
      <View style={styles.buttonRow}>
        <View>{leadingSlot}</View>
        <View style={styles.trailingButtons}>
          {trailingButtons.map((button, i) => (
            <WaHeaderCircle key={i} {...button} accentColor={accent} colors={colors} />
          ))}
        </View>
      </View>

      <Text style={[styles.largeTitle, { color: colors.text }]} numberOfLines={1}>
        {title}
      </Text>

      {searchSlot ??
        (searchPlaceholder ? (
          <Pressable
            onPress={onSearchPress}
            style={[styles.searchPill, { backgroundColor: colors.backgroundGrouped }]}
            accessibilityRole="search"
          >
            <Ionicons name="search" size={WA_SEARCH_PILL_ICON_SIZE} color={colors.textTertiary} />
            <Text style={[styles.searchPlaceholder, { color: colors.textTertiary }]} numberOfLines={1}>
              {searchPlaceholder}
            </Text>
          </Pressable>
        ) : null)}
    </View>
  );
}

const styles = StyleSheet.create({
  buttonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: WA_ROW_LEADING_PADDING,
    paddingTop: 4,
  },
  trailingButtons: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: WA_HEADER_CIRCLE_GAP,
  },
  circle: {
    width: WA_HEADER_CIRCLE_SIZE,
    height: WA_HEADER_CIRCLE_SIZE,
    borderRadius: WA_HEADER_CIRCLE_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  largeTitle: {
    fontSize: WA_LARGE_TITLE_SIZE,
    fontWeight: '700',
    textAlign: 'left',
    paddingHorizontal: WA_ROW_LEADING_PADDING,
    paddingTop: 8,
  },
  searchPill: {
    flexDirection: 'row',
    alignItems: 'center',
    height: WA_SEARCH_PILL_HEIGHT,
    borderRadius: WA_SEARCH_PILL_HEIGHT / 2,
    marginHorizontal: WA_SEARCH_PILL_MARGIN,
    marginTop: WA_SEARCH_PILL_TOP_GAP,
    paddingHorizontal: 12,
  },
  searchPlaceholder: {
    fontSize: 17,
    marginLeft: WA_SEARCH_PILL_ICON_GAP,
  },
  collapsedBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    height: 44,
    paddingHorizontal: WA_ROW_LEADING_PADDING,
  },
  collapsedSide: {
    flexDirection: 'row',
    alignItems: 'center',
    minWidth: WA_HEADER_CIRCLE_SIZE,
  },
  collapsedSideTrailing: {
    justifyContent: 'flex-end',
    gap: WA_HEADER_CIRCLE_GAP,
  },
  navTitle: {
    fontSize: WA_NAV_TITLE_SIZE,
    fontWeight: '600',
    flex: 1,
    textAlign: 'center',
  },
});
