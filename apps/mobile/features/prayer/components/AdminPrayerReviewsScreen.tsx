/**
 * Community-admin queue for prayer moderation. Two sections:
 *
 * 1. **Held by moderator** — prayers our LLM flagged YELLOW. Admin can
 *    Approve (publishes) or Keep private (rejects).
 * 2. **Reported by members** — published prayers that one or more members
 *    flagged. Admin can Keep private (rejects + marks reports actioned)
 *    or Dismiss (leaves it up + marks reports dismissed).
 *
 * Verb choice: we call the rejection action "Keep private" everywhere
 * users see it (author-side too) so the language is consistent with the
 * compassionate framing. "Reject" reads as punitive in a prayer context.
 *
 * Anonymous prayers stay anonymous to admins too — the backend never
 * sends author identity for `isAnonymous` prayers. Admins moderate on
 * the body content. Members never see anything beyond what the regular
 * feed already shows.
 */

import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@providers/AuthProvider';
import { useTheme } from '@hooks/useTheme';
import { useCommunityTheme } from '@hooks/useCommunityTheme';
import {
  useAuthenticatedQuery,
  useAuthenticatedMutation,
  api,
} from '@services/api/convex';
import { formatError } from '@/utils/error-handling';
import type { Id } from '@services/api/convex';

const CATEGORY_LABELS: Record<string, string> = {
  third_party_named: 'Third party named with detail',
  intimate_explicit: 'Intimate / explicit detail',
  borderline_solicitation: 'Possible solicitation',
  borderline_other: 'Borderline',
  violence: 'Violence',
  self_harm_plan: 'Self-harm with plan',
  explicit: 'Explicit content',
  doxing: 'Doxing',
  hate: 'Hate',
  spam: 'Spam',
  other: 'Other',
};

const REPORT_REASON_LABELS: Record<string, string> = {
  names_person: 'Names a specific person',
  intimate_explicit: 'Too intimate / explicit',
  spam_solicitation: 'Spam or solicitation',
  hateful: 'Hateful or hurtful',
  crisis_needs_resources: 'Needs crisis resources',
  other: 'Other',
};

export function AdminPrayerReviewsScreen() {
  const insets = useSafeAreaInsets();
  const { community } = useAuth();
  const { colors } = useTheme();
  const { primaryColor } = useCommunityTheme();
  const [busyId, setBusyId] = useState<string | null>(null);

  const heldQueue = useAuthenticatedQuery(
    api.functions.prayers.listPendingForReview,
    community?.id ? { communityId: community.id as Id<'communities'> } : 'skip',
  );
  const reportedQueue = useAuthenticatedQuery(
    api.functions.prayers.listReportedPrayers,
    community?.id ? { communityId: community.id as Id<'communities'> } : 'skip',
  );

  const approve = useAuthenticatedMutation(api.functions.prayers.approvePending);
  const rejectHeld = useAuthenticatedMutation(api.functions.prayers.rejectPending);
  const upholdReport = useAuthenticatedMutation(api.functions.prayers.upholdReport);
  const dismissReports = useAuthenticatedMutation(api.functions.prayers.dismissReports);

  const loading = heldQueue === undefined || reportedQueue === undefined;
  const empty = !loading && (heldQueue?.length ?? 0) === 0 && (reportedQueue?.length ?? 0) === 0;

  // Group reports by prayer so one prayer with 3 reports renders as one card.
  const reportsByPrayer = (() => {
    const map = new Map<string, NonNullable<typeof reportedQueue>>();
    for (const r of reportedQueue ?? []) {
      const existing = map.get(r.prayerId) ?? [];
      existing.push(r);
      map.set(r.prayerId, existing);
    }
    return map;
  })();

  const handleApproveHeld = async (id: Id<'prayers'>) => {
    setBusyId(id);
    try {
      await approve({ prayerId: id });
    } catch (e) {
      Alert.alert('Error', formatError(e, 'Could not approve'));
    } finally {
      setBusyId(null);
    }
  };

  const handleKeepPrivateHeld = (id: Id<'prayers'>) => {
    Alert.alert(
      'Keep this prayer private?',
      'The prayer will not post publicly. The author will see a gentle "kept private" notice.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Keep private',
          style: 'destructive',
          onPress: async () => {
            setBusyId(id);
            try {
              await rejectHeld({ prayerId: id });
            } catch (e) {
              Alert.alert('Error', formatError(e, 'Could not keep private'));
            } finally {
              setBusyId(null);
            }
          },
        },
      ],
    );
  };

  const handleKeepPrivateReported = (id: Id<'prayers'>) => {
    Alert.alert(
      'Keep this prayer private?',
      'The prayer will be removed from the feed. The author will see a gentle "kept private" notice and reports close.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Keep private',
          style: 'destructive',
          onPress: async () => {
            setBusyId(id);
            try {
              await upholdReport({ prayerId: id });
            } catch (e) {
              Alert.alert('Error', formatError(e, 'Could not keep private'));
            } finally {
              setBusyId(null);
            }
          },
        },
      ],
    );
  };

  const handleDismissReports = async (id: Id<'prayers'>) => {
    setBusyId(id);
    try {
      await dismissReports({ prayerId: id });
    } catch (e) {
      Alert.alert('Error', formatError(e, 'Could not dismiss reports'));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.surfaceSecondary }]}>
      <Stack.Screen
        options={{
          headerShown: true,
          title: 'Prayer Reviews',
          headerBackTitle: 'Back',
        }}
      />
      <ScrollView
        contentContainerStyle={[
          styles.scrollContent,
          { paddingBottom: 32 + insets.bottom },
        ]}
      >
        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator color={primaryColor} />
          </View>
        ) : empty ? (
          <View style={styles.empty}>
            <Ionicons name="checkmark-circle-outline" size={36} color={colors.iconSecondary} />
            <Text style={[styles.emptyTitle, { color: colors.text }]}>Nothing to review</Text>
            <Text style={[styles.emptyBody, { color: colors.textSecondary }]}>
              We'll surface borderline prayers and member reports here so you can act on them.
            </Text>
          </View>
        ) : (
          <>
            {/* SECTION 1 — held by moderator */}
            {heldQueue && heldQueue.length > 0 ? (
              <>
                <Text style={[styles.sectionHeader, { color: colors.textSecondary }]}>
                  Held by moderator
                </Text>
                {heldQueue.map((p) => {
                  const categoryLabel =
                    CATEGORY_LABELS[p.moderationDetail?.category ?? ''] ?? 'Held for review';
                  return (
                    <View
                      key={p.id}
                      style={[
                        styles.card,
                        { backgroundColor: colors.surface, borderColor: colors.border },
                      ]}
                    >
                      <View style={styles.chipRow}>
                        <View style={[styles.chip, { backgroundColor: '#FFF3DD', borderColor: '#FFC53D' }]}>
                          <Text style={styles.chipText}>{categoryLabel}</Text>
                        </View>
                        {p.crisisFlag ? (
                          <View style={[styles.chip, { backgroundColor: '#FFE3E3', borderColor: '#FFAAAA' }]}>
                            <Ionicons name="heart-circle" size={12} color="#C0392B" />
                            <Text style={[styles.chipText, { color: '#C0392B' }]}>Crisis flagged</Text>
                          </View>
                        ) : null}
                      </View>

                      <Text style={[styles.body, { color: colors.text }]}>{p.bodyText}</Text>

                      {p.moderationDetail?.note ? (
                        <Text style={[styles.aiNote, { color: colors.textSecondary }]}>
                          Moderator note: {p.moderationDetail.note}
                        </Text>
                      ) : null}

                      <View style={styles.metaRow}>
                        <Text style={[styles.meta, { color: colors.textTertiary }]}>
                          {p.isAnonymous ? 'Anonymous' : p.authorDisplayName}
                        </Text>
                        <Text style={[styles.meta, { color: colors.textTertiary }]}>
                          {new Date(p.createdAt).toLocaleString()}
                        </Text>
                      </View>

                      <View style={styles.actionsRow}>
                        <TouchableOpacity
                          style={[styles.action, { backgroundColor: '#34C759', opacity: busyId === p.id ? 0.5 : 1 }]}
                          onPress={() => handleApproveHeld(p.id)}
                          disabled={busyId === p.id}
                          activeOpacity={0.85}
                        >
                          <Ionicons name="checkmark" size={16} color="#fff" />
                          <Text style={styles.actionText}>Approve</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={[
                            styles.action,
                            {
                              backgroundColor: colors.surface,
                              borderColor: colors.border,
                              borderWidth: 1,
                              opacity: busyId === p.id ? 0.5 : 1,
                            },
                          ]}
                          onPress={() => handleKeepPrivateHeld(p.id)}
                          disabled={busyId === p.id}
                          activeOpacity={0.85}
                        >
                          <Ionicons name="lock-closed-outline" size={16} color={colors.text} />
                          <Text style={[styles.actionText, { color: colors.text }]}>Keep private</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  );
                })}
              </>
            ) : null}

            {/* SECTION 2 — reported by members (grouped per prayer) */}
            {reportsByPrayer.size > 0 ? (
              <>
                <Text style={[styles.sectionHeader, { color: colors.textSecondary, marginTop: 18 }]}>
                  Reported by members
                </Text>
                {Array.from(reportsByPrayer.entries()).map(([prayerId, reports]) => {
                  const first = reports[0];
                  return (
                    <View
                      key={prayerId}
                      style={[
                        styles.card,
                        { backgroundColor: colors.surface, borderColor: colors.border },
                      ]}
                    >
                      <View style={styles.chipRow}>
                        <View style={[styles.chip, { backgroundColor: '#FFE0E0', borderColor: '#FF8E8E' }]}>
                          <Ionicons name="flag" size={11} color="#C0392B" />
                          <Text style={[styles.chipText, { color: '#C0392B' }]}>
                            {reports.length === 1 ? '1 report' : `${reports.length} reports`}
                          </Text>
                        </View>
                        {first.prayerStatus !== 'approved' ? (
                          <View style={[styles.chip, { backgroundColor: '#E0E0E0', borderColor: '#A0A0A0' }]}>
                            <Text style={styles.chipText}>
                              Already {first.prayerStatus === 'rejected' ? 'kept private' : first.prayerStatus}
                            </Text>
                          </View>
                        ) : null}
                      </View>

                      <Text style={[styles.body, { color: colors.text }]}>{first.prayerBody}</Text>

                      {reports.map((r) => (
                        <View key={r.reportId} style={styles.reportItem}>
                          <Text style={[styles.reportReason, { color: colors.text }]}>
                            {REPORT_REASON_LABELS[r.reason] ?? r.reason}
                          </Text>
                          {r.customNote ? (
                            <Text style={[styles.reportNote, { color: colors.textSecondary }]}>
                              “{r.customNote}”
                            </Text>
                          ) : null}
                          <Text style={[styles.reportMeta, { color: colors.textTertiary }]}>
                            {r.reporterDisplayName} · {new Date(r.createdAt).toLocaleString()}
                          </Text>
                        </View>
                      ))}

                      {first.prayerStatus === 'approved' ? (
                        <View style={styles.actionsRow}>
                          <TouchableOpacity
                            style={[styles.action, { backgroundColor: '#34C759', opacity: busyId === prayerId ? 0.5 : 1 }]}
                            onPress={() => handleDismissReports(prayerId as Id<'prayers'>)}
                            disabled={busyId === prayerId}
                            activeOpacity={0.85}
                          >
                            <Ionicons name="checkmark" size={16} color="#fff" />
                            <Text style={styles.actionText}>Leave up</Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={[
                              styles.action,
                              {
                                backgroundColor: colors.surface,
                                borderColor: colors.border,
                                borderWidth: 1,
                                opacity: busyId === prayerId ? 0.5 : 1,
                              },
                            ]}
                            onPress={() => handleKeepPrivateReported(prayerId as Id<'prayers'>)}
                            disabled={busyId === prayerId}
                            activeOpacity={0.85}
                          >
                            <Ionicons name="lock-closed-outline" size={16} color={colors.text} />
                            <Text style={[styles.actionText, { color: colors.text }]}>Keep private</Text>
                          </TouchableOpacity>
                        </View>
                      ) : (
                        <TouchableOpacity
                          style={[
                            styles.action,
                            {
                              backgroundColor: colors.surface,
                              borderColor: colors.border,
                              borderWidth: 1,
                              opacity: busyId === prayerId ? 0.5 : 1,
                              marginTop: 4,
                            },
                          ]}
                          onPress={() => handleDismissReports(prayerId as Id<'prayers'>)}
                          disabled={busyId === prayerId}
                          activeOpacity={0.85}
                        >
                          <Text style={[styles.actionText, { color: colors.text }]}>
                            Dismiss reports
                          </Text>
                        </TouchableOpacity>
                      )}
                    </View>
                  );
                })}
              </>
            ) : null}
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollContent: { padding: 16 },
  center: { paddingVertical: 40, alignItems: 'center' },
  empty: {
    paddingVertical: 60,
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  emptyTitle: { fontSize: 17, fontWeight: '600', marginTop: 12, marginBottom: 6 },
  emptyBody: { fontSize: 14, textAlign: 'center', lineHeight: 20 },
  sectionHeader: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginBottom: 8,
    marginTop: 4,
  },
  card: {
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 16,
    marginBottom: 12,
  },
  chipRow: { flexDirection: 'row', gap: 8, marginBottom: 10, flexWrap: 'wrap' },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
  },
  chipText: { fontSize: 11, fontWeight: '700', color: '#7C5500' },
  body: { fontSize: 15, lineHeight: 21, marginBottom: 10 },
  aiNote: { fontSize: 12, fontStyle: 'italic', marginBottom: 10 },
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  meta: { fontSize: 12 },
  reportItem: {
    paddingVertical: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(0,0,0,0.06)',
  },
  reportReason: { fontSize: 13, fontWeight: '600', marginBottom: 2 },
  reportNote: { fontSize: 13, fontStyle: 'italic', marginBottom: 2 },
  reportMeta: { fontSize: 11 },
  actionsRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 8,
  },
  action: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: 8,
  },
  actionText: { color: '#fff', fontSize: 14, fontWeight: '600' },
});
