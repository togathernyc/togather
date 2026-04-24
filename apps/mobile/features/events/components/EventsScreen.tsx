/**
 * EventsScreen
 *
 * The dedicated Events tab introduced in ADR-022. Four sections:
 *   - "My Events" horizontal tiles — events I'm RSVP'd to or hosting.
 *   - "Next Up" horizontal tiles — events in the next 48 hours.
 *   - "This Week" vertical rows — everything within 7 days.
 *   - "Later" vertical rows — everything else, paginated on scroll.
 *
 * Sections can overlap (an RSVP'd event tomorrow shows in both My Events
 * and Next Up). "Later" is a separate paginated query so the initial
 * payload stays small.
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
  NativeScrollEvent,
  NativeSyntheticEvent,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@providers/AuthProvider';
import { useTheme } from '@hooks/useTheme';
import { useCommunityTheme } from '@hooks/useCommunityTheme';
import { AppImage } from '@components/ui';
import { useEventsByTimeWindow } from '../hooks/useEventsByTimeWindow';
import { useLaterEvents } from '../hooks/useLaterEvents';
import { useMyRsvpedEvents } from '../hooks/useCommunityEvents';
import { EventCardRow } from './EventCardRow';
import { EventRowCommunityWide } from './EventRowCommunityWide';
import { FeaturedEventTile } from './FeaturedEventTile';
import { CommunityWideEventSheet } from './CommunityWideEventSheet';
import { EventsMapView } from './EventsMapView';
import type { CommunityEvent } from '../hooks/useCommunityEvents';
import type { Id } from '@services/api/convex';

type ViewMode = 'list' | 'map';

/**
 * Adapter: maps a SingleEventCard (backend shape with Convex ids) into the
 * CommunityEvent shape the existing row/tile components consume. Convex ids
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
    hideRsvpCount: card.hideRsvpCount === true,
    createdById: card.createdById ?? null,
    viewerIsLeader: card.viewerIsLeader === true,
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
          const adapted = toCommunityEvent(card);
          return <EventCardRow key={String(card.id)} event={adapted} />;
        })}
      </View>
    </View>
  );
}

interface HorizontalTileRowProps {
  title: string;
  cards: any[];
  colors: ReturnType<typeof useTheme>['colors'];
}

function HorizontalTileRow({ title, cards, colors }: HorizontalTileRowProps) {
  // Drop community-wide cards in horizontal tile rows — the FeaturedEventTile
  // UI assumes a single time/place/group. CWE collapsed parents don't fit.
  // Users can still reach those events through This Week / Later.
  const tiles: CommunityEvent[] = cards
    .filter((c) => c.kind !== 'community_wide')
    .map((c) => toCommunityEvent(c));
  if (tiles.length === 0) return null;
  return (
    <View style={styles.horizontalSection}>
      <Text style={[styles.sectionTitle, { color: colors.text }]}>{title}</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.horizontalScrollContent}
      >
        {tiles.map((ev) => (
          <FeaturedEventTile key={String(ev.id)} event={ev} />
        ))}
      </ScrollView>
    </View>
  );
}

interface GreetingProps {
  firstName: string | null;
  colors: ReturnType<typeof useTheme>['colors'];
  primaryColor: string;
  onMakePlans: () => void;
}

function Greeting({ firstName, colors, primaryColor, onMakePlans }: GreetingProps) {
  const hello = firstName ? `Hey ${firstName}` : 'Hey there';
  return (
    <View style={styles.greeting}>
      <Text style={[styles.greetingTitle, { color: colors.text }]}>{hello}</Text>
      <Text style={[styles.greetingSubtitle, { color: colors.textSecondary }]}>
        Life is better in community.{' '}
        <Text
          style={[styles.greetingAction, { color: primaryColor }]}
          onPress={onMakePlans}
        >
          Make plans
        </Text>
      </Text>
    </View>
  );
}

export function EventsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { community, user } = useAuth();
  const { colors } = useTheme();
  const { primaryColor } = useCommunityTheme();
  const hasCommunityContext = !!community?.id;

  const [expandedParentId, setExpandedParentId] =
    useState<Id<'communityWideEvents'> | null>(null);

  // List vs map view (list by default). Only surfaced when we have a
  // community context — the no-community fallback body stays list-only.
  const [viewMode, setViewMode] = useState<ViewMode>('list');

  const handleCommunityWideTap = useCallback(
    (parentId: Id<'communityWideEvents'>) => {
      setExpandedParentId(parentId);
    },
    []
  );

  const handleDismissSheet = useCallback(() => {
    setExpandedParentId(null);
  }, []);

  // Primary data source when we have a community. Returns myEvents, nextUp,
  // thisWeek. Later events come from a separate paginated query below.
  const { data, isLoading } = useEventsByTimeWindow({
    enabled: hasCommunityContext,
  });

  // Paginated Later section. `status === 'CanLoadMore'` means there's more
  // to fetch; `loadMore()` advances the cursor.
  const {
    cards: laterCards,
    loadMore: loadMoreLater,
    status: laterStatus,
  } = useLaterEvents({ enabled: hasCommunityContext });

  // Fallback: user with no community — show their RSVPed events
  const { data: myRsvpedEventsData, isLoading: isLoadingMyRsvps } =
    useMyRsvpedEvents({ enabled: !hasCommunityContext });

  const handleCreateEvent = useCallback(() => {
    router.push('/(user)/create-event');
  }, [router]);

  // Compact List/Map toggle — only shown when we have community context.
  const renderViewToggle = () => {
    if (!hasCommunityContext) return null;
    const listActive = viewMode === 'list';
    const mapActive = viewMode === 'map';
    return (
      <View
        style={[
          styles.toggleContainer,
          {
            backgroundColor: colors.backgroundSecondary,
            borderColor: colors.borderLight,
          },
        ]}
      >
        <TouchableOpacity
          style={[
            styles.toggleButton,
            listActive && { backgroundColor: colors.surface },
          ]}
          onPress={() => setViewMode('list')}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel="List view"
        >
          <Ionicons
            name={listActive ? 'list' : 'list-outline'}
            size={14}
            color={listActive ? colors.text : colors.textSecondary}
          />
          <Text
            style={[
              styles.toggleText,
              { color: listActive ? colors.text : colors.textSecondary },
            ]}
          >
            List
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[
            styles.toggleButton,
            mapActive && { backgroundColor: colors.surface },
          ]}
          onPress={() => setViewMode('map')}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel="Map view"
        >
          <Ionicons
            name={mapActive ? 'map' : 'map-outline'}
            size={14}
            color={mapActive ? colors.text : colors.textSecondary}
          />
          <Text
            style={[
              styles.toggleText,
              { color: mapActive ? colors.text : colors.textSecondary },
            ]}
          >
            Map
          </Text>
        </TouchableOpacity>
      </View>
    );
  };

  // Floating controls — no static header. The List/Map toggle floats
  // over the top-left; the Create Event CTA floats over the bottom
  // center (above the tab bar). Content scrolls beneath them.
  const renderFloatingControls = () => (
    <>
      <View
        style={[styles.floatingToggle, { top: insets.top + 12 }]}
        pointerEvents="box-none"
      >
        {renderViewToggle()}
      </View>
      <View
        style={[
          styles.floatingCreateContainer,
          { paddingBottom: insets.bottom + 16 },
        ]}
      >
        <TouchableOpacity
          style={[styles.floatingCreateButton, { backgroundColor: primaryColor }]}
          onPress={handleCreateEvent}
          activeOpacity={0.85}
        >
          <Ionicons name="add" size={18} color="#fff" />
          <Text style={styles.floatingCreateText}>Create Event</Text>
        </TouchableOpacity>
      </View>
    </>
  );

  // The toggle floats on top with zIndex — it should NOT take y-space. So
  // scroll content only clears the status bar, and the toggle visually
  // overlaps the empty area next to the first section header.
  const contentTopPadding = insets.top + 8;

  // Infinite scroll: trigger loadMore when the user gets within a page of
  // the bottom. Runs on every scroll event; the pagination hook guards
  // against duplicate fetches via its internal status state.
  const LOAD_MORE_THRESHOLD = 400;
  const handleScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      if (laterStatus !== 'CanLoadMore') return;
      const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
      const distanceFromBottom =
        contentSize.height - (contentOffset.y + layoutMeasurement.height);
      if (distanceFromBottom < LOAD_MORE_THRESHOLD) {
        loadMoreLater();
      }
    },
    [laterStatus, loadMoreLater]
  );

  // No community context → "My RSVPs" fallback body
  if (!hasCommunityContext) {
    const myEvents = myRsvpedEventsData?.events ?? [];
    return (
      <View style={[styles.container, { backgroundColor: colors.backgroundSecondary }]}>
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
            contentContainerStyle={[
              styles.myRsvpsContent,
              { paddingTop: contentTopPadding, paddingBottom: 120 },
            ]}
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
        {renderFloatingControls()}
      </View>
    );
  }

  // Community context → My Events → Next Up → This Week → Later.
  const { myEvents, nextUp, thisWeek } = data;
  const hasAnyContent =
    myEvents.length > 0 ||
    nextUp.length > 0 ||
    thisWeek.length > 0 ||
    laterCards.length > 0;

  return (
    <View style={[styles.container, { backgroundColor: colors.backgroundSecondary }]}>
      {viewMode === 'map' ? (
        <EventsMapView enabled={viewMode === 'map'} />
      ) : (
        <>
          {isLoading ? (
            <View style={styles.centerContainer}>
              <ActivityIndicator size="small" color={colors.textSecondary} />
            </View>
          ) : (
            <ScrollView
              style={styles.scrollView}
              contentContainerStyle={[
                styles.scrollContent,
                { paddingTop: contentTopPadding },
              ]}
              onScroll={handleScroll}
              scrollEventThrottle={200}
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

          <Greeting
            firstName={user?.first_name ?? null}
            colors={colors}
            primaryColor={primaryColor}
            onMakePlans={handleCreateEvent}
          />
          <HorizontalTileRow title="My Events" cards={myEvents} colors={colors} />
          <Section
            title="Next Up"
            cards={nextUp}
            onCommunityWideTap={handleCommunityWideTap}
            colors={colors}
          />
          <Section
            title="This Week"
            cards={thisWeek}
            onCommunityWideTap={handleCommunityWideTap}
            colors={colors}
          />
          <Section
            title="Later"
            cards={laterCards}
            onCommunityWideTap={handleCommunityWideTap}
            colors={colors}
          />
          {laterStatus === 'LoadingMore' && (
            <View style={styles.loadMoreIndicator}>
              <ActivityIndicator size="small" color={colors.textSecondary} />
            </View>
          )}
        </ScrollView>
      )}
        </>
      )}

      {/* Community-wide children sheet — renders when parentId is non-null */}
      <CommunityWideEventSheet
        parentId={expandedParentId}
        onDismiss={handleDismissSheet}
      />

      {renderFloatingControls()}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  toggleContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 100,
    borderWidth: 1,
    padding: 2,
    gap: 2,
  },
  toggleButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 100,
    gap: 4,
  },
  toggleText: {
    fontSize: 12,
    fontWeight: '600',
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
    paddingHorizontal: 16,
    paddingBottom: 120, // leaves room for the floating Create Event button
  },
  floatingToggle: {
    position: 'absolute',
    right: 16,
    zIndex: 20,
  },
  floatingCreateContainer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 20,
    pointerEvents: 'box-none',
  },
  floatingCreateButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderRadius: 100,
    gap: 6,
    ...Platform.select({
      web: {
        boxShadow: '0px 4px 16px rgba(0, 0, 0, 0.18)',
      },
      default: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.2,
        shadowRadius: 8,
        elevation: 6,
      },
    }),
  },
  floatingCreateText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
  section: {
    marginTop: 28, // breathing room between section groups (Next Up → This week → Later)
    marginBottom: 8,
  },
  sectionTitle: {
    fontSize: 19,
    fontWeight: '700',
    letterSpacing: -0.2,
    marginBottom: 12,
  },
  sectionBody: {
    gap: 8,
  },
  greeting: {
    paddingTop: 48,
    paddingBottom: 28,
    alignItems: 'center',
    gap: 4,
  },
  greetingTitle: {
    fontSize: 20,
    fontWeight: '700',
    lineHeight: 26,
    letterSpacing: -0.3,
    textAlign: 'center',
  },
  greetingSubtitle: {
    fontSize: 16,
    fontWeight: '400',
    lineHeight: 22,
    textAlign: 'center',
  },
  greetingAction: {
    fontSize: 16,
    fontWeight: '600',
    textDecorationLine: 'underline',
  },
  horizontalSection: {
    marginTop: 8,
    marginBottom: 8,
    gap: 12,
  },
  horizontalScrollContent: {
    flexDirection: 'row',
    gap: 12,
    paddingRight: 16,
  },
  loadMoreIndicator: {
    paddingVertical: 24,
    alignItems: 'center',
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
