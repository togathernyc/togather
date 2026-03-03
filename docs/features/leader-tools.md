# Leader Tools Feature

## Overview

The Leader Tools feature provides a dashboard for group leaders to manage their groups, track attendance, manage events, and view member information. It includes components for attendance tracking, event management, and member management.

## Purpose

- Leader dashboard with group overview
- Attendance tracking and statistics
- Event management and history
- Member management
- Attendance reports

## User Flows

### Leader Tools Dashboard Flow

1. User navigates to `/leader-tools` → `LeaderToolsScreen` component
2. Screen fetches leader groups via `useLeaderGroups` hook
3. Groups displayed in `LeaderGroupsList` component
4. User clicks group → Navigates to `/leader-tools/[group_id]`

### Group Leader Dashboard Flow

1. User navigates to `/leader-tools/[group_id]` → Group leader dashboard
2. Screen displays:
   - Recent attendance statistics
   - Attendance chart
   - Event history
   - Member list
3. User clicks attendance → Navigates to `/leader-tools/[group_id]/attendance`
4. User clicks events → Navigates to `/leader-tools/[group_id]/events`
5. User clicks members → Navigates to `/leader-tools/[group_id]/members`

### Attendance Tracking Flow

1. User navigates to `/leader-tools/[group_id]/attendance` → `AttendanceDetails` component
2. Screen automatically selects the most recent past event (within last 60 days) for attendance
3. Screen fetches attendance report via `useAttendanceReport` hook
4. Attendance displayed with statistics
5. User can edit attendance → Navigates to `/leader-tools/[group_id]/attendance/edit`
6. When editing attendance:
   - Users who RSVP'd as "going" are automatically preselected as attended
   - Users can be deselected if they didn't actually attend
   - Guest counter allows quick entry of anonymous guests with plus/minus buttons
   - Named guests can still be added via the "Add Guest" button

### Event Management Flow

1. User navigates to `/leader-tools/[group_id]/events` → `EventHistory` component
2. Screen fetches events via `useMeetingDates` hook
3. Events displayed in calendar and list
4. User clicks on an event → Navigates to `/leader-tools/[group_id]/events/[event_date]` → `EventDetails` component
5. Event details page displays:
   - Event date and time
   - RSVP statistics (Going, Not Going, Not Answered)
   - Edit button to modify event
   - Group Chat button to navigate to dinner-party page
6. User can create/edit events → `EventSchedule` modal

### Member Management Flow

1. User navigates to `/leader-tools/[group_id]/members` → `Members` component
2. Screen fetches members via `useGroupMembers` hook
3. Members displayed with pagination
4. User can filter and search members

## Route Structure

| Route | File | Component |
|-------|------|-----------|
| `/leader-tools` | `app/(user)/leader-tools/index.tsx` | `LeaderToolsScreen` |
| `/leader-tools/[group_id]` | `app/(user)/leader-tools/[group_id]/index.tsx` | Uses `RecentAttendance`, `AttendanceDetails` |
| `/leader-tools/[group_id]/attendance` | `app/(user)/leader-tools/[group_id]/attendance/index.tsx` | `AttendanceDetails` |
| `/leader-tools/[group_id]/attendance/edit` | `app/(user)/leader-tools/[group_id]/attendance/edit/index.tsx` | `AttendanceDetails` |
| `/leader-tools/[group_id]/events` | `app/(user)/leader-tools/[group_id]/events/index.tsx` | Uses `EventHistory`, `AttendanceChart`, `EventSchedule` |
| `/leader-tools/[group_id]/events/[event_id]` | `app/(user)/leader-tools/[group_id]/events/[event_id]/index.tsx` | `EventDetails` |
| `/leader-tools/[group_id]/members` | `app/(user)/leader-tools/[group_id]/members/index.tsx` | `Members` |

## Components

### LeaderToolsScreen

**Location:** `features/leader-tools/components/LeaderToolsScreen.tsx`

**Purpose:** Main leader tools screen with header and content.

**Features:**
- Header with title
- Groups list for leaders
- Member counts
- Navigation to group leader dashboard

**Usage:**
```typescript
import { LeaderToolsScreen } from "@/features/leader-tools/components/LeaderToolsScreen";
```

### LeaderGroupsList

**Location:** `features/leader-tools/components/LeaderGroupsList.tsx`

**Purpose:** Groups list for leaders with member counts.

**Features:**
- Groups where user is leader
- Member counts
- Navigation to group leader dashboard

**Usage:**
```typescript
import { LeaderGroupsList } from "@/features/leader-tools/components/LeaderGroupsList";
```

### RecentAttendance

**Location:** `features/leader-tools/components/RecentAttendance.tsx`

**Purpose:** Recent attendance statistics display.

**Features:**
- Recent attendance stats
- Meeting dates
- Attendance chart
- Navigation to attendance details

**Usage:**
```typescript
import { RecentAttendance } from "@/features/leader-tools/components/RecentAttendance";
```

### AttendanceChart

**Location:** `features/leader-tools/components/AttendanceChart.tsx`

**Purpose:** Attendance chart visualization.

**Features:**
- Attendance chart
- Date range selection
- Statistics display

**Usage:**
```typescript
import { AttendanceChart } from "@/features/leader-tools/components/AttendanceChart";
```

### AttendanceDetails

**Location:** `features/leader-tools/components/AttendanceDetails.tsx`

**Purpose:** Attendance details with edit functionality.

**Features:**
- Attendance report
- Member attendance status
- Edit attendance
- Statistics display
- **RSVP Preselection**: Automatically preselects users who RSVP'd as "going" when entering edit mode (can be deselected)
- **Guest Counter**: Quick entry of anonymous guests using plus/minus buttons
- **Named Guests**: Add guests with full details via "Add Guest" button

**Usage:**
```typescript
import { AttendanceDetails } from "@/features/leader-tools/components/AttendanceDetails";
```

### GuestCounter

**Location:** `features/leader-tools/components/GuestCounter.tsx`

**Purpose:** Quick counter component for adding anonymous guests to attendance.

**Features:**
- Plus/minus buttons to increment/decrement guest count
- Displays current guest count
- Disabled state when count is 0

**Usage:**
```typescript
import { GuestCounter } from "@/features/leader-tools/components/GuestCounter";
```

### EventHistory

**Location:** `features/leader-tools/components/EventHistory.tsx`

**Purpose:** Event history display with calendar.

**Features:**
- Event list
- Calendar view
- Meeting dates
- Event details

**Usage:**
```typescript
import { EventHistory } from "@/features/leader-tools/components/EventHistory";
```

### EventList

**Location:** `features/leader-tools/components/EventList.tsx`

**Purpose:** Event list display.

**Features:**
- Event list
- Date filtering
- Event details

**Usage:**
```typescript
import { EventList } from "@/features/leader-tools/components/EventList";
```

### EventDetails

**Location:** `features/leader-tools/components/EventDetails.tsx`

**Purpose:** Event details page with RSVP statistics and edit functionality.

**Features:**
- Event date and time display
- RSVP statistics (Going, Not Going, Not Answered)
- Edit button to modify event
- Group Chat button to navigate to dinner-party page
- Event schedule modal integration

**Usage:**
```typescript
import { EventDetails } from "@/features/leader-tools/components/EventDetails";
```

### Members

**Location:** `features/leader-tools/components/Members.tsx`

**Purpose:** Member management with pagination.

**Features:**
- Member list
- Pagination
- Filtering
- Search

**Usage:**
```typescript
import { Members } from "@/features/leader-tools/components/Members";
```

### WeekCalendar

**Location:** `features/leader-tools/components/WeekCalendar.tsx`

**Purpose:** Week calendar display.

**Features:**
- Week calendar
- Date selection
- Event display

**Usage:**
```typescript
import { WeekCalendar } from "@/features/leader-tools/components/WeekCalendar";
```

### Modals

**Location:** `features/leader-tools/components/modals/`

**Purpose:** Various modals for leader tools.

**Modals:**
- `EventSchedule` - Create/edit events
- Other modals for attendance and member management

**Usage:**
```typescript
import { EventSchedule } from "@/features/leader-tools/components/modals/EventSchedule";
```

## Hooks

### useRecentAttendanceStats

**Location:** `features/leader-tools/hooks/useRecentAttendanceStats.ts`

**Purpose:** Fetches recent attendance statistics.

**Returns:**
- `data` - Attendance statistics
- `isLoading` - Loading state
- `error` - Error state
- `refetch` - Refetch function

**Usage:**
```typescript
import { useRecentAttendanceStats } from "@/features/leader-tools/hooks/useRecentAttendanceStats";

const { data: stats, isLoading, error } = useRecentAttendanceStats(groupId);
```

### useMeetingDates

**Location:** `features/leader-tools/hooks/useMeetingDates.ts`

**Purpose:** Fetches meeting dates for date ranges.

**Returns:**
- `data` - Meeting dates array
- `isLoading` - Loading state
- `error` - Error state
- `refetch` - Refetch function

**Usage:**
```typescript
import { useMeetingDates } from "@/features/leader-tools/hooks/useMeetingDates";

const { data: dates, isLoading, error } = useMeetingDates(groupId, startDate, endDate);
```

### useMeetingDatesForMonth

**Location:** `features/leader-tools/hooks/useMeetingDates.ts`

**Purpose:** Fetches meeting dates for specific months.

**Returns:**
- `data` - Meeting dates array
- `isLoading` - Loading state
- `error` - Error state
- `refetch` - Refetch function

**Usage:**
```typescript
import { useMeetingDatesForMonth } from "@/features/leader-tools/hooks/useMeetingDates";

const { data: dates, isLoading, error } = useMeetingDatesForMonth(groupId, month, year);
```

### useGroupMembers

**Location:** `features/leader-tools/hooks/useGroupMembers.ts`

**Purpose:** Fetches group members with pagination and filtering.

**Returns:**
- `data` - Members array
- `isLoading` - Loading state
- `error` - Error state
- `refetch` - Refetch function

**Usage:**
```typescript
import { useGroupMembers } from "@/features/leader-tools/hooks/useGroupMembers";

const { data: members, isLoading, error } = useGroupMembers(groupId, page, filters);
```

### useAttendanceReport

**Location:** `features/leader-tools/hooks/useAttendanceReport.ts`

**Purpose:** Fetches attendance report for a specific event.

**Returns:**
- `data` - Attendance report
- `isLoading` - Loading state
- `error` - Error state
- `refetch` - Refetch function

**Usage:**
```typescript
import { useAttendanceReport } from "@/features/leader-tools/hooks/useAttendanceReport";

const { data: report, isLoading, error } = useAttendanceReport(groupId, eventId);
```

### useAttendancePage

**Location:** `features/leader-tools/hooks/useAttendancePage.ts`

**Purpose:** Fetches group details and finds the most recent past event for attendance tracking.

**Returns:**
- `group` - Group details
- `isLoadingGroup` - Loading state
- `groupError` - Error state
- `meetingDates` - Array of meeting dates
- `eventDate` - Most recent past event date (within last 60 days)
- `hasScheduledEvent` - Whether a past event exists

**Notes:**
- Attendance is only for past events (not future events)
- Automatically selects the most recent past event within the last 60 days
- If no past events exist, shows "Nothing Scheduled" message

**Usage:**
```typescript
import { useAttendancePage } from "@/features/leader-tools/hooks/useAttendancePage";

const { group, eventDate, hasScheduledEvent } = useAttendancePage(groupId);
```

### useAttendanceEdit

**Location:** `features/leader-tools/hooks/useAttendanceEdit.ts`

**Purpose:** Manages attendance editing state and RSVP preselection.

**Returns:**
- `group` - Group details
- `isLoadingGroup` - Loading state
- `groupError` - Error state
- `attendanceList` - Array of user IDs marked as attended
- `note` - Event note
- `eventDate` - Event date
- `setAttendanceList` - Function to update attendance list
- `setNote` - Function to update note
- `handleBack` - Navigate back handler
- `handleCancelEdit` - Cancel edit handler
- `handleDateSelect` - Date selection handler
- `handleSubmitAttendance` - Submit attendance handler
- `isLoadingRSVPs` - Loading state for RSVP data

**Notes:**
- Automatically preselects users who RSVP'd as "going" when entering edit mode
- Preselection only occurs if no existing attendance data exists
- Users can be deselected if they didn't actually attend

**Usage:**
```typescript
import { useAttendanceEdit } from "@/features/leader-tools/hooks/useAttendanceEdit";

const { attendanceList, setAttendanceList, handleSubmitAttendance } = useAttendanceEdit(groupId);
```

### useLeaderGroups

**Location:** `features/leader-tools/hooks/useLeaderGroups.ts`

**Purpose:** Fetches groups where user is leader, filters by role.

**Returns:**
- `data` - Leader groups array
- `isLoading` - Loading state
- `error` - Error state
- `refetch` - Refetch function

**Usage:**
```typescript
import { useLeaderGroups } from "@/features/leader-tools/hooks/useLeaderGroups";

const { data: groups, isLoading, error } = useLeaderGroups(user);
```

### useLeaderGroupMemberCounts

**Location:** `features/leader-tools/hooks/useLeaderGroupMemberCounts.ts`

**Purpose:** Fetches member counts for leader groups in parallel.

**Returns:**
- `data` - Member counts map
- `isLoading` - Loading state
- `error` - Error state
- `refetch` - Refetch function

**Usage:**
```typescript
import { useLeaderGroupMemberCounts } from "@/features/leader-tools/hooks/useLeaderGroupMemberCounts";

const { data: counts, isLoading, error } = useLeaderGroupMemberCounts(groupIds);
```

## API Endpoints

**Location:** `features/leader-tools/services/leader-tools.api.ts`

The leader-tools service re-exports from the main API modules:

```typescript
import { groupsApi, membersApi, adminApi } from "../../../services/api";

export const leaderToolsService = {
  // Group methods
  getDPDetails: groupsApi.getDPDetails,
  // Member methods
  getGroupMembers: membersApi.getGroupMembers,
  // Admin methods
  getAttendanceStats: adminApi.getAttendanceStats,
  getMeetingDates: adminApi.getMeetingDates,
  getAttendanceReport: adminApi.getAttendanceReport,
};
```

**Available Methods:**
- `getDPDetails(groupId)` - Get group details
- `getGroupMembers(groupId, page, filters)` - Get group members
  - Supports `rsvpStatus` filter: "going", "not_going", "not_answered"
  - Requires `rsvpDate` parameter when using RSVP filters (YYYY-MM-DD format)
- `getAttendanceStats(groupId, startDate, endDate)` - Get attendance statistics
- `getMeetingDatesList(groupId, startDate, endDate)` - Get meeting dates for a date range
  - Used to find past events for attendance (looks back 60 days)
- `getAttendanceReport(groupId, eventDate)` - Get attendance report for a specific event
- `getRSVPStats(groupId, date)` - Get RSVP statistics for a specific event date
- `getMeetingRSVPs(groupId, date)` - Get list of RSVPs for a specific event date
- `addGuest(data)` - Add a named guest to attendance
- `createAttendance(groupId, data)` - Submit attendance data
  - `data.attendanceData`: Array of `{user: number, status: number}` (1=attended, 0=absent)
  - `data.date`: Event date
  - `data.totalUsers`: Total member count
  - `data.note`: Optional event note
- `createEventSchedule(data)` - Create/edit/remove event schedule

## Types

**Location:** `features/leader-tools/types.ts`

### MeetingSummary

```typescript
interface MeetingSummary {
  id: number;
  date: string;
  attendance_count: number;
  total_members: number;
  // ... other fields
}
```

### AttendanceStats

```typescript
interface AttendanceStats {
  total_attendance: number;
  average_attendance: number;
  meetings: MeetingSummary[];
}
```

## Examples

### Using Leader Groups Hook

```typescript
import { useLeaderGroups } from "@/features/leader-tools/hooks/useLeaderGroups";

function LeaderGroupsList() {
  const { user } = useAuth();
  const { data: groups, isLoading, error } = useLeaderGroups(user);

  if (isLoading) return <LoadingSkeleton />;
  if (error) return <ErrorMessage error={error} />;

  return (
    <FlatList
      data={groups}
      renderItem={({ item }) => <GroupCard group={item} />}
    />
  );
}
```

### Using Attendance Stats Hook

```typescript
import { useRecentAttendanceStats } from "@/features/leader-tools/hooks/useRecentAttendanceStats";

function AttendanceChart({ groupId }) {
  const { data: stats, isLoading, error } = useRecentAttendanceStats(groupId);

  if (isLoading) return <LoadingSkeleton />;
  if (error) return <ErrorMessage error={error} />;

  return <Chart data={stats.meetings} />;
}
```

## Related Documentation

- [Feature Index](./README.md)
- [Architecture Decision Records](../architecture/decisions/)
- [Routing Guide](../development/ROUTING.md)
- [API Integration Guide](../development/API_INTEGRATION.md)

