# Query Keys Consolidation Plan

## Problem Statement

The mobile app currently uses multiple inconsistent query key formats for the same data, requiring us to invalidate multiple variations to ensure UI updates. This leads to:

- **Verbose invalidation code** - Need to invalidate 3-4 variations for the same data
- **Error-prone** - Easy to miss a variation when updating code
- **Maintenance burden** - Hard to know which keys are actually used
- **Performance impact** - Invalidating more queries than necessary

## Current State Analysis

### Group Details Query Keys (4 variations!)
1. `["group-details", groupId]` - Used by `useGroupDetails` hook (most common)
2. `["groupDetails", groupId]` - Used by `useMembersPage`, `AttendanceScreen` (camelCase)
3. `["group", groupId]` - Used by `useAttendanceEdit`, `useAttendancePage` (shorter)
4. `queryKeys.groups.detail(groupId)` → `["groups", groupId]` - Standardized (rarely used)

### Group Members Query Keys (2 variations)
1. `["groupMembers", groupId]` - Used in various places
2. `queryKeys.leaderTools.groupMembers(groupId)` → `["groupMembers", groupId, ...]` - Standardized

### Other Inconsistent Patterns
- `["user-groups"]` vs `queryKeys.groups.userGroups()` → `["userGroups"]`
- `["meetings", groupId, "past-90", "next-90"]` vs `queryKeys.leaderTools.meetingDates(groupId)`
- `["recent-meetings", groupId]` - No standardized version
- `["rsvpStats", groupId, dateStr]` - No standardized version
- `["leaderAttendanceReport", groupId, eventDate]` vs `queryKeys.leaderTools.attendanceReport(groupId, eventDate)`
- `["attendance", groupId, meetingId]` - No standardized version
- `["chat", "messages"]` vs `queryKeys.chat.messages(roomId)`
- `["dinnerParty", dp_id]` - Legacy format
- `["admin", "pending-requests"]` - No standardized version
- `["services", churchId]` - No standardized version
- `["subscriptions"]` - No standardized version

## Standardization Strategy

### Phase 1: Extend queryKeys Utility (Foundation)

**Goal**: Ensure all query key patterns have standardized factories

**Tasks**:
1. Add missing query key factories to `apps/mobile/utils/query-keys.ts`:
   ```typescript
   groups: {
     // ... existing
     details: (groupId: string | number) => ['group-details', groupId] as const, // Alias for backward compat
   },
   leaderTools: {
     // ... existing
     meetings: (groupId: string | number, past?: number, next?: number) => 
       ['meetings', groupId, `past-${past || 90}`, `next-${next || 90}`] as const,
     rsvpStats: (groupId: string | number, dateStr: string) => 
       ['rsvpStats', groupId, dateStr] as const,
     attendance: (groupId: string | number, meetingId: string | number) => 
       ['attendance', groupId, meetingId] as const,
     recentMeetings: (groupId: string | number) => 
       ['recent-meetings', groupId] as const,
   },
   admin: {
     // ... existing
     pendingRequests: () => ['admin', 'pending-requests'] as const,
     userHistory: (userId: number) => ['admin', 'user-history', userId] as const,
     duplicateAccounts: () => ['admin', 'duplicateAccounts'] as const,
     mergedAccounts: () => ['admin', 'mergedAccounts'] as const,
   },
   services: {
     list: (churchId?: string | number) => ['services', ...(churchId ? [churchId] : [])] as const,
   },
   subscriptions: {
     list: () => ['subscriptions'] as const,
   },
   ```

2. Update `packages/shared/src/utils/query-keys.ts` to match (for web app consistency)

**Files to Update**:
- `apps/mobile/utils/query-keys.ts`
- `packages/shared/src/utils/query-keys.ts`

**Estimated Time**: 1-2 hours

---

### Phase 2: Migrate Group Details Queries (High Priority)

**Goal**: Consolidate all group details queries to use `queryKeys.groups.detail(groupId)`

**Migration Map**:
- `["group-details", groupId]` → `queryKeys.groups.detail(groupId)`
- `["groupDetails", groupId]` → `queryKeys.groups.detail(groupId)`
- `["group", groupId]` → `queryKeys.groups.detail(groupId)`

**Files to Update** (in order of priority):

1. **Core hooks** (affects most screens):
   - `apps/mobile/features/groups/hooks/useGroupDetails.ts` ✅ Already uses `["group-details", groupId]` - change to `queryKeys.groups.detail()`
   - `apps/mobile/features/leader-tools/hooks/useGroupLeaderTools.ts` - Change `["group-details", groupId]`
   - `apps/mobile/features/leader-tools/hooks/useMembersPage.ts` - Change `["groupDetails", groupId]`
   - `apps/mobile/features/leader-tools/components/AttendanceScreen.tsx` - Change `["groupDetails", group_id]`
   - `apps/mobile/features/leader-tools/hooks/useAttendanceEdit.ts` - Change `["group", groupId]`
   - `apps/mobile/features/leader-tools/hooks/useAttendancePage.ts` - Change `["group", groupId]`
   - `apps/mobile/app/(user)/leader-tools/[group_id]/events/[event_id]/index.tsx` - Change `["group", group_id]`

2. **Mutation hooks** (invalidation):
   - `apps/mobile/features/groups/hooks/useJoinGroup.ts` - Update invalidation
   - `apps/mobile/features/groups/hooks/useWithdrawJoinRequest.ts` - Update invalidation
   - `apps/mobile/features/groups/hooks/useUpdateGroup.ts` - Update invalidation
   - `apps/mobile/features/groups/components/EditGroupScreen.tsx` - Update invalidation
   - `apps/mobile/features/leader-tools/hooks/useMemberActions.ts` - **Simplify invalidation** (remove 3 variations!)

**Benefits**:
- Reduces invalidation from 4 queries to 1
- Makes `useMemberActions.ts` much cleaner
- Consistent across all group detail queries

**Estimated Time**: 2-3 hours

---

### Phase 3: Migrate Group Members Queries

**Goal**: Consolidate group members queries to use `queryKeys.leaderTools.groupMembers(groupId)`

**Migration Map**:
- `["groupMembers", groupId]` → `queryKeys.leaderTools.groupMembers(groupId)`
- `["groupMembers", groupId, "attendance-edit"]` → `queryKeys.leaderTools.groupMembers(groupId, "attendance-edit")`

**Files to Update**:
- `apps/mobile/features/leader-tools/hooks/useMemberActions.ts` - Update invalidation
- `apps/mobile/features/leader-tools/hooks/useAttendanceEdit.ts` - Update query key

**Note**: `useGroupMembers.ts` already uses `queryKeys.leaderTools.groupMembers()` ✅

**Estimated Time**: 1 hour

---

### Phase 4: Migrate Meetings & Events Queries

**Goal**: Consolidate meeting-related queries

**Migration Map**:
- `["meetings", groupId, "past-90", "next-90"]` → `queryKeys.leaderTools.meetings(groupId, 90, 90)`
- `["meetings", groupId, "past-90", "next-1"]` → `queryKeys.leaderTools.meetings(groupId, 90, 1)`
- `["recent-meetings", groupId]` → `queryKeys.leaderTools.recentMeetings(groupId)`
- `["leader-tools", "meeting-dates", groupId]` → `queryKeys.leaderTools.meetingDates(groupId)`
- `["meetingDates", groupId]` → `queryKeys.leaderTools.meetingDates(groupId)`

**Files to Update**:
- `apps/mobile/features/leader-tools/hooks/useGroupLeaderTools.ts`
- `apps/mobile/features/leader-tools/hooks/useAttendanceEdit.ts`
- `apps/mobile/features/leader-tools/hooks/useAttendancePage.ts`
- `apps/mobile/features/leader-tools/components/EventsList.tsx`
- `apps/mobile/features/leader-tools/components/CreateEventScreen.tsx`
- `apps/mobile/features/leader-tools/hooks/useAttendanceSubmission.ts`

**Estimated Time**: 2 hours

---

### Phase 5: Migrate RSVP & Attendance Queries

**Goal**: Consolidate RSVP and attendance-related queries

**Migration Map**:
- `["rsvpStats", groupId, dateStr]` → `queryKeys.leaderTools.rsvpStats(groupId, dateStr)`
- `["leaderAttendanceReport", groupId, eventDate]` → `queryKeys.leaderTools.attendanceReport(groupId, eventDate)`
- `["attendance", groupId, meetingId]` → `queryKeys.leaderTools.attendance(groupId, meetingId)`

**Files to Update**:
- `apps/mobile/features/leader-tools/components/AttendanceDetails.tsx`
- `apps/mobile/features/leader-tools/components/EventDetails.tsx`
- `apps/mobile/features/leader-tools/hooks/useAttendanceEdit.ts`
- `apps/mobile/app/(user)/leader-tools/[group_id]/events/[event_id]/index.tsx`

**Estimated Time**: 1-2 hours

---

### Phase 6: Migrate User Groups Query

**Goal**: Consolidate user groups query

**Migration Map**:
- `["user-groups"]` → `queryKeys.groups.userGroups()`

**Files to Update**:
- `apps/mobile/features/leader-tools/hooks/useGroupLeaderTools.ts`

**Note**: `useGroups.ts` already uses `queryKeys.groups.userGroups()` ✅

**Estimated Time**: 30 minutes

---

### Phase 7: Migrate Admin Queries

**Goal**: Consolidate admin-related queries

**Migration Map**:
- `["admin", "pending-requests"]` → `queryKeys.admin.pendingRequests()`
- `["admin", "user-history", userId]` → `queryKeys.admin.userHistory(userId)`
- `["admin", "duplicateAccounts"]` → `queryKeys.admin.duplicateAccounts()`
- `["admin", "mergedAccounts"]` → `queryKeys.admin.mergedAccounts()`

**Files to Update**:
- `apps/mobile/features/admin/components/PendingRequestsScreen.tsx`
- `apps/mobile/features/admin/components/DuplicateAccountsScreen.tsx`

**Estimated Time**: 1 hour

---

### Phase 8: Migrate Remaining Queries

**Goal**: Migrate remaining miscellaneous queries

**Migration Map**:
- `["chat", "messages"]` → Use `queryKeys.chat.messages(roomId)` with proper roomId
- `["dinnerParty", dp_id]` → `queryKeys.groups.detail(dp_id)` (if UUID) or keep for legacy
- `["services", churchId]` → `queryKeys.services.list(churchId)`
- `["subscriptions"]` → `queryKeys.subscriptions.list()`
- `["groupTypes"]` → Add to `queryKeys.groups.types()`

**Files to Update**:
- `apps/mobile/features/chat/hooks/useChatRefresh.ts`
- `apps/mobile/app/(user)/dinner-party/[dp_id]/index.tsx`
- `apps/mobile/app/(user)/dinner-party/[dp_id]/[slug].tsx`
- `apps/mobile/app/(user)/service/index.tsx`
- `apps/mobile/app/(landing)/pricing/index.tsx`
- `apps/mobile/app/(landing)/get-started/index.tsx`
- `apps/mobile/features/explore/components/ExploreScreen.tsx`

**Estimated Time**: 2 hours

---

## Implementation Guidelines

### Step-by-Step Process for Each File

1. **Import queryKeys**:
   ```typescript
   import { queryKeys } from "@utils/query-keys";
   ```

2. **Replace hardcoded query key**:
   ```typescript
   // Before
   queryKey: ["group-details", groupId]
   
   // After
   queryKey: queryKeys.groups.detail(groupId)
   ```

3. **Update invalidation**:
   ```typescript
   // Before
   queryClient.invalidateQueries({ queryKey: ["group-details", groupId] });
   queryClient.invalidateQueries({ queryKey: ["groupDetails", groupId] });
   queryClient.invalidateQueries({ queryKey: ["group", groupId] });
   
   // After
   queryClient.invalidateQueries({ queryKey: queryKeys.groups.detail(groupId) });
   ```

4. **Test thoroughly**:
   - Verify data still loads correctly
   - Verify mutations still invalidate correctly
   - Check that UI updates after mutations

### Testing Strategy

For each phase:

1. **Unit Tests**: Update any query key tests
2. **Integration Tests**: 
   - Test data fetching with new keys
   - Test query invalidation after mutations
   - Verify no duplicate queries are created
3. **Manual Testing**:
   - Navigate through affected screens
   - Perform mutations (promote leader, update group, etc.)
   - Verify UI updates immediately
   - Check React Query DevTools for query key consistency

### Rollback Plan

If issues arise:
1. Revert the specific file(s) causing issues
2. Keep both old and new keys temporarily:
   ```typescript
   // Temporary: invalidate both during migration
   queryClient.invalidateQueries({ queryKey: ["group-details", groupId] });
   queryClient.invalidateQueries({ queryKey: queryKeys.groups.detail(groupId) });
   ```
3. Once stable, remove old key invalidation

---

## Success Metrics

### Before Consolidation
- **Group details**: 4 different query keys
- **Group members**: 2 different query keys  
- **Invalidation calls**: ~15-20 per mutation
- **Code duplication**: High

### After Consolidation
- **Group details**: 1 standardized query key
- **Group members**: 1 standardized query key
- **Invalidation calls**: ~5-8 per mutation (60% reduction)
- **Code duplication**: Minimal

### Benefits
1. ✅ **Simpler invalidation** - One key per data type
2. ✅ **Fewer queries** - Better performance
3. ✅ **Easier maintenance** - Single source of truth
4. ✅ **Type safety** - TypeScript autocomplete for query keys
5. ✅ **Consistency** - Same pattern across entire app

---

## Timeline Estimate

| Phase | Description | Time | Priority |
|-------|-------------|------|----------|
| Phase 1 | Extend queryKeys utility | 1-2h | 🔴 Critical |
| Phase 2 | Migrate group details | 2-3h | 🔴 Critical |
| Phase 3 | Migrate group members | 1h | 🟡 High |
| Phase 4 | Migrate meetings | 2h | 🟡 High |
| Phase 5 | Migrate RSVP/attendance | 1-2h | 🟢 Medium |
| Phase 6 | Migrate user groups | 30m | 🟢 Medium |
| Phase 7 | Migrate admin queries | 1h | 🟢 Medium |
| Phase 8 | Migrate remaining | 2h | 🟢 Medium |
| **Total** | | **11-13h** | |

**Recommended Approach**: Complete phases 1-3 first (highest impact), then continue with remaining phases incrementally.

---

## Next Steps

1. ✅ Review and approve this plan
2. Start with Phase 1 (extend queryKeys utility)
3. Complete Phase 2 (group details - highest impact)
4. Continue with remaining phases incrementally
5. Update this document as phases are completed

---

## Notes

- **Backward Compatibility**: During migration, we can temporarily invalidate both old and new keys to ensure no regressions
- **Web App**: Similar consolidation should be done for web app (`apps/web`) - can use this plan as template
- **Documentation**: Update `docs/agent/FRONTEND_DEVELOPMENT_GUIDE.md` with query key best practices after completion

