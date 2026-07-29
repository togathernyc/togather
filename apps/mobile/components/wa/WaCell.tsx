/**
 * WaCell — one row inside a `WaInsetGroup` card.
 *
 * WHATSAPP-DESIGN-SYSTEM.md §3.2: plain flat monochrome icon glyph (never a
 * colored rounded-square background chip — "the single most common mistake"
 * per the spec), title, optional right-aligned value label, chevron. Five
 * row variants (§3.2/§1.4 + WA-VISUAL-DELTAS.md S3.6):
 * - `navigational` — title (+ optional value) + chevron.
 * - `toggle` — title (+ optional description sub-line) + native `Switch`
 *   (never a custom toggle component, per §6).
 * - `action` — plain accent-colored text, no icon, no chevron (§1.3: "Add to
 *   Favorites", "Export chat").
 * - `destructive` — plain red text, no icon, no chevron, never brand-mapped
 *   (§1.4). Pass `centered` for the modal/action-sheet rendering (20pt,
 *   centered, own row) instead of the default inline-grouped rendering
 *   (17pt, left-aligned) — §1.4 documents both.
 * - `footer` — gray left-aligned metadata text inside the card ("Created by
 *   … Created Jul 27, 2024.", S3.6). Not tappable-looking: 13pt, no icon, no
 *   chevron, wraps freely.
 *
 * WA-VISUAL-DELTAS.md S3.2 recalibrations applied here (the screenshots
 * supersede the design-system prose):
 * - Cell icons default to `colors.text` — BLACK 24pt line glyphs, not the
 *   thin `text.secondary` gray the audit flagged. Callers that genuinely
 *   need a tinted glyph still pass `iconColor` (e.g. a WhatsApp/Telegram
 *   brand mark on an external-chat row).
 * - The trailing value+chevron block is explicitly vertically centered, so a
 *   cell that grows past one line (a `description` sub-line) can't leave the
 *   chevron hugging the row's top-right corner (S3.3).
 *
 * `trailingAccessory` (navigational variant only) is an escape hatch that
 * replaces the default value+chevron block with an arbitrary node — e.g. a
 * tappable copy-icon button (Invite kit's per-group links, §8: "per-group
 * links as WaCells with copy accessories"). Purely additive: omitting it
 * keeps the standard value/chevron rendering exactly as before.
 *
 * Presentational only: reads `useTheme()` for neutral grays/destructive red;
 * brand accent is an explicit prop, never read from community theme here.
 */
import React from 'react';
import { View, Text, Pressable, Switch, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@hooks/useTheme';
import {
  WA_CELL_MIN_HEIGHT,
  WA_CELL_TALL_MIN_HEIGHT,
  WA_CELL_PADDING,
  WA_CELL_ICON_SIZE,
  WA_CELL_ICON_COLUMN,
  WA_CELL_ICON_LABEL_GAP,
  WA_CHEVRON_SIZE,
  WA_CHEVRON_GAP,
  WA_SECTION_FOOTER_SIZE,
  WA_DEFAULT_ACCENT,
} from './metrics';

export type WaCellVariant =
  | 'navigational'
  | 'toggle'
  | 'action'
  | 'destructive'
  | 'footer';

export interface WaCellProps {
  /** Monochrome glyph (Ionicons name). Omit for icon-less cells (action/destructive variants never show one). */
  icon?: keyof typeof Ionicons.glyphMap;
  /** Escape hatch for a custom icon node instead of `icon`. */
  iconNode?: React.ReactNode;
  /** Overrides the icon's default neutral color. */
  iconColor?: string;
  title: string;
  /** Sub-line under the title (e.g. "Lock chat"'s explanatory text) — grows the cell to the tall variant. */
  description?: string;
  /** Right-aligned value before the chevron, e.g. "5.4 MB", "Off", "On" (`navigational` only). */
  value?: string;
  /** Replaces the default value+chevron block entirely (`navigational` only) — e.g. a copy-icon button. */
  trailingAccessory?: React.ReactNode;
  variant?: WaCellVariant;
  /** `toggle` only. */
  toggleValue?: boolean;
  onToggleChange?: (value: boolean) => void;
  /** `action`/`destructive` only — the modal/action-sheet centered rendering (§1.4) instead of the inline-grouped one. */
  centered?: boolean;
  /** Brand accent for `action` text / toggle-on track. Falls back to WhatsApp's own default green. */
  accent?: string;
  onPress?: () => void;
  disabled?: boolean;
  testID?: string;
}

export function WaCell({
  icon,
  iconNode,
  iconColor,
  title,
  description,
  value,
  trailingAccessory,
  variant = 'navigational',
  toggleValue,
  onToggleChange,
  centered = false,
  accent = WA_DEFAULT_ACCENT,
  onPress,
  disabled,
  testID,
}: WaCellProps) {
  const { colors, isDark } = useTheme();
  const minHeight = description ? WA_CELL_TALL_MIN_HEIGHT : WA_CELL_MIN_HEIGHT;

  // S3.6 gray footer metadata, rendered as a row inside the card rather than
  // below it (WaInsetGroup's own `footer` prop covers the below-card case).
  if (variant === 'footer') {
    return (
      <View testID={testID} accessibilityRole="none">
        <View style={styles.footerRow}>
          <Text style={[styles.footerText, { color: colors.textTertiary }]}>{title}</Text>
        </View>
      </View>
    );
  }

  if (variant === 'action' || variant === 'destructive') {
    const tone = variant === 'destructive' ? colors.destructive : accent;
    return (
      <RowContainer onPress={onPress} disabled={disabled} testID={testID} isDark={isDark}>
        <View
          style={[
            styles.plainRow,
            { minHeight: centered ? WA_CELL_MIN_HEIGHT : minHeight },
            centered && styles.centeredRow,
          ]}
        >
          <Text
            style={[
              centered ? styles.centeredText : styles.plainText,
              { color: tone },
            ]}
            numberOfLines={1}
          >
            {title}
          </Text>
        </View>
      </RowContainer>
    );
  }

  return (
    <RowContainer onPress={onPress} disabled={disabled} testID={testID} isDark={isDark}>
      <View style={[styles.row, { minHeight }]}>
        {icon || iconNode ? (
          <View style={styles.iconColumn}>
            {iconNode ??
              (icon ? (
                // S3.2: black line glyph by default — `colors.text`, not the
                // thin `text.secondary` gray the pre-pass used.
                <Ionicons name={icon} size={WA_CELL_ICON_SIZE} color={iconColor ?? colors.text} />
              ) : null)}
          </View>
        ) : null}

        <View style={styles.textColumn}>
          <Text style={[styles.title, { color: colors.text }]} numberOfLines={1}>
            {title}
          </Text>
          {description ? (
            <Text style={[styles.description, { color: colors.textTertiary }]}>{description}</Text>
          ) : null}
        </View>

        {variant === 'toggle' ? (
          <Switch
            value={!!toggleValue}
            onValueChange={onToggleChange}
            trackColor={{ false: colors.textTertiary, true: accent }}
            thumbColor="#FFFFFF"
            disabled={disabled}
          />
        ) : trailingAccessory ? (
          trailingAccessory
        ) : (
          // S3.3: the value+chevron block is its own vertically-centered
          // cluster. Left as bare siblings of a `description`-grown text
          // column, the chevron rode the row's top-right corner.
          <View style={styles.trailing}>
            {value ? (
              <Text style={[styles.value, { color: colors.textTertiary }]} numberOfLines={1}>
                {value}
              </Text>
            ) : null}
            <Ionicons
              name="chevron-forward"
              size={WA_CHEVRON_SIZE}
              color={colors.textTertiary}
              style={styles.chevron}
            />
          </View>
        )}
      </View>
    </RowContainer>
  );
}

function RowContainer({
  children,
  onPress,
  disabled,
  testID,
  isDark,
}: {
  children: React.ReactNode;
  onPress?: () => void;
  disabled?: boolean;
  testID?: string;
  isDark: boolean;
}) {
  if (!onPress) {
    return (
      <View testID={testID} accessibilityRole="none">
        {children}
      </View>
    );
  }
  const pressHighlight = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)';
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [pressed && { backgroundColor: pressHighlight }]}
    >
      {children}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: WA_CELL_PADDING,
  },
  iconColumn: {
    width: WA_CELL_ICON_COLUMN,
    alignItems: 'flex-start',
    justifyContent: 'center',
    marginRight: WA_CELL_ICON_LABEL_GAP,
  },
  textColumn: {
    flex: 1,
    minWidth: 0,
    justifyContent: 'center',
    marginRight: 8,
  },
  title: {
    fontSize: 17,
    fontWeight: '400',
  },
  description: {
    fontSize: 13,
    marginTop: 2,
  },
  trailing: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'center',
    flexShrink: 0,
  },
  chevron: {
    alignSelf: 'center',
  },
  value: {
    fontSize: 17,
    marginRight: WA_CHEVRON_GAP,
  },
  footerRow: {
    paddingHorizontal: WA_CELL_PADDING,
    paddingVertical: 12,
  },
  footerText: {
    fontSize: WA_SECTION_FOOTER_SIZE,
    fontWeight: '400',
    lineHeight: 18,
  },
  plainRow: {
    justifyContent: 'center',
    paddingHorizontal: WA_CELL_PADDING,
  },
  plainText: {
    fontSize: 17,
    fontWeight: '400',
  },
  centeredRow: {
    alignItems: 'center',
  },
  centeredText: {
    fontSize: 20,
    fontWeight: '400',
  },
});
