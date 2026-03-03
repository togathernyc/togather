# Admin Feature

## Overview

The Admin feature provides administrative functionality for managing the church, members, groups, reports, and settings. This feature is **partially extracted** - the dashboard is complete, but other admin routes still need extraction.

## Purpose

- Admin dashboard with statistics
- Member management
- Group management
- Reports generation
- Church settings management
- Homefeed content management

## Status

**Partially Extracted** - Dashboard is complete, other routes need extraction following the same pattern.

## User Flows

### Admin Dashboard Flow

1. User navigates to `/admin/dashboard` → `AdminDashboardScreen` component
2. Screen fetches admin dashboard data via `useAdminDashboard` hook
3. Dashboard displays:
   - Total attendance statistics
   - New signups statistics
   - Groups statistics
   - Quick access to other admin sections
4. User clicks section → Navigates to respective admin page

### Other Admin Flows (To Be Extracted)

- Member management → `/admin/members`
- Group management → `/admin/groups`
- Reports → `/admin/reports`
- Settings → `/admin/settings`
- Church settings → `/admin/church-settings`
- Homefeed content → `/admin/homefeed/*`

## Route Structure

| Route | File | Component | Status |
|-------|------|-----------|--------|
| `/admin/dashboard` | `app/admin/dashboard/index.tsx` | `AdminDashboardScreen` | ✅ Extracted |
| `/admin/members` | `app/admin/members/index.tsx` | To be extracted | ⚠️ Pending |
| `/admin/groups` | `app/admin/groups/index.tsx` | To be extracted | ⚠️ Pending |
| `/admin/reports` | `app/admin/reports/index.tsx` | To be extracted | ⚠️ Pending |
| `/admin/settings` | `app/admin/settings/index.tsx` | To be extracted | ⚠️ Pending |
| `/admin/church-settings` | `app/admin/church-settings/index.tsx` | To be extracted | ⚠️ Pending |
| `/admin/homefeed/*` | `app/admin/homefeed/*` | To be extracted | ⚠️ Pending |

## Components

### AdminDashboardScreen

**Location:** `features/admin/components/AdminDashboardScreen.tsx`

**Purpose:** Main admin dashboard with stats and quick access.

**Features:**
- Total attendance statistics
- New signups statistics
- Groups statistics
- Quick access to other admin sections
- Loading states
- Error handling

**Usage:**
```typescript
import { AdminDashboardScreen } from "@/features/admin/components/AdminDashboardScreen";
```

### Other Components (To Be Extracted)

- Member management components
- Group management components
- Reports components
- Settings components
- Church settings components
- Homefeed content components

## Hooks

### useAdminDashboard

**Location:** `features/admin/hooks/useAdminDashboard.ts`

**Purpose:** Fetches admin dashboard data (total attendance, new signups, groups).

**Returns:**
- `data` - Dashboard statistics
- `isLoading` - Loading state
- `error` - Error state
- `refetch` - Refetch function

**Usage:**
```typescript
import { useAdminDashboard } from "@/features/admin/hooks/useAdminDashboard";

const { data: stats, isLoading, error } = useAdminDashboard();
```

**Features:**
- Fetches total attendance
- Fetches new signups
- Fetches groups statistics
- Date range support

### Other Hooks (To Be Extracted)

- Member management hooks
- Group management hooks
- Reports hooks
- Settings hooks
- Church settings hooks
- Homefeed content hooks

## API Endpoints

**Location:** `features/admin/services/admin.api.ts`

The admin service re-exports from the main API modules:

```typescript
import { adminApi } from "../../../services/api/admin";

export const adminService = {
  ...adminApi,
};
```

**Available Methods:**
- `getDashboardStats(dateRange)` - Get dashboard statistics
- `getMembers(page, filters)` - Get members (to be extracted)
- `getGroups(page, filters)` - Get groups (to be extracted)
- `getReports(dateRange)` - Get reports (to be extracted)
- `getChurchSettings()` - Get church settings (to be extracted)
- `updateChurchSettings(data)` - Update church settings (to be extracted)
- And more...

## Types

**Location:** `features/admin/types.ts`

### AdminDashboardStats

```typescript
interface AdminDashboardStats {
  total_attendance: number;
  new_signups: number;
  total_groups: number;
  // ... other statistics
}
```

### DateRange

```typescript
interface DateRange {
  start_date: string;
  end_date: string;
}
```

## Future Extraction Work

The following admin routes need to be extracted following the same pattern as the dashboard:

1. **Member Management** (`/admin/members`)
   - Extract components: `MembersList`, `MemberDetail`, `MemberForm`
   - Extract hooks: `useMembers`, `useMemberDetails`, `useUpdateMember`
   - Create route wrapper

2. **Group Management** (`/admin/groups`)
   - Extract components: `GroupsList`, `GroupDetail`, `GroupForm`
   - Extract hooks: `useGroups`, `useGroupDetails`, `useUpdateGroup`
   - Create route wrapper

3. **Reports** (`/admin/reports`)
   - Extract components: `ReportsList`, `ReportDetail`, `ReportGenerator`
   - Extract hooks: `useReports`, `useReportDetails`, `useGenerateReport`
   - Create route wrapper

4. **Settings** (`/admin/settings`)
   - Extract components: `SettingsScreen`, `SettingsForm`
   - Extract hooks: `useSettings`, `useUpdateSettings`
   - Create route wrapper

5. **Church Settings** (`/admin/church-settings`)
   - Extract components: `ChurchSettingsScreen`, `ChurchSettingsForm`
   - Extract hooks: `useChurchSettings`, `useUpdateChurchSettings`
   - Create route wrapper

6. **Homefeed Content** (`/admin/homefeed/*`)
   - Extract components for each content type
   - Extract hooks for each content type
   - Create route wrappers

## Duplicate Accounts Management

### Overview

The duplicate accounts feature (`/admin/duplicate-accounts`) helps manage users who have created multiple accounts with the same phone number during the migration to phone-based authentication.

### How It Works

1. **Detection**: The system detects users with the same phone number who have multiple accounts
2. **Auto-merge**: During sync, accounts inactive for 1+ year are automatically merged
3. **Manual review**: Active accounts (logged in within past year) require manual review through the admin UI
4. **Persistence**: Manual merge decisions are saved and replayed on future syncs

### Key Files

| File | Purpose |
|------|---------|
| `apps/backend/src/servers/togather_api/routers/user/duplicates.py` | API endpoints for duplicate detection and merging |
| `apps/backend/src/servers/togather_sync/management/commands/auto_merge_duplicates.py` | Management command for auto-merging |
| `apps/backend/src/servers/togather_sync/management/commands/merge_decisions.json` | Stores manual merge decisions for replay |
| `apps/mobile/app/admin/duplicate-accounts/index.tsx` | Admin UI for reviewing and merging duplicates |
| `packages/shared/src/api/services/admin.ts` | Frontend API client for duplicate management |

### API Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/users/duplicates` | GET | List all duplicate accounts grouped by phone |
| `/api/users/duplicates/merge` | POST | Merge selected accounts into a primary account |
| `/api/users/duplicates/merged` | GET | List all previous merge decisions |

### Merge Logic

When merging accounts:
1. **Group memberships** are transferred to the primary account
2. **Church memberships** are transferred to the primary account
3. **Role conflicts** are resolved by keeping the higher role
4. **Secondary accounts** are soft-deleted (deactivated, email prefixed with `merged_`)
5. **Decision recorded** in `merge_decisions.json` for replay on future syncs

### Technical Note: Bypassing Django Signals

The merge operations use `Model.objects.filter(pk=...).update()` instead of `model.save()` to bypass Django signals. This is necessary because:
- The `update_dynamo_db_chat_record` signal in `signals.py` fires on Membership save
- This signal queries `ChatRoom` tables which may not exist in all environments
- Using `update()` skips the signal entirely while still updating the database

### Running Duplicate Merge Manually

```bash
# Dry run - see what would be merged
python manage.py auto_merge_duplicates --dry-run --verbose

# Actually run the merge
python manage.py auto_merge_duplicates --verbose

# Adjust inactive threshold (default is 365 days)
python manage.py auto_merge_duplicates --inactive-days 180
```

## Examples

### Using Admin Dashboard Hook

```typescript
import { useAdminDashboard } from "@/features/admin/hooks/useAdminDashboard";

function AdminDashboard() {
  const { data: stats, isLoading, error } = useAdminDashboard();

  if (isLoading) return <LoadingSkeleton />;
  if (error) return <ErrorMessage error={error} />;

  return (
    <View>
      <StatCard title="Total Attendance" value={stats.total_attendance} />
      <StatCard title="New Signups" value={stats.new_signups} />
      <StatCard title="Total Groups" value={stats.total_groups} />
    </View>
  );
}
```

## Related Documentation

- [Feature Index](./README.md)
- [Architecture Decision Records](../architecture/decisions/)
- [Routing Guide](../development/ROUTING.md)
- [API Integration Guide](../development/API_INTEGRATION.md)
- [Adding Features Guide](../development/ADDING_FEATURES.md) - For extracting remaining admin routes

