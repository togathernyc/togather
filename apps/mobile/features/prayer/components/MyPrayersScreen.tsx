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
import { useWhatsappShell } from '@hooks/useWhatsappShell';
import {
  WA_GROUP_RADIUS,
  WA_TYPE_FOOTNOTE,
  WA_TYPE_ROW_TITLE,
  WA_TYPE_SUBTITLE,
  WA_WEIGHT_REGULAR,
  WA_WEIGHT_SEMIBOLD,
} from '@components/wa';
import { useAuthenticatedQuery, api } from '@services/api/convex';

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
  const wa = useWhatsappShell();
  const { primaryColor } = useCommunityTheme();
  const prayers = useAuthenticatedQuery(api.functions.prayers.myPrayers, {});

  return (
    <View style={[styles.container, { backgroundColor: colors.surfaceSecondary }]}>
      <Stack.Screen options={{ title: 'My Prayers', headerShown: true }} />
      <ScrollView contentContainerStyle={[styles.scrollContent, { paddingTop: 16, paddingBottom: 24 + insets.bottom }]}>
        {prayers === undefined ? (
          <View style={styles.center}>
            <ActivityIndicator color={primaryColor} />
          </View>
        ) : prayers.length === 0 ? (
          <View
            style={[
              styles.emptyCard,
              wa && waStyles.emptyCard,
              { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
          >
            <Ionicons name="heart-outline" size={36} color={colors.iconSecondary} />
            <Text style={[styles.emptyTitle, wa && waStyles.emptyTitle, { color: colors.text }]}>
              No prayers yet
            </Text>
            <Text style={[styles.emptyBody, wa && waStyles.emptyBody, { color: colors.textSecondary }]}>
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
                style={[
                  styles.row,
                  wa && waStyles.row,
                  { backgroundColor: colors.surface, borderColor: colors.border },
                ]}
                onPress={() => router.push(`/(user)/my-prayers/${p.id}`)}
                activeOpacity={0.85}
              >
                <Text
                  style={[styles.body, wa && waStyles.body, { color: colors.text }]}
                  numberOfLines={3}
                >
                  {p.bodyText}
                </Text>
                <View style={styles.metaRow}>
                  {/* Hide the lifecycle "Active" pill when moderation is in
                     flight or held — the moderation status is the more
                     urgent thing for the author to see.

                     Flag-on every one of these becomes the SAME neutral gray
                     capsule with dark text: §7 bans colored taxonomy chips
                     outright ("Active" blue, "Awaiting admin" orange,
                     "Resource added" red), and the word in the capsule is
                     what carries the meaning. */}
                  {modBadge ? (
                    <View
                      style={[
                        styles.badge,
                        wa && waStyles.badge,
                        { backgroundColor: wa ? colors.surfaceSecondary : modBadge.color },
                      ]}
                    >
                      <Text
                        style={[
                          styles.badgeText,
                          wa && waStyles.badgeText,
                          wa && { color: colors.textSecondary },
                        ]}
                      >
                        {modBadge.label}
                      </Text>
                    </View>
                  ) : (
                    <View
                      style={[
                        styles.badge,
                        wa && waStyles.badge,
                        { backgroundColor: wa ? colors.surfaceSecondary : badge.color },
                      ]}
                    >
                      <Text
                        style={[
                          styles.badgeText,
                          wa && waStyles.badgeText,
                          wa && { color: colors.textSecondary },
                        ]}
                      >
                        {badge.label}
                      </Text>
                    </View>
                  )}
                  {p.isAnonymous && (
                    <View
                      style={[
                        styles.badge,
                        wa && waStyles.badge,
                        { backgroundColor: wa ? colors.surfaceSecondary : colors.textTertiary },
                      ]}
                    >
                      <Text
                        style={[
                          styles.badgeText,
                          wa && waStyles.badgeText,
                          wa && { color: colors.textSecondary },
                        ]}
                      >
                        Anonymous
                      </Text>
                    </View>
                  )}
                  {p.crisisFlag && (
                    <View
                      style={[
                        styles.badge,
                        wa && waStyles.badge,
                        { backgroundColor: wa ? colors.surfaceSecondary : '#C0392B' },
                      ]}
                    >
                      <Text
                        style={[
                          styles.badgeText,
                          wa && waStyles.badgeText,
                          wa && { color: colors.textSecondary },
                        ]}
                      >
                        Resource added
                      </Text>
                    </View>
                  )}
                  <Text
                    style={[styles.countText, wa && waStyles.countText, { color: colors.textTertiary }]}
                  >
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

/**
 * whatsapp-shell skin: flat 24pt-radius rows (§7 — no bordered mini-cards), the
 * S7 type scale, and the whole taxonomy-chip family collapsed into one neutral
 * gray capsule.
 *
 * Follow-up: this screen still renders the stock opaque `Stack.Screen` nav bar.
 * S1 wants a floating back circle + centered floating title (`WaSubScreenHeader`)
 * — a navigation change, not a restyle, so it's deliberately out of this pass.
 */
const waStyles = StyleSheet.create({
  emptyCard: { borderRadius: WA_GROUP_RADIUS, borderWidth: 0, padding: 28 },
  emptyTitle: { fontSize: WA_TYPE_ROW_TITLE, fontWeight: WA_WEIGHT_SEMIBOLD },
  emptyBody: { fontSize: WA_TYPE_SUBTITLE, lineHeight: 21 },
  row: { borderRadius: WA_GROUP_RADIUS, borderWidth: 0, padding: 16, marginBottom: 12 },
  body: { fontSize: WA_TYPE_ROW_TITLE, lineHeight: 24, marginBottom: 12 },
  badge: { height: 26, borderRadius: 13, paddingHorizontal: 10, justifyContent: 'center' },
  badgeText: { fontSize: WA_TYPE_FOOTNOTE, fontWeight: WA_WEIGHT_REGULAR },
  countText: { fontSize: WA_TYPE_FOOTNOTE },
});
