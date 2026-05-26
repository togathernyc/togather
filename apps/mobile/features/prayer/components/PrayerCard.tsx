import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@hooks/useTheme';
import { useCommunityTheme } from '@hooks/useCommunityTheme';
import type { Id } from '@services/api/convex';

export interface PrayerCardData {
  id: Id<'prayers'>;
  bodyText: string;
  prayedForCount: number;
  createdAt: number;
  /** "First L." for non-anonymous prayers, null when posted anonymously. */
  authorDisplayName: string | null;
  /**
   * When true, the moderator flagged this as first-person crisis content
   * (depression, suicidal ideation without plan/means). The card renders
   * a small 988 / crisis-line resource above the body. We DON'T block
   * these — "triage, not suppression."
   */
  crisisFlag: boolean;
}

interface Props {
  prayer: PrayerCardData;
  onPressPray: (prayer: PrayerCardData) => void;
}

export function PrayerCard({ prayer, onPressPray }: Props) {
  const { colors } = useTheme();
  const { primaryColor } = useCommunityTheme();

  const count = prayer.prayedForCount;
  const countLabel =
    count === 0 ? 'Be the first to pray' : count === 1 ? '1 person prayed' : `${count} people prayed`;

  const authorLabel = prayer.authorDisplayName ?? 'Anonymous';

  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <View style={styles.authorRow}>
        <Ionicons
          name={prayer.authorDisplayName ? 'person-outline' : 'eye-off-outline'}
          size={13}
          color={colors.textTertiary}
        />
        <Text style={[styles.authorLabel, { color: colors.textTertiary }]}>{authorLabel}</Text>
      </View>
      <Text style={[styles.body, { color: colors.text }]}>{prayer.bodyText}</Text>

      <View style={styles.row}>
        <View style={styles.metaRow}>
          <Ionicons name="people-outline" size={14} color={colors.textTertiary} />
          <Text style={[styles.meta, { color: colors.textTertiary }]}>{countLabel}</Text>
        </View>

        <TouchableOpacity
          style={[styles.prayButton, { backgroundColor: primaryColor }]}
          onPress={() => onPressPray(prayer)}
          activeOpacity={0.85}
        >
          <Ionicons name="heart" size={16} color="#fff" />
          <Text style={styles.prayButtonText}>Pray</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 16,
    marginBottom: 12,
  },
  authorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginBottom: 8,
  },
  authorLabel: {
    fontSize: 12,
    fontWeight: '500',
  },
  body: {
    fontSize: 16,
    lineHeight: 22,
    marginBottom: 16,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  meta: {
    fontSize: 13,
  },
  prayButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
  },
  prayButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
});
