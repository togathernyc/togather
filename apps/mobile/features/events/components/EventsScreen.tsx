/**
 * EventsScreen
 *
 * The dedicated Events tab introduced in ADR-022. Renders four pre-sliced
 * buckets from `listForEventsTab` — Happening now / Your RSVPs / This week /
 * Later — with a sticky "Create Event" header and a link to past events.
 *
 * When the user has no community context, falls back to the "My RSVPs"
 * view (ported from the legacy ExploreScreen) so the tab still has content.
 */

import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@providers/AuthProvider';
import { useTheme } from '@hooks/useTheme';
import { useCommunityTheme } from '@hooks/useCommunityTheme';
import { AppImage } from '@components/ui';
import { useEventsByTimeWindow } from '../hooks/useEventsByTimeWindow';
import { useMyRsvpedEvents } from '../hooks/useCommunityEvents';
import { EventCard } from './EventCard';
import { CommunityWideEventCard } from './CommunityWideEventCard';
import { CommunityWideEventSheet } from './CommunityWideEventSheet';
import type { CommunityEvent } from '../hooks/useCommunityEvents';
import type { Id } from '@services/api/convex';

/**
 * Adapter: maps a SingleEventCard (backend shape with Convex ids) into the
 * CommunityEvent shape the existing EventCard component consumes. Convex ids
 * are strings at runtime, so this is mostly a type-level passthrough.
 */
function toCommunityEvent(card: any): CommunityEvent {
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

interface SectionProps {
  title: string;
  cards: any[];
  onCommunityWideTap: (parentId: Id<'communityWideEvents'>) => void;
  colors: ReturnType<typeof useTheme>['colors'];
}

function Section({ title, cards, onCommunityWideTap, colors }: SectionProps) {
  if (!cards || cards.length === 0) return null;
  return (
    <View style={styles.section}>
      <Text style={[styles.sectionTitle, { color: colors.text }]}>{title}</Text>
      <View style={styles.sectionBody}>
        {cards.map((card) => {
          if (card.kind === 'community_wide') {
            return (
              <CommunityWideEventCard
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
          const adapted = toCommunityEvent(card);
          return <EventCard key={String(card.id)} event={adapted} />;
        })}
      </View>
    </View>
  );
}

export function EventsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { community, user, token } = useAuth();
  const { colors } = useTheme();
  const { primaryColor } = useCommunityTheme();
  const hasCommunityContext = !!community?.id;

  const [expandedParentId, setExpandedParentId] =
    useState<Id<'communityWideEvents'> | null>(null);

  const handleCommunityWideTap = useCallback(
    (parentId: Id<'communityWideEvents'>) => {
      setExpandedParentId(parentId);
    },
    []
  );

  const handleDismissSheet = useCallback(() => {
    setExpandedParentId(null);
  }, []);

  // Primary data source when we have a community.
  const { data, isLoading } = useEventsByTimeWindow({
    enabled: hasCommunityContext,
  });

  // Fallback: user with no community — show their RSVPed events
  const { data: myRsvpedEventsData, isLoading: isLoadingMyRsvps } =
    useMyRsvpedEvents({ enabled: !hasCommunityContext });

  const handleCreateEvent = useCallback(() => {
    router.push('/(user)/create-event');
  }, [router]);

  const handlePastEventsPress = useCallback(() => {
    // Note: /(user)/my-events does not yet exist — link added now, route
    // comes in PR 2. Until then this will 404 gracefully.
    router.push('/(user)/my-events?segment=attended');
  }, [router]);

  // Header with sticky "+ Create Event" CTA
  const header = (
    <View
      style={[
        styles.header,
        {
          paddingTop: insets.top + 16,
          backgroundColor: colors.surface,
          borderBottomColor: colors.borderLight,
        },
      ]}
    >
      <Text style={[styles.headerTitle, { color: colors.text }]}>Events</Text>
      <TouchableOpacity
        style={[styles.createButton, { backgroundColor: primaryColor }]}
        onPress={handleCreateEvent}
        activeOpacity={0.8}
      >
        <Ionicons name="add" size={16} color="#fff" />
        <Text style={styles.createButtonText}>Create Event</Text>
      </TouchableOpacity>
    </View>
  );

  // No community context → "My RSVPs" fallback body
  if (!hasCommunityContext) {
    const myEvents = myRsvpedEventsData?.events ?? [];
    return (
      <View style={[styles.container, { backgroundColor: colors.backgroundSecondary }]}>
        {header}
        {isLoadingMyRsvps ? (
          <View style={styles.centerContainer}>
            <ActivityIndicator size="small" color={colors.textSecondary} />
          </View>
        ) : myEvents.length === 0 ? (
          <View style={styles.centerContainer}>
            <Ionicons
              name="calendar-outline"
              size={48}
              color={colors.textSecondary}
              style={{ marginBottom: 16 }}
            />
            <Text style={[styles.emptyTitle, { color: colors.text }]}>No upcoming events</Text>
            <Text style={[styles.emptySubtitle, { color: colors.textSecondary }]}>
              Events you RSVP to will appear here
            </Text>
          </View>
        ) : (
          <ScrollView
            style={styles.scrollView}
            contentContainerStyle={styles.myRsvpsContent}
          >
            {myEvents.map((event: any) => (
              <TouchableOpacity
                key={event.id}
                style={[styles.myEventCard, { backgroundColor: colors.surface }]}
                onPress={() => router.push(`/e/${event.shortId}?source=app`)}
                activeOpacity={0.7}
              >
                <AppImage
                  source={event.coverImage || event.group.image}
                  style={styles.myEventImage}
                  resizeMode="cover"
                  optimizedWidth={150}
                  placeholder={{
                    type: 'initials',
                    name: event.title || event.group.name,
                  }}
                />
                <View style={styles.myEventInfo}>
                  <Text
                    style={[styles.myEventTitle, { color: colors.text }]}
                    numberOfLines={1}
                  >
                    {event.title || event.group.name}
                  </Text>
                  <Text style={[styles.myEventDate, { color: primaryColor }]}>
                    {new Date(event.scheduledAt).toLocaleDateString('en-US', {
                      weekday: 'short',
                      month: 'short',
                      day: 'numeric',
                      hour: 'numeric',
                      minute: '2-digit',
                    })}
                  </Text>
                  <Text
                    style={[styles.myEventGroup, { color: colors.textSecondary }]}
                    numberOfLines={1}
                  >
                    {event.group.name}
                    {event.community?.name ? ` • ${event.community.name}` : ''}
                  </Text>
                </View>
                {event.rsvpStatus?.optionLabel && (
                  <View
                    style={[styles.myEventStatus, { backgroundColor: `${primaryColor}15` }]}
                  >
                    <Text style={[styles.myEventStatusText, { color: primaryColor }]}>
                      {event.rsvpStatus.optionLabel}
                    </Text>
                  </View>
                )}
              </TouchableOpacity>
            ))}
          </ScrollView>
        )}
      </View>
    );
  }

  // Community context → four-bucket view
  const { happeningNow, myRsvps, thisWeek, later } = data;
  const hasAnyContent =
    happeningNow.length > 0 ||
    myRsvps.length > 0 ||
    thisWeek.length > 0 ||
    later.length > 0;

  return (
    <View style={[styles.container, { backgroundColor: colors.backgroundSecondary }]}>
      {header}

      {isLoading ? (
        <View style={styles.centerContainer}>
          <ActivityIndicator size="small" color={colors.textSecondary} />
        </View>
      ) : (
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
        >
          {!hasAnyContent && (
            <View style={styles.centerContainer}>
              <Ionicons
                name="calendar-outline"
                size={48}
                color={colors.textSecondary}
                style={{ marginBottom: 16 }}
              />
              <Text style={[styles.emptyTitle, { color: colors.text }]}>No upcoming events</Text>
              <Text style={[styles.emptySubtitle, { color: colors.textSecondary }]}>
                Check back later or create one yourself.
              </Text>
            </View>
          )}

          <Section
            title="Happening now"
            cards={happeningNow}
            onCommunityWideTap={handleCommunityWideTap}
            colors={colors}
          />
          <Section
            title="Your RSVPs"
            cards={myRsvps}
            onCommunityWideTap={handleCommunityWideTap}
            colors={colors}
          />
          <Section
            title="This week"
            cards={thisWeek}
            onCommunityWideTap={handleCommunityWideTap}
            colors={colors}
          />
          <Section
            title="Later"
            cards={later}
            onCommunityWideTap={handleCommunityWideTap}
            colors={colors}
          />

          {/* Past events link — route lands in PR 2 */}
          <TouchableOpacity
            style={[styles.pastEventsLink, { borderColor: colors.borderLight }]}
            onPress={handlePastEventsPress}
            activeOpacity={0.7}
          >
            <Ionicons name="time-outline" size={18} color={colors.textSecondary} />
            <Text style={[styles.pastEventsText, { color: colors.textSecondary }]}>
              View past events
            </Text>
            <Ionicons
              name="chevron-forward"
              size={18}
              color={colors.textSecondary}
            />
          </TouchableOpacity>
        </ScrollView>
      )}

      {/* Community-wide children sheet — renders when parentId is non-null */}
      <CommunityWideEventSheet
        parentId={expandedParentId}
        onDismiss={handleDismissSheet}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    paddingHorizontal: 20,
    paddingBottom: 12,
    borderBottomWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: '700',
  },
  createButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 100,
    gap: 4,
    ...Platform.select({
      web: {
        boxShadow: '0px 2px 4px rgba(0, 0, 0, 0.12)',
      },
      default: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.12,
        shadowRadius: 3,
        elevation: 2,
      },
    }),
  },
  createButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 40,
  },
  section: {
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 10,
  },
  sectionBody: {
    gap: 12,
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 60,
    paddingHorizontal: 20,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 8,
  },
  emptySubtitle: {
    fontSize: 14,
    textAlign: 'center',
  },
  pastEventsLink: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 12,
    borderWidth: 1,
    gap: 10,
    marginTop: 4,
  },
  pastEventsText: {
    flex: 1,
    fontSize: 14,
    fontWeight: '500',
  },
  // My-RSVPs fallback styles
  myRsvpsContent: {
    padding: 16,
    gap: 12,
  },
  myEventCard: {
    borderRadius: 12,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    ...Platform.select({
      web: {
        boxShadow: '0px 1px 3px rgba(0, 0, 0, 0.1)',
      },
      default: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.1,
        shadowRadius: 2,
        elevation: 2,
      },
    }),
  },
  myEventImage: {
    width: 60,
    height: 60,
    borderRadius: 8,
  },
  myEventInfo: {
    flex: 1,
  },
  myEventTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 4,
  },
  myEventDate: {
    fontSize: 14,
    marginBottom: 2,
  },
  myEventGroup: {
    fontSize: 13,
  },
  myEventStatus: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  myEventStatusText: {
    fontSize: 12,
    fontWeight: '600',
  },
});
