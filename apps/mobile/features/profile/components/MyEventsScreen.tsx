/**
 * MyEventsScreen
 *
 * Profile → My Events. Two segments (Hosted / Attended). Each segment has
 * Upcoming above Past. Single events render via `EventCardRow`; community-wide
 * grouped cards render via `EventRowCommunityWide` with tap-to-expand into
 * `CommunityWideEventSheet`, matching the Events tab. See ADR-022.
 */

import React, { useCallback, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '@hooks/useTheme';
import {
  useMyHostedEvents,
  useMyAttendedEvents,
} from '@features/events/hooks/useMyEvents';
import { EventCardRow } from '@features/events/components/EventCardRow';
import { EventRowCommunityWide } from '@features/events/components/EventRowCommunityWide';
import { CommunityWideEventSheet } from '@features/events/components/CommunityWideEventSheet';
import type { CommunityEvent } from '@features/events/hooks/useCommunityEvents';
import type { Id } from '@services/api/convex';

type Segment = 'hosted' | 'attended';

function adaptSingleCard(card: any): CommunityEvent {
  return {
    id: card.id,
    shortId: card.shortId,
    title: card.title,
    scheduledAt: card.scheduledAt,
    status: card.status,
    visibility: card.visibility,
    coverImage: card.coverImage,
    locationOverride: card.locationOverride,
    meetingType: card.meetingType,
    rsvpEnabled: card.rsvpEnabled,
    communityWideEventId: card.communityWideEventId,
    group: {
      id: card.group.id,
      name: card.group.name,
      image: card.group.image,
      groupTypeName: card.group.groupTypeName,
      addressLine1: card.group.addressLine1,
      addressLine2: card.group.addressLine2,
      city: card.group.city,
      state: card.group.state,
      zipCode: card.group.zipCode,
    },
    rsvpSummary: {
      totalGoing: card.rsvpSummary.totalGoing,
      topGoingGuests: card.rsvpSummary.topGoingGuests,
    },
  };
}

interface CardListProps {
  cards: any[];
  emptyText: string;
  onCommunityWideTap: (parentId: Id<'communityWideEvents'>) => void;
  colors: ReturnType<typeof useTheme>['colors'];
}

function CardList({ cards, emptyText, onCommunityWideTap, colors }: CardListProps) {
  if (!cards || cards.length === 0) {
    return (
      <View style={styles.emptyBlock}>
        <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
          {emptyText}
        </Text>
      </View>
    );
  }
  return (
    <View style={styles.sectionBody}>
      {cards.map((card) => {
        if (card.kind === 'community_wide') {
          return (
            <EventRowCommunityWide
              key={`cw-${String(card.parentId)}`}
              event={{
                kind: 'community_wide',
                parentId: String(card.parentId),
                title: card.title,
                scheduledAt: card.scheduledAt,
                status: card.status,
                meetingType: card.meetingType,
                groupCount: card.groupCount,
                totalGoing: card.totalGoing,
                coverImage: card.coverImage,
                representativeShortId: card.representativeShortId,
              }}
              onPress={() =>
                onCommunityWideTap(card.parentId as Id<'communityWideEvents'>)
              }
            />
          );
        }
        return <EventCardRow key={String(card.id)} event={adaptSingleCard(card)} />;
      })}
    </View>
  );
}

export function MyEventsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const [segment, setSegment] = useState<Segment>('hosted');
  const [activeParentId, setActiveParentId] =
    useState<Id<'communityWideEvents'> | null>(null);

  const { data: hosted, isLoading: isLoadingHosted } = useMyHostedEvents({
    enabled: segment === 'hosted',
    includePast: true,
  });
  const { data: attended, isLoading: isLoadingAttended } = useMyAttendedEvents({
    enabled: segment === 'attended',
    includePast: true,
  });

  const current = segment === 'hosted' ? hosted : attended;
  const isLoading =
    (segment === 'hosted' && isLoadingHosted) ||
    (segment === 'attended' && isLoadingAttended);

  const upcoming = useMemo(() => current?.upcoming ?? [], [current]);
  const past = useMemo(() => current?.past ?? [], [current]);

  const handleCommunityWideTap = useCallback(
    (parentId: Id<'communityWideEvents'>) => {
      setActiveParentId(parentId);
    },
    []
  );

  return (
    <View
      style={[
        styles.container,
        { paddingTop: insets.top, backgroundColor: colors.backgroundSecondary },
      ]}
    >
      {/* Header: only a back chevron + segmented control — no big title. */}
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <TouchableOpacity
          onPress={() => router.back()}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          style={styles.backButton}
        >
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <View
          style={[
            styles.segmentedControl,
            { backgroundColor: colors.surfaceSecondary },
          ]}
        >
          <SegmentButton
            label="Hosted"
            active={segment === 'hosted'}
            onPress={() => setSegment('hosted')}
            colors={colors}
          />
          <SegmentButton
            label="Attended"
            active={segment === 'attended'}
            onPress={() => setSegment('attended')}
            colors={colors}
          />
        </View>
        {/* Empty spacer to balance the chevron column */}
        <View style={styles.backButton} />
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
      >
        {isLoading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator color={colors.textSecondary} />
          </View>
        ) : (
          <>
            <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>
              UPCOMING
            </Text>
            <CardList
              cards={upcoming}
              emptyText={
                segment === 'hosted'
                  ? "You haven't created any upcoming events yet."
                  : "You haven't RSVPed to any upcoming events."
              }
              onCommunityWideTap={handleCommunityWideTap}
              colors={colors}
            />

            <Text
              style={[
                styles.sectionLabel,
                styles.sectionLabelSpaced,
                { color: colors.textSecondary },
              ]}
            >
              PAST
            </Text>
            <CardList
              cards={past}
              emptyText={
                segment === 'hosted'
                  ? 'No past events yet.'
                  : 'No past attended events yet.'
              }
              onCommunityWideTap={handleCommunityWideTap}
              colors={colors}
            />
          </>
        )}
      </ScrollView>

      <CommunityWideEventSheet
        parentId={activeParentId}
        onDismiss={() => setActiveParentId(null)}
      />
    </View>
  );
}

interface SegmentButtonProps {
  label: string;
  active: boolean;
  onPress: () => void;
  colors: ReturnType<typeof useTheme>['colors'];
}
function SegmentButton({ label, active, onPress, colors }: SegmentButtonProps) {
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.7}
      style={[
        styles.segmentButton,
        active && { backgroundColor: colors.surface },
      ]}
    >
      <Text
        style={[
          styles.segmentButtonText,
          { color: active ? colors.text : colors.textSecondary },
        ]}
      >
        {label}
      </Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 8,
  },
  backButton: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
  segmentedControl: {
    flex: 1,
    flexDirection: 'row',
    borderRadius: 10,
    padding: 4,
  },
  segmentButton: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 8,
    alignItems: 'center',
  },
  segmentButtonText: {
    fontSize: 14,
    fontWeight: '600',
  },
  scroll: { flex: 1 },
  scrollContent: {
    paddingHorizontal: 16,
    paddingBottom: 40,
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.5,
    marginTop: 16,
    marginBottom: 8,
  },
  sectionLabelSpaced: {
    marginTop: 28,
  },
  sectionBody: {
    gap: 10,
  },
  emptyBlock: {
    paddingVertical: 20,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 14,
    textAlign: 'center',
  },
  loadingContainer: {
    paddingVertical: 60,
    alignItems: 'center',
  },
});
