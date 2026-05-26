/**
 * PrayedPrayerDetailScreen — read-only view of a prayer the user has
 * prayed for. Shows the prayer body and any author follow-ups (updates +
 * praise reports). No composer or lifecycle actions — that's the author's
 * MyPrayerDetailScreen.
 *
 * `getDetail` already gates access: returns null if the caller is neither
 * the author nor has a prayerResponses row, so this screen renders an
 * empty state safely if they shouldn't be here.
 */

import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@hooks/useTheme';
import { useCommunityTheme } from '@hooks/useCommunityTheme';
import { useAuthenticatedQuery, api } from '@services/api/convex';
import type { Id } from '@services/api/convex';
import { CrisisResourceCard } from './CrisisResourceCard';

const COMPLETED_GREEN = '#34C759';

export function PrayedPrayerDetailScreen() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { primaryColor } = useCommunityTheme();
  const params = useLocalSearchParams<{ prayerId: string }>();
  const prayerId = params.prayerId as Id<'prayers'> | undefined;

  const detail = useAuthenticatedQuery(
    api.functions.prayers.getDetail,
    prayerId ? { prayerId } : 'skip',
  );

  if (!prayerId) {
    return (
      <View style={[styles.container, { backgroundColor: colors.surfaceSecondary }]}>
        <Stack.Screen options={{ title: 'Prayer', headerShown: true }} />
        <Text style={{ color: colors.text, padding: 20 }}>Missing prayer ID</Text>
      </View>
    );
  }

  if (detail === undefined) {
    return (
      <View
        style={[
          styles.container,
          styles.center,
          { backgroundColor: colors.surfaceSecondary },
        ]}
      >
        <Stack.Screen options={{ title: 'Prayer', headerShown: true }} />
        <ActivityIndicator color={primaryColor} />
      </View>
    );
  }

  if (detail === null) {
    return (
      <View style={[styles.container, { backgroundColor: colors.surfaceSecondary }]}>
        <Stack.Screen options={{ title: 'Prayer', headerShown: true }} />
        <View style={styles.center}>
          <Text style={[styles.emptyTitle, { color: colors.text }]}>
            This prayer is no longer available.
          </Text>
        </View>
      </View>
    );
  }

  const authorLabel = detail.authorDisplayName ?? 'Anonymous';

  return (
    <View style={[styles.container, { backgroundColor: colors.surfaceSecondary }]}>
      <Stack.Screen options={{ title: 'Prayer', headerShown: true }} />
      <ScrollView
        contentContainerStyle={[
          styles.scrollContent,
          { paddingBottom: 40 + insets.bottom },
        ]}
      >
        {detail.crisisFlag ? <CrisisResourceCard /> : null}

        <View
          style={[
            styles.card,
            { backgroundColor: colors.surface, borderColor: colors.border },
          ]}
        >
          <View style={styles.authorRow}>
            <Text style={[styles.authorName, { color: colors.text }]}>{authorLabel}</Text>
            {detail.status === 'answered' ? (
              <View style={[styles.statusBadge, { backgroundColor: COMPLETED_GREEN }]}>
                <Ionicons name="checkmark" size={11} color="#fff" />
                <Text style={styles.statusBadgeText}>Answered</Text>
              </View>
            ) : detail.status === 'archived' ? (
              <View style={[styles.statusBadge, { backgroundColor: colors.textTertiary }]}>
                <Text style={styles.statusBadgeText}>Archived</Text>
              </View>
            ) : null}
          </View>
          <Text style={[styles.bodyText, { color: colors.text }]}>{detail.bodyText}</Text>
          <View style={styles.metaRow}>
            <Ionicons name="people-outline" size={14} color={colors.textTertiary} />
            <Text style={[styles.metaText, { color: colors.textTertiary }]}>
              {detail.prayedForCount}{' '}
              {detail.prayedForCount === 1 ? 'person' : 'people'} prayed
            </Text>
            <Text style={[styles.metaText, { color: colors.textTertiary, marginLeft: 'auto' }]}>
              {new Date(detail.createdAt).toLocaleDateString()}
            </Text>
          </View>
        </View>

        <Text style={[styles.sectionTitle, { color: colors.text }]}>Updates</Text>
        {detail.followUps.length === 0 ? (
          <Text style={[styles.emptyText, { color: colors.textTertiary }]}>
            No updates yet. When {authorLabel === 'Anonymous' ? 'the author' : authorLabel} shares an update or a praise report, it'll show here.
          </Text>
        ) : (
          detail.followUps.map((f) => (
            <View
              key={f.id}
              style={[
                styles.followUp,
                { backgroundColor: colors.surface, borderColor: colors.border },
              ]}
            >
              <View style={styles.followUpHeader}>
                <View
                  style={[
                    styles.followUpBadge,
                    {
                      backgroundColor:
                        f.kind === 'praise_report' ? COMPLETED_GREEN : colors.textTertiary,
                    },
                  ]}
                >
                  <Text style={styles.followUpBadgeText}>
                    {f.kind === 'praise_report' ? 'Praise report' : 'Update'}
                  </Text>
                </View>
                <Text style={[styles.followUpDate, { color: colors.textTertiary }]}>
                  {new Date(f.createdAt).toLocaleDateString()}
                </Text>
              </View>
              <Text style={[styles.followUpBody, { color: colors.text }]}>{f.bodyText}</Text>
            </View>
          ))
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20 },
  emptyTitle: { fontSize: 16, fontWeight: '600', textAlign: 'center' },
  scrollContent: { padding: 16 },
  card: {
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 16,
    marginBottom: 16,
  },
  authorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 10,
  },
  authorName: { fontSize: 15, fontWeight: '700' },
  bodyText: { fontSize: 16, lineHeight: 22, marginBottom: 12 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  metaText: { fontSize: 13 },
  sectionTitle: { fontSize: 16, fontWeight: '600', marginTop: 4, marginBottom: 10 },
  emptyText: { fontSize: 14, lineHeight: 20 },
  followUp: {
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 12,
    marginBottom: 10,
  },
  followUpHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  followUpBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
  },
  followUpBadgeText: { color: '#fff', fontSize: 11, fontWeight: '600' },
  followUpDate: { fontSize: 12, marginLeft: 'auto' },
  followUpBody: { fontSize: 14, lineHeight: 19 },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
  },
  statusBadgeText: { color: '#fff', fontSize: 11, fontWeight: '600' },
});
