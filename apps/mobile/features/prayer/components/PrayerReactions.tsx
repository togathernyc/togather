/**
 * PrayerReactions — the reaction row that hangs off the bottom of a prayer
 * request card or a follow-up (update / praise report) card on the prayer
 * detail screens.
 *
 * Mirrors the chat reactions UX (badge pills + a ＋ picker + a "who reacted"
 * long-press modal) but is self-contained for the prayer surface: it reads the
 * aggregated `{ emoji, count, hasReacted }[]` that `prayers.getDetail` already
 * folds in, and writes through `prayers.reactions.toggleReaction`. Convex
 * reactivity re-renders the detail screen after each toggle, so no local
 * optimistic state is needed.
 */
import React, { useCallback, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Modal,
  TouchableOpacity,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@hooks/useTheme';
import { useAuthenticatedMutation, api } from '@services/api/convex';
import { PrayerReactionDetailsModal } from './PrayerReactionDetailsModal';

export type PrayerReactionTargetType = 'prayer' | 'followUp';

/**
 * Curated reaction set shown in the picker — the display mirror of the
 * server-side allowlist `PRAYER_REACTION_EMOJIS` in
 * apps/convex/functions/prayers/reactions.ts. Keep the two in sync: the server
 * rejects anything not on its list, so adding an emoji here alone does nothing.
 */
export const PRAYER_REACTION_EMOJIS = [
  '❤️', // Love & support
  '🙏', // Praying with you / amen
  '🎉', // Celebrate
  '🙌', // Praise / hallelujah
  '🕊️', // Peace & comfort
  '🥹', // Deeply moved
] as const;

// Chat's blue "your own reaction" highlight, reused verbatim for consistency.
const OWN_REACTION_BG = '#E3F2FD';
const OWN_REACTION_BORDER = '#1976D2';

interface AggregatedReaction {
  emoji: string;
  count: number;
  hasReacted: boolean;
}

interface PrayerReactionsProps {
  targetType: PrayerReactionTargetType;
  targetId: string;
  reactions: AggregatedReaction[];
  /**
   * Whether the current viewer may add/toggle a reaction. Defaults to true.
   * Set to false on an anonymous prayer's author's *own* cards: reacting there
   * would attribute the author by real name in the "who reacted" list and
   * defeat the prayer's anonymity (the server enforces the same block). When
   * false, existing badges still render and long-press "who reacted" still
   * works, but the ＋ picker is hidden and tapping a badge does not toggle.
   */
  canReact?: boolean;
}

export function PrayerReactions({
  targetType,
  targetId,
  reactions,
  canReact = true,
}: PrayerReactionsProps) {
  const { colors } = useTheme();
  const toggleReaction = useAuthenticatedMutation(
    api.functions.prayers.reactions.toggleReaction,
  );

  const addButtonRef = useRef<View>(null);
  const [pickerVisible, setPickerVisible] = useState(false);
  const [pickerPos, setPickerPos] = useState<{ top: number; left: number } | null>(
    null,
  );
  const [detailsEmoji, setDetailsEmoji] = useState<string | null>(null);

  const handleToggle = useCallback(
    (emoji: string) => {
      // Fire-and-forget; Convex reactivity refreshes getDetail. Swallow errors
      // (e.g. a race where access was revoked) rather than crashing the screen.
      void toggleReaction({ targetType, targetId, emoji }).catch(() => {});
    },
    [toggleReaction, targetType, targetId],
  );

  const openPicker = useCallback(() => {
    const node = addButtonRef.current;
    if (node) {
      node.measureInWindow((x, y) => {
        // Anchor the bar just above the ＋ button, nudged left so the 6-emoji
        // row stays on-screen.
        setPickerPos({ top: Math.max(y - 60, 40), left: Math.max(x - 120, 12) });
        setPickerVisible(true);
      });
    } else {
      setPickerVisible(true);
    }
  }, []);

  const handlePickEmoji = useCallback(
    (emoji: string) => {
      setPickerVisible(false);
      handleToggle(emoji);
    },
    [handleToggle],
  );

  return (
    <View style={styles.row}>
      {reactions.map((reaction) => (
        <Pressable
          key={reaction.emoji}
          style={[
            styles.badge,
            {
              backgroundColor: colors.surfaceSecondary,
              borderColor: colors.border,
            },
            reaction.hasReacted && {
              backgroundColor: OWN_REACTION_BG,
              borderColor: OWN_REACTION_BORDER,
            },
          ]}
          onPress={canReact ? () => handleToggle(reaction.emoji) : undefined}
          onLongPress={() => setDetailsEmoji(reaction.emoji)}
          delayLongPress={300}
        >
          <Text style={styles.badgeEmoji}>{reaction.emoji}</Text>
          {reaction.count > 1 && (
            <Text style={[styles.badgeCount, { color: colors.textSecondary }]}>
              {reaction.count}
            </Text>
          )}
        </Pressable>
      ))}

      {/* ＋ button opens the curated reaction bar (hidden when the viewer may
          not react — e.g. an anonymous prayer's author on their own card). */}
      {canReact && (
        <Pressable
          ref={addButtonRef}
          onPress={openPicker}
          style={[styles.addButton, { borderColor: colors.border }]}
          accessibilityRole="button"
          accessibilityLabel="Add a reaction"
        >
          <Ionicons name="add" size={16} color={colors.textTertiary} />
        </Pressable>
      )}

      {/* Picker popover */}
      <Modal
        visible={pickerVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setPickerVisible(false)}
      >
        <Pressable style={styles.pickerBackdrop} onPress={() => setPickerVisible(false)}>
          <View
            style={[
              styles.pickerBar,
              { backgroundColor: colors.surface, borderColor: colors.border },
              pickerPos
                ? { position: 'absolute', top: pickerPos.top, left: pickerPos.left }
                : null,
            ]}
          >
            {PRAYER_REACTION_EMOJIS.map((emoji) => (
              <TouchableOpacity
                key={emoji}
                style={styles.pickerButton}
                onPress={() => handlePickEmoji(emoji)}
                activeOpacity={0.7}
              >
                <Text style={styles.pickerEmoji}>{emoji}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </Pressable>
      </Modal>

      {/* Long-press "who reacted" list */}
      <PrayerReactionDetailsModal
        visible={detailsEmoji !== null}
        emoji={detailsEmoji}
        targetType={targetType}
        targetId={targetId}
        onClose={() => setDetailsEmoji(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    marginTop: 12,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 5,
    marginRight: 6,
    marginBottom: 6,
    borderWidth: 1,
  },
  badgeEmoji: { fontSize: 15 },
  badgeCount: { fontSize: 12, fontWeight: '600', marginLeft: 5 },
  addButton: {
    width: 32,
    height: 30,
    borderRadius: 14,
    borderWidth: 1,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
  },
  pickerBackdrop: { flex: 1 },
  pickerBar: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 24,
    borderWidth: 1,
    paddingHorizontal: 6,
    paddingVertical: 4,
    // Centered fallback when we couldn't measure the ＋ button.
    alignSelf: 'center',
    marginTop: 120,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 4,
  },
  pickerButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pickerEmoji: { fontSize: 24 },
});
