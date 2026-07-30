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
import { useWhatsappShell } from '@hooks/useWhatsappShell';
import { AppImage } from '@components/ui';
import {
  WaRow,
  WaLargeTitle,
  WaSeparator,
  WaFloatingCta,
  WA_LIST_SEPARATOR_INSET,
  WA_GROUP_MARGIN,
  WA_GROUP_SPACING,
  WA_FLOATING_CTA_CONTENT_CLEARANCE,
  WA_TAB_ACTIVE_PILL_LIGHT,
  WA_TAB_ACTIVE_PILL_DARK,
  WA_TYPE_SECTION_HEADER,
  WA_TYPE_ROW_TITLE,
  WA_TYPE_SUBTITLE,
  WA_TYPE_FOOTNOTE,
  WA_WEIGHT_SEMIBOLD,
  waTabBarStripHeight,
} from '@components/wa';
import { formatWaEventWhen } from '../utils/waEventWhen';
import { useEventsByTimeWindow } from '../hooks/useEventsByTimeWindow';
import { useLaterEvents } from '../hooks/useLaterEvents';
import { useMyRsvpedEvents } from '../hooks/useCommunityEvents';
import { EventCardRow } from './EventCardRow';
import { EventRowCommunityWide } from './EventRowCommunityWide';
import { FeaturedEventTile } from './FeaturedEventTile';
import { CommunityWideEventSheet } from './CommunityWideEventSheet';
import { EventsMapView } from './EventsMapView';
import { WaEventThumbnail } from './WaEventThumbnail';
import type { CommunityEvent } from '../hooks/useCommunityEvents';
import type { Id } from '@services/api/convex';

type ViewMode = 'list' | 'map';

/**
 * Flag-on List/Map chip height — WhatsApp's filter-chip band (WA-VISUAL-DELTAS
 * D4: "34pt, fully rounded, gray fill, 15pt dark label"), matching the Chats
 * list's resource-chip strip. Kept local rather than imported from
 * `features/chat` so the two surfaces don't couple.
 */
const WA_VIEW_CHIP_HEIGHT = 34;

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

// --- WhatsApp-shell event rows (flag-gated) ---------------------------------
// WHATSAPP-DESIGN-SYSTEM.md §7 "Event cards inside chat" governs bubble-shaped
// events *inside a chat thread*; the Events tab itself is a full-bleed list
// surface, so its rows follow the plain §3.1/S6 WaRow anatomy instead — a 58pt
// rounded-square thumbnail, 17pt semibold title, 15pt gray "when · where"
// subtitle, right-aligned gray attendance text and a vertically centered
// chevron — same treatment for individual and community-wide (CWE) cards.
// Flag off renders the existing FeaturedEventTile/EventCardRow/
// EventRowCommunityWide components below, untouched.

/** Raw event/CWE card shape as returned by the Events tab queries — same
 * union `Section`/`HorizontalTileRow` above already destructure ad hoc. */
type EventTabCard = any;

interface WaEventRowProps {
  card: EventTabCard;
  colors: ReturnType<typeof useTheme>['colors'];
  accent: string;
  userTimezone: string;
  onCommunityWideTap: (parentId: Id<'communityWideEvents'>) => void;
}

function WaEventRow({
  card,
  colors,
  accent,
  userTimezone,
  onCommunityWideTap,
}: WaEventRowProps) {
  const router = useRouter();
  const isCommunityWide = card.kind === 'community_wide';

  const title = card.title || 'Untitled Event';
  const when = formatWaEventWhen(card.scheduledAt, userTimezone);

  const location = isCommunityWide
    ? card.groupCount === 1
      ? '1 location'
      : `${card.groupCount} locations`
    : card.locationOverride || card.group.name;
  const subtitle = `${when} · ${location}`;

  // Right column: the going count as plain right-aligned gray text (S3.5's
  // treatment for a row's secondary fact), never a colored chip (§7). Hidden
  // when the event opts out of showing counts — except for leaders, who keep
  // the total for managing attendance (matches EventCard) — or when nobody's
  // going yet.
  const goingCount: number = isCommunityWide
    ? card.totalGoing ?? 0
    : card.hideRsvpCount === true && card.viewerIsLeader !== true
      ? 0
      : card.rsvpSummary?.totalGoing ?? 0;

  const coverImage: string | null | undefined = isCommunityWide
    ? card.coverImage
    : card.coverImage || card.group?.image;

  const handlePress = () => {
    if (isCommunityWide) {
      onCommunityWideTap(card.parentId as Id<'communityWideEvents'>);
    } else if (card.shortId) {
      router.push(`/e/${card.shortId}?source=app`);
    }
  };

  return (
    <WaRow
      avatar={
        coverImage
          ? { imageUrl: coverImage, label: title, shape: 'squircle' }
          : <WaEventThumbnail />
      }
      title={title}
      subtitle={subtitle}
      accent={accent}
      onPress={handlePress}
      testID="wa-event-row"
      showChevron={goingCount === 0}
      rightAccessory={
        goingCount > 0 ? (
          <View style={styles.waRowTrailing}>
            <Text style={[styles.waRowTrailingText, { color: colors.textTertiary }]}>
              {goingCount} going
            </Text>
            <Ionicons name="chevron-forward" size={13} color={colors.textTertiary} />
          </View>
        ) : undefined
      }
    />
  );
}

/**
 * Landing-surface section header (S3.5 / per-screen §5.3): ~20pt sentence-case
 * gray semibold sitting directly on the page background — never the 12pt
 * ALL-CAPS iOS-15 label the pre-pass screen used. Same anatomy as the community
 * landing's "Groups you're in".
 */
function WaSectionHeader({ children }: { children: string }) {
  const { colors } = useTheme();
  return (
    <Text style={[styles.waSectionHeader, { color: colors.textSecondary }]}>{children}</Text>
  );
}

interface WaEventSectionProps {
  title: string;
  cards: EventTabCard[];
  colors: ReturnType<typeof useTheme>['colors'];
  accent: string;
  userTimezone: string;
  onCommunityWideTap: (parentId: Id<'communityWideEvents'>) => void;
}

function WaEventSection({
  title,
  cards,
  colors,
  accent,
  userTimezone,
  onCommunityWideTap,
}: WaEventSectionProps) {
  if (!cards || cards.length === 0) return null;
  return (
    <View style={styles.waSection}>
      <WaSectionHeader>{title}</WaSectionHeader>
      <View>
        {cards.map((card, index) => (
          <React.Fragment
            key={card.kind === 'community_wide' ? `cw-${String(card.parentId)}` : String(card.id)}
          >
            <WaEventRow
              card={card}
              colors={colors}
              accent={accent}
              userTimezone={userTimezone}
              onCommunityWideTap={onCommunityWideTap}
            />
            {index < cards.length - 1 ? <WaSeparator inset={WA_LIST_SEPARATOR_INSET} /> : null}
          </React.Fragment>
        ))}
      </View>
    </View>
  );
}

/**
 * WA-style empty state (S7 type scale): centered monochrome glyph, 17pt title,
 * 15pt gray subtitle. The flag-off variant keeps its 18/14pt pair.
 */
function WaEmptyState({
  title,
  subtitle,
  colors,
}: {
  title: string;
  subtitle: string;
  colors: ReturnType<typeof useTheme>['colors'];
}) {
  return (
    <View style={styles.centerContainer}>
      <Ionicons
        name="calendar-outline"
        size={64}
        color={colors.textTertiary}
        style={styles.waEmptyGlyph}
      />
      <Text style={[styles.waEmptyTitle, { color: colors.text }]}>{title}</Text>
      <Text style={[styles.waEmptySubtitle, { color: colors.textSecondary }]}>{subtitle}</Text>
    </View>
  );
}

interface GreetingProps {
  firstName: string | null;
  colors: ReturnType<typeof useTheme>['colors'];
  primaryColor: string;
  onMakePlans: () => void;
  /** Flag-on: the quiet left-aligned header block. Flag-off: the centered hero. */
  whatsappShell?: boolean;
}

function Greeting({
  firstName,
  colors,
  primaryColor,
  onMakePlans,
  whatsappShell = false,
}: GreetingProps) {
  const hello = firstName ? `Hey ${firstName}` : 'Hey there';

  // Flag-on: the greeting is a quiet header block under the large title —
  // left-aligned at the row inset, on the S7 scale (17 semibold / 15 gray),
  // with the accent spent only on the "Make plans" action link (S5.1) and no
  // underline (WA action text is plain colored text).
  if (whatsappShell) {
    return (
      <View style={styles.waGreeting}>
        <Text style={[styles.waGreetingTitle, { color: colors.text }]}>{hello}</Text>
        <Text style={[styles.waGreetingSubtitle, { color: colors.textSecondary }]}>
          Life is better in community.{' '}
          <Text
            style={[styles.waGreetingAction, { color: primaryColor }]}
            onPress={onMakePlans}
          >
            Make plans
          </Text>
        </Text>
      </View>
    );
  }

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
  const { colors, isDark } = useTheme();
  const { primaryColor } = useCommunityTheme();
  const hasCommunityContext = !!community?.id;
  const whatsappShellEnabled = useWhatsappShell();
  const userTimezone = user?.timezone || 'America/New_York';

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

  /**
   * Flag-on List/Map switch — WhatsApp's filter-chip anatomy (D4 "Resources
   * leave the list": 34pt fully-rounded chips, light gray fill, 15pt dark
   * label), the same strip the Chats list carries under its search pill. It
   * replaces the pre-pass pair of floating header circles: this is a *view
   * filter*, not a nav action, and the chips make the current view legible at
   * rest instead of hiding it in a glyph's fill variant. Selection is a step-
   * darker neutral pill (the tab bar's active-pill treatment) — never green
   * (S5.1: the Create Event pill is this screen's only accent).
   *
   * Rendered outside the list/map branch so the user can always switch back.
   */
  const renderWaViewChips = () => {
    if (!hasCommunityContext) return null;
    const chips: Array<{ mode: ViewMode; label: string; icon: 'list' | 'map' }> = [
      { mode: 'list', label: 'List', icon: 'list' },
      { mode: 'map', label: 'Map', icon: 'map' },
    ];
    return (
      <View style={styles.waChipsRow} testID="wa-events-view-chips">
        {chips.map((chip) => {
          const active = viewMode === chip.mode;
          return (
            <TouchableOpacity
              key={chip.mode}
              style={[
                styles.waChip,
                {
                  backgroundColor: active
                    ? isDark
                      ? WA_TAB_ACTIVE_PILL_DARK
                      : WA_TAB_ACTIVE_PILL_LIGHT
                    : colors.surfaceSecondary,
                },
              ]}
              onPress={() => setViewMode(chip.mode)}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              accessibilityLabel={`${chip.label} view`}
            >
              <Ionicons
                name={active ? chip.icon : (`${chip.icon}-outline` as const)}
                size={15}
                color={active ? colors.text : colors.textSecondary}
              />
              <Text
                style={[
                  styles.waChipLabel,
                  {
                    color: active ? colors.text : colors.textSecondary,
                    fontWeight: active ? WA_WEIGHT_SEMIBOLD : '500',
                  },
                ]}
              >
                {chip.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    );
  };

  // Floating controls — no static header. The List/Map toggle floats
  // over the top-left; the Create Event CTA floats over the bottom
  // center (above the tab bar). Content scrolls beneath them.
  //
  // Flag-on: the List/Map toggle becomes the neutral chip strip under the
  // large title (`renderWaViewChips`), so it's skipped here — and the CTA
  // becomes the shared `WaFloatingCta`, the kit's one floating-CTA geometry
  // (the owner asked for Events and Groups to stop drawing their own, and the
  // component's own clearance maths keeps it off the tab island).
  const renderFloatingControls = () => (
    <>
      {!whatsappShellEnabled && (
        <View
          style={[styles.floatingToggle, { top: insets.top + 12 }]}
          pointerEvents="box-none"
        >
          {renderViewToggle()}
        </View>
      )}
      {whatsappShellEnabled ? (
        <WaFloatingCta
          label="Create Event"
          icon="add"
          onPress={handleCreateEvent}
          accent={primaryColor}
          bottomInset={insets.bottom}
          testID="wa-events-create"
        />
      ) : (
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
      )}
    </>
  );

  // The toggle floats on top with zIndex — it should NOT take y-space. So
  // scroll content only clears the status bar, and the toggle visually
  // overlaps the empty area next to the first section header.
  const contentTopPadding = insets.top + 8;
  // Flag-on: the large title + chip strip render in flow above the list, so the
  // scroll content only needs a small gap below them — reusing
  // `contentTopPadding` here would double the header's own top inset.
  const mainContentTopPadding = whatsappShellEnabled ? 8 : contentTopPadding;

  // Flag-on the screen is a WhatsApp list surface: white (S6 full-bleed rows
  // with text-column-inset hairlines, exactly like the community landing),
  // not the grouped gray the card-based flag-off layout needs.
  const pageBackground = whatsappShellEnabled
    ? colors.surface
    : colors.backgroundSecondary;

  // Flag-on: reserve the strip below the floating island on the container that
  // carries the page background, so the home-indicator gap paints page gray
  // rather than showing whatever content scrolls past underneath.
  const waStripPadding = whatsappShellEnabled
    ? { paddingBottom: waTabBarStripHeight(insets.bottom) }
    : null;

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
      <View style={[styles.container, { backgroundColor: pageBackground }, waStripPadding]}>
        {whatsappShellEnabled && (
          <WaLargeTitle style={{ paddingTop: insets.top + 8 }}>Events</WaLargeTitle>
        )}
        {isLoadingMyRsvps ? (
          <View style={styles.centerContainer}>
            <ActivityIndicator size="small" color={colors.textSecondary} />
          </View>
        ) : myEvents.length === 0 ? (
          whatsappShellEnabled ? (
            <WaEmptyState
              title="No upcoming events"
              subtitle="Events you RSVP to will appear here"
              colors={colors}
            />
          ) : (
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
          )
        ) : whatsappShellEnabled ? (
          // Same S6 row anatomy as the community-context list — the pre-pass
          // fallback used shadowed cards with an accent date line and a tinted
          // RSVP chip, all three banned by §7/S5.1.
          <ScrollView
            style={styles.scrollView}
            contentContainerStyle={styles.waMyRsvpsContent}
          >
            {myEvents.map((event: any, index: number) => (
              <React.Fragment key={event.id}>
                <WaRow
                  avatar={{
                    imageUrl: event.coverImage || event.group.image,
                    label: event.title || event.group.name,
                    seed: String(event.id),
                    shape: 'squircle',
                  }}
                  title={event.title || event.group.name}
                  subtitle={[
                    formatWaEventWhen(event.scheduledAt, userTimezone),
                    event.group.name,
                    event.community?.name,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                  subtitleLines={2}
                  accent={primaryColor}
                  onPress={() => router.push(`/e/${event.shortId}?source=app`)}
                  showChevron={!event.rsvpStatus?.optionLabel}
                  rightAccessory={
                    event.rsvpStatus?.optionLabel ? (
                      <View style={styles.waRowTrailing}>
                        <Text
                          style={[styles.waRowTrailingText, { color: colors.textTertiary }]}
                          numberOfLines={1}
                        >
                          {event.rsvpStatus.optionLabel}
                        </Text>
                        <Ionicons
                          name="chevron-forward"
                          size={13}
                          color={colors.textTertiary}
                        />
                      </View>
                    ) : undefined
                  }
                />
                {index < myEvents.length - 1 ? (
                  <WaSeparator inset={WA_LIST_SEPARATOR_INSET} />
                ) : null}
              </React.Fragment>
            ))}
          </ScrollView>
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
    <View style={[styles.container, { backgroundColor: pageBackground }, waStripPadding]}>
      {whatsappShellEnabled && (
        // S1/S7 chrome, in flow (this screen doesn't scroll content under a
        // floating nav zone — see metrics.ts's note on the nav scrim): 34pt
        // heavy large title, then the neutral List/Map chip strip. The map view
        // itself is untouched below; only its entry point is restyled.
        <>
          <WaLargeTitle style={{ paddingTop: insets.top + 8 }}>Events</WaLargeTitle>
          {renderWaViewChips()}
        </>
      )}
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
                // Flag-on rows are full-bleed (WaRow supplies its own 16pt
                // leading inset), so the card-era horizontal padding has to go
                // or every hairline stops 16pt short of both edges.
                whatsappShellEnabled && styles.waScrollContent,
                { paddingTop: mainContentTopPadding },
              ]}
              onScroll={handleScroll}
              scrollEventThrottle={200}
            >
          {!hasAnyContent &&
            (whatsappShellEnabled ? (
              <WaEmptyState
                title="No upcoming events"
                subtitle="Check back later or create one yourself."
                colors={colors}
              />
            ) : (
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
            ))}

          <Greeting
            firstName={user?.first_name ?? null}
            colors={colors}
            primaryColor={primaryColor}
            onMakePlans={handleCreateEvent}
            whatsappShell={whatsappShellEnabled}
          />
          {whatsappShellEnabled ? (
            // Sentence-case section headers (S3.5): "My events", not
            // "MY EVENTS" and not Title Case either — WhatsApp's landing
            // headers read as a sentence.
            <>
              <WaEventSection
                title="My events"
                cards={myEvents}
                colors={colors}
                accent={primaryColor}
                userTimezone={userTimezone}
                onCommunityWideTap={handleCommunityWideTap}
              />
              <WaEventSection
                title="Next up"
                cards={nextUp}
                colors={colors}
                accent={primaryColor}
                userTimezone={userTimezone}
                onCommunityWideTap={handleCommunityWideTap}
              />
              <WaEventSection
                title="This week"
                cards={thisWeek}
                colors={colors}
                accent={primaryColor}
                userTimezone={userTimezone}
                onCommunityWideTap={handleCommunityWideTap}
              />
              <WaEventSection
                title="Later"
                cards={laterCards}
                colors={colors}
                accent={primaryColor}
                userTimezone={userTimezone}
                onCommunityWideTap={handleCommunityWideTap}
              />
            </>
          ) : (
            <>
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
            </>
          )}
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
  // --- WhatsApp-shell (flag-on) styles ------------------------------------
  waScrollContent: {
    paddingHorizontal: 0,
    // Clear the floating island AND the Create Event pill above it — the
    // flat 120 the flag-off layout uses leaves the last row under the pill.
    paddingBottom: WA_FLOATING_CTA_CONTENT_CLEARANCE,
  },
  // §3.2 "visibly more generous than the header-to-card gap" — the rhythm
  // between one section's last row and the next section's header.
  waSection: {
    marginTop: WA_GROUP_SPACING,
  },
  // S3.5 / §5.3 landing section header: ~20pt sentence-case gray semibold on
  // the page background, no card, no uppercase.
  waSectionHeader: {
    fontSize: WA_TYPE_SECTION_HEADER,
    fontWeight: WA_WEIGHT_SEMIBOLD,
    paddingHorizontal: WA_GROUP_MARGIN,
    paddingBottom: 6,
  },
  // Right-aligned gray secondary fact + vertically centered chevron (S3.3/S6).
  waRowTrailing: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  waRowTrailingText: {
    fontSize: WA_TYPE_FOOTNOTE,
  },
  // WA filter-chip strip (D4): 34pt fully-rounded, light gray fill, 15pt label.
  waChipsRow: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: WA_GROUP_MARGIN,
    paddingTop: 12,
  },
  waChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: WA_VIEW_CHIP_HEIGHT,
    borderRadius: WA_VIEW_CHIP_HEIGHT / 2,
    paddingHorizontal: 14,
  },
  waChipLabel: {
    fontSize: WA_TYPE_SUBTITLE,
  },
  waGreeting: {
    paddingHorizontal: WA_GROUP_MARGIN,
    paddingTop: 12,
    paddingBottom: 4,
    gap: 2,
  },
  waGreetingTitle: {
    fontSize: WA_TYPE_ROW_TITLE,
    fontWeight: WA_WEIGHT_SEMIBOLD,
  },
  waGreetingSubtitle: {
    fontSize: WA_TYPE_SUBTITLE,
    lineHeight: 20,
  },
  waGreetingAction: {
    fontSize: WA_TYPE_SUBTITLE,
    fontWeight: WA_WEIGHT_SEMIBOLD,
  },
  waEmptyGlyph: {
    marginBottom: 12,
  },
  waEmptyTitle: {
    fontSize: WA_TYPE_ROW_TITLE,
    fontWeight: WA_WEIGHT_SEMIBOLD,
    marginBottom: 6,
  },
  waEmptySubtitle: {
    fontSize: WA_TYPE_SUBTITLE,
    textAlign: 'center',
  },
  waMyRsvpsContent: {
    paddingTop: 8,
    // Clears the floating island AND the Create Event pill above it.
    paddingBottom: WA_FLOATING_CTA_CONTENT_CLEARANCE,
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
