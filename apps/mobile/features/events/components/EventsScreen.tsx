/**
 * EventsScreen
 *
 * The dedicated Events tab introduced in ADR-022. Redesigned in a Partiful
 * style:
 *   - No screen title — the tab bar already indicates the current tab.
 *   - Tight action row with List/Map toggle + "Create Event" CTA.
 *   - "Next Up" featured row: up to 2 large tiles merging `happeningNow` and
 *     `myRsvps` (community-wide parents excluded — no single time/place).
 *   - Dense row list below: "This week" + "Later" (the other two buckets
 *     were already promoted into the featured row).
 *
 * When the user has no community context, falls back to the "My RSVPs"
 * view (ported from the legacy ExploreScreen) so the tab still has content.
 */

import React, { useCallback, useMemo, useState } from 'react';
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

interface NextUpProps {
  events: CommunityEvent[];
  colors: ReturnType<typeof useTheme>['colors'];
}

interface NextUpPropsWithAction extends NextUpProps {
  onViewAll?: () => void;
}

function NextUpRow({ events, colors, onViewAll }: NextUpPropsWithAction) {
  if (events.length < 1) return null;
  return (
    <View style={styles.nextUpSection}>
      <View style={styles.nextUpHeader}>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>Next Up</Text>
        {onViewAll && (
          <TouchableOpacity
            onPress={onViewAll}
            activeOpacity={0.6}
            style={[styles.viewAllButton, { borderColor: colors.borderLight }]}
          >
            <Text style={[styles.viewAllText, { color: colors.textSecondary }]}>
              View all
            </Text>
          </TouchableOpacity>
        )}
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.nextUpScrollContent}
      >
        {events.map((ev) => (
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

  // Featured "Next Up" events: merge happeningNow + myRsvps, drop
  // community-wide cards (no single time/place to headline), and take the
  // first 2. Community data only — memo avoids re-computing on unrelated
  // renders.
  const featuredEvents: CommunityEvent[] = useMemo(() => {
    if (!hasCommunityContext) return [];
    const happeningNow = data?.happeningNow ?? [];
    const myRsvps = data?.myRsvps ?? [];
    const merged = [...happeningNow, ...myRsvps]
      .filter((card: any) => card.kind !== 'community_wide')
      .map((card: any) => toCommunityEvent(card));
    return merged.slice(0, 2);
  }, [hasCommunityContext, data?.happeningNow, data?.myRsvps]);

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

  // Community context → Next Up featured row + "This week" / "Later" lists.
  // happeningNow + myRsvps were consumed by the featured row; rendering them
  // again would duplicate. Leaving the backend shape untouched in case we
  // want per-bucket labeling later.
  const { thisWeek, later } = data;
  const hasAnyContent =
    featuredEvents.length > 0 || thisWeek.length > 0 || later.length > 0;

  // Flattened event list for the map view (map handles its own
  // filtering + de-dup + geocoding). Use the raw buckets so the map still
  // gets every card, not just the featured subset.
  const allCards = [
    ...data.happeningNow,
    ...data.myRsvps,
    ...data.thisWeek,
    ...data.later,
  ];

  return (
    <View style={[styles.container, { backgroundColor: colors.backgroundSecondary }]}>
      {/*
        The map renders as an ambient background in list mode and as the
        full-screen surface in map mode. Keeping a single instance avoids
        re-running geocoding when the user toggles.
      */}
      <View style={StyleSheet.absoluteFill} pointerEvents={viewMode === 'map' ? 'auto' : 'none'}>
        <EventsMapView cards={allCards} isLoading={isLoading} />
      </View>

      {viewMode === 'list' && (
        <>
          {/* Overlay that dims the map so list content stays readable. */}
          <View
            style={[
              StyleSheet.absoluteFill,
              { backgroundColor: colors.backgroundSecondary, opacity: 0.82 },
            ]}
            pointerEvents="none"
          />
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
          <NextUpRow
            events={featuredEvents}
            colors={colors}
            // TODO: wire to a full "Next Up" destination once that screen exists.
            // No-op for PR 1 — surfaces the pill button without routing.
            onViewAll={() => {}}
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
    // Push the greeting well below the floating List/Map toggle so it feels
    // centered in the upper region of the screen (Partiful-style breathing room).
    // `contentTopPadding` already clears the status bar; add another 88px here.
    paddingTop: 88,
    paddingBottom: 40,
    alignItems: 'center',
    gap: 8,
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
  nextUpSection: {
    marginTop: 8,
    marginBottom: 8,
    gap: 12,
  },
  nextUpHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  viewAllButton: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 100,
    borderWidth: 1,
  },
  viewAllText: {
    fontSize: 13,
    fontWeight: '500',
  },
  nextUpScrollContent: {
    flexDirection: 'row',
    gap: 12,
    paddingRight: 16,
  },
  nextUpScrollContentCentered: {
    // When only 1 featured tile is present, center it horizontally so it
    // doesn't look stranded next to empty space.
    justifyContent: 'center',
    flexGrow: 1,
    paddingRight: 0,
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
