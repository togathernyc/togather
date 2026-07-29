/**
 * PrayedPrayerRail — horizontal strip of prayers the user has prayed for,
 * shown under the main feed card on the Prayer tab.
 *
 * Once you've prayed, the request leaves the feed forever — but that meant
 * you couldn't come back to it later to follow up or see if the author
 * posted an update. The rail keeps those prayers in reach without
 * cluttering the focused single-card feed.
 *
 * A small dot on a card indicates the author has posted a follow-up since
 * the user prayed.
 */

import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useTheme } from '@hooks/useTheme';
import { useCommunityTheme } from '@hooks/useCommunityTheme';
import { useWhatsappShell } from '@hooks/useWhatsappShell';
import {
  WA_GROUP_MARGIN,
  WA_TYPE_SECTION_HEADER,
  WA_TYPE_SUBTITLE,
  WA_WEIGHT_SEMIBOLD,
} from '@components/wa';
import { useAuthenticatedQuery, api } from '@services/api/convex';
import type { Id } from '@services/api/convex';
import { PrayedCard } from './PrayedCard';

const RAIL_LIMIT = 10;

export function PrayedPrayerRail({ communityId }: { communityId: Id<'communities'> }) {
  const router = useRouter();
  const { colors } = useTheme();
  const wa = useWhatsappShell();
  const { primaryColor } = useCommunityTheme();

  const items = useAuthenticatedQuery(
    api.functions.prayers.myPrayedFor,
    { communityId, limit: RAIL_LIMIT },
  );

  if (!items || items.length === 0) return null;

  return (
    <View style={styles.wrap}>
      <View style={[styles.headerRow, wa && waStyles.headerRow]}>
        <Text
          style={[
            styles.title,
            wa && waStyles.title,
            { color: wa ? colors.textSecondary : colors.text },
          ]}
        >
          Prayers you've prayed
        </Text>
        <TouchableOpacity
          onPress={() => router.push('/(user)/prayed-for')}
          hitSlop={8}
          accessibilityLabel="See all prayers you've prayed for"
        >
          {/* S3.6: an accent TEXT link is legal WA vocabulary — no chip. */}
          <Text style={[styles.seeAll, wa && waStyles.seeAll, { color: primaryColor }]}>
            See all
          </Text>
        </TouchableOpacity>
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        {items.map((p) => (
          <PrayedCard
            key={p.id}
            prayer={p}
            onPress={() => router.push(`/(user)/prayed-for/${p.id}`)}
            variant="rail"
          />
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginTop: 4,
    paddingBottom: 8,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    marginBottom: 10,
  },
  title: { fontSize: 14, fontWeight: '700' },
  seeAll: { fontSize: 13, fontWeight: '600' },
  scrollContent: {
    paddingHorizontal: 16,
    gap: 10,
  },
});

/**
 * whatsapp-shell skin: the rail keeps its shape but its title becomes a WA
 * landing section header (~20pt sentence-case gray, S3.5 — no 14pt bold
 * mini-heading) and "See all" grows to the 15pt subtitle scale as an accent
 * text link.
 */
const waStyles = StyleSheet.create({
  headerRow: { paddingHorizontal: WA_GROUP_MARGIN, marginBottom: 8 },
  title: { fontSize: WA_TYPE_SECTION_HEADER, fontWeight: WA_WEIGHT_SEMIBOLD },
  seeAll: { fontSize: WA_TYPE_SUBTITLE, fontWeight: WA_WEIGHT_SEMIBOLD },
});
