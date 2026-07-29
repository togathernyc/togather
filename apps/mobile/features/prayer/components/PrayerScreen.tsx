/**
 * PrayerScreen — the church-feature prayer tab.
 *
 * Single full-screen prayer at a time, anchored as a card high in the
 * viewport. The user prays for 3 in a "session"; a "Prayer N of 3"
 * header with inline dots shows progress, and a checkmark celebrates
 * the finished set. They can opt to "Pray for more" to start another
 * set — but the friction-free path is to stop after 3.
 *
 * Picking through a list felt too lightweight for the weight of the
 * ask, so there is no "next" or "skip"; the only forward motion is
 * praying. After each pray, the PraySession modal shows a brief
 * confirmation overlay ("Prayed for Sarah") so the action feels real
 * before the next card slides in.
 *
 * Feed ordering is set on the backend: fewest pray-count first, oldest
 * as tiebreaker, excluding prayers the caller authored or already prayed
 * for. See `apps/convex/functions/prayers.ts:feed`.
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  ScrollView,
  Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@providers/AuthProvider';
import { useTheme } from '@hooks/useTheme';
import { useCommunityTheme } from '@hooks/useCommunityTheme';
import { useWhatsappShell } from '@hooks/useWhatsappShell';
import {
  WaScreenHeader,
  WA_GROUP_MARGIN,
  WA_GROUP_RADIUS,
  WA_TAB_CONTENT_CLEARANCE,
  WA_TYPE_FOOTNOTE,
  WA_TYPE_HEADER_BLOCK,
  WA_TYPE_ROW_TITLE,
  WA_TYPE_SUBTITLE,
  WA_WEIGHT_BOLD,
  WA_WEIGHT_REGULAR,
  WA_WEIGHT_SEMIBOLD,
  waTabBarStripHeight,
} from '@components/wa';
import {
  useAuthenticatedQuery,
  useAuthenticatedMutation,
  api,
} from '@services/api/convex';
import type { Id } from '@services/api/convex';
import { PraySession } from './PraySession';
import { AddPrayerSheet } from './AddPrayerSheet';
import { ReportPrayerSheet } from './ReportPrayerSheet';
import { PrayedPrayerRail } from './PrayedPrayerRail';
import type { PrayerCardData } from './PrayerCard';

const SESSION_TARGET = 3;
// Don't surface the "this week" pill until the user has prayed enough that
// the number feels affirming rather than judgey. Below this it just looks
// like a stat; past it, it lands as "wow, I've actually been showing up."
const WEEK_PILL_MIN = 6;
const COMPLETED_GREEN = '#34C759';

// Deterministic palette so the same name always gets the same avatar color.
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

export function PrayerScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { community } = useAuth();
  const { colors } = useTheme();
  const wa = useWhatsappShell();
  const { primaryColor } = useCommunityTheme();
  // `openAdd=1` is set by the `prayer.monday_nudge` deep link — one-tap from
  // the notification straight into the AddPrayerSheet. We guard with a ref-
  // style flag to ensure we only auto-open on first mount of this query
  // param, not every time the user dismisses and the param lingers.
  const params = useLocalSearchParams<{ openAdd?: string }>();
  const [praySessionOpen, setPraySessionOpen] = useState(false);
  const [isAddOpen, setIsAddOpen] = useState(params.openAdd === '1');
  const [reportOpen, setReportOpen] = useState(false);
  const [autoOpenedAdd, setAutoOpenedAdd] = useState(false);

  useEffect(() => {
    if (params.openAdd === '1' && !autoOpenedAdd) {
      setIsAddOpen(true);
      setAutoOpenedAdd(true);
    }
  }, [params.openAdd, autoOpenedAdd]);
  // Whether the user has dismissed today's "you prayed for 3" celebration.
  // Local + session-scoped: a fresh app open *does* re-show the celebration
  // if they cross 3 again, but tapping "Pray for more" hides it for the rest
  // of this app session. After they're past 3 today, the N-of-3 framing
  // disappears entirely — it'd be a lie to keep showing "Prayer 2 of 3" when
  // they're on their 7th.
  const [celebrationDismissed, setCelebrationDismissed] = useState(false);

  const feed = useAuthenticatedQuery(
    api.functions.prayers.feed,
    community?.id ? { communityId: community.id as Id<'communities'> } : 'skip',
  );
  const counts = useAuthenticatedQuery(
    api.functions.prayers.myPrayedThisWeekCount,
    community?.id
      ? { communityId: community.id as Id<'communities'> }
      : 'skip',
  );
  const prayerNotifPrefs = useAuthenticatedQuery(
    api.functions.prayers.notifications.getPrayerNotificationPreferences,
    community?.id
      ? { communityId: community.id as Id<'communities'> }
      : 'skip',
  );
  const setMasterPrayerNotifications = useAuthenticatedMutation(
    api.functions.prayers.notifications.setMasterPrayerNotifications,
  );
  const notifsMasterEnabled = prayerNotifPrefs?.masterEnabled ?? true;

  const handleToggleNotifications = useCallback(() => {
    if (!community?.id) return;
    if (notifsMasterEnabled) {
      // Turning OFF — confirm because this silences everything (the user
      // won't be reminded to pray or notified when someone prays for them).
      Alert.alert(
        'Turn off prayer notifications?',
        "You won't be reminded to pray or notified when someone prays for you. You can turn this back on anytime.",
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Turn off',
            style: 'destructive',
            onPress: () => {
              void setMasterPrayerNotifications({
                communityId: community.id as Id<'communities'>,
                enabled: false,
              });
            },
          },
        ],
      );
    } else {
      // Turning ON — no confirmation needed, it's the safe direction.
      void setMasterPrayerNotifications({
        communityId: community.id as Id<'communities'>,
        enabled: true,
      });
    }
  }, [community?.id, notifsMasterEnabled, setMasterPrayerNotifications]);
  const todayCount = counts?.today ?? 0;
  const weekCount = counts?.week ?? 0;

  const isLoading = feed === undefined && !!community?.id;
  const current: PrayerCardData | undefined = feed?.[0];

  // Are we still inside the initial set-of-3 onboarding framing? Once the
  // user has prayed 3+ today, drop the dots and the "N of 3" label — at
  // that point they're committed and the framing would just be noise.
  const inFirstSet = todayCount < SESSION_TARGET;
  // Celebration fires only at the *exact* moment they cross 3, and only
  // until dismissed for this app session. If they re-open the app already
  // past 3 today, skip straight to the prayer card — interrupting them
  // with the celebration on every launch would feel ceremonious in a bad
  // way.
  const showCelebration = todayCount === SESSION_TARGET && !celebrationDismissed;

  const handlePrayed = useCallback(() => {
    setPraySessionOpen(false);
    // todayCount auto-updates via reactive query.
  }, []);

  const dismissCelebration = useCallback(() => setCelebrationDismissed(true), []);

  const isAnonymous = current && !current.authorDisplayName;
  const authorLabel = current?.authorDisplayName ?? 'Anonymous';
  const avatarBg = current && !isAnonymous ? avatarBgFor(authorLabel) : '#E5E5EA';
  const avatarInitials = current && !isAnonymous ? initialsOf(authorLabel) : '?';

  // Hero region — either the prayer card, the celebration, an empty state,
  // or a loading spinner. Pulled inline so the wrapping <View> can keep
  // layout consistent.
  let hero: React.ReactNode;
  if (isLoading) {
    hero = (
      <View style={styles.heroCenter}>
        <ActivityIndicator color={primaryColor} />
      </View>
    );
  } else if (showCelebration) {
    hero = (
      <View style={styles.heroCenter}>
        {/*
         * Flag-on the celebration disc takes the community accent rather than
         * iOS system green: S5.1 allows accent on a screen's one primary
         * moment, and this view REPLACES the Pray button, so there's still
         * only one accent element on screen at a time.
         */}
        <View
          style={[
            styles.checkCircle,
            { backgroundColor: wa ? primaryColor : COMPLETED_GREEN },
          ]}
        >
          <Ionicons name="checkmark" size={44} color="#fff" />
        </View>
        <Text style={[styles.celebTitle, wa && waStyles.celebTitle, { color: colors.text }]}>
          You prayed for 3
        </Text>
        <Text style={[styles.celebBody, wa && waStyles.celebBody, { color: colors.textSecondary }]}>
          Thank you for taking the time. Your community is held up because of it.
        </Text>
        {current ? (
          <TouchableOpacity
            style={[
              styles.secondaryButton,
              wa && waStyles.secondaryButton,
              { borderColor: colors.border },
            ]}
            onPress={dismissCelebration}
            activeOpacity={0.85}
          >
            <Text
              style={[
                styles.secondaryButtonText,
                wa && waStyles.secondaryButtonText,
                { color: colors.text },
              ]}
            >
              Pray for more
            </Text>
          </TouchableOpacity>
        ) : (
          <Text
            style={[styles.celebFootnote, wa && waStyles.celebFootnote, { color: colors.textTertiary }]}
          >
            No more prayer requests right now — check back later.
          </Text>
        )}
      </View>
    );
  } else if (!current && todayCount > 0) {
    hero = (
      <View style={styles.heroCenter}>
        <View
          style={[
            styles.checkCircle,
            { backgroundColor: wa ? primaryColor : COMPLETED_GREEN },
          ]}
        >
          <Ionicons name="checkmark" size={36} color="#fff" />
        </View>
        <Text style={[styles.celebTitle, wa && waStyles.celebTitle, { color: colors.text }]}>
          You prayed for {todayCount} today
        </Text>
        <Text style={[styles.celebBody, wa && waStyles.celebBody, { color: colors.textSecondary }]}>
          That's everyone waiting for prayer right now. Check back later.
        </Text>
      </View>
    );
  } else if (!current) {
    hero = (
      <View style={styles.heroCenter}>
        <Ionicons name="heart-outline" size={44} color={colors.iconSecondary} />
        <Text style={[styles.emptyTitle, wa && waStyles.emptyTitle, { color: colors.text }]}>
          All caught up
        </Text>
        <Text style={[styles.emptyBody, wa && waStyles.emptyBody, { color: colors.textSecondary }]}>
          There's no one waiting for prayer right now. Add a request for your community.
        </Text>
      </View>
    );
  } else {
    const countLabel =
      current.prayedForCount === 0
        ? 'Be the first to pray'
        : current.prayedForCount === 1
          ? '1 other prayed'
          : `${current.prayedForCount} others prayed`;

    hero = (
      <View style={styles.cardWrap}>
        <View
          style={[
            styles.card,
            wa && waStyles.card,
            {
              backgroundColor: colors.surface,
              borderColor: colors.border,
              shadowColor: colors.text,
            },
          ]}
        >
          <View style={styles.cardHeader}>
            {/*
             * Initials-only on purpose — NEVER swap in a profile photo here.
             * A prayer request is a vulnerable moment and showing a face
             * pulls in social-media energy ("who's this person, what do
             * they look like") that the prayer screen should resist. The
             * deterministic background color gives enough identity texture
             * without making it about appearance.
             */}
            <View style={[styles.avatar, { backgroundColor: avatarBg }]}>
              {isAnonymous ? (
                <Ionicons name="eye-off-outline" size={18} color="#5C5C66" />
              ) : (
                <Text style={styles.avatarText}>{avatarInitials}</Text>
              )}
            </View>
            <View style={styles.cardHeaderText}>
              <Text style={[styles.authorName, wa && waStyles.authorName, { color: colors.text }]}>
                {authorLabel}
              </Text>
              <Text
                style={[
                  styles.authorMeta,
                  wa && waStyles.authorMeta,
                  { color: colors.textTertiary },
                ]}
              >
                {relativeTime(current.createdAt)} · {countLabel}
              </Text>
            </View>
            <TouchableOpacity
              style={styles.overflowButton}
              onPress={() => setReportOpen(true)}
              hitSlop={10}
              accessibilityLabel="Report this prayer"
            >
              <Ionicons name="ellipsis-horizontal" size={20} color={colors.iconSecondary} />
            </TouchableOpacity>
          </View>

          {/*
           * Body scrolls *inside* the card so a long request can't push the
           * Pray button off the bottom and out from under the prayed-for rail.
           * The button stays pinned and tappable no matter how long the text.
           */}
          <ScrollView
            style={styles.bodyScroll}
            contentContainerStyle={styles.bodyContent}
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.bodyWrap}>
              <Text
                style={[
                  styles.quoteMark,
                  // S5: the Pray pill is this screen's only accent. The
                  // decorative quote mark goes neutral gray flag-on.
                  { color: wa ? colors.textTertiary : primaryColor },
                ]}
                accessibilityElementsHidden
                importantForAccessibility="no"
              >
                “
              </Text>
              <Text style={[styles.body, wa && waStyles.body, { color: colors.text }]}>
                {current.bodyText}
              </Text>
            </View>
          </ScrollView>

          <TouchableOpacity
            style={[styles.prayButton, wa && waStyles.prayButton, { backgroundColor: primaryColor }]}
            onPress={() => setPraySessionOpen(true)}
            activeOpacity={0.85}
          >
            <Ionicons name="heart" size={18} color="#fff" />
            <Text style={[styles.prayButtonText, wa && waStyles.prayButtonText]}>Pray</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // Header progress framing — only meaningful for the initial set of 3.
  // Past that, the dots + "N of 3" would lie (no, you're not on prayer 2,
  // you're on your 7th today), so we hide them entirely and only keep the
  // cumulative "today" pill.
  const setLabel = !isLoading && inFirstSet
    ? `Prayer ${Math.min(SESSION_TARGET, todayCount + 1)} of ${SESSION_TARGET}`
    : null;
  const weekLabel = weekCount >= WEEK_PILL_MIN ? `${weekCount} this week` : null;
  const showHeaderRow = !isLoading && (setLabel || weekLabel);

  const setProgress = (
    <>
      <Text
        style={[
          styles.progressLabel,
          wa && waStyles.progressLabel,
          { color: wa ? colors.text : colors.textSecondary },
        ]}
      >
        {setLabel}
      </Text>
      <ProgressDots
        count={SESSION_TARGET}
        filled={Math.min(SESSION_TARGET, todayCount)}
        complete={false}
        baseColor={colors.border}
        filledColor={wa ? colors.text : COMPLETED_GREEN}
      />
    </>
  );

  return (
    <View
      style={[
        styles.container,
        { backgroundColor: colors.surfaceSecondary, paddingTop: insets.top + 12 },
        // Flag-on, the tab bar is a floating island over the content (S2).
        // The prayed rail is a fixed footer (not scroll content), so the
        // container must reserve the safe-area strip AND the island height
        // for the rail to stay fully reachable above it.
        wa && {
          paddingBottom: waTabBarStripHeight(insets.bottom) + WA_TAB_CONTENT_CLEARANCE,
        },
      ]}
    >
      {wa ? (
        // S1 chrome, same shape as the Events tab: a row of floating NEUTRAL
        // white circles over the content, then the 34pt large title on its own
        // line. Each header action keeps its affordance — the bell's state now
        // reads from the glyph (outline vs. off-outline) instead of a green
        // tint (S5.2), and "My prayers" becomes a circle so no text button
        // survives in the chrome. The screen's original framing copy moves to
        // the 15pt gray subtitle below the title.
        <>
          <WaScreenHeader
            title="Prayer"
            trailingButtons={[
              {
                icon: notifsMasterEnabled
                  ? 'notifications-outline'
                  : 'notifications-off-outline',
                onPress: handleToggleNotifications,
                accessibilityLabel: notifsMasterEnabled
                  ? 'Turn off prayer notifications'
                  : 'Turn on prayer notifications',
              },
              {
                icon: 'list-outline',
                onPress: () => router.push('/(user)/my-prayers'),
                accessibilityLabel: 'My prayers',
              },
              {
                icon: 'add',
                onPress: () => setIsAddOpen(true),
                accessibilityLabel: 'Request prayer',
              },
            ]}
          />
          <Text style={[waStyles.headerSubtitle, { color: colors.textSecondary }]}>
            Pray for your community
          </Text>
        </>
      ) : (
        <View style={styles.topBar}>
          <Text style={[styles.heading, { color: colors.text }]}>Pray for your community</Text>
          <View style={styles.topRightRow}>
            <TouchableOpacity
              style={styles.topAction}
              onPress={handleToggleNotifications}
              hitSlop={8}
              accessibilityLabel={
                notifsMasterEnabled
                  ? 'Turn off prayer notifications'
                  : 'Turn on prayer notifications'
              }
              accessibilityRole="button"
            >
              <Ionicons
                name={notifsMasterEnabled ? 'notifications-outline' : 'notifications-off-outline'}
                size={22}
                color={notifsMasterEnabled ? primaryColor : colors.iconSecondary}
              />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.topAction}
              onPress={() => setIsAddOpen(true)}
              hitSlop={8}
              accessibilityLabel="Request prayer"
            >
              <Ionicons name="add-circle-outline" size={22} color={primaryColor} />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.topAction}
              onPress={() => router.push('/(user)/my-prayers')}
              hitSlop={8}
              accessibilityLabel="My prayers"
            >
              <Text style={[styles.topActionText, { color: primaryColor }]}>My prayers</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {showHeaderRow ? (
        <View style={[styles.progressRow, wa && waStyles.progressRow]}>
          {setLabel ? (
            // Flag-on the label + dots become ONE neutral pill (S5: no colored
            // or warning chips anywhere but the primary CTA). Flag-off they stay
            // bare siblings of the row — the wrapper View's very presence is
            // gated, not just its style.
            wa ? (
              <View style={[waStyles.pill, { backgroundColor: colors.surface }]}>
                {setProgress}
              </View>
            ) : (
              setProgress
            )
          ) : null}
          {weekLabel ? (
            <View
              style={[
                styles.todayPill,
                wa && waStyles.pill,
                wa && waStyles.weekPill,
                { backgroundColor: colors.surface, borderColor: colors.border },
              ]}
            >
              <Ionicons
                name="flame"
                size={wa ? 14 : 11}
                color={wa ? colors.textSecondary : COMPLETED_GREEN}
              />
              <Text
                style={[
                  styles.todayPillText,
                  wa && waStyles.weekPillText,
                  { color: wa ? colors.text : colors.textSecondary },
                ]}
              >
                {weekLabel}
              </Text>
            </View>
          ) : null}
        </View>
      ) : null}

      <View style={styles.heroFill}>{hero}</View>

      {community?.id ? (
        <PrayedPrayerRail communityId={community.id as Id<'communities'>} />
      ) : null}

      <PraySession
        prayer={current ?? null}
        visible={praySessionOpen && !!current}
        onClose={() => setPraySessionOpen(false)}
        onPrayed={handlePrayed}
      />
      <AddPrayerSheet
        visible={isAddOpen}
        onClose={() => setIsAddOpen(false)}
        onPosted={() => setIsAddOpen(false)}
      />
      <ReportPrayerSheet
        prayerId={current?.id ?? null}
        visible={reportOpen && !!current}
        onClose={() => setReportOpen(false)}
        onReported={() => setReportOpen(false)}
      />
    </View>
  );
}

function ProgressDots({
  count,
  filled,
  complete,
  baseColor,
  filledColor,
}: {
  count: number;
  filled: number;
  complete: boolean;
  baseColor: string;
  /** Ink for a completed dot — neutral text ink flag-on, iOS green flag-off. */
  filledColor: string;
}) {
  return (
    <View style={styles.dotsRow}>
      {Array.from({ length: count }).map((_, i) => {
        const isFilled = i < filled;
        return (
          <View
            key={i}
            style={[
              styles.dot,
              { backgroundColor: isFilled ? filledColor : baseColor },
            ]}
          />
        );
      })}
      {complete ? (
        <View style={[styles.dotCheck, { backgroundColor: COMPLETED_GREEN }]}>
          <Ionicons name="checkmark" size={12} color="#fff" />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    marginBottom: 6,
  },
  heading: { fontSize: 20, fontWeight: '700', flex: 1 },
  topRightRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  topAction: { paddingVertical: 4 },
  topActionText: { fontSize: 14, fontWeight: '600' },
  progressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 20,
    marginBottom: 18,
  },
  progressLabel: { fontSize: 12, fontWeight: '600', letterSpacing: 0.4 },
  dotsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
  todayPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    marginLeft: 'auto',
  },
  todayPillText: { fontSize: 11, fontWeight: '600' },
  dotCheck: {
    width: 16,
    height: 16,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 2,
  },
  heroFill: { flex: 1 },
  heroCenter: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 36,
  },
  cardWrap: {
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 4,
    paddingBottom: 4,
  },
  card: {
    // flexShrink lets the card cap at the available height for long prayers
    // (so the body scrolls) while still sizing to content for short ones.
    flexShrink: 1,
    borderRadius: 20,
    padding: 22,
    borderWidth: StyleSheet.hairlineWidth,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.08,
    shadowRadius: 16,
    elevation: 4,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 12,
  },
  bodyScroll: {
    flexShrink: 1,
  },
  bodyContent: {
    // Headroom so the negative-offset quote mark isn't clipped at the
    // scroll viewport's top edge.
    paddingTop: 8,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#3A3A3F',
  },
  cardHeaderText: { flex: 1 },
  overflowButton: {
    padding: 4,
  },
  authorName: { fontSize: 16, fontWeight: '700' },
  authorMeta: { fontSize: 12, marginTop: 2 },
  bodyWrap: {
    position: 'relative',
    paddingLeft: 24,
    paddingRight: 4,
    paddingTop: 8,
    paddingBottom: 22,
  },
  quoteMark: {
    position: 'absolute',
    top: -12,
    left: -2,
    fontSize: 64,
    fontWeight: '700',
    lineHeight: 64,
    opacity: 0.35,
  },
  body: {
    fontSize: 19,
    lineHeight: 28,
    fontWeight: '500',
  },
  prayButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    borderRadius: 14,
  },
  prayButtonText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  emptyTitle: { fontSize: 18, fontWeight: '600', marginTop: 14, marginBottom: 8 },
  emptyBody: { fontSize: 15, textAlign: 'center', lineHeight: 22 },
  checkCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 18,
  },
  celebTitle: { fontSize: 22, fontWeight: '700', marginBottom: 8, textAlign: 'center' },
  celebBody: { fontSize: 15, textAlign: 'center', lineHeight: 22, marginBottom: 24 },
  celebFootnote: { fontSize: 13, textAlign: 'center' },
  secondaryButton: {
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 24,
    borderWidth: 1,
  },
  secondaryButtonText: { fontSize: 15, fontWeight: '600' },
});

/**
 * Neutral pill height. WA's filter/status capsules are 34pt fully rounded with
 * a 15pt dark label (WA-VISUAL-DELTAS.md D4, matching the inbox resource
 * chips). Declared here rather than imported from `features/chat` so the
 * prayer surface doesn't reach across features for a number.
 */
const WA_PILL_HEIGHT = 34;

/**
 * The whatsapp-shell skin (WHATSAPP-DESIGN-SYSTEM.md §7): the pray-session card
 * mechanic survives — it IS the feature — but it stops being a
 * bordered-and-shadowed "feature card" and becomes an inset-grouped surface at
 * the WA radius, on the S7 type scale, with the accent left only on the Pray
 * pill. Applied as `wa && waStyles.x` so flag-off rendering is untouched.
 */
const waStyles = StyleSheet.create({
  // The framing copy the flag-off screen carries as its 20pt heading, re-set as
  // the 15pt gray line under the large title (§3.2 hero subtitle).
  headerSubtitle: {
    fontSize: WA_TYPE_SUBTITLE,
    fontWeight: WA_WEIGHT_REGULAR,
    paddingHorizontal: WA_GROUP_MARGIN,
    marginTop: 2,
    marginBottom: 14,
  },

  progressRow: { paddingHorizontal: WA_GROUP_MARGIN, gap: 8, marginBottom: 14 },
  // Neutral capsule. The page background is already `surfaceSecondary`, so the
  // fill is `surface` (WhatsApp's floating day-pill treatment) rather than the
  // gray fill chips use when they sit on white — a gray-on-gray pill would
  // simply vanish here.
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    height: WA_PILL_HEIGHT,
    borderRadius: WA_PILL_HEIGHT / 2,
    paddingHorizontal: 14,
  },
  progressLabel: {
    fontSize: WA_TYPE_SUBTITLE,
    fontWeight: WA_WEIGHT_REGULAR,
    letterSpacing: 0,
  },
  // Kills the hairline border and the old 10pt radius; `pill` supplies the rest.
  weekPill: { borderWidth: 0, paddingVertical: 0, gap: 6, marginLeft: 'auto' },
  weekPillText: { fontSize: WA_TYPE_SUBTITLE, fontWeight: WA_WEIGHT_REGULAR },

  // §7 "never cards-with-shadows": flat, borderless, 24pt radius.
  card: {
    borderRadius: WA_GROUP_RADIUS,
    borderWidth: 0,
    shadowOpacity: 0,
    shadowRadius: 0,
    elevation: 0,
    padding: 20,
  },
  authorName: { fontSize: WA_TYPE_ROW_TITLE, fontWeight: WA_WEIGHT_SEMIBOLD },
  authorMeta: { fontSize: WA_TYPE_FOOTNOTE, fontWeight: WA_WEIGHT_REGULAR },
  body: { fontSize: WA_TYPE_ROW_TITLE, fontWeight: WA_WEIGHT_REGULAR, lineHeight: 25 },
  // The screen's single accent element, as a fully-rounded WA CTA pill.
  prayButton: { borderRadius: 26, paddingVertical: 15 },
  prayButtonText: { fontSize: WA_TYPE_ROW_TITLE, fontWeight: WA_WEIGHT_SEMIBOLD },

  // Empty / celebration states: centered glyph + 17pt title + 15pt gray body.
  emptyTitle: { fontSize: WA_TYPE_ROW_TITLE, fontWeight: WA_WEIGHT_SEMIBOLD },
  emptyBody: { fontSize: WA_TYPE_SUBTITLE, fontWeight: WA_WEIGHT_REGULAR, lineHeight: 21 },
  celebTitle: { fontSize: WA_TYPE_HEADER_BLOCK, fontWeight: WA_WEIGHT_BOLD },
  celebBody: { fontSize: WA_TYPE_SUBTITLE, fontWeight: WA_WEIGHT_REGULAR, lineHeight: 21 },
  celebFootnote: { fontSize: WA_TYPE_FOOTNOTE },
  secondaryButton: { borderRadius: 26, paddingVertical: 14, paddingHorizontal: 28 },
  secondaryButtonText: { fontSize: WA_TYPE_ROW_TITLE, fontWeight: WA_WEIGHT_SEMIBOLD },
});
