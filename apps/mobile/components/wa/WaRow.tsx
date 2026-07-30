/**
 * WaRow — the full-bleed chat-row anatomy shared by every flat WhatsApp-style
 * list (Chats list, New-chat contact list, channel sub-rows, resource rows,
 * directory rows).
 *
 * WHATSAPP-DESIGN-SYSTEM.md §3.1: avatar (circle for people/groups/channels,
 * squircle for communities — the one shape-based semantic signal in the
 * system, §6) · title (Semibold when unread, Regular when read) · one-line
 * subtitle/preview · a right column stacking timestamp above
 * badge/mute-dot/chevron · exact leading/gap/trailing metrics from §3.1.
 *
 * Presentational only: takes explicit props, no feature/data-fetching logic.
 * Reads `useTheme()` for neutral grays; brand color is always an explicit
 * `accent` prop (falls back to WhatsApp's own default green) rather than
 * this component calling `useCommunityTheme()` itself.
 */
import React from 'react';
import { View, Text, Pressable, StyleSheet, StyleProp, ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@hooks/useTheme';
import { WaBadge } from './WaBadge';
import { WaAvatar, WA_AVATAR_SQUIRCLE_RATIO } from './WaAvatar';
import {
  WA_ROW_LEADING_PADDING,
  WA_ROW_AVATAR_GAP,
  WA_ROW_TRAILING_PADDING,
  WA_RIGHT_COLUMN_WIDTH,
  WA_RIGHT_COLUMN_GAP,
  WA_MUTED_GLYPH_SIZE,
  WA_GHOST_CARD_OFFSET,
  WA_CHEVRON_SIZE,
  WA_DEFAULT_ACCENT,
} from './metrics';

// --- S6 row density -----------------------------------------------------
//
// WA-VISUAL-DELTAS.md S6.1, measured off the reference screenshots: "avatar
// ~58px … row ~78px" — the biggest single density delta in the audit. The
// calibrated pixel pass (2026-07-29) re-measured the avatar in POINTS at 56,
// which agrees with `metrics.ts`'s `WA_AVATAR_LG`; the 78pt row height is
// unchanged and still supersedes `metrics.ts`'s 76. These live locally and are
// re-exported for the surfaces that have to line up with them.

/**
 * List avatar diameter. S6.1 read it at ~58 off a screenshot; the calibrated
 * pixel pass (2026-07-29, points not pixels) measured 56 — back in line with
 * `metrics.ts`'s `WA_AVATAR_LG`. Row height stays at S6.1's 78.
 */
export const WA_LIST_AVATAR = 56;
/** Row height with a preview line present (S6.1). */
export const WA_LIST_ROW_HEIGHT = 78;
/** Row height for a title-only row. */
export const WA_LIST_ROW_HEIGHT_NO_PREVIEW = 62;
/**
 * Separator inset — the hairline starts where the *title* starts, not where
 * the avatar does (S6.1): leading padding + avatar + gap.
 */
export const WA_LIST_SEPARATOR_INSET =
  WA_ROW_LEADING_PADDING + WA_LIST_AVATAR + WA_ROW_AVATAR_GAP; // 84

export interface WaRowAvatarDescriptor {
  imageUrl?: string | null;
  /** Used for the initials placeholder and as the AppImage accessibility fallback. */
  label: string;
  /** 'circle' for people/groups/channels; 'squircle' is reserved for Communities (§6). */
  shape?: 'circle' | 'squircle';
  /** Defaults to `WA_LIST_AVATAR` (56pt). */
  size?: number;
  /**
   * Stable identity the fallback pastel hue is derived from (S5.2). Prefer a
   * Convex id so a rename doesn't re-color the avatar; defaults to `label`.
   */
  seed?: string;
  /**
   * @deprecated Accepted but ignored. Callers used to pass a flat fill here —
   * usually the community accent, which is exactly the "all-green fallback
   * avatars everywhere" item on S5.2's kill list. Fallback discs are now
   * always the muted per-entity pastel from `waAvatarColor.ts`; drop this prop
   * at the call site.
   */
  backgroundColor?: string;
}

/** Either a pre-built node (full control) or a descriptor this component renders via `AppImage`. */
export type WaRowAvatarProp = React.ReactNode | WaRowAvatarDescriptor;

function isAvatarDescriptor(avatar: WaRowAvatarProp): avatar is WaRowAvatarDescriptor {
  return (
    !!avatar &&
    typeof avatar === 'object' &&
    !React.isValidElement(avatar) &&
    'label' in (avatar as unknown as Record<string, unknown>)
  );
}

function WaRowGhostCards({ isDark }: { isDark: boolean }) {
  // §3.1: 1-2 "ghost" card edges peeking from behind the avatar's top-left
  // corner, signaling "there's more behind this" (communities, multi-channel
  // clusters). Lighter fill / thin border, no content.
  const fill = isDark ? '#233138' : '#ECECEC';
  const border = isDark ? '#2A3942' : '#D8D8D8';
  const radius = WA_LIST_AVATAR * WA_AVATAR_SQUIRCLE_RATIO;
  return (
    <>
      <View
        style={[
          styles.ghostCard,
          {
            width: WA_LIST_AVATAR,
            height: WA_LIST_AVATAR,
            borderRadius: radius,
            backgroundColor: fill,
            borderColor: border,
            top: -WA_GHOST_CARD_OFFSET * 2,
            left: -WA_GHOST_CARD_OFFSET * 2,
          },
        ]}
      />
      <View
        style={[
          styles.ghostCard,
          {
            width: WA_LIST_AVATAR,
            height: WA_LIST_AVATAR,
            borderRadius: radius,
            backgroundColor: fill,
            borderColor: border,
            top: -WA_GHOST_CARD_OFFSET,
            left: -WA_GHOST_CARD_OFFSET,
          },
        ]}
      />
    </>
  );
}

function WaRowAvatar({ avatar, showGhostCards }: { avatar?: WaRowAvatarProp; showGhostCards?: boolean }) {
  const { isDark } = useTheme();
  if (!avatar) return null;

  if (!isAvatarDescriptor(avatar)) {
    return <>{avatar}</>;
  }

  const size = avatar.size ?? WA_LIST_AVATAR;

  const image = (
    <WaAvatar
      imageUrl={avatar.imageUrl}
      label={avatar.label}
      seed={avatar.seed}
      shape={avatar.shape ?? 'circle'}
      size={size}
    />
  );

  if (!showGhostCards) return image;

  return (
    <View style={{ width: size, height: size }}>
      <WaRowGhostCards isDark={isDark} />
      {image}
    </View>
  );
}

export interface WaRowProps {
  /** Node or a `{imageUrl, label, shape, size}` descriptor (§3.1/§6). Omit for an avatar-less row. */
  avatar?: WaRowAvatarProp;
  /** Renders behind the avatar's top-left corner (§3.1: communities / multi-channel clusters). */
  showGhostCards?: boolean;
  title: string;
  /** Row title renders Semibold when true, Regular when false (§2). */
  isUnread?: boolean;
  subtitle?: string;
  /**
   * Subtitle line clamp. S6.1 allows message previews **up to 2 lines**;
   * single-fact subtitles ("12 members", a role) stay on one. Default 1.
   */
  subtitleLines?: number;
  /** Bold-preview "you're mentioned" state (§2) — independent of `isUnread`. */
  subtitleEmphasis?: boolean;
  /** Right column, top line. Accent-colored when `isUnread`, `text.tertiary` otherwise (§1.3/§2). */
  timestamp?: string;
  /** Renders a `WaBadge` when > 0 and `showMutedDot` is false. */
  unreadCount?: number;
  /**
   * S6.3: put the disclosure chevron **inside** the unread capsule ("7 ›")
   * instead of beside it — for rows standing for a container of chats
   * (community, group parent). Ignored when there's no badge to draw.
   */
  badgeChevron?: boolean;
  /** A muted-chat bell-slash renders in place of the badge; the badge itself would stay accent-colored if both were shown (§3.1) — pass at most one of `unreadCount`/`showMutedDot` truthy at a time. */
  showMutedDot?: boolean;
  /** Trailing chevron for navigational (non-chat) full-bleed rows, e.g. a directory/contact list. */
  showChevron?: boolean;
  /** Escape hatch replacing the entire right column, e.g. a "Join" pill button (§8 Directory). */
  rightAccessory?: React.ReactNode;
  /** Brand accent for the unread badge/timestamp. Falls back to WhatsApp's own default green. */
  accent?: string;
  onPress?: () => void;
  onLongPress?: () => void;
  disabled?: boolean;
  /** Overrides the auto height (76pt with a subtitle, 60pt without). */
  height?: number;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function WaRow({
  avatar,
  showGhostCards,
  title,
  isUnread = false,
  subtitle,
  subtitleLines = 1,
  subtitleEmphasis = false,
  timestamp,
  unreadCount,
  badgeChevron = false,
  showMutedDot = false,
  showChevron = false,
  rightAccessory,
  accent = WA_DEFAULT_ACCENT,
  onPress,
  onLongPress,
  disabled,
  height,
  style,
  testID,
}: WaRowProps) {
  const { colors, isDark } = useTheme();
  const minHeight = height ?? (subtitle ? WA_LIST_ROW_HEIGHT : WA_LIST_ROW_HEIGHT_NO_PREVIEW);
  const pressHighlight = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)';

  const content = (
    <View style={[styles.row, { minHeight }, style]}>
      {avatar ? (
        <View style={styles.avatarSlot}>
          <WaRowAvatar avatar={avatar} showGhostCards={showGhostCards} />
        </View>
      ) : null}

      <View style={styles.textColumn}>
        <Text
          style={[styles.title, { color: colors.text }, isUnread && styles.titleUnread]}
          numberOfLines={1}
        >
          {title}
        </Text>
        {subtitle ? (
          <Text
            style={[
              styles.subtitle,
              { color: colors.textSecondary },
              subtitleEmphasis && styles.subtitleEmphasis,
            ]}
            numberOfLines={subtitleLines}
          >
            {subtitle}
          </Text>
        ) : null}
      </View>

      {rightAccessory ? (
        // Unlike the fixed-width timestamp/badge column below, the accessory
        // slot sizes to its content — accessories (Join pills, button pairs)
        // are wider than WA_RIGHT_COLUMN_WIDTH and would overflow the title
        // otherwise; the text column's flex/minWidth absorbs the difference.
        <View style={styles.rightAccessorySlot}>{rightAccessory}</View>
      ) : (
        <View style={styles.rightColumn}>
          {timestamp ? (
            <Text
              style={[
                styles.timestamp,
                { color: isUnread ? accent : colors.textTertiary },
              ]}
              numberOfLines={1}
            >
              {timestamp}
            </Text>
          ) : null}
          <View style={styles.rightColumnBottom}>
            {showMutedDot ? (
              <Ionicons
                name="notifications-off-outline"
                size={WA_MUTED_GLYPH_SIZE}
                color={colors.textTertiary}
                style={showChevron ? styles.rightColumnItemGap : undefined}
              />
            ) : unreadCount && unreadCount > 0 ? (
              <View style={showChevron && !badgeChevron ? styles.rightColumnItemGap : undefined}>
                <WaBadge count={unreadCount} color={accent} showChevron={badgeChevron} />
              </View>
            ) : null}
            {/* The chevron is drawn once: inside the capsule when
                `badgeChevron` and a badge is actually showing (S6.3),
                otherwise as the standalone gray glyph. */}
            {showChevron && !(badgeChevron && !showMutedDot && unreadCount && unreadCount > 0) ? (
              <Ionicons name="chevron-forward" size={WA_CHEVRON_SIZE} color={colors.textTertiary} />
            ) : null}
          </View>
        </View>
      )}
    </View>
  );

  if (!onPress && !onLongPress) {
    return (
      <View testID={testID} accessibilityRole="none">
        {content}
      </View>
    );
  }

  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      onLongPress={onLongPress}
      disabled={disabled}
      style={({ pressed }) => [pressed && { backgroundColor: pressHighlight }]}
    >
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: WA_ROW_LEADING_PADDING,
    paddingRight: WA_ROW_TRAILING_PADDING,
    // Only matters when a 2-line preview outgrows `minHeight`; short rows are
    // still exactly `WA_LIST_ROW_HEIGHT` tall.
    paddingVertical: 8,
  },
  avatarSlot: {
    marginRight: WA_ROW_AVATAR_GAP,
  },
  ghostCard: {
    position: 'absolute',
    borderWidth: StyleSheet.hairlineWidth,
  },
  textColumn: {
    flex: 1,
    minWidth: 0,
    justifyContent: 'center',
  },
  // S6.1: 17pt semibold titles across the board — the reference's read and
  // unread rows share one title weight; unread is signalled by the badge and
  // the green timestamp, not by the name getting heavier.
  title: {
    fontSize: 17,
    fontWeight: '600',
  },
  titleUnread: {
    fontWeight: '600',
  },
  subtitle: {
    fontSize: 15,
    marginTop: 2,
    fontWeight: '400',
  },
  subtitleEmphasis: {
    fontWeight: '600',
  },
  rightColumn: {
    width: WA_RIGHT_COLUMN_WIDTH,
    alignItems: 'flex-end',
    justifyContent: 'flex-start',
    alignSelf: 'stretch',
    paddingTop: 2,
    marginLeft: 8,
  },
  rightAccessorySlot: {
    flexShrink: 0,
    alignItems: 'flex-end',
    justifyContent: 'center',
    marginLeft: 8,
  },
  rightColumnBottom: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: WA_RIGHT_COLUMN_GAP,
  },
  rightColumnItemGap: {
    marginRight: 4,
  },
  timestamp: {
    // S6.1/S6.2: 15pt, not the 13pt footnote size — the timestamp is a peer
    // of the subtitle in the reference, not a caption.
    fontSize: 15,
  },
});
