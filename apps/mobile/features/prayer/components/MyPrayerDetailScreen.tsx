/**
 * MyPrayerDetailScreen — author view of a single prayer, with follow-up
 * composer and lifecycle actions (mark answered / archive).
 *
 * Also reachable by users who prayed for the request — they see the body
 * + follow-ups (the "praise reports" they got notified about), but no
 * authoring actions.
 */

import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@hooks/useTheme';
import { useCommunityTheme } from '@hooks/useCommunityTheme';
import { useAuthenticatedQuery, useAuthenticatedMutation, api } from '@services/api/convex';
import { formatError } from '@/utils/error-handling';
import { CrisisResourceCard } from './CrisisResourceCard';
import { PrayerReactions } from './PrayerReactions';
import type { Id } from '@services/api/convex';

// Human-readable copy for moderation outcomes shown on the author's detail
// screen. Generic by category so we don't leak the LLM's exact reasoning
// (which can read as accusatory and is also exploitable for jailbreaks).
function moderationCopy(
  modStatus: string | undefined,
  category: string | undefined,
): { title: string; body: string; color: string } | null {
  if (!modStatus || modStatus === 'approved') return null;
  if (modStatus === 'pending') {
    return {
      title: 'Reviewing your prayer',
      body: 'Usually takes a few seconds. You can leave this screen — we’ll publish it as soon as it’s approved.',
      color: '#8E8E93',
    };
  }
  if (modStatus === 'pending_review') {
    return {
      title: 'A community admin will review this',
      body:
        category === 'third_party_named'
          ? 'You appear to be naming someone else with sensitive detail. An admin will review before it posts. You can also share more privately with your church staff.'
          : category === 'intimate_explicit'
            ? 'Your post has intimate detail that may be too explicit for a public community feed. An admin will review — you might also consider rephrasing more generally, like "praying for closeness in our marriage."'
            : category === 'borderline_solicitation'
              ? 'Your post might be read as a fundraiser or solicitation. An admin will review before it posts.'
              : 'Your post is held for a community admin to review before it goes public.',
      color: '#FF9500',
    };
  }
  if (modStatus === 'rejected') {
    return {
      title: 'Kept private',
      body:
        category === 'self_harm_plan'
          ? 'This one stays between us — please reach out using one of the lines above. Talking with your church staff or a counselor can help too.'
          : category === 'doxing' || category === 'third_party_named'
            ? 'To protect others’ privacy, we kept this one between you and us. Try rephrasing without specific names — “my friend” or “a family member” works.'
            : category === 'spam' || category === 'borderline_solicitation'
              ? 'We kept this one private — posts that read as fundraising, promotion, or solicitation don’t go public on the prayer feed.'
              : 'We kept this one private. Try rephrasing without names or graphic details and post again.',
      color: '#8E8E93',
    };
  }
  return null;
}

const MAX_FOLLOWUP = 500;

export function MyPrayerDetailScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { primaryColor } = useCommunityTheme();
  const params = useLocalSearchParams<{ prayerId: string }>();
  const prayerId = params.prayerId as Id<'prayers'> | undefined;

  const [followUpText, setFollowUpText] = useState('');
  const [followUpKind, setFollowUpKind] = useState<'update' | 'praise_report'>('update');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const detail = useAuthenticatedQuery(
    api.functions.prayers.getDetail,
    prayerId ? { prayerId } : 'skip',
  );

  const addFollowUp = useAuthenticatedMutation(api.functions.prayers.addFollowUp);
  const markAnswered = useAuthenticatedMutation(api.functions.prayers.markAnswered);
  const archivePrayer = useAuthenticatedMutation(api.functions.prayers.archivePrayer);

  if (!prayerId) {
    return (
      <View style={[styles.container, { backgroundColor: colors.surfaceSecondary }]}>
        <Text style={{ color: colors.text, padding: 20 }}>Missing prayer ID</Text>
      </View>
    );
  }

  if (detail === undefined) {
    return (
      <View style={[styles.container, styles.center, { backgroundColor: colors.surfaceSecondary }]}>
        <ActivityIndicator color={primaryColor} />
      </View>
    );
  }
  if (detail === null) {
    return (
      <View style={[styles.container, { backgroundColor: colors.surfaceSecondary }]}>
        <Stack.Screen options={{ title: 'Prayer', headerShown: true }} />
        <Text style={{ color: colors.text, padding: 20 }}>This prayer is not available.</Text>
      </View>
    );
  }

  const isAuthor = detail.isAuthor;
  const isActive = detail.status === 'active';

  const handleAddFollowUp = async () => {
    const body = followUpText.trim();
    if (body.length === 0) return;
    setIsSubmitting(true);
    try {
      await addFollowUp({ prayerId, kind: followUpKind, bodyText: body });
      setFollowUpText('');
      setFollowUpKind('update');
    } catch (e) {
      Alert.alert('Error', formatError(e, 'Could not post your update'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleMarkAnswered = () => {
    Alert.alert('Mark as answered?', 'You can also share a short praise report below first.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Mark answered',
        style: 'default',
        onPress: async () => {
          try {
            await markAnswered({ prayerId });
          } catch (e) {
            Alert.alert('Error', formatError(e, 'Could not update'));
          }
        },
      },
    ]);
  };

  const handleArchive = () => {
    Alert.alert('Archive this prayer?', 'It will be hidden from the feed. You can still see it under My Prayers.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Archive',
        style: 'destructive',
        onPress: async () => {
          try {
            await archivePrayer({ prayerId });
            router.back();
          } catch (e) {
            Alert.alert('Error', formatError(e, 'Could not archive'));
          }
        },
      },
    ]);
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.surfaceSecondary }]}>
      <Stack.Screen options={{ title: 'Prayer', headerShown: true }} />
      <ScrollView contentContainerStyle={[styles.scrollContent, { paddingBottom: 40 + insets.bottom }]}>
        {(() => {
          const copy = moderationCopy(
            (detail as any).moderationStatus,
            (detail as any).moderationDetail?.category,
          );
          if (!copy) return null;
          return (
            <View
              style={[
                styles.modBanner,
                { borderColor: copy.color, backgroundColor: colors.surface },
              ]}
            >
              <Text style={[styles.modBannerTitle, { color: copy.color }]}>{copy.title}</Text>
              <Text style={[styles.modBannerBody, { color: colors.text }]}>{copy.body}</Text>
            </View>
          );
        })()}

        {detail.crisisFlag ? <CrisisResourceCard /> : null}

        {/* Body */}
        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text style={[styles.bodyText, { color: colors.text }]}>{detail.bodyText}</Text>
          <View style={styles.metaRow}>
            <Ionicons name="people-outline" size={14} color={colors.textTertiary} />
            <Text style={[styles.metaText, { color: colors.textTertiary }]}>
              {detail.prayedForCount} {detail.prayedForCount === 1 ? 'person' : 'people'} prayed
            </Text>
            <Text style={[styles.metaText, { color: colors.textTertiary, marginLeft: 'auto' }]}>
              {new Date(detail.createdAt).toLocaleDateString()}
            </Text>
          </View>
          <PrayerReactions
            targetType="prayer"
            targetId={detail.id}
            reactions={detail.reactions}
            canReact={!(detail as any).isAnonymous}
          />
        </View>

        {/* Author-only lifecycle actions */}
        {isAuthor && isActive && (
          <View style={styles.actionsRow}>
            <TouchableOpacity
              style={[styles.actionButton, { backgroundColor: '#34C759' }]}
              onPress={handleMarkAnswered}
              activeOpacity={0.85}
            >
              <Ionicons name="checkmark-circle-outline" size={16} color="#fff" />
              <Text style={styles.actionButtonText}>Mark answered</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.actionButton, { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1 }]}
              onPress={handleArchive}
              activeOpacity={0.85}
            >
              <Ionicons name="archive-outline" size={16} color={colors.text} />
              <Text style={[styles.actionButtonText, { color: colors.text }]}>Archive</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Follow-ups */}
        <Text style={[styles.sectionTitle, { color: colors.text }]}>Updates</Text>
        {detail.followUps.length === 0 ? (
          <Text style={[styles.emptyText, { color: colors.textTertiary }]}>
            No updates yet.
          </Text>
        ) : (
          detail.followUps.map((f) => (
            <View
              key={f.id}
              style={[styles.followUp, { backgroundColor: colors.surface, borderColor: colors.border }]}
            >
              <View style={styles.followUpHeader}>
                <View
                  style={[
                    styles.followUpBadge,
                    {
                      backgroundColor:
                        f.kind === 'praise_report' ? '#34C759' : colors.textTertiary,
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
              <PrayerReactions
                targetType="followUp"
                targetId={f.id}
                reactions={f.reactions}
                canReact={!(detail as any).isAnonymous}
              />
            </View>
          ))
        )}

        {/* Author follow-up composer */}
        {isAuthor && (
          <View style={[styles.composer, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[styles.composerTitle, { color: colors.text }]}>Add an update</Text>
            <View style={styles.kindRow}>
              <TouchableOpacity
                style={[
                  styles.kindChip,
                  { borderColor: colors.border },
                  followUpKind === 'update' && { backgroundColor: primaryColor, borderColor: primaryColor },
                ]}
                onPress={() => setFollowUpKind('update')}
              >
                <Text
                  style={[
                    styles.kindChipText,
                    { color: colors.text },
                    followUpKind === 'update' && { color: '#fff' },
                  ]}
                >
                  Update
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.kindChip,
                  { borderColor: colors.border },
                  followUpKind === 'praise_report' && { backgroundColor: '#34C759', borderColor: '#34C759' },
                ]}
                onPress={() => setFollowUpKind('praise_report')}
              >
                <Text
                  style={[
                    styles.kindChipText,
                    { color: colors.text },
                    followUpKind === 'praise_report' && { color: '#fff' },
                  ]}
                >
                  Praise report
                </Text>
              </TouchableOpacity>
            </View>
            <TextInput
              style={[
                styles.composerInput,
                {
                  backgroundColor: colors.inputBackground,
                  color: colors.text,
                  borderColor: colors.inputBorder,
                },
              ]}
              value={followUpText}
              onChangeText={setFollowUpText}
              placeholder="Share an update for those who prayed…"
              placeholderTextColor={colors.inputPlaceholder}
              multiline
              maxLength={MAX_FOLLOWUP}
              editable={!isSubmitting}
            />
            <TouchableOpacity
              style={[
                styles.composerSubmit,
                { backgroundColor: primaryColor },
                (isSubmitting || followUpText.trim().length === 0) && { opacity: 0.5 },
              ]}
              onPress={handleAddFollowUp}
              disabled={isSubmitting || followUpText.trim().length === 0}
              activeOpacity={0.85}
            >
              {isSubmitting ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text style={styles.composerSubmitText}>Post update</Text>
              )}
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { justifyContent: 'center', alignItems: 'center' },
  scrollContent: { padding: 16 },
  card: {
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 16,
    marginBottom: 12,
  },
  bodyText: { fontSize: 16, lineHeight: 22, marginBottom: 12 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  metaText: { fontSize: 13 },
  actionsRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 20,
  },
  actionButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: 10,
  },
  actionButtonText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  sectionTitle: { fontSize: 16, fontWeight: '600', marginTop: 8, marginBottom: 10 },
  emptyText: { fontSize: 14, marginBottom: 20 },
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
  composer: {
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 16,
    marginTop: 12,
  },
  composerTitle: { fontSize: 15, fontWeight: '600', marginBottom: 10 },
  kindRow: { flexDirection: 'row', gap: 8, marginBottom: 10 },
  kindChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
  },
  kindChipText: { fontSize: 13, fontWeight: '500' },
  composerInput: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    fontSize: 15,
    minHeight: 90,
    textAlignVertical: 'top',
    marginBottom: 10,
  },
  composerSubmit: {
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  composerSubmitText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  modBanner: {
    borderRadius: 12,
    borderLeftWidth: 4,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    padding: 14,
    marginBottom: 12,
  },
  modBannerTitle: { fontSize: 14, fontWeight: '700', marginBottom: 6 },
  modBannerBody: { fontSize: 13, lineHeight: 19 },
});
