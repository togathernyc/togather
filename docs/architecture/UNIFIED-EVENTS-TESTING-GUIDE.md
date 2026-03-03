# Unified Events Feature - Testing Guide

This document provides a checklist for LLMs and testers to verify the unified events feature works correctly. Each section contains specific user journeys (CUJs) that must be verified.

## Prerequisites

- **Test Account**: Use the test credentials from the seed script (`npx convex run functions/seed:seedDemoData`)
- **Community**: Search for "Demo Community"
- User should be a leader of at least one group to test leader-specific features

---

## 1. Explore Tab - View Toggle

### CUJ 1.1: Default View State
- [ ] Navigate to the Explore tab (`/(tabs)/search`)
- [ ] Verify bottom sheet starts at **50% height** (half screen)
- [ ] Verify "Groups" view is selected by default
- [ ] Verify map is visible behind the bottom sheet
- [ ] Verify groups list is displayed in the bottom sheet

### CUJ 1.2: Switch to Events View
- [ ] Tap "Events" in the ViewToggle
- [ ] Verify events list is displayed (with date sections: TODAY, TOMORROW, THIS WEEK, COMING UP)
- [ ] Verify map remains visible (not hidden)
- [ ] Verify search bar updates placeholder text appropriately
- [ ] Verify "Map" button is hidden (only shows for Groups view)

### CUJ 1.3: Switch Back to Groups View
- [ ] Tap "Groups" in the ViewToggle
- [ ] Verify groups list is restored
- [ ] Verify "Map" button reappears
- [ ] Verify previous search query is cleared

---

## 2. Groups View (Existing Functionality)

### CUJ 2.1: Groups Filter Modal
- [ ] Tap the filter button (top right, gear icon)
- [ ] Verify Groups filter modal opens (NOT events filter)
- [ ] Select a group type filter
- [ ] Verify filter is applied and badge shows count
- [ ] Clear filters and verify badge disappears

### CUJ 2.2: Group Selection
- [ ] Tap on a group card in the list
- [ ] Verify floating group card appears
- [ ] Verify bottom sheet hides when group is selected
- [ ] Close the floating card
- [ ] Verify bottom sheet reappears

### CUJ 2.3: Admin - Create Group Button
- [ ] As an admin user, verify "+" button is visible
- [ ] Tap "+" button
- [ ] Verify navigation to `/(user)/create-group`

---

## 3. Events View (New Functionality)

### CUJ 3.1: Events List Display
- [ ] Switch to Events view
- [ ] Verify events are grouped by date sections
- [ ] Verify each event card shows:
  - Event title (or group type name if no title)
  - Date/time badge
  - Hosting group name and image
  - RSVP count (if enabled)
  - Location or "Online" indicator

### CUJ 3.2: Events Filter Modal
- [ ] In Events view, tap the filter button
- [ ] Verify **Events** filter modal opens (NOT groups filter)
- [ ] Test date preset filters (Today, This Week, This Month)
- [ ] Test hosting group multi-select:
  - [ ] Search for a group
  - [ ] Select multiple groups
  - [ ] Verify selected count shows
- [ ] Apply filters and verify list updates
- [ ] Reset filters and verify all events return

### CUJ 3.3: Event Card Tap
- [ ] Tap on an event card
- [ ] Verify navigation to `/e/[shortId]` (event detail page)
- [ ] Verify event details load correctly
- [ ] Tap back button
- [ ] Verify return to Events view in Explore tab

### CUJ 3.4: Leader - Create Event Button
- [ ] As a group leader, verify "+" button is visible in Events view
- [ ] Tap "+" button
- [ ] Verify navigation to `/(user)/create-event`
- [ ] Verify hosting group dropdown is displayed
- [ ] Verify user's leader groups are listed in dropdown

---

## 4. Create Event Flow

### CUJ 4.1: Create Event from Events View
- [ ] Navigate to Events view → tap "+" button
- [ ] Verify `/(user)/create-event` route loads
- [ ] Verify "Hosting Group" dropdown is shown
- [ ] Select a hosting group
- [ ] Fill in required fields (Date & Time)
- [ ] Submit the event
- [ ] Verify event is created
- [ ] Verify navigation back or to event detail

### CUJ 4.2: Create Event with Pre-selected Group
- [ ] Navigate to `/(user)/create-event?hostingGroupId={groupId}`
- [ ] Verify hosting group is pre-selected in dropdown
- [ ] Verify user can still change the selection
- [ ] Complete event creation

### CUJ 4.3: Create Event from Leader Tools
- [ ] Navigate to Leader Tools for a group
- [ ] Go to Event History
- [ ] Tap "New Event" button
- [ ] Verify navigation to `/(user)/create-event?hostingGroupId={groupId}`
- [ ] Verify hosting group is pre-selected

---

## 5. Navigation Entry Points

### CUJ 5.1: From Leader Tools → Events
- [ ] Navigate to Leader Tools for a group
- [ ] Tap "Events" nav tab
- [ ] Verify navigation to `/(tabs)/search?view=events&hostingGroups={groupId}`
- [ ] Verify Events view is active
- [ ] Verify filter shows the hosting group is selected

### CUJ 5.2: From Chat Room Menu → Events
- [ ] Open a group chat
- [ ] Open the menu (three dots)
- [ ] Tap "Events" option
- [ ] Verify navigation to `/(tabs)/search?view=events&hostingGroups={groupId}`

### CUJ 5.3: From Recent Attendance → Events
- [ ] Navigate to Leader Tools
- [ ] In Recent Attendance section, tap "EDIT" or "CREATE EVENT"
- [ ] Verify appropriate navigation

### CUJ 5.4: Deep Link with URL Params
- [ ] Navigate directly to `/(tabs)/search?view=events`
- [ ] Verify Events view is active
- [ ] Navigate to `/(tabs)/search?view=events&hostingGroups={id1},{id2}`
- [ ] Verify Events view with hosting groups filter applied

---

## 6. Event Detail Navigation

### CUJ 6.1: Back Navigation from Event Detail
- [ ] Open an event detail page
- [ ] Tap the back button
- [ ] If history exists: verify `router.back()` works
- [ ] If no history: verify fallback to `/(tabs)/search?view=events`

### CUJ 6.2: Edit Event Navigation
- [ ] Open an event detail page (as leader)
- [ ] Tap edit button
- [ ] Verify navigation to edit screen
- [ ] Verify existing event data is loaded
- [ ] Verify save works and returns to detail

---

## 7. Edge Cases

### CUJ 7.1: Empty States
- [ ] View Events when no events exist
- [ ] Verify "No upcoming events" empty state
- [ ] Apply date filter that returns no results
- [ ] Verify "No events found" with filter hint

### CUJ 7.2: Loading States
- [ ] Switch to Events view
- [ ] Verify skeleton loading cards display while fetching
- [ ] Verify loading spinner in filter modal while fetching groups

### CUJ 7.3: User with No Leader Groups
- [ ] Log in as non-leader user
- [ ] Navigate to Events view
- [ ] Verify "+" button is NOT visible
- [ ] Try to access `/(user)/create-event` directly
- [ ] Verify "no permission" message in dropdown

### CUJ 7.4: Community Change
- [ ] Switch communities
- [ ] Verify Explore tab resets (clears filters, search, selection)
- [ ] Verify events and groups reload for new community

---

## 8. URL Param Persistence

### CUJ 8.1: Filter State in URL
- [ ] Apply events filters (date + hosting groups)
- [ ] Check URL includes params: `?view=events&dateFilter=today&hostingGroups={ids}`
- [ ] Refresh the page
- [ ] Verify filters are restored from URL

### CUJ 8.2: Groups Filter State in URL
- [ ] Apply group type filter
- [ ] Check URL includes: `?groupType={id}`
- [ ] Switch to events and back to groups
- [ ] Verify group filter persists

---

## Verification Commands

### Check TypeScript Compilation
```bash
cd apps/mobile && npx tsc --noEmit
```

### Run Related Tests
```bash
cd apps/mobile && npx jest --testPathPattern="(ExploreScreen|EventHistory|ChatRoomScreen|event-details)" --passWithNoTests
```

### Start Development Server
```bash
pnpm dev  # Uses production backend
# or
pnpm dev --local  # Uses local backend
```

---

## Files Changed (Reference)

### Backend
- `apps/api-trpc/src/routers/groups/meetings.ts` - communityEvents endpoint
- `apps/api-trpc/src/routers/groups/core.ts` - myLeaderGroups endpoint
- `apps/api-trpc/src/routers/groups/access.ts` - helper functions

### Frontend - New
- `apps/mobile/features/explore/hooks/useExploreFilters.ts`
- `apps/mobile/features/explore/hooks/useCommunityEvents.ts`
- `apps/mobile/features/explore/components/ViewToggle.tsx`
- `apps/mobile/features/explore/components/EventCard.tsx`
- `apps/mobile/features/explore/components/EventsListView.tsx`
- `apps/mobile/features/explore/components/EventsFilterModal.tsx`
- `apps/mobile/app/(user)/create-event.tsx`

### Frontend - Modified
- `apps/mobile/features/explore/components/ExploreScreen.tsx`
- `apps/mobile/features/explore/components/ExploreBottomSheet.tsx`
- `apps/mobile/features/leader-tools/components/CreateEventScreen.tsx`

### Frontend - Deleted
- `apps/mobile/features/leader-tools/components/EventsScreen.tsx`
- `apps/mobile/app/(user)/leader-tools/[group_id]/events/index.tsx`
- `apps/mobile/app/(user)/leader-tools/[group_id]/events/new.tsx`

---

## Common Issues & Fixes

### Issue: Events not loading
- Check that `communityEvents` endpoint is properly exported in router
- Verify user is authenticated (protectedProcedure)
- Check browser console for tRPC errors

### Issue: Hosting groups dropdown empty
- Verify `myLeaderGroups` endpoint is working
- Check user has leader/admin role in at least one group

### Issue: Filters not persisting
- Check `useExploreFilters` hook is properly using `router.setParams`
- Verify URL params are being read correctly

### Issue: View toggle not switching
- Check `activeView` state is being updated
- Verify `handleViewChange` is calling `setExploreFilters`

### Issue: "+" button not appearing
- For Groups view: user must be admin (`user?.is_admin`)
- For Events view: user must be leader (`leaderGroups?.length > 0`)
