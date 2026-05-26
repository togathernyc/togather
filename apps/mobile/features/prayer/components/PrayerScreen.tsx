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

import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@providers/AuthProvider';
import { useTheme } from '@hooks/useTheme';
import { useCommunityTheme } from '@hooks/useCommunityTheme';
import { useAuthenticatedQuery, api } from '@services/api/convex';
import type { Id } from '@services/api/convex';
import { PraySession } from './PraySession';
import { AddPrayerSheet } from './AddPrayerSheet';
import { CrisisResourceCard } from './CrisisResourceCard';
import { ReportPrayerSheet } from './ReportPrayerSheet';
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
  const { primaryColor } = useCommunityTheme();
  const [praySessionOpen, setPraySessionOpen] = useState(false);
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
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
        <View style={[styles.checkCircle, { backgroundColor: COMPLETED_GREEN }]}>
          <Ionicons name="checkmark" size={44} color="#fff" />
        </View>
        <Text style={[styles.celebTitle, { color: colors.text }]}>You prayed for 3</Text>
        <Text style={[styles.celebBody, { color: colors.textSecondary }]}>
          Thank you for taking the time. Your community is held up because of it.
        </Text>
        {current ? (
          <TouchableOpacity
            style={[styles.secondaryButton, { borderColor: colors.border }]}
            onPress={dismissCelebration}
            activeOpacity={0.85}
          >
            <Text style={[styles.secondaryButtonText, { color: colors.text }]}>Pray for more</Text>
          </TouchableOpacity>
        ) : (
          <Text style={[styles.celebFootnote, { color: colors.textTertiary }]}>
            No more prayer requests right now — check back later.
          </Text>
        )}
      </View>
    );
  } else if (!current && todayCount > 0) {
    hero = (
      <View style={styles.heroCenter}>
        <View style={[styles.checkCircle, { backgroundColor: COMPLETED_GREEN }]}>
          <Ionicons name="checkmark" size={36} color="#fff" />
        </View>
        <Text style={[styles.celebTitle, { color: colors.text }]}>
          You prayed for {todayCount} today
        </Text>
        <Text style={[styles.celebBody, { color: colors.textSecondary }]}>
          That's everyone waiting for prayer right now. Check back later.
        </Text>
      </View>
    );
  } else if (!current) {
    hero = (
      <View style={styles.heroCenter}>
        <Ionicons name="heart-outline" size={44} color={colors.iconSecondary} />
        <Text style={[styles.emptyTitle, { color: colors.text }]}>All caught up</Text>
        <Text style={[styles.emptyBody, { color: colors.textSecondary }]}>
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
            {
              backgroundColor: colors.surface,
              borderColor: colors.border,
              shadowColor: colors.text,
            },
          ]}
        >
          {current.crisisFlag ? <CrisisResourceCard /> : null}
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
              <Text style={[styles.authorName, { color: colors.text }]}>{authorLabel}</Text>
              <Text style={[styles.authorMeta, { color: colors.textTertiary }]}>
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

          <View style={styles.bodyWrap}>
            <Text
              style={[styles.quoteMark, { color: primaryColor }]}
              accessibilityElementsHidden
              importantForAccessibility="no"
            >
              “
            </Text>
            <Text style={[styles.body, { color: colors.text }]}>{current.bodyText}</Text>
          </View>

          <TouchableOpacity
            style={[styles.prayButton, { backgroundColor: primaryColor }]}
            onPress={() => setPraySessionOpen(true)}
            activeOpacity={0.85}
          >
            <Ionicons name="heart" size={18} color="#fff" />
            <Text style={styles.prayButtonText}>Pray</Text>
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

  return (
    <View
      style={[
        styles.container,
        { backgroundColor: colors.surfaceSecondary, paddingTop: insets.top + 12 },
      ]}
    >
      <View style={styles.topBar}>
        <Text style={[styles.heading, { color: colors.text }]}>Pray for your community</Text>
        <View style={styles.topRightRow}>
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

      {showHeaderRow ? (
        <View style={styles.progressRow}>
          {setLabel ? (
            <>
              <Text style={[styles.progressLabel, { color: colors.textSecondary }]}>{setLabel}</Text>
              <ProgressDots
                count={SESSION_TARGET}
                filled={Math.min(SESSION_TARGET, todayCount)}
                complete={false}
                baseColor={colors.border}
              />
            </>
          ) : null}
          {weekLabel ? (
            <View style={[styles.todayPill, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <Ionicons name="flame" size={11} color={COMPLETED_GREEN} />
              <Text style={[styles.todayPillText, { color: colors.textSecondary }]}>{weekLabel}</Text>
            </View>
          ) : null}
        </View>
      ) : null}

      <View style={styles.heroFill}>{hero}</View>

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
}: {
  count: number;
  filled: number;
  complete: boolean;
  baseColor: string;
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
              { backgroundColor: isFilled ? COMPLETED_GREEN : baseColor },
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
    paddingHorizontal: 16,
    paddingTop: 4,
  },
  card: {
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
    marginBottom: 18,
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
