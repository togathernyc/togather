/**
 * WaScreenHeader — current WhatsApp iOS's top-level screen chrome: a row of
 * FLOATING 44pt circular buttons over the content, with the large title on its
 * own line below, and an optional search pill under that.
 *
 * WA-VISUAL-DELTAS.md S1: there is no opaque nav bar on any WA screen any more
 * — no bar fill, no hairline, no inline title-row buttons. The buttons are
 * `WaFloatingButton` circles (white, black line glyph, very light shadow); the
 * only accent-filled circle in the whole chrome is the Chats compose "+"
 * (S5.1). Togather adaptation: the leading slot is the community switcher
 * (README §5 Rule 3) — pass it as `leadingSlot`, styled as a plain floating
 * circle with the community avatar inside.
 *
 * Screens with no title at all (the You tab, S1.3) pass `title={undefined}` —
 * the button row renders alone.
 *
 * This component renders one static layout at a time; it does not itself
 * listen to scroll position. Pass `collapsed` once the consuming screen's own
 * scroll handler decides the large title should give way to a centered 17pt
 * title.
 *
 * Presentational only: reads `useTheme()` for neutral ink; the compose
 * button's brand fill is an explicit `accent` prop.
 */
import React from 'react';
import { View, Text, Pressable, StyleSheet, StyleProp, ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@hooks/useTheme';
import { WaFloatingButton } from './WaFloatingButton';
import { WaLargeTitle } from './WaLargeTitle';
import {
  WA_NAV_TITLE_SIZE,
  WA_HEADER_CIRCLE_SIZE,
  WA_HEADER_CIRCLE_GAP,
  WA_SEARCH_PILL_HEIGHT,
  WA_SEARCH_PILL_ICON_SIZE,
  WA_SEARCH_PILL_ICON_GAP,
  WA_SEARCH_PILL_MARGIN,
  WA_SEARCH_PILL_TOP_GAP,
  WA_ROW_LEADING_PADDING,
  WA_FLOATING_ROW_TITLE_GAP,
  WA_TYPE_ROW_TITLE,
  WA_WEIGHT_SEMIBOLD,
  WA_DEFAULT_ACCENT,
} from './metrics';

export interface WaHeaderButton {
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
  /** The one filled-accent circle among the row (the Chats compose `+`, per S5.1). */
  accent?: boolean;
  accessibilityLabel?: string;
  /** For toggle-style circles (List/Map): forwarded as accessibilityState.selected. */
  selected?: boolean;
}

export interface WaScreenHeaderProps {
  /** Omit for a buttons-only header (the You tab has no large title — S1.3). */
  title?: string;
  /** Switches to the collapsed 17pt centered nav-title layout. Default false (large title at rest). */
  collapsed?: boolean;
  /** The leading slot — Togather renders its community switcher here instead of a generic icon. */
  leadingSlot?: React.ReactNode;
  trailingButtons?: WaHeaderButton[];
  /** Renders the default search pill with this placeholder when provided. */
  searchPlaceholder?: string;
  onSearchPress?: () => void;
  /** Full override for the search pill slot (e.g. a live filter input instead of a nav-to-search pill). */
  searchSlot?: React.ReactNode;
  /** Brand accent for any `trailingButtons` entry with `accent: true`. Falls back to WhatsApp's own default green. */
  accent?: string;
  style?: StyleProp<ViewStyle>;
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

  const buttons = trailingButtons.map((button, i) => (
    <WaFloatingButton
      key={i}
      icon={button.icon}
      onPress={button.onPress}
      variant={button.accent ? 'accent' : 'plain'}
      accent={accent}
      accessibilityLabel={button.accessibilityLabel}
      selected={button.selected}
    />
  ));

  if (collapsed) {
    return (
      <View style={[styles.collapsedBar, style]}>
        <View style={styles.collapsedSide}>{leadingSlot}</View>
        {title ? (
          <Text style={[styles.navTitle, { color: colors.text }]} numberOfLines={1}>
            {title}
          </Text>
        ) : (
          <View style={styles.navTitle} />
        )}
        <View style={[styles.collapsedSide, styles.collapsedSideTrailing]}>{buttons}</View>
      </View>
    );
  }

  return (
    <View style={style}>
      <View style={styles.buttonRow}>
        <View>{leadingSlot}</View>
        <View style={styles.trailingButtons}>{buttons}</View>
      </View>

      {title ? (
        <WaLargeTitle style={styles.largeTitle}>{title}</WaLargeTitle>
      ) : null}

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

export interface WaSubScreenHeaderProps {
  /** Centered 17pt semibold floating title. Omit for buttons only. */
  title?: string;
  onBack?: () => void;
  /** Rendered next to the chevron inside the back circle — e.g. a total unread count (S1.1). */
  backBadge?: string;
  trailingButtons?: WaHeaderButton[];
  accent?: string;
  style?: StyleProp<ViewStyle>;
}

/**
 * WaSubScreenHeader — the sub-screen counterpart to `WaScreenHeader` (S1.1/S1.2):
 * a floating white circle back button top-left with a black chevron, and a
 * centered 17pt semibold title floating over the (unfilled) background. Same
 * "no bar, no hairline" rule as the top-level header.
 */
export function WaSubScreenHeader({
  title,
  onBack,
  backBadge,
  trailingButtons = [],
  accent = WA_DEFAULT_ACCENT,
  style,
}: WaSubScreenHeaderProps) {
  const { colors } = useTheme();
  return (
    <View style={[styles.subHeader, style]}>
      <View style={styles.subHeaderSide}>
        {onBack ? (
          <WaFloatingButton
            onPress={onBack}
            accessibilityLabel="Back"
            // A count next to the chevron widens the circle into a capsule,
            // exactly as the reference's "‹ 62" back button does.
            style={backBadge ? styles.backCapsule : undefined}
          >
            <View style={styles.backContent}>
              <Ionicons name="chevron-back" size={22} color={colors.text} />
              {backBadge ? (
                <Text style={[styles.backBadge, { color: colors.text }]} numberOfLines={1}>
                  {backBadge}
                </Text>
              ) : null}
            </View>
          </WaFloatingButton>
        ) : null}
      </View>
      {title ? (
        <Text style={[styles.navTitle, { color: colors.text }]} numberOfLines={1}>
          {title}
        </Text>
      ) : (
        <View style={styles.navTitle} />
      )}
      <View style={[styles.subHeaderSide, styles.collapsedSideTrailing]}>
        {trailingButtons.map((button, i) => (
          <WaFloatingButton
            key={i}
            icon={button.icon}
            onPress={button.onPress}
            variant={button.accent ? 'accent' : 'plain'}
            accent={accent}
            accessibilityLabel={button.accessibilityLabel}
          />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  buttonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: WA_HEADER_CIRCLE_SIZE,
    paddingHorizontal: WA_ROW_LEADING_PADDING,
    paddingTop: 8,
  },
  trailingButtons: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: WA_HEADER_CIRCLE_GAP,
  },
  largeTitle: {
    paddingTop: WA_FLOATING_ROW_TITLE_GAP,
  },
  searchPill: {
    flexDirection: 'row',
    alignItems: 'center',
    height: WA_SEARCH_PILL_HEIGHT,
    borderRadius: WA_SEARCH_PILL_HEIGHT / 2,
    marginHorizontal: WA_SEARCH_PILL_MARGIN,
    marginTop: WA_SEARCH_PILL_TOP_GAP,
    paddingHorizontal: 14,
  },
  searchPlaceholder: {
    fontSize: WA_TYPE_ROW_TITLE,
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
    fontWeight: WA_WEIGHT_SEMIBOLD,
    flex: 1,
    textAlign: 'center',
  },
  subHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: WA_HEADER_CIRCLE_SIZE,
    paddingHorizontal: WA_ROW_LEADING_PADDING,
    paddingTop: 8,
  },
  subHeaderSide: {
    flexDirection: 'row',
    alignItems: 'center',
    minWidth: WA_HEADER_CIRCLE_SIZE,
  },
  backCapsule: {
    width: 'auto',
    minWidth: WA_HEADER_CIRCLE_SIZE,
    paddingHorizontal: 10,
  },
  backContent: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  backBadge: {
    fontSize: WA_TYPE_ROW_TITLE,
    fontWeight: WA_WEIGHT_SEMIBOLD,
    marginLeft: 2,
  },
});
