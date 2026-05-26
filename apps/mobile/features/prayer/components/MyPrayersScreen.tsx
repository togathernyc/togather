/**
 * MyPrayersScreen — author's own list of prayers across all statuses.
 * Shown via the Profile → My Prayers menu entry.
 */

import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@hooks/useTheme';
import { useCommunityTheme } from '@hooks/useCommunityTheme';
import { useAuth } from '@providers/AuthProvider';
import { useAuthenticatedQuery, api } from '@services/api/convex';
import type { Id } from '@services/api/convex';

function statusBadge(status: string): { label: string; color: string } {
  switch (status) {
    case 'answered':
      return { label: 'Answered', color: '#34C759' };
    case 'archived':
      return { label: 'Archived', color: '#8E8E93' };
    case 'active':
    default:
      return { label: 'Active', color: '#007AFF' };
  }
}

function moderationBadge(modStatus: string): { label: string; color: string } | null {
  switch (modStatus) {
    case 'pending':
      return { label: 'Reviewing…', color: '#8E8E93' };
    case 'pending_review':
      return { label: 'Awaiting admin', color: '#FF9500' };
    case 'rejected':
      // Softer than "Rejected" — a prayer is a vulnerable thing to share,
      // and the existing copy implies failure. "Kept private" frames it as
      // "the post didn't go public, but it's still yours."
      return { label: 'Kept private', color: '#8E8E93' };
    case 'approved':
    default:
      return null;
  }
}

export function MyPrayersScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colors } = useTheme();
  const { primaryColor } = useCommunityTheme();
  const { community } = useAuth();
  const prayers = useAuthenticatedQuery(
    api.functions.prayers.myPrayers,
    community?.id
      ? { communityId: community.id as Id<'communities'> }
      : 'skip',
  );

  return (
    <View style={[styles.container, { backgroundColor: colors.surfaceSecondary }]}>
      <Stack.Screen options={{ title: 'My Prayers', headerShown: true }} />
      <ScrollView contentContainerStyle={[styles.scrollContent, { paddingTop: 16, paddingBottom: 24 + insets.bottom }]}>
        {!community?.id ? (
          // No active community: query is skipped, so we'd otherwise sit on
          // the spinner forever. Show the same empty card with "select a
          // community" copy instead.
          <View style={[styles.emptyCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Ionicons name="heart-outline" size={36} color={colors.iconSecondary} />
            <Text style={[styles.emptyTitle, { color: colors.text }]}>No community selected</Text>
            <Text style={[styles.emptyBody, { color: colors.textSecondary }]}>
              Select a community to see your prayers there.
            </Text>
          </View>
        ) : prayers === undefined ? (
          <View style={styles.center}>
            <ActivityIndicator color={primaryColor} />
          </View>
        ) : prayers.length === 0 ? (
          <View style={[styles.emptyCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Ionicons name="heart-outline" size={36} color={colors.iconSecondary} />
            <Text style={[styles.emptyTitle, { color: colors.text }]}>No prayers yet</Text>
            <Text style={[styles.emptyBody, { color: colors.textSecondary }]}>
              When you post a prayer request, it'll show up here.
            </Text>
          </View>
        ) : (
          prayers.map((p) => {
            const badge = statusBadge(p.status);
            const modBadge = moderationBadge(p.moderationStatus);
            return (
              <TouchableOpacity
                key={p.id}
                style={[styles.row, { backgroundColor: colors.surface, borderColor: colors.border }]}
                onPress={() => router.push(`/(user)/my-prayers/${p.id}`)}
                activeOpacity={0.85}
              >
                <Text style={[styles.body, { color: colors.text }]} numberOfLines={3}>
                  {p.bodyText}
                </Text>
                <View style={styles.metaRow}>
                  {/* Hide the lifecycle "Active" pill when moderation is in
                     flight or held — the moderation status is the more
                     urgent thing for the author to see. */}
                  {modBadge ? (
                    <View style={[styles.badge, { backgroundColor: modBadge.color }]}>
                      <Text style={styles.badgeText}>{modBadge.label}</Text>
                    </View>
                  ) : (
                    <View style={[styles.badge, { backgroundColor: badge.color }]}>
                      <Text style={styles.badgeText}>{badge.label}</Text>
                    </View>
                  )}
                  {p.isAnonymous && (
                    <View style={[styles.badge, { backgroundColor: colors.textTertiary }]}>
                      <Text style={styles.badgeText}>Anonymous</Text>
                    </View>
                  )}
                  {p.crisisFlag && (
                    <View style={[styles.badge, { backgroundColor: '#C0392B' }]}>
                      <Text style={styles.badgeText}>Resource added</Text>
                    </View>
                  )}
                  <Text style={[styles.countText, { color: colors.textTertiary }]}>
                    {p.prayedForCount} prayed
                  </Text>
                </View>
              </TouchableOpacity>
            );
          })
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollContent: { padding: 16 },
  center: { paddingVertical: 40, alignItems: 'center' },
  emptyCard: {
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 24,
    alignItems: 'center',
    marginTop: 12,
  },
  emptyTitle: { fontSize: 17, fontWeight: '600', marginTop: 12, marginBottom: 6 },
  emptyBody: { fontSize: 14, textAlign: 'center', lineHeight: 20 },
  row: {
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 14,
    marginBottom: 10,
  },
  body: { fontSize: 15, lineHeight: 20, marginBottom: 10 },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
  },
  badgeText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '600',
  },
  countText: {
    fontSize: 12,
    marginLeft: 'auto',
  },
});
