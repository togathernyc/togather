/**
 * WaGroupsScreen — the flag-on (`whatsapp-shell`) Groups tab.
 *
 * The owner asked for the Groups tab to be redesigned into the WhatsApp design
 * system after the Events tab (2026-07-29). Flag-off, this tab is a
 * map-first explore surface: a full-bleed Mapbox map with a `@gorhom`
 * bottom sheet of shadowed `GroupCard`s over it, a green floating filter
 * circle, a green floating "+" circle, and a group-type filter modal whose
 * options carry per-type color dots. Every one of those is on
 * WA-VISUAL-DELTAS.md's S5.2 kill list (green circle glyphs, colored type
 * chips, cards-with-shadows).
 *
 * Flag-on this becomes the **directory surface** the delta list describes:
 *
 *   - S1 floating chrome: neutral white List/Map circles, "Groups" large
 *     title, 44pt fully-rounded search pill (S6.5) — same anatomy the Events
 *     tab landed, so the two divergence tabs read as one system.
 *   - D4 filter chips: a horizontal strip of 34pt fully-rounded chips under
 *     the pill (gray fill, 15pt dark label) — group types plus the two
 *     meeting-type filters, replacing the modal. The selected chip takes the
 *     pale accent tint with accent ink, exactly as WhatsApp's own selected
 *     "All" chip does; never an accent-FILLED chip, never a per-type hue.
 *   - S6 rows: 58pt avatars with the muted per-entity pastel fallback,
 *     17pt/15pt type, centered chevrons, hairlines inset to the title —
 *     full-bleed on white, no card edges.
 *   - §5.3 sections: ~20pt sentence-case gray headers ("Groups you're in" /
 *     "Groups you can join"), the community-landing pattern.
 *   - S5.1 one green thing: the bottom floating "Add group" pill — the shared
 *     `WaFloatingCta`, so it is geometrically identical to the Events tab's
 *     "Create Event" and clears the floating tab island by construction.
 *   - S5.2 "find groups near me": a neutral compass circle beside the search
 *     pill, plus zip search in the pill itself. An active origin sorts BOTH
 *     membership sections nearest-first and labels every geocoded row with its
 *     distance. See `handlePressNearby` and the `nearby` memo.
 *
 * The map is not dropped — it moves behind the Map circle in the header
 * (the Events tab's List/Map pattern), where it still renders the existing
 * `ExploreMap` + `FloatingGroupCard` preview untouched.
 *
 * Presentational + local view state only: every query, filter and geocoding
 * decision stays in `GroupsScreen`, which owns the data and renders this on
 * the flag-on path. The one exception is device location, which is view state
 * rather than community data — see the `useUserLocation` call below for why it
 * cannot live in the container.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  Pressable,
  ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useTheme } from '@hooks/useTheme';
import { useCommunityTheme } from '@hooks/useCommunityTheme';
import { waAccentPalette } from '@utils/waPalette';
import type { Group } from '@features/groups/types';
import {
  WaScreenHeader,
  WaRow,
  WaSeparator,
  WaFloatingCta,
  WaFloatingButton,
  WA_HEADER_CIRCLE_SIZE,
  WA_TYPE_FOOTNOTE,
  WA_LIST_SEPARATOR_INSET,
  WA_SEARCH_PILL_HEIGHT,
  WA_SEARCH_PILL_ICON_SIZE,
  WA_SEARCH_PILL_MARGIN,
  WA_SEARCH_PILL_TOP_GAP,
  WA_GROUP_MARGIN,
  WA_TYPE_ROW_TITLE,
  WA_TYPE_SUBTITLE,
  WA_TYPE_SECTION_HEADER,
  WA_WEIGHT_SEMIBOLD,
  WA_FLOATING_CTA_CONTENT_CLEARANCE,
  waTabBarStripHeight,
} from '@components/wa';
import { useUserLocation } from '@features/location/hooks/useUserLocation';
import { useConvexFeatureFlag } from '@hooks/useConvexFeatureFlag';
import { ExploreMap, MapBounds } from './ExploreMap';
import { FloatingGroupCard } from './FloatingGroupCard';
import type { FilterState, GroupTypeOption } from './FilterModal';
import {
  formatMiles,
  isZipQuery,
  sortByDistance,
  type LatLng,
} from '../utils/nearbyGroups';

/** D4: "34pt, fully rounded, gray fill, 15pt dark label" — WhatsApp's own
 *  All/Unread/Favorites/Groups chip row measures 32-34pt. */
const CHIP_HEIGHT = 34;
/** Centered empty-state glyph, same size the flag-on Chats list uses. */
const EMPTY_GLYPH_SIZE = 48;

/** Meeting-type filter values, mirroring the groups schema (1 = in-person, 2 = online). */
const MEETING_TYPE_IN_PERSON = 1;
const MEETING_TYPE_ONLINE = 2;

/**
 * The explore mapping in `GroupsScreen` (`allGroups`) attaches a few fields
 * on top of the shared `Group` shape that the shared type doesn't declare
 * (it's consumed by many other surfaces). Declared locally rather than
 * widening `features/groups/types.ts` for one screen.
 */
export type ExploreGroup = Group & {
  member_count?: number | null;
  is_member?: boolean | null;
  is_on_break?: boolean | null;
};

function groupDisplayName(group: ExploreGroup): string {
  return group.title || group.name || 'Untitled Group';
}

function groupKey(group: ExploreGroup): string {
  return String(group._id ?? group.id ?? groupDisplayName(group));
}

/** S6.1 subtitle: one 15pt gray line of facts — "Small Group · 12 members". */
function groupSubtitle(group: ExploreGroup): string | undefined {
  const parts: string[] = [];
  if (group.group_type_name) parts.push(group.group_type_name);
  const count = group.member_count ?? group.members_count ?? 0;
  if (count > 0) parts.push(`${count} ${count === 1 ? 'member' : 'members'}`);
  if (group.is_on_break) parts.push('On break');
  return parts.length > 0 ? parts.join(' · ') : undefined;
}

/** Same name/location predicate the flag-off bottom sheet applies. */
function matchesQuery(group: ExploreGroup, query: string): boolean {
  const name = groupDisplayName(group).toLowerCase();
  const location = (group.location || group.city || '').toLowerCase();
  return name.includes(query) || location.includes(query);
}

interface WaGroupsSearchPillProps {
  value: string;
  onChange: (value: string) => void;
  /** Compass affordance rendered to the right of the pill. */
  nearbyActive: boolean;
  onPressNearby: () => void;
  /**
   * Whether the device-location compass renders at all. Gated on the
   * `nearby-device-location` Convex flag: the iOS permission string shipped
   * in config but is inert until a NATIVE build carries it, and prompting
   * from a binary without it mis-behaves. Zip search (typed into this pill)
   * works regardless, so the placeholder advertises it while the compass is
   * hidden.
   */
  showCompass: boolean;
}

/**
 * S6.5: 44pt fully-rounded pill. A live filter input rather than the kit
 * header's nav-to-search pill, so it goes in via `searchSlot` — the wrapper
 * reproduces `WaScreenHeader`'s own pill margins so the two are
 * interchangeable.
 *
 * The compass circle beside it is "find groups near me" (owner request,
 * 2026-07-29). It is a plain `WaFloatingButton` — a neutral white circle with
 * a dark glyph — because the accent budget for this screen is spent on the
 * "Add group" pill (S5.1). Active state reads from the filled glyph, never a
 * green fill, exactly like the List/Map circles above it.
 */
function WaGroupsSearchPill({
  value,
  onChange,
  nearbyActive,
  onPressNearby,
  showCompass,
}: WaGroupsSearchPillProps) {
  const { colors } = useTheme();
  return (
    <View style={styles.searchWrap}>
      <View style={[styles.searchPill, { backgroundColor: colors.backgroundGrouped }]}>
        <Ionicons
          name="search"
          size={WA_SEARCH_PILL_ICON_SIZE}
          color={colors.textTertiary}
          style={styles.searchIcon}
        />
        <TextInput
          style={[styles.searchInput, { color: colors.text }]}
          placeholder={showCompass ? 'Search groups' : 'Search groups or zip code'}
          placeholderTextColor={colors.textTertiary}
          value={value}
          onChangeText={onChange}
          returnKeyType="search"
          autoCorrect={false}
          autoCapitalize="none"
          testID="wa-groups-search"
        />
        {value.length > 0 ? (
          <Pressable
            onPress={() => onChange('')}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Clear search"
          >
            <Ionicons name="close-circle" size={16} color={colors.textTertiary} />
          </Pressable>
        ) : null}
      </View>
      {showCompass ? (
        <WaFloatingButton
          icon={nearbyActive ? 'compass' : 'compass-outline'}
          onPress={onPressNearby}
          size={WA_HEADER_CIRCLE_SIZE}
          accessibilityLabel="Find groups near me"
        />
      ) : null}
    </View>
  );
}

interface FilterChipSpec {
  key: string;
  label: string;
  icon?: keyof typeof Ionicons.glyphMap;
  selected: boolean;
  onPress: () => void;
}

interface WaFilterChipsProps {
  chips: FilterChipSpec[];
  /** Pale accent tint for the selected chip (§1.6's bubble tint — WA's own selected-chip pale green). */
  selectedFill: string;
  /** Accent ink on the selected chip; never white-on-accent (that's a filled chip, banned by §7). */
  selectedInk: string;
}

function WaFilterChips({ chips, selectedFill, selectedInk }: WaFilterChipsProps) {
  const { colors } = useTheme();
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      style={styles.chipsRow}
      contentContainerStyle={styles.chipsRowContent}
      testID="wa-group-filter-chips"
    >
      {chips.map((chip) => (
        <Pressable
          key={chip.key}
          onPress={chip.onPress}
          accessibilityRole="button"
          accessibilityState={{ selected: chip.selected }}
          accessibilityLabel={chip.label}
          testID={`wa-group-chip-${chip.key}`}
          style={({ pressed }) => [
            styles.chip,
            { backgroundColor: chip.selected ? selectedFill : colors.surfaceSecondary },
            pressed && styles.chipPressed,
          ]}
        >
          {chip.icon ? (
            <Ionicons
              name={chip.icon}
              size={15}
              color={chip.selected ? selectedInk : colors.textSecondary}
            />
          ) : null}
          <Text
            style={[styles.chipLabel, { color: chip.selected ? selectedInk : colors.text }]}
            numberOfLines={1}
          >
            {chip.label}
          </Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}

interface WaGroupSectionProps {
  title: string;
  groups: ExploreGroup[];
  onPressGroup: (group: ExploreGroup) => void;
  /** Distance in miles per `groupKey`, appended to the subtitle when known. */
  distances?: Map<string, number>;
}

/**
 * §5.3 section: a ~20pt sentence-case gray header over full-bleed WA rows.
 * Deliberately not `WaSectionLabel` (15pt) — the landing-surface header is a
 * size up, matching the community landing's `LandingSectionHeader`.
 */
function WaGroupSection({ title, groups, onPressGroup, distances }: WaGroupSectionProps) {
  const { colors } = useTheme();
  if (groups.length === 0) return null;
  return (
    <View style={styles.section}>
      <Text style={[styles.sectionHeader, { color: colors.textSecondary }]}>{title}</Text>
      {groups.map((group, index) => {
        const name = groupDisplayName(group);
        const miles = distances?.get(groupKey(group));
        const subtitle = [groupSubtitle(group), miles == null ? null : formatMiles(miles)]
          .filter(Boolean)
          .join(' · ');
        return (
          <React.Fragment key={groupKey(group)}>
            <WaRow
              avatar={{
                imageUrl: group.preview ?? group.image_url,
                label: name,
                seed: groupKey(group),
              }}
              title={name}
              subtitle={subtitle || undefined}
              showChevron
              onPress={() => onPressGroup(group)}
              testID={`wa-group-row-${groupKey(group)}`}
            />
            {index < groups.length - 1 ? (
              <WaSeparator inset={WA_LIST_SEPARATOR_INSET} />
            ) : null}
          </React.Fragment>
        );
      })}
    </View>
  );
}

interface WaEmptyStateProps {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  subtitle: string;
}

function WaEmptyState({ icon, title, subtitle }: WaEmptyStateProps) {
  const { colors } = useTheme();
  return (
    <View style={styles.empty} testID="wa-groups-empty">
      <Ionicons name={icon} size={EMPTY_GLYPH_SIZE} color={colors.iconSecondary} />
      <Text style={[styles.emptyTitle, { color: colors.text }]}>{title}</Text>
      <Text style={[styles.emptySubtitle, { color: colors.textSecondary }]}>{subtitle}</Text>
    </View>
  );
}

export interface WaGroupsScreenProps {
  /** False → the "join a community" empty state (no list, no chips, no CTA). */
  hasCommunityContext: boolean;
  isLoading: boolean;
  /** All groups matching the active filters — the directory list is not bounds-limited. */
  groups: ExploreGroup[];
  /** Geocoded subset, for the map view's markers. */
  groupsWithLocation: ExploreGroup[];
  selectedGroup: ExploreGroup | null;
  onGroupSelect: (group: ExploreGroup | null) => void;
  onBoundsChange: (bounds: MapBounds, groupsInView: Group[]) => void;
  mapboxToken: string;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  groupTypes: GroupTypeOption[];
  filters: FilterState;
  onFilterChange: (filters: FilterState) => void;
  onAddGroup: () => void;
}

export function WaGroupsScreen({
  hasCommunityContext,
  isLoading,
  groups,
  groupsWithLocation,
  selectedGroup,
  onGroupSelect,
  onBoundsChange,
  mapboxToken,
  searchQuery,
  onSearchChange,
  groupTypes,
  filters,
  onFilterChange,
  onAddGroup,
}: WaGroupsScreenProps) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colors, isDark } = useTheme();
  const { primaryColor } = useCommunityTheme();
  // §1.2 dark-mode accent shift — never reuse the light-mode brand hex
  // verbatim in dark mode (same pattern as CommunityPageScreen/MessageItem).
  const accent = useMemo(() => waAccentPalette(primaryColor, isDark), [primaryColor, isDark]);
  const [viewMode, setViewMode] = useState<'list' | 'map'>('list');

  // "Find groups near me" (owner request, 2026-07-29). Device location is view
  // state, not community data, so unlike the queries/filters/geocoding it lives
  // here rather than in `GroupsScreen` — putting it in the container would run
  // the location hook on the flag-OFF path too. `useUserLocation` is the app's
  // existing wrapper (permission prompt, 30-min AsyncStorage cache, and a
  // zip→coords lookup off the offline `us-zips` table).
  const {
    coordinates,
    error: locationError,
    isLoading: isLocating,
    requestDeviceLocation,
    setLocationFromZip,
  } = useUserLocation();
  const [nearbyRequested, setNearbyRequested] = useState(false);
  // Owner directive (2026-07-30): the device-location compass stays hidden
  // until the native build carrying the iOS permission string is live —
  // flipped via /admin/features once it ships. Fails closed while loading.
  const { enabled: deviceLocationEnabled } = useConvexFeatureFlag(
    'nearby-device-location'
  );

  // A bare 5-digit zip in the search field means "groups near this zip", not
  // "groups whose name contains 12345" — it is the always-available alternative
  // when location permission is denied (or on a device that has none).
  const zipQuery = isZipQuery(searchQuery) ? searchQuery.trim() : null;
  useEffect(() => {
    if (zipQuery) setLocationFromZip(zipQuery);
  }, [zipQuery, setLocationFromZip]);

  const handlePressNearby = useCallback(() => {
    if (nearbyRequested) {
      setNearbyRequested(false);
      return;
    }
    setNearbyRequested(true);
    void requestDeviceLocation();
  }, [nearbyRequested, requestDeviceLocation]);

  // Gate on the CURRENT lookup having succeeded: `useUserLocation` clears
  // `error` at the start of every attempt and on success, so a set error means
  // the latest zip/device request failed — in which case `coordinates` is a
  // stale value (30-min cache or an earlier zip) that must not silently
  // become the sort origin while we're showing a failure hint.
  const origin: LatLng | null =
    (nearbyRequested || zipQuery) && !locationError ? coordinates : null;

  const searchedGroups = useMemo(() => {
    if (zipQuery) return groups;
    const query = searchQuery.trim().toLowerCase();
    if (!query) return groups;
    return groups.filter((group) => matchesQuery(group, query));
  }, [groups, searchQuery, zipQuery]);

  // The container geocodes addresses/zips and hands back the placeable subset
  // with flat lat/lng attached; anything missing from it simply has no address
  // on file. Keyed the same way the rows are, so ordering and labelling agree.
  const coordsByKey = useMemo(() => {
    const map = new Map<string, LatLng>();
    groupsWithLocation.forEach((group) => {
      const { latitude, longitude } = group as ExploreGroup & {
        latitude?: number;
        longitude?: number;
      };
      if (typeof latitude === 'number' && typeof longitude === 'number') {
        map.set(groupKey(group), { latitude, longitude });
      }
    });
    return map;
  }, [groupsWithLocation]);

  const { memberGroups, joinableGroups } = useMemo(() => {
    const mine: ExploreGroup[] = [];
    const joinable: ExploreGroup[] = [];
    searchedGroups.forEach((group) => {
      if (group.is_member) mine.push(group);
      else joinable.push(group);
    });
    return { memberGroups: mine, joinableGroups: joinable };
  }, [searchedGroups]);

  /**
   * Owner directive (2026-07-30): "when typing in a zipcode it does not update
   * the list sorted by distance and display the distance on the group card, it
   * should."
   *
   * An active origin now sorts BOTH sections nearest-first and labels every
   * geocoded row with its distance — not just the joinable half. The owner is a
   * member of nearly every group in their community, so re-sectioning only the
   * discovery list made zip search look like a no-op. The membership sections
   * stay ("Groups you're in" / "Groups you can join"): they are the mental model
   * of the screen, and "the list sorted by distance" is a sort, not a regrouping,
   * so the old "Near you" / "More groups" split is gone.
   *
   * Rows without coordinates are never dropped — they trail the located ones
   * inside their own section and simply carry no distance.
   */
  const nearby = useMemo(() => {
    if (!origin) return null;
    const coordsOf = (group: ExploreGroup) => coordsByKey.get(groupKey(group)) ?? null;
    const rankedMembers = sortByDistance(memberGroups, coordsOf, origin);
    const rankedJoinable = sortByDistance(joinableGroups, coordsOf, origin);
    const distances = new Map<string, number>();
    [...rankedMembers, ...rankedJoinable].forEach((entry) => {
      if (entry.miles !== null) distances.set(groupKey(entry.item), entry.miles);
    });
    return {
      memberGroups: rankedMembers.map((entry) => entry.item),
      joinableGroups: rankedJoinable.map((entry) => entry.item),
      distances,
    };
  }, [origin, memberGroups, joinableGroups, coordsByKey]);

  // One quiet gray line, never an alert: the denial path has to point at the
  // zip alternative, and "nothing is geocoded" has to say so rather than leave
  // the user staring at an unchanged list.
  let nearbyHint: string | null = null;
  if (nearbyRequested && locationError) {
    nearbyHint = locationError;
  } else if (nearbyRequested && !coordinates && isLocating) {
    nearbyHint = 'Finding your location…';
  } else if (zipQuery && !coordinates) {
    nearbyHint = `We don't know the zip code ${zipQuery}. Try another one.`;
  } else if (nearby && nearby.distances.size === 0 && searchedGroups.length > 0) {
    nearbyHint = 'None of these groups have an address yet, so we can’t sort by distance.';
  }

  const selectGroupType = useCallback(
    (groupType: string | number | null) => {
      onFilterChange({ ...filters, groupType });
    },
    [filters, onFilterChange]
  );

  const toggleMeetingType = useCallback(
    (meetingType: number) => {
      onFilterChange({
        ...filters,
        meetingType: filters.meetingType === meetingType ? null : meetingType,
      });
    },
    [filters, onFilterChange]
  );

  // D4 chip strip: "All" + one chip per group type (the filter modal's whole
  // group-type section, inline and de-colored), then the two meeting-type
  // chips it also carried. WhatsApp's own row mixes semantics the same way
  // (All / Unread / Favorites / Groups); the glyphs keep the two families
  // legible.
  const chips = useMemo<FilterChipSpec[]>(() => {
    const specs: FilterChipSpec[] = [
      {
        key: 'all',
        label: 'All',
        selected: filters.groupType === null,
        onPress: () => selectGroupType(null),
      },
    ];
    groupTypes.forEach((groupType) => {
      specs.push({
        key: String(groupType.id),
        label: groupType.name,
        selected: filters.groupType === groupType.id,
        onPress: () => selectGroupType(groupType.id),
      });
    });
    specs.push({
      key: 'in-person',
      label: 'In-Person',
      icon: 'location-outline',
      selected: filters.meetingType === MEETING_TYPE_IN_PERSON,
      onPress: () => toggleMeetingType(MEETING_TYPE_IN_PERSON),
    });
    specs.push({
      key: 'online',
      label: 'Online',
      icon: 'videocam-outline',
      selected: filters.meetingType === MEETING_TYPE_ONLINE,
      onPress: () => toggleMeetingType(MEETING_TYPE_ONLINE),
    });
    return specs;
  }, [filters.groupType, filters.meetingType, groupTypes, selectGroupType, toggleMeetingType]);

  // A directory row goes straight to the group (the flag-off list's preview
  // card offered exactly one action — "View Group" — to the same route). The
  // preview card itself is still reachable from the map's markers below.
  const openGroup = useCallback(
    (group: ExploreGroup) => {
      router.push(`/groups/${group._id ?? group.id}`);
    },
    [router]
  );

  const selectedGroupId = selectedGroup?.id
    ? typeof selectedGroup.id === 'number'
      ? selectedGroup.id
      : parseInt(String(selectedGroup.id), 10)
    : null;

  const header = (
    <WaScreenHeader
      title="Groups"
      accent={accent.accent}
      // S1.1/S5.1: both circles are neutral white with black line glyphs —
      // the active view reads from its glyph switching to the filled variant,
      // never from a green fill (the Events tab does the same).
      trailingButtons={[
        {
          icon: viewMode === 'list' ? 'list' : 'list-outline',
          onPress: () => setViewMode('list'),
          accessibilityLabel: 'List view',
          selected: viewMode === 'list',
        },
        {
          icon: viewMode === 'map' ? 'map' : 'map-outline',
          onPress: () => setViewMode('map'),
          accessibilityLabel: 'Map view',
          selected: viewMode === 'map',
        },
      ]}
      searchSlot={
        hasCommunityContext && viewMode === 'list' ? (
          <WaGroupsSearchPill
            value={searchQuery}
            onChange={onSearchChange}
            nearbyActive={Boolean(origin)}
            onPressNearby={handlePressNearby}
            showCompass={deviceLocationEnabled}
          />
        ) : (
          <View />
        )
      }
      style={{ paddingTop: insets.top }}
    />
  );

  // Flag-on the tab bar is a floating island (S2), so its whole BAND is
  // reserved on the container that paints the page background — otherwise
  // list rows show beside the island (in its 20pt side margins) and under it.
  const containerStyle = [
    styles.container,
    { backgroundColor: colors.surface, paddingBottom: waTabBarStripHeight(insets.bottom) },
  ];

  if (!hasCommunityContext) {
    return (
      <View style={containerStyle}>
        {header}
        <WaEmptyState
          icon="people-outline"
          title="Join a community to see groups"
          subtitle="Groups are organized within communities"
        />
      </View>
    );
  }

  if (viewMode === 'map') {
    return (
      <View style={containerStyle}>
        {header}
        <View style={styles.mapArea}>
          <ExploreMap
            groups={groupsWithLocation}
            selectedGroupId={selectedGroupId}
            onGroupSelect={onGroupSelect}
            onBoundsChange={onBoundsChange}
            mapboxToken={mapboxToken}
          />
          {selectedGroup ? (
            <FloatingGroupCard group={selectedGroup} onClose={() => onGroupSelect(null)} />
          ) : null}
        </View>
      </View>
    );
  }

  const hasResults = searchedGroups.length > 0;

  return (
    <View style={containerStyle}>
      {header}
      <WaFilterChips
        chips={chips}
        selectedFill={accent.bubbleOutgoing}
        selectedInk={accent.accent}
      />
      {nearbyHint ? (
        <Text
          style={[styles.nearbyHint, { color: colors.textSecondary }]}
          testID="wa-groups-nearby-hint"
        >
          {nearbyHint}
        </Text>
      ) : null}
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {isLoading && !hasResults ? (
          <View style={styles.loading}>
            <ActivityIndicator size="small" color={colors.textSecondary} />
          </View>
        ) : !hasResults ? (
          <WaEmptyState
            icon="people-outline"
            title={searchQuery.trim() ? 'No groups found' : 'No groups yet'}
            subtitle={
              searchQuery.trim()
                ? 'Try a different name or clear the filters above.'
                : 'Add the first one and invite people to join.'
            }
          />
        ) : (
          <>
            <WaGroupSection
              title="Groups you're in"
              groups={nearby?.memberGroups ?? memberGroups}
              distances={nearby?.distances}
              onPressGroup={openGroup}
            />
            <WaGroupSection
              title="Groups you can join"
              groups={nearby?.joinableGroups ?? joinableGroups}
              distances={nearby?.distances}
              onPressGroup={openGroup}
            />
          </>
        )}
      </ScrollView>

      {/* S5.1: the screen's single green element — the shared kit geometry, so
          it reads identically to the Events tab's "Create Event" pill. */}
      <WaFloatingCta
        label="Add group"
        icon="add"
        onPress={onAddGroup}
        accent={accent.accent}
        bottomInset={insets.bottom}
        testID="wa-groups-add"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: WA_SEARCH_PILL_MARGIN,
    marginTop: WA_SEARCH_PILL_TOP_GAP,
  },
  searchPill: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    height: WA_SEARCH_PILL_HEIGHT,
    borderRadius: WA_SEARCH_PILL_HEIGHT / 2,
    paddingHorizontal: 14,
  },
  nearbyHint: {
    fontSize: WA_TYPE_FOOTNOTE,
    paddingHorizontal: WA_GROUP_MARGIN,
    paddingTop: 10,
  },
  searchIcon: {
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: WA_TYPE_ROW_TITLE,
    padding: 0,
  },
  chipsRow: {
    height: CHIP_HEIGHT,
    marginTop: 12,
    flexGrow: 0,
  },
  chipsRowContent: {
    paddingHorizontal: WA_GROUP_MARGIN,
    gap: 8,
    alignItems: 'center',
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: CHIP_HEIGHT,
    borderRadius: CHIP_HEIGHT / 2,
    paddingHorizontal: 14,
  },
  chipPressed: {
    opacity: 0.6,
  },
  chipLabel: {
    fontSize: WA_TYPE_SUBTITLE,
    fontWeight: '500',
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingTop: 8,
    // Clear the CTA pill floating above the island band (the band itself is
    // reserved by the container).
    paddingBottom: WA_FLOATING_CTA_CONTENT_CLEARANCE,
  },
  section: {
    marginTop: 12,
  },
  sectionHeader: {
    fontSize: WA_TYPE_SECTION_HEADER,
    fontWeight: WA_WEIGHT_SEMIBOLD,
    paddingHorizontal: WA_GROUP_MARGIN,
    paddingBottom: 6,
  },
  mapArea: {
    flex: 1,
    marginTop: 8,
  },
  loading: {
    paddingTop: 48,
    alignItems: 'center',
  },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 64,
    paddingHorizontal: 40,
  },
  emptyTitle: {
    fontSize: WA_TYPE_ROW_TITLE,
    fontWeight: WA_WEIGHT_SEMIBOLD,
    marginTop: 16,
    textAlign: 'center',
  },
  emptySubtitle: {
    fontSize: WA_TYPE_SUBTITLE,
    marginTop: 6,
    textAlign: 'center',
  },
});
