# Query Keys Migration Quick Reference

Quick lookup table for migrating query keys during consolidation.

## Group Details

| Old Format                   | New Format                         | Files Affected                                                                                              |
| ---------------------------- | ---------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `["group-details", groupId]` | `queryKeys.groups.detail(groupId)` | useGroupDetails, useGroupLeaderTools, useJoinGroup, useWithdrawJoinRequest, useUpdateGroup, EditGroupScreen |
| `["groupDetails", groupId]`  | `queryKeys.groups.detail(groupId)` | useMembersPage, AttendanceScreen                                                                            |
| `["group", groupId]`         | `queryKeys.groups.detail(groupId)` | useAttendanceEdit, useAttendancePage, event details page                                                    |

## Group Members

| Old Format                                     | New Format                                                       | Files Affected                      |
| ---------------------------------------------- | ---------------------------------------------------------------- | ----------------------------------- |
| `["groupMembers", groupId]`                    | `queryKeys.leaderTools.groupMembers(groupId)`                    | useMemberActions, useAttendanceEdit |
| `["groupMembers", groupId, "attendance-edit"]` | `queryKeys.leaderTools.groupMembers(groupId, "attendance-edit")` | useAttendanceEdit                   |

## Meetings & Events

| Old Format                                    | New Format                                        | Files Affected                                     |
| --------------------------------------------- | ------------------------------------------------- | -------------------------------------------------- |
| `["meetings", groupId, "past-90", "next-90"]` | `queryKeys.leaderTools.meetings(groupId, 90, 90)` | useGroupLeaderTools, useAttendanceEdit, EventsList |
| `["meetings", groupId, "past-90", "next-1"]`  | `queryKeys.leaderTools.meetings(groupId, 90, 1)`  | useAttendancePage                                  |
| `["recent-meetings", groupId]`                | `queryKeys.leaderTools.recentMeetings(groupId)`   | useGroupLeaderTools                                |
| `["leader-tools", "meeting-dates", groupId]`  | `queryKeys.leaderTools.meetingDates(groupId)`     | CreateEventScreen, useAttendanceSubmission         |
| `["meetingDates", groupId]`                   | `queryKeys.leaderTools.meetingDates(groupId)`     | CreateEventScreen                                  |

## RSVP & Attendance

| Old Format                                       | New Format                                                   | Files Affected                                      |
| ------------------------------------------------ | ------------------------------------------------------------ | --------------------------------------------------- |
| `["rsvpStats", groupId, dateStr]`                | `queryKeys.leaderTools.rsvpStats(groupId, dateStr)`          | AttendanceDetails, EventDetails, event details page |
| `["leaderAttendanceReport", groupId, eventDate]` | `queryKeys.leaderTools.attendanceReport(groupId, eventDate)` | useAttendanceEdit                                   |
| `["attendance", groupId, meetingId]`             | `queryKeys.leaderTools.attendance(groupId, meetingId)`       | useAttendanceEdit                                   |

## User Groups

| Old Format        | New Format                      | Files Affected      |
| ----------------- | ------------------------------- | ------------------- |
| `["user-groups"]` | `queryKeys.groups.userGroups()` | useGroupLeaderTools |

## Admin

| Old Format                          | New Format                            | Files Affected          |
| ----------------------------------- | ------------------------------------- | ----------------------- |
| `["admin", "pending-requests"]`     | `queryKeys.admin.pendingRequests()`   | PendingRequestsScreen   |
| `["admin", "user-history", userId]` | `queryKeys.admin.userHistory(userId)` | PendingRequestsScreen   |
| `["admin", "duplicateAccounts"]`    | `queryKeys.admin.duplicateAccounts()` | DuplicateAccountsScreen |
| `["admin", "mergedAccounts"]`       | `queryKeys.admin.mergedAccounts()`    | DuplicateAccountsScreen |

## Other

| Old Format               | New Format                          | Files Affected                |
| ------------------------ | ----------------------------------- | ----------------------------- |
| `["chat", "messages"]`   | `queryKeys.chat.messages(roomId)`   | useChatRefresh (needs roomId) |
| `["dinnerParty", dp_id]` | `queryKeys.groups.detail(dp_id)`    | Legacy dinner party pages     |
| `["services", churchId]` | `queryKeys.services.list(churchId)` | Service page                  |
| `["subscriptions"]`      | `queryKeys.subscriptions.list()`    | Pricing, get-started pages    |
| `["groupTypes"]`         | `queryKeys.groups.types()`          | ExploreScreen                 |

## Invalidation Patterns

### Before (Multiple Variations)

```typescript
// Group details - 4 variations!
queryClient.invalidateQueries({ queryKey: ["group", groupId] });
queryClient.invalidateQueries({ queryKey: ["group-details", groupId] });
queryClient.invalidateQueries({ queryKey: ["groupDetails", groupId] });
queryClient.invalidateQueries({ queryKey: queryKeys.groups.detail(groupId) });
```

### After (Single Standardized Key)

```typescript
// Group details - 1 key!
queryClient.invalidateQueries({ queryKey: queryKeys.groups.detail(groupId) });
```

## Common Patterns

### Import Statement

```typescript
import { queryKeys } from "@utils/query-keys";
```

### Query Hook Pattern

```typescript
// Before
const { data } = useQuery({
  queryKey: ["group-details", groupId],
  queryFn: () => api.get(groupId),
});

// After
const { data } = useQuery({
  queryKey: queryKeys.groups.detail(groupId),
  queryFn: () => api.get(groupId),
});
```

### Invalidation Pattern

```typescript
// Before
queryClient.invalidateQueries({ queryKey: ["group-details", groupId] });

// After
queryClient.invalidateQueries({ queryKey: queryKeys.groups.detail(groupId) });
```

### Temporary Dual Invalidation (During Migration)

```typescript
// During migration, invalidate both to ensure no regressions
queryClient.invalidateQueries({ queryKey: ["group-details", groupId] }); // Old
queryClient.invalidateQueries({ queryKey: queryKeys.groups.detail(groupId) }); // New
```
