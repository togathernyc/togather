# Unified Events Page Refactoring

> Implementation plan for refactoring events from group-specific pages to a unified Explore tab view.

## Background

**Current State:**
- Events accessed at `/leader-tools/[group_id]/events` (group-specific)
- Explore tab shows groups on a map with bottom sheet
- No way to see all community events in one place

**Target State:**
- Explore tab has toggle: Groups | Events
- Events view shows all accessible events in the community
- URL params enable prefiltered links (e.g., from group chat → events for that group)
- Create event page works independently of group context

---

## Phase 1: Backend Endpoints

### 1.1 Community Events Endpoint

**File:** `apps/api-trpc/src/routers/groups/meetings.ts`

Add `communityEvents` procedure:

```typescript
communityEvents: protectedProcedure
  .input(z.object({
    datePreset: z.enum(['today', 'this_week', 'this_month', 'custom']).optional(),
    startDate: z.string().optional(),  // ISO date for custom range
    endDate: z.string().optional(),    // ISO date for custom range
    hostingGroupIds: z.array(z.string()).optional(),  // Filter by groups
    limit: z.number().optional().default(50),
    cursor: z.string().optional(),
    includePast: z.boolean().optional().default(false),
  }))
  .query(async ({ input, ctx }) => {
    const userId = ctx.user.id;
    const communityId = BigInt(ctx.user.communityId);

    // Get groups user is member of (for group-visibility events)
    const userGroupIds = await getUserGroupIds(userId, communityId, ctx.db);

    // Build visibility filter (CRITICAL - backend-only security)
    const visibilityFilter = {
      OR: [
        { visibility: 'public' },
        { visibility: 'community' },  // User is already verified as community member
        { visibility: 'group', group_id: { in: userGroupIds } },
      ],
    };

    // Build date filter
    const dateFilter = buildDateFilter(input.datePreset, input.startDate, input.endDate);

    // Build hosting group filter
    const groupFilter = input.hostingGroupIds?.length
      ? { group_id: { in: input.hostingGroupIds } }
      : {};

    // Query meetings
    const meetings = await ctx.db.meeting.findMany({
      where: {
        AND: [
          visibilityFilter,
          dateFilter,
          groupFilter,
          { status: { not: 'cancelled' } },
          { group: { community_id: communityId } },
        ],
      },
      include: {
        group: { include: { group_type: true } },
        meeting_rsvp: { where: { response: 'yes' }, take: 5 },
      },
      orderBy: { scheduled_at: 'asc' },
      take: input.limit + 1,  // For cursor pagination
      cursor: input.cursor ? { id: input.cursor } : undefined,
    });

    // Format response
    return {
      events: meetings.slice(0, input.limit).map(formatEventForList),
      nextCursor: meetings.length > input.limit ? meetings[input.limit].id : null,
    };
  })
```

**Helper function for date filtering:**

```typescript
function buildDateFilter(preset?: string, startDate?: string, endDate?: string) {
  const now = new Date();
  const startOfDay = new Date(now.setHours(0, 0, 0, 0));

  switch (preset) {
    case 'today':
      return {
        scheduled_at: {
          gte: startOfDay,
          lt: new Date(startOfDay.getTime() + 24 * 60 * 60 * 1000),
        },
      };
    case 'this_week':
      const endOfWeek = new Date(startOfDay);
      endOfWeek.setDate(endOfWeek.getDate() + (7 - endOfWeek.getDay()));
      return { scheduled_at: { gte: startOfDay, lt: endOfWeek } };
    case 'this_month':
      const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      return { scheduled_at: { gte: startOfDay, lte: endOfMonth } };
    case 'custom':
      return {
        scheduled_at: {
          gte: startDate ? new Date(startDate) : undefined,
          lte: endDate ? new Date(endDate) : undefined,
        },
      };
    default:
      return { scheduled_at: { gte: startOfDay } };  // Default: future events
  }
}
```

### 1.2 My Leader Groups Endpoint

**File:** `apps/api-trpc/src/routers/groups/core.ts`

Add `myLeaderGroups` procedure (for create event dropdown):

```typescript
myLeaderGroups: protectedProcedure.query(async ({ ctx }) => {
  const memberships = await ctx.db.group_member.findMany({
    where: {
      user_id: ctx.user.id,
      left_at: null,
      role: { in: ['leader', 'admin'] },
      group: {
        community_id: BigInt(ctx.user.communityId),
        is_archived: false,
      },
    },
    include: {
      group: { include: { group_type: true } },
    },
    orderBy: { group: { name: 'asc' } },
  });

  return memberships.map(m => ({
    id: m.group.id,
    name: m.group.name,
    groupTypeName: m.group.group_type?.name ?? 'Group',
    preview: m.group.preview ? getMediaUrl(m.group.preview) : null,
  }));
})
```

---

## Phase 2: Frontend Hooks

### 2.1 useExploreFilters Hook

**File:** `apps/mobile/features/explore/hooks/useExploreFilters.ts`

```typescript
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useCallback } from 'react';

export interface ExploreFilters {
  view: 'groups' | 'events';
  // Groups
  groupType: number | null;
  meetingType: number | null;
  // Events
  dateFilter: 'today' | 'this_week' | 'this_month' | 'custom' | null;
  startDate: string | null;
  endDate: string | null;
  hostingGroups: string[];
}

const defaultFilters: ExploreFilters = {
  view: 'groups',
  groupType: null,
  meetingType: null,
  dateFilter: null,
  startDate: null,
  endDate: null,
  hostingGroups: [],
};

export function useExploreFilters() {
  const params = useLocalSearchParams<Record<string, string>>();
  const router = useRouter();

  const filters = useMemo<ExploreFilters>(() => ({
    view: (params.view as 'groups' | 'events') || 'groups',
    groupType: params.groupType ? Number(params.groupType) : null,
    meetingType: params.meetingType ? Number(params.meetingType) : null,
    dateFilter: params.dateFilter as ExploreFilters['dateFilter'] || null,
    startDate: params.startDate || null,
    endDate: params.endDate || null,
    hostingGroups: params.hostingGroups?.split(',').filter(Boolean) || [],
  }), [params]);

  const setFilters = useCallback((updates: Partial<ExploreFilters>) => {
    const merged = { ...filters, ...updates };
    const urlParams: Record<string, string> = {};

    // Only include non-default values
    if (merged.view !== 'groups') urlParams.view = merged.view;
    if (merged.groupType) urlParams.groupType = String(merged.groupType);
    if (merged.meetingType) urlParams.meetingType = String(merged.meetingType);
    if (merged.dateFilter) urlParams.dateFilter = merged.dateFilter;
    if (merged.startDate) urlParams.startDate = merged.startDate;
    if (merged.endDate) urlParams.endDate = merged.endDate;
    if (merged.hostingGroups.length) urlParams.hostingGroups = merged.hostingGroups.join(',');

    router.setParams(urlParams);
  }, [filters, router]);

  const resetFilters = useCallback(() => {
    router.setParams({ view: filters.view });  // Keep view, reset everything else
  }, [filters.view, router]);

  return { filters, setFilters, resetFilters };
}
```

### 2.2 useCommunityEvents Hook

**File:** `apps/mobile/features/explore/hooks/useCommunityEvents.ts`

```typescript
import { trpc } from '@/lib/trpc';
import { ExploreFilters } from './useExploreFilters';

export function useCommunityEvents(filters: ExploreFilters) {
  return trpc.groups.meetings.communityEvents.useQuery({
    datePreset: filters.dateFilter ?? undefined,
    startDate: filters.startDate ?? undefined,
    endDate: filters.endDate ?? undefined,
    hostingGroupIds: filters.hostingGroups.length > 0 ? filters.hostingGroups : undefined,
  }, {
    enabled: filters.view === 'events',
    staleTime: 2 * 60 * 1000,
  });
}
```

---

## Phase 3: New Components

### 3.1 ViewToggle

**File:** `apps/mobile/features/explore/components/ViewToggle.tsx`

Segmented control at top of bottom sheet content:

```typescript
interface ViewToggleProps {
  activeView: 'groups' | 'events';
  onViewChange: (view: 'groups' | 'events') => void;
}

export function ViewToggle({ activeView, onViewChange }: ViewToggleProps) {
  return (
    <View style={styles.container}>
      <TouchableOpacity
        style={[styles.option, activeView === 'groups' && styles.optionActive]}
        onPress={() => onViewChange('groups')}
      >
        <Text style={[styles.optionText, activeView === 'groups' && styles.optionTextActive]}>
          Groups
        </Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={[styles.option, activeView === 'events' && styles.optionActive]}
        onPress={() => onViewChange('events')}
      >
        <Text style={[styles.optionText, activeView === 'events' && styles.optionTextActive]}>
          Events
        </Text>
      </TouchableOpacity>
    </View>
  );
}
```

### 3.2 EventsListView

**File:** `apps/mobile/features/explore/components/EventsListView.tsx`

FlatList of events with date section headers:

```typescript
interface EventsListViewProps {
  events: CommunityEvent[];
  isLoading: boolean;
  onEventPress: (event: CommunityEvent) => void;
  onRefresh: () => void;
  onEndReached: () => void;
}

export function EventsListView({ events, isLoading, onEventPress, onRefresh, onEndReached }: EventsListViewProps) {
  // Group events by date section (Today, Tomorrow, This Week, Later)
  const sections = useMemo(() => groupEventsByDateSection(events), [events]);

  return (
    <SectionList
      sections={sections}
      keyExtractor={(item) => item.id}
      renderItem={({ item }) => (
        <EventCard event={item} onPress={() => onEventPress(item)} />
      )}
      renderSectionHeader={({ section }) => (
        <Text style={styles.sectionHeader}>{section.title}</Text>
      )}
      refreshing={isLoading}
      onRefresh={onRefresh}
      onEndReached={onEndReached}
      onEndReachedThreshold={0.5}
      ListEmptyComponent={<EmptyEventsState />}
    />
  );
}
```

### 3.3 EventsFilterModal

**File:** `apps/mobile/features/explore/components/EventsFilterModal.tsx`

Modal with date presets and hosting group multi-select:

```typescript
interface EventsFilterModalProps {
  visible: boolean;
  onClose: () => void;
  filters: ExploreFilters;
  onFilterChange: (updates: Partial<ExploreFilters>) => void;
}

export function EventsFilterModal({ visible, onClose, filters, onFilterChange }: EventsFilterModalProps) {
  // Date preset options
  const datePresets = [
    { label: 'All', value: null },
    { label: 'Today', value: 'today' },
    { label: 'This Week', value: 'this_week' },
    { label: 'This Month', value: 'this_month' },
  ];

  // Fetch groups for hosting filter (user's groups)
  const { data: userGroups } = trpc.groups.myGroups.useQuery();

  // Search state for groups
  const [groupSearch, setGroupSearch] = useState('');

  const filteredGroups = useMemo(() => {
    if (!userGroups) return [];
    if (!groupSearch) return userGroups;
    return userGroups.filter(g =>
      g.name.toLowerCase().includes(groupSearch.toLowerCase())
    );
  }, [userGroups, groupSearch]);

  return (
    <Modal visible={visible} transparent animationType="fade">
      {/* Date Presets Section */}
      {/* Custom Date Range Section (when dateFilter === 'custom') */}
      {/* Hosting Groups Section with search and multi-select */}
      {/* Reset Button */}
    </Modal>
  );
}
```

---

## Phase 4: Modify Existing Components

### 4.1 ExploreBottomSheet

**File:** `apps/mobile/features/explore/components/ExploreBottomSheet.tsx`

**Changes:**
1. Line 281: Change `index={0}` to `index={1}` (start at 50% instead of 12%)
2. Add `activeView` and `onViewChange` props
3. Add ViewToggle below search bar
4. Conditionally render GroupsList or EventsListView

```typescript
// Change snap point default
<BottomSheet
  ref={bottomSheetRef}
  index={1}  // Changed from 0 to 1 (50% default)
  snapPoints={snapPoints}
  ...
>
  {/* Add ViewToggle */}
  <ViewToggle
    activeView={activeView}
    onViewChange={onViewChange}
  />

  {/* Conditional content */}
  {activeView === 'groups' ? (
    <GroupsList ... />
  ) : (
    <EventsListView ... />
  )}
</BottomSheet>
```

### 4.2 ExploreScreen

**File:** `apps/mobile/features/explore/components/ExploreScreen.tsx`

**Changes:**
1. Import and use `useExploreFilters`
2. Import and use `useCommunityEvents` (when events view active)
3. Show different filter button based on view
4. Pass view state to bottom sheet

```typescript
export function ExploreScreen() {
  const { filters, setFilters, resetFilters } = useExploreFilters();
  const { data: eventsData, isLoading: eventsLoading } = useCommunityEvents(filters);

  // ... existing groups logic

  return (
    <View style={styles.container}>
      {/* Map - could hide for events view or keep */}
      <ExploreMap ... />

      {/* Filter Button - show EventsFilterModal when events view */}
      <FilterButton
        onPress={() => setFilterModalVisible(true)}
        activeCount={getActiveFilterCount(filters)}
      />

      <ExploreBottomSheet
        activeView={filters.view}
        onViewChange={(view) => setFilters({ view })}
        // Pass appropriate data based on view
        groups={filters.view === 'groups' ? filteredGroups : []}
        events={filters.view === 'events' ? eventsData?.events : []}
        ...
      />

      {/* Conditional filter modals */}
      {filters.view === 'groups' ? (
        <FilterModal ... />
      ) : (
        <EventsFilterModal
          visible={filterModalVisible}
          filters={filters}
          onFilterChange={setFilters}
          onClose={() => setFilterModalVisible(false)}
        />
      )}
    </View>
  );
}
```

### 4.3 CreateEventScreen

**File:** `apps/mobile/features/leader-tools/components/CreateEventScreen.tsx`

**Changes:**
1. Read `hostingGroupId` from URL params
2. Fetch `myLeaderGroups` for dropdown options
3. Add hosting group dropdown at top of form
4. Pre-select if `hostingGroupId` provided
5. Require selection before submit

```typescript
export function CreateEventScreen() {
  const params = useLocalSearchParams<{ hostingGroupId?: string }>();
  const { data: leaderGroups } = trpc.groups.myLeaderGroups.useQuery();

  const [hostingGroupId, setHostingGroupId] = useState(params.hostingGroupId ?? '');

  // ... existing form state

  return (
    <ScrollView>
      {/* NEW: Hosting Group Dropdown */}
      <View style={styles.field}>
        <Text style={styles.label}>Hosting Group *</Text>
        <Picker
          selectedValue={hostingGroupId}
          onValueChange={setHostingGroupId}
        >
          <Picker.Item label="Select a group..." value="" />
          {leaderGroups?.map(g => (
            <Picker.Item key={g.id} label={g.name} value={g.id} />
          ))}
        </Picker>
      </View>

      {/* ... rest of existing form */}
    </ScrollView>
  );
}
```

### 4.4 New Create Event Route

**File:** `apps/mobile/app/(user)/create-event.tsx`

```typescript
import { CreateEventScreen } from "@features/leader-tools/components/CreateEventScreen";
export default CreateEventScreen;
```

---

## Phase 5: Update Navigation References

Update all navigation calls from old paths to new paths:

| File | Old Path | New Path |
|------|----------|----------|
| `RecentAttendance.tsx:239` | `/(user)/leader-tools/${groupId}/events` | `/(tabs)/search?view=events&hostingGroups=${groupId}` |
| `RecentAttendance.tsx:287` | `/(user)/leader-tools/${groupId}/events` | `/(tabs)/search?view=events&hostingGroups=${groupId}` |
| `EventHistory.tsx:135` | `/(user)/leader-tools/${groupId}/events/new` | `/(user)/create-event?hostingGroupId=${groupId}` |
| `useGroupLeaderTools.ts:128` | `/(user)/leader-tools/${groupId}/events` | `/(tabs)/search?view=events&hostingGroups=${groupId}` |
| `useChatRoom.ts:342` | `/(user)/leader-tools/${id}/events` | `/(tabs)/search?view=events&hostingGroups=${id}` |
| `[event_id]/index.tsx:102,133,146,182` | `/(user)/leader-tools/${group_id}/events` | `/(tabs)/search?view=events` |

---

## Phase 6: Cleanup

### Delete Files
- `apps/mobile/features/leader-tools/components/EventsScreen.tsx`
- `apps/mobile/app/(user)/leader-tools/[group_id]/events/index.tsx`

### Update Tests
- `features/leader-tools/__tests__/events-page.test.tsx` - Delete or update
- `features/leader-tools/__tests__/event-details-page.test.tsx` - Update assertions
- `features/leader-tools/components/__tests__/EventHistory.test.tsx` - Update assertions

---

## URL Param Reference

```
# Groups view (default)
/(tabs)/search
/(tabs)/search?groupType=5&meetingType=2

# Events view
/(tabs)/search?view=events
/(tabs)/search?view=events&dateFilter=this_week
/(tabs)/search?view=events&hostingGroups=uuid1,uuid2
/(tabs)/search?view=events&dateFilter=custom&startDate=2024-01-01&endDate=2024-01-31

# Create event
/(user)/create-event
/(user)/create-event?hostingGroupId=uuid1
```
