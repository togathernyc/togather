/**
 * PrayedCard — visual card for a prayer the user has already prayed for.
 * Used in the horizontal rail under the feed (variant="rail") and in the
 * full history list screen (variant="list").
 *
 * Anonymity contract: avatar shows eye-off icon when authorDisplayName is
 * null. Same deterministic-color initials avatar pattern as the main feed
 * card.
 */

import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@hooks/useTheme';

const COMPLETED_GREEN = '#34C759';

const AVATAR_COLORS = [
  '#FFB4A2', '#FFD6A5', '#FDFFB6', '#CAFFBF',
  '#9BF6FF', '#A0C4FF', '#BDB2FF', '#FFC6FF',
];

function hashToIndex(input: string, mod: number): number {
  let h = 0;
  for (let i = 0; i < input.length; i++) h = (h * 31 + input.charCodeAt(i)) & 0xffffffff;
  return Math.abs(h) % mod;
}

function avatarBgFor(name: string): string {
  return AVATAR_COLORS[hashToIndex(name, AVATAR_COLORS.length)];
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 1).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function relativeTime(ts: number): string {
  const diffMs = Date.now() - ts;
  const min = Math.round(diffMs / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.round(hr / 24);
  if (d < 7) return `${d}d ago`;
  const w = Math.round(d / 7);
  if (w < 5) return `${w}w ago`;
  const mo = Math.round(d / 30);
  if (mo < 12) return `${mo}mo ago`;
  return `${Math.round(d / 365)}y ago`;
}

export interface PrayedPrayerSummary {
  id: string;
  bodyText: string;
  status: 'active' | 'answered' | 'archived';
  authorDisplayName: string | null;
  prayedAt: number;
  hasNewUpdate: boolean;
  crisisFlag: boolean;
}

export function PrayedCard({
  prayer,
  onPress,
  variant,
}: {
  prayer: PrayedPrayerSummary;
  onPress: () => void;
  variant: 'rail' | 'list';
}) {
  const { colors } = useTheme();

  const isAnonymous = prayer.authorDisplayName == null;
  const authorLabel = prayer.authorDisplayName ?? 'Anonymous';
  const avatarBg = isAnonymous ? '#E5E5EA' : avatarBgFor(authorLabel);
  const avatarInitials = isAnonymous ? '?' : initialsOf(authorLabel);

  const isRail = variant === 'rail';

  return (
    <TouchableOpacity
      style={[
        isRail ? styles.cardRail : styles.cardList,
        { backgroundColor: colors.surface, borderColor: colors.border },
      ]}
      onPress={onPress}
      activeOpacity={0.85}
    >
      <View style={styles.headerRow}>
        <View style={[styles.avatar, { backgroundColor: avatarBg }]}>
          {isAnonymous ? (
            <Ionicons name="eye-off-outline" size={14} color="#5C5C66" />
          ) : (
            <Text style={styles.avatarText}>{avatarInitials}</Text>
          )}
        </View>
        <View style={styles.headerText}>
          <Text
            style={[styles.author, { color: colors.text }]}
            numberOfLines={1}
          >
            {authorLabel}
          </Text>
          <Text style={[styles.meta, { color: colors.textTertiary }]} numberOfLines={1}>
            You prayed {relativeTime(prayer.prayedAt)}
          </Text>
        </View>
        {prayer.hasNewUpdate ? (
          <View style={[styles.updateDot, { backgroundColor: COMPLETED_GREEN }]} />
        ) : null}
      </View>

      <Text
        style={[styles.body, { color: colors.text }]}
        numberOfLines={isRail ? 3 : 4}
      >
        {prayer.bodyText}
      </Text>

      {prayer.status !== 'active' ? (
        <View style={styles.statusRow}>
          {prayer.status === 'answered' ? (
            <View style={[styles.statusBadge, { backgroundColor: COMPLETED_GREEN }]}>
              <Ionicons name="checkmark" size={11} color="#fff" />
              <Text style={styles.statusBadgeText}>Answered</Text>
            </View>
          ) : (
            <View style={[styles.statusBadge, { backgroundColor: colors.textTertiary }]}>
              <Text style={styles.statusBadgeText}>Archived</Text>
            </View>
          )}
        </View>
      ) : null}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  cardRail: {
    width: 240,
    minHeight: 140,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 12,
  },
  cardList: {
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 14,
    marginBottom: 10,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  avatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { fontSize: 11, fontWeight: '700', color: '#3A3A3F' },
  headerText: { flex: 1, minWidth: 0 },
  author: { fontSize: 13, fontWeight: '700' },
  meta: { fontSize: 11, marginTop: 1 },
  updateDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  body: {
    fontSize: 13,
    lineHeight: 18,
  },
  statusRow: {
    flexDirection: 'row',
    marginTop: 8,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 8,
  },
  statusBadgeText: { color: '#fff', fontSize: 10, fontWeight: '600' },
});
