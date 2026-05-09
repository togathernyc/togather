/**
 * PollCard — visual poll surface rendered inside a chat message.
 *
 * Pure-ish component: receives the resolved poll + viewer's vote selection
 * and a `castVote(optionIds)` callback. Local optimistic state covers the
 * gap between tap and Convex round-trip so the UI doesn't feel laggy on
 * slow connections.
 *
 * For multi-select polls, taps toggle options into a draft selection and
 * the user submits with the "Vote" button. For single-select, a tap
 * commits immediately.
 */
import React, { useEffect, useMemo, useState, useCallback } from 'react';
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@hooks/useTheme';

export interface PollCardOption {
  id: string;
  text: string;
  count: number;
}

export interface PollCardProps {
  question: string;
  options: PollCardOption[];
  allowMultiple: boolean;
  status: 'active' | 'closed';
  voteCount: number;
  voterCount: number;
  myVoteOptionIds: string[];
  editCount: number;
  permissions: {
    canVote: boolean;
    canEdit: boolean;
    canClose: boolean;
    canDelete: boolean;
  };
  onCastVote: (optionIds: string[]) => Promise<void>;
  onEdit: () => void;
  onClose: () => void;
  onDelete: () => void;
  onShowVoters: () => void;
}

export function PollCard({
  question,
  options,
  allowMultiple,
  status,
  voteCount,
  voterCount,
  myVoteOptionIds,
  editCount,
  permissions,
  onCastVote,
  onEdit,
  onClose,
  onDelete,
  onShowVoters,
}: PollCardProps) {
  const { colors } = useTheme();
  const isClosed = status === 'closed';
  const [pendingSelection, setPendingSelection] = useState<string[]>(myVoteOptionIds);
  const [submitting, setSubmitting] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  // Whenever the server view of the viewer's votes changes, reset the
  // local draft so we don't carry an unsubmitted selection past a server
  // sync. This also resets after a successful submit.
  useEffect(() => {
    setPendingSelection(myVoteOptionIds);
  }, [myVoteOptionIds.join('|')]);

  const totalVotes = useMemo(
    () => options.reduce((sum, o) => sum + o.count, 0),
    [options],
  );
  const maxCount = useMemo(
    () => options.reduce((m, o) => Math.max(m, o.count), 0),
    [options],
  );

  const hasUnsavedDraft = useMemo(() => {
    if (!allowMultiple) return false;
    if (pendingSelection.length !== myVoteOptionIds.length) return true;
    const a = [...pendingSelection].sort().join('|');
    const b = [...myVoteOptionIds].sort().join('|');
    return a !== b;
  }, [allowMultiple, pendingSelection, myVoteOptionIds]);

  const handleOptionPress = useCallback(
    async (optionId: string) => {
      if (isClosed || !permissions.canVote || submitting) return;

      if (allowMultiple) {
        setPendingSelection((prev) =>
          prev.includes(optionId)
            ? prev.filter((id) => id !== optionId)
            : [...prev, optionId],
        );
        return;
      }

      // Single-select: commit immediately. Tapping the already-selected
      // option clears it (toggle off).
      const next = myVoteOptionIds.includes(optionId) ? [] : [optionId];
      setPendingSelection(next);
      setSubmitting(true);
      try {
        await onCastVote(next);
      } catch (e: any) {
        // Revert local on failure.
        setPendingSelection(myVoteOptionIds);
        Alert.alert('Vote failed', e?.data?.message || e?.message || 'Try again.');
      } finally {
        setSubmitting(false);
      }
    },
    [allowMultiple, isClosed, permissions.canVote, submitting, myVoteOptionIds, onCastVote],
  );

  const handleSubmitMulti = useCallback(async () => {
    if (!allowMultiple || submitting) return;
    setSubmitting(true);
    try {
      await onCastVote(pendingSelection);
    } catch (e: any) {
      setPendingSelection(myVoteOptionIds);
      Alert.alert('Vote failed', e?.data?.message || e?.message || 'Try again.');
    } finally {
      setSubmitting(false);
    }
  }, [allowMultiple, submitting, pendingSelection, myVoteOptionIds, onCastVote]);

  const showMenu = permissions.canEdit || permissions.canClose || permissions.canDelete;

  const handleMenuItem = useCallback(
    (action: 'edit' | 'close' | 'delete') => {
      setMenuOpen(false);
      if (action === 'edit') return onEdit();
      if (action === 'close') {
        Alert.alert('Close poll?', 'Voters will no longer be able to change their votes.', [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Close poll', style: 'destructive', onPress: onClose },
        ]);
        return;
      }
      if (action === 'delete') {
        Alert.alert('Delete poll?', 'This removes the poll and all votes. Cannot be undone.', [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Delete', style: 'destructive', onPress: onDelete },
        ]);
        return;
      }
    },
    [onEdit, onClose, onDelete],
  );

  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: colors.surface,
          borderColor: colors.border,
        },
      ]}
    >
      {/* Header: question + (•••) menu */}
      <View style={styles.headerRow}>
        <View style={styles.headerTextWrap}>
          <View style={styles.headerBadgeRow}>
            <Ionicons name="bar-chart" size={14} color={colors.textSecondary} />
            <Text style={[styles.headerBadge, { color: colors.textSecondary }]}>
              {isClosed ? 'Poll · Closed' : allowMultiple ? 'Poll · Multiple choice' : 'Poll'}
            </Text>
          </View>
          <Text style={[styles.question, { color: colors.text }]}>{question}</Text>
        </View>
        {showMenu && (
          <Pressable
            onPress={() => setMenuOpen((v) => !v)}
            hitSlop={8}
            style={styles.menuButton}
          >
            <Ionicons name="ellipsis-horizontal" size={20} color={colors.textSecondary} />
          </Pressable>
        )}
      </View>

      {/* Inline action menu */}
      {menuOpen && showMenu && (
        <View
          style={[
            styles.menu,
            { backgroundColor: colors.surfaceSecondary, borderColor: colors.border },
          ]}
        >
          {permissions.canEdit && (
            <Pressable style={styles.menuItem} onPress={() => handleMenuItem('edit')}>
              <Ionicons name="create-outline" size={16} color={colors.text} />
              <Text style={[styles.menuLabel, { color: colors.text }]}>Edit poll</Text>
            </Pressable>
          )}
          {permissions.canClose && (
            <Pressable style={styles.menuItem} onPress={() => handleMenuItem('close')}>
              <Ionicons name="lock-closed-outline" size={16} color={colors.text} />
              <Text style={[styles.menuLabel, { color: colors.text }]}>Close poll</Text>
            </Pressable>
          )}
          {permissions.canDelete && (
            <Pressable style={styles.menuItem} onPress={() => handleMenuItem('delete')}>
              <Ionicons name="trash-outline" size={16} color={colors.error} />
              <Text style={[styles.menuLabel, { color: colors.error }]}>Delete poll</Text>
            </Pressable>
          )}
        </View>
      )}

      {/* Options */}
      <View style={styles.options}>
        {options.map((opt) => {
          const selected = allowMultiple
            ? pendingSelection.includes(opt.id)
            : myVoteOptionIds.includes(opt.id);
          const isWinner = isClosed && opt.count === maxCount && opt.count > 0;
          const pct = totalVotes > 0 ? Math.round((opt.count / totalVotes) * 100) : 0;
          return (
            <Pressable
              key={opt.id}
              onPress={() => handleOptionPress(opt.id)}
              disabled={isClosed || !permissions.canVote || submitting}
              style={({ pressed }) => [
                styles.optionRow,
                { borderColor: selected ? colors.link : colors.border },
                pressed && !isClosed && { opacity: 0.7 },
              ]}
            >
              {/* Background bar showing share — shown once any vote exists. */}
              {totalVotes > 0 && (
                <View
                  style={[
                    styles.optionBar,
                    {
                      width: `${pct}%`,
                      backgroundColor: isWinner
                        ? `${colors.link}33`
                        : selected
                        ? `${colors.link}22`
                        : colors.surfaceSecondary,
                    },
                  ]}
                />
              )}
              <View style={styles.optionContent}>
                <View
                  style={[
                    allowMultiple ? styles.checkbox : styles.radio,
                    {
                      borderColor: selected ? colors.link : colors.border,
                      backgroundColor: selected ? colors.link : 'transparent',
                    },
                  ]}
                >
                  {selected &&
                    (allowMultiple ? (
                      <Ionicons name="checkmark" size={14} color="#fff" />
                    ) : (
                      <View style={styles.radioInner} />
                    ))}
                </View>
                <Text
                  style={[styles.optionText, { color: colors.text }]}
                  numberOfLines={2}
                >
                  {opt.text}
                </Text>
                {totalVotes > 0 && (
                  <Text style={[styles.optionCount, { color: colors.textSecondary }]}>
                    {opt.count}
                  </Text>
                )}
              </View>
            </Pressable>
          );
        })}
      </View>

      {/* Multi-select submit row */}
      {allowMultiple && !isClosed && permissions.canVote && hasUnsavedDraft && (
        <Pressable
          onPress={handleSubmitMulti}
          disabled={submitting}
          style={[
            styles.submitButton,
            { backgroundColor: colors.link, opacity: submitting ? 0.6 : 1 },
          ]}
        >
          {submitting ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Text style={styles.submitLabel}>
              {myVoteOptionIds.length > 0 ? 'Update vote' : 'Vote'}
            </Text>
          )}
        </Pressable>
      )}

      {/* Footer — tap opens the voter list sheet (gated when there are
          votes; tapping a "No votes yet" footer is a no-op). */}
      <Pressable
        onPress={voterCount > 0 ? onShowVoters : undefined}
        disabled={voterCount === 0}
        style={({ pressed }) => [styles.footer, pressed && voterCount > 0 && styles.footerPressed]}
        hitSlop={6}
      >
        <Text style={[styles.footerText, { color: colors.textSecondary }]}>
          {voterCount === 0
            ? 'No votes yet'
            : `${voterCount} ${voterCount === 1 ? 'voter' : 'voters'} · ${voteCount} ${
                voteCount === 1 ? 'vote' : 'votes'
              }`}
        </Text>
        {voterCount > 0 && (
          <Ionicons name="chevron-forward" size={14} color={colors.textTertiary} />
        )}
        {editCount > 0 && (
          <Text style={[styles.footerEdited, { color: colors.textTertiary }]}>edited</Text>
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 14,
    padding: 12,
    minWidth: 240,
    maxWidth: 360,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  headerTextWrap: {
    flex: 1,
  },
  headerBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginBottom: 4,
  },
  headerBadge: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.3,
    textTransform: 'uppercase',
  },
  question: {
    fontSize: 15,
    fontWeight: '600',
    lineHeight: 20,
  },
  menuButton: {
    padding: 4,
  },
  menu: {
    marginTop: 8,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  menuLabel: {
    fontSize: 14,
    fontWeight: '500',
  },
  options: {
    marginTop: 12,
    gap: 8,
  },
  optionRow: {
    borderWidth: 1,
    borderRadius: 10,
    overflow: 'hidden',
    minHeight: 40,
    justifyContent: 'center',
  },
  optionBar: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
  },
  optionContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  radio: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioInner: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#fff',
  },
  checkbox: {
    width: 18,
    height: 18,
    borderRadius: 4,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  optionText: {
    flex: 1,
    fontSize: 14,
  },
  optionCount: {
    fontSize: 13,
    fontWeight: '600',
    minWidth: 24,
    textAlign: 'right',
  },
  submitButton: {
    marginTop: 12,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
  },
  submitLabel: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 10,
    gap: 8,
  },
  footerPressed: {
    opacity: 0.6,
  },
  footerText: {
    fontSize: 12,
    flex: 1,
  },
  footerEdited: {
    fontSize: 12,
    fontStyle: 'italic',
  },
});
