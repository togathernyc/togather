# Unified Events Page Refactoring - Status & Bug Tracker

## Overview

Refactored the events system from group-specific pages (`/leader-tools/[group_id]/events`) to a unified events view in the Explore tab with filtering capabilities.

---

## Implementation Status

### Completed ✅

#### Backend
- [x] Added `communityEvents` endpoint to `apps/api-trpc/src/routers/groups/meetings.ts`
- [x] Added `myLeaderGroups` endpoint to `apps/api-trpc/src/routers/groups/core.ts`
- [x] Added helper functions to `apps/api-trpc/src/routers/groups/access.ts`

#### Frontend - New Files
- [x] `apps/mobile/features/explore/hooks/useExploreFilters.ts` - URL param sync
- [x] `apps/mobile/features/explore/hooks/useCommunityEvents.ts` - Events data fetching
- [x] `apps/mobile/features/explore/components/ViewToggle.tsx` - Groups/Events toggle
- [x] `apps/mobile/features/explore/components/EventCard.tsx` - Event card component
- [x] `apps/mobile/features/explore/components/EventsListView.tsx` - Events list with sections
- [x] `apps/mobile/features/explore/components/EventsFilterModal.tsx` - Events filter modal
- [x] `apps/mobile/app/(user)/create-event.tsx` - Universal create event route

#### Frontend - Modified Files
- [x] `apps/mobile/features/explore/components/ExploreScreen.tsx` - Integrated events view
- [x] `apps/mobile/features/explore/components/ExploreBottomSheet.tsx` - Added toggle, 50% default
- [x] `apps/mobile/features/leader-tools/components/CreateEventScreen.tsx` - Hosting group dropdown

#### Deleted Files
- [x] `apps/mobile/features/leader-tools/components/EventsScreen.tsx`
- [x] `apps/mobile/app/(user)/leader-tools/[group_id]/events/index.tsx`
- [x] `apps/mobile/app/(user)/leader-tools/[group_id]/events/new.tsx`
- [x] `apps/mobile/features/leader-tools/__tests__/events-page.test.tsx`

#### Navigation Updates
- [x] Updated 9 navigation references to use new routes

---

## Known Bugs 🐛

### Bug 1: ViewToggle Not Switching Back to Groups
**Severity:** Critical
**Status:** Open - Root Cause Identified
**Symptom:** After clicking "Events" tab, clicking "Groups" tab does not switch back

**Root Cause Analysis:**
Found in `useExploreFilters.ts` lines 67-69:

```typescript
// View - only include if not default
if (merged.view !== 'groups') {
  urlParams.view = merged.view;
}
```

The problem: When switching TO 'groups', the code doesn't add `view` to `urlParams` (since 'groups' is default). Then `router.setParams(urlParams)` is called, but **Expo Router's `setParams` MERGES params, it doesn't replace them**. So the old `?view=events` param stays in the URL.

**Files to Fix:**
- `apps/mobile/features/explore/hooks/useExploreFilters.ts`

**Fix Option 1: Explicitly set view param even for default**
```typescript
// Always include view param
urlParams.view = merged.view;
```

**Fix Option 2: Clear params before setting (more thorough)**
```typescript
const setFilters = useCallback((updates: Partial<ExploreFilters>) => {
  const merged = { ...filters, ...updates };

  // Build clean params - explicitly set empty string to clear
  const urlParams: Record<string, string | undefined> = {
    view: merged.view === 'groups' ? undefined : merged.view,
    groupType: merged.groupType !== null ? String(merged.groupType) : undefined,
    // ... etc
  };

  // Use router.replace or navigate to clear old params
  router.setParams(urlParams);
}, [filters, router]);
```

**Fix Option 3: Use router.replace instead of setParams**
```typescript
const setFilters = useCallback((updates: Partial<ExploreFilters>) => {
  const merged = { ...filters, ...updates };

  // Build query string
  const params = new URLSearchParams();
  if (merged.view !== 'groups') params.set('view', merged.view);
  // ... add other params

  const queryString = params.toString();
  router.replace(queryString ? `/(tabs)/search?${queryString}` : '/(tabs)/search');
}, [filters, router]);
```

**Recommended Fix: Option 3** - Using `router.replace` ensures the URL is completely replaced rather than merged.

**How to Debug:**
```typescript
// Add console.log in useExploreFilters.ts setFilters
const setFilters = useCallback((updates: Partial<ExploreFilters>) => {
  console.log('setFilters called with:', updates);
  console.log('Current filters:', filters);
  const merged = { ...filters, ...updates };
  console.log('Merged filters:', merged);
  console.log('URL params to set:', urlParams);
  router.setParams(urlParams);
}, [filters, router]);
```

---

### Bug 2: Map Shows Group Markers Instead of Event Markers
**Severity:** High
**Status:** Open
**Symptom:** When in Events view, map displays group location markers. Clicking a marker navigates to group page, not event page.

**Root Cause Analysis:**
The `ExploreMap` component is always receiving `groups` data, even in Events view. The map was not updated to handle events.

**Files to Investigate:**
- `apps/mobile/features/explore/components/ExploreScreen.tsx` - Check what's passed to ExploreMap
- `apps/mobile/features/explore/components/ExploreMap.tsx` - Check marker rendering

**Current Code (ExploreScreen.tsx:246-254):**
```tsx
<ExploreMap
  groups={groupsWithLocation}  // Always passes groups, never events
  selectedGroupId={selectedGroup?.id ?? null}
  onGroupSelect={handleGroupSelect}
  onBoundsChange={handleBoundsChange}
  mapboxToken={mapboxToken}
/>
```

**Required Fix Options:**

**Option A: Hide map in Events view**
```tsx
{/* Only show map in Groups view */}
{exploreFilters.view === 'groups' && (
  <ExploreMap
    groups={groupsWithLocation}
    selectedGroupId={selectedGroup?.id ?? null}
    onGroupSelect={handleGroupSelect}
    onBoundsChange={handleBoundsChange}
    mapboxToken={mapboxToken}
  />
)}
```

**Option B: Show event locations on map (more complex)**
Would require:
1. Adding event location data to `CommunityEvent` type
2. Modifying `ExploreMap` to accept events
3. Creating event markers with different styling
4. Handling event marker clicks → navigate to event detail

**Recommended:** Start with Option A (hide map in Events view) as it's simpler and events don't necessarily have unique locations (they use group locations).

---

### Bug 3: Search Not Working in Events View
**Severity:** High
**Status:** Open
**Symptom:** Typing in search bar doesn't filter the events list

**Root Cause Analysis:**
The search functionality may not be properly connected in Events view. Check:
1. Is `searchQuery` state being passed to the events filtering logic?
2. Is `filteredEvents` in ExploreBottomSheet using the search query?

**Files to Investigate:**
- `apps/mobile/features/explore/components/ExploreBottomSheet.tsx` - Check `filteredEvents` memo
- `apps/mobile/features/explore/components/ExploreScreen.tsx` - Check search state flow

**Current Code (ExploreBottomSheet.tsx:223-233):**
```tsx
// Filter events based on search query
const filteredEvents = useMemo(() => {
  if (!searchQuery.trim()) return events;

  const query = searchQuery.toLowerCase();
  return events.filter((event) => {
    const title = (event.title || '').toLowerCase();
    const groupName = event.group.name.toLowerCase();
    const location = (event.locationOverride || '').toLowerCase();
    return title.includes(query) || groupName.includes(query) || location.includes(query);
  });
}, [events, searchQuery]);
```

**Debug Steps:**
1. Add console.log to verify `searchQuery` is updating
2. Add console.log to verify `events` array is populated
3. Check if `filteredEvents` is being used in the SectionList

**Check the SectionList data source:**
```tsx
// ExploreBottomSheet.tsx - verify eventSections uses filteredEvents
const eventSections = useMemo(() => {
  // ... should use filteredEvents, not events
}, [filteredEvents]);  // Check dependency array
```

---

## How to Fix Bugs

### General Debugging Workflow

1. **Read the relevant files** to understand current implementation
2. **Add console.logs** at key points to trace data flow
3. **Use iOS Simulator** to reproduce the bug
4. **Make minimal changes** to fix the specific issue
5. **Test the fix** using the simulator
6. **Verify no regressions** by testing related functionality
7. **Update this document** with the fix status

### Testing with iOS Simulator

```bash
# Get the booted simulator ID
# Use mcp__ios-simulator__get_booted_sim_id

# Take a screenshot to see current state
# Use mcp__ios-simulator__screenshot

# Describe UI elements to find tap targets
# Use mcp__ios-simulator__ui_describe_all

# Tap on specific coordinates
# Use mcp__ios-simulator__ui_tap with x, y coordinates

# Type in search fields
# Use mcp__ios-simulator__ui_type with text
```

### Example Debug Session for Bug 1

```
1. Take screenshot of Explore tab
2. Use ui_describe_all to find ViewToggle elements
3. Tap on "Events" - verify it switches
4. Take screenshot to confirm Events view
5. Tap on "Groups" - check if it responds
6. If no response, check if tap coordinates are correct
7. If tap works but no switch, add console.logs to trace
```

---

## Verification Checklist

After fixing bugs, verify these critical user journeys work:

### ViewToggle (Bug 1 Fix Verification)
- [ ] Tap Groups → Events → Groups → Events repeatedly
- [ ] Each tap should instantly switch the view
- [ ] URL params should update (`?view=groups` vs `?view=events`)

### Map Behavior (Bug 2 Fix Verification)
- [ ] In Groups view: Map shows group markers
- [ ] In Events view: Map is hidden OR shows event-appropriate markers
- [ ] Tapping group markers opens group card (Groups view only)

### Search (Bug 3 Fix Verification)
- [ ] In Groups view: Search filters groups list
- [ ] In Events view: Search filters events list
- [ ] Clear search restores full list
- [ ] Search is case-insensitive

### Full Integration Test
- [ ] Fresh app load → Explore tab at 50%
- [ ] Groups view → filter by type → see filtered groups
- [ ] Switch to Events → filter by date → see filtered events
- [ ] Switch back to Groups → previous filter still applied
- [ ] Tap event → navigate to detail → back → return to Events view
- [ ] Create new event → appears in Events list

---

## File Reference

### Key Files for Bug Fixes

| File | Purpose | Bugs Related |
|------|---------|--------------|
| `ExploreScreen.tsx` | Main container, state management | Bug 1, 2 |
| `ExploreBottomSheet.tsx` | List rendering, search filtering | Bug 1, 3 |
| `ViewToggle.tsx` | Toggle UI component | Bug 1 |
| `ExploreMap.tsx` | Map rendering | Bug 2 |
| `useExploreFilters.ts` | URL param management | Bug 1 |

### Component Hierarchy

```
ExploreScreen
├── ExploreMap (groups only)
├── Filter Button → FilterModal (groups) OR EventsFilterModal (events)
├── Add Button (context-aware)
├── ExploreBottomSheet
│   ├── ViewToggle
│   ├── SearchBar
│   └── BottomSheetFlatList (groups) OR BottomSheetSectionList (events)
└── FloatingGroupCard (when group selected)
```

---

## Notes for Future LLMs

1. **Always reproduce the bug first** before attempting to fix
2. **Make small, targeted changes** - don't refactor while bug fixing
3. **Test in simulator** after each change
4. **Check for TypeScript errors** with `npx tsc --noEmit`
5. **Update this document** with findings and fixes
6. **Commit fixes separately** from new features

### Common Gotchas

- `useCallback` dependencies - missing deps cause stale closures
- `useMemo` dependencies - wrong deps cause stale data
- URL params are strings - need to parse numbers/booleans
- Bottom sheet gestures can interfere with touch events
- Map markers have their own touch handling
