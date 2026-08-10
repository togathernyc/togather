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
import { useCommunityTheme } from '@hooks/useCommunityTheme';
import { useWhatsappShell } from '@hooks/useWhatsappShell';
import {
  WA_GROUP_RADIUS,
  WA_TYPE_FOOTNOTE,
  WA_TYPE_ROW_TITLE,
  WA_TYPE_SUBTITLE,
  WA_WEIGHT_REGULAR,
  WA_WEIGHT_SEMIBOLD,
} from '@components/wa';

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
  const wa = useWhatsappShell();
  const { primaryColor } = useCommunityTheme();

  const isAnonymous = prayer.authorDisplayName == null;
  const authorLabel = prayer.authorDisplayName ?? 'Anonymous';
  const avatarBg = isAnonymous ? '#E5E5EA' : avatarBgFor(authorLabel);
  const avatarInitials = isAnonymous ? '?' : initialsOf(authorLabel);

  const isRail = variant === 'rail';

  return (
    <TouchableOpacity
      style={[
        isRail ? styles.cardRail : styles.cardList,
        wa && (isRail ? waStyles.cardRail : waStyles.cardList),
        { backgroundColor: colors.surface, borderColor: colors.border },
      ]}
      onPress={onPress}
      activeOpacity={0.85}
    >
      <View style={[styles.headerRow, wa && waStyles.headerRow]}>
        <View style={[styles.avatar, wa && waStyles.avatar, { backgroundColor: avatarBg }]}>
          {isAnonymous ? (
            <Ionicons name="eye-off-outline" size={wa ? 16 : 14} color="#5C5C66" />
          ) : (
            <Text style={[styles.avatarText, wa && waStyles.avatarText]}>{avatarInitials}</Text>
          )}
        </View>
        <View style={styles.headerText}>
          <Text
            style={[styles.author, wa && waStyles.author, { color: colors.text }]}
            numberOfLines={1}
          >
            {authorLabel}
          </Text>
          <Text
            style={[styles.meta, wa && waStyles.meta, { color: colors.textTertiary }]}
            numberOfLines={1}
          >
            You prayed {relativeTime(prayer.prayedAt)}
          </Text>
        </View>
        {prayer.hasNewUpdate ? (
          // A "there's an update" dot is exactly WhatsApp's unread badge, and
          // S5.1 keeps accent on unread indicators — so flag-on it takes the
          // community accent instead of iOS system green.
          <View
            style={[
              styles.updateDot,
              { backgroundColor: wa ? primaryColor : COMPLETED_GREEN },
            ]}
          />
        ) : null}
      </View>

      <Text
        style={[styles.body, wa && waStyles.body, { color: colors.text }]}
        numberOfLines={isRail ? 3 : 4}
      >
        {prayer.bodyText}
      </Text>

      {prayer.status !== 'active' ? (
        <View style={[styles.statusRow, wa && waStyles.statusRow]}>
          {/*
           * §7 bans colored taxonomy chips: flag-on both statuses render as the
           * same neutral gray capsule with dark text, distinguished by the word
           * in it — never by hue, and never with white-on-green.
           */}
          {prayer.status === 'answered' ? (
            <View
              style={[
                styles.statusBadge,
                wa && waStyles.statusBadge,
                { backgroundColor: wa ? colors.surfaceSecondary : COMPLETED_GREEN },
              ]}
            >
              {wa ? null : <Ionicons name="checkmark" size={11} color="#fff" />}
              <Text
                style={[
                  styles.statusBadgeText,
                  wa && waStyles.statusBadgeText,
                  wa && { color: colors.textSecondary },
                ]}
              >
                Answered
              </Text>
            </View>
          ) : (
            <View
              style={[
                styles.statusBadge,
                wa && waStyles.statusBadge,
                { backgroundColor: wa ? colors.surfaceSecondary : colors.textTertiary },
              ]}
            >
              <Text
                style={[
                  styles.statusBadgeText,
                  wa && waStyles.statusBadgeText,
                  wa && { color: colors.textSecondary },
                ]}
              >
                Archived
              </Text>
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

/**
 * whatsapp-shell skin: flat 24pt-radius cards (§7 "never cards-with-shadows",
 * and never a hairline-bordered mini-card either), the S7 type scale (17pt
 * name / 15pt body / 13pt meta), and neutral status capsules. The rail card
 * widens because the type grew — same move ServingTeamScreen made when its
 * names went 14 → 17pt.
 */
const waStyles = StyleSheet.create({
  cardRail: {
    width: 264,
    minHeight: 152,
    borderRadius: WA_GROUP_RADIUS,
    borderWidth: 0,
    padding: 16,
  },
  cardList: {
    borderRadius: WA_GROUP_RADIUS,
    borderWidth: 0,
    padding: 16,
    marginBottom: 12,
  },
  headerRow: { gap: 10, marginBottom: 10 },
  avatar: { width: 32, height: 32, borderRadius: 16 },
  avatarText: { fontSize: WA_TYPE_FOOTNOTE, fontWeight: WA_WEIGHT_SEMIBOLD },
  author: { fontSize: WA_TYPE_ROW_TITLE, fontWeight: WA_WEIGHT_SEMIBOLD },
  meta: { fontSize: WA_TYPE_FOOTNOTE, marginTop: 1 },
  body: { fontSize: WA_TYPE_SUBTITLE, lineHeight: 21 },
  statusRow: { marginTop: 10 },
  statusBadge: { height: 26, borderRadius: 13, paddingHorizontal: 10, gap: 0 },
  statusBadgeText: { fontSize: WA_TYPE_FOOTNOTE, fontWeight: WA_WEIGHT_REGULAR },
});
