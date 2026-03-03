# Feature Documentation Index

## Overview

The Togather mobile app is organized using a **feature-based architecture**. Each feature is self-contained with its own components, hooks, services, types, and utilities. This documentation provides comprehensive information about each feature.

## Feature-Based Architecture

Features are organized independently of routes. A single feature can be used by multiple routes, and a single route can use multiple features. Route files are thin wrappers (3 lines) that import components from features.

**Example:**
```typescript
// app/groups/index.tsx
import { GroupsScreen } from "@/features/groups/components/GroupsScreen";
export default GroupsScreen;
```

## Features

### 1. [Authentication](./phone-auth.md)

**Purpose:** User authentication via phone-first flow, account claiming, and initial routing.

**Routes:**
- `/signin` → `app/(auth)/signin/index.tsx` (phone entry)
- `/verify-otp` → `app/(auth)/verify-otp/index.tsx`
- `/confirm-identity` → `app/(auth)/confirm-identity/index.tsx`
- `/user-type` → `app/(auth)/user-type/index.tsx`
- `/claim-account/*` → Account claiming flow
- `/signup` → `app/(auth)/signup/index.tsx`
- `/reset-password` → `app/(auth)/reset-password/index.tsx`
- `/welcome` → `app/(auth)/welcome/index.tsx`
- `/` → `app/index.tsx` (initial routing)

**Key Components:** `PhoneSignInScreen`, `ConfirmIdentityScreen`, `UserTypeScreen`, `SignUpScreen`, `PasswordResetScreen`, `WelcomeScreen`, `ChurchSearch`, `ConfirmModal`

**Key Hooks:** `usePhoneAuth`, `useSignIn`, `useSignUp`, `usePasswordReset`, `useChurchSearch`, `useChurchSelection`, `useInitialRouting`

---

### 2. [Groups](./groups.md)

**Purpose:** Group management, RSVP functionality, group search, and group creation.

**Routes:**
- `/groups` → `app/groups/index.tsx`
- `/groups/[group_id]` → `app/groups/[group_id]/index.tsx`
- `/create-group` → `app/(user)/create-group/index.tsx`
- `/dinner-party-search` → `app/(user)/dinner-party-search/index.tsx`
- `/home` → `app/home/index.tsx` (RSVP section)

**Key Components:** `GroupsScreen`, `GroupDetailScreen`, `GroupCard`, `RSVPSection`, `RSVPModal`, `CreateGroupScreen`, `GroupSearchScreen`

**Key Hooks:** `useGroups`, `useGroupDetails`, `useRSVP`, `useCreateGroup`, `useGroupSearch`

---

### 3. [Chat/Inbox](./chat.md)

**Purpose:** Chat rooms, messaging, and real-time communication.

**Routes:**
- `/inbox` → `app/inbox/index.tsx`
- `/inbox/[chat_id]` → `app/inbox/[chat_id]/index.tsx`
- `/home` → `app/home/index.tsx` (recent messages section)

**Key Components:** `InboxScreen`, `ChatDetailScreen`, `ChatList`, `MessageList`, `MessageBubble`, `MessageInput`

**Key Hooks:** `useChatRooms`, `useChatMessages`, `useSendMessage`, `useChatRefresh`

**Special Features:** WebSocket integration for real-time messaging

---

### 4. [Home](./home.md)

**Purpose:** Main dashboard showing recent messages, group RSVPs, and church resources.

**Routes:**
- `/home` → `app/home/index.tsx` (via tabs)

**Key Components:** `HomeScreen`

**Key Hooks:** `useChatRooms`, `useUserData`, `useLatestMessage`, `useChurchSettings`, `useGroupsNeedingRSVP`

**Sections:** New Messages, Group RSVPs, Get Connected, Latest Message

---

### 5. [Leader Tools](./leader-tools.md)

**Purpose:** Leader dashboard, attendance tracking, event management, and member management.

**Routes:**
- `/leader-tools` → `app/(user)/leader-tools/index.tsx`
- `/leader-tools/[group_id]` → `app/(user)/leader-tools/[group_id]/index.tsx`
- `/leader-tools/[group_id]/attendance` → `app/(user)/leader-tools/[group_id]/attendance/index.tsx`
- `/leader-tools/[group_id]/attendance/edit` → `app/(user)/leader-tools/[group_id]/attendance/edit/index.tsx`
- `/leader-tools/[group_id]/events` → `app/(user)/leader-tools/[group_id]/events/index.tsx`
- `/leader-tools/[group_id]/members` → `app/(user)/leader-tools/[group_id]/members/index.tsx`

**Key Components:** `LeaderToolsScreen`, `RecentAttendance`, `AttendanceChart`, `AttendanceDetails`, `EventHistory`, `EventList`, `Members`

**Key Hooks:** `useRecentAttendanceStats`, `useMeetingDates`, `useGroupMembers`, `useAttendanceReport`, `useLeaderGroups`, `useLeaderGroupMemberCounts`

---

### 6. [Profile](./profile.md)

**Purpose:** User profile viewing and editing, including photo upload.

**Routes:**
- `/profile` → `app/(user)/profile/index.tsx`
- `/edit-profile` → `app/(user)/edit-profile/index.tsx`

**Key Components:** `ProfileScreen`, `ProfileHeader`, `ProfileMenu`, `EditProfileScreen`, `EditProfileForm`

**Key Hooks:** `useProfile`, `useUpdateProfile`, `useUpdateProfilePhoto`, `useRemoveProfilePhoto`

---

### 7. [Settings](./settings.md)

**Purpose:** User settings management (name, email, etc.).

**Routes:**
- `/settings` → `app/(user)/settings/index.tsx`

**Key Components:** `SettingsScreen`, `SettingsForm`

**Key Hooks:** `useSettings`, `useUpdateSettings`

---

### 8. [Admin](./admin.md)

**Purpose:** Admin dashboard and administrative features (partially extracted).

**Routes:**
- `/admin/dashboard` → `app/admin/dashboard/index.tsx`
- `/admin/members` → `app/admin/members/index.tsx` (to be extracted)
- `/admin/groups` → `app/admin/groups/index.tsx` (to be extracted)
- `/admin/reports` → `app/admin/reports/index.tsx` (to be extracted)
- `/admin/settings` → `app/admin/settings/index.tsx` (to be extracted)
- And more...

**Key Components:** `AdminDashboardScreen` (extracted), others (to be extracted)

**Key Hooks:** `useAdminDashboard` (extracted), others (to be extracted)

**Status:** Partially extracted - dashboard is complete, other routes need extraction

---

## Quick Reference Table

| Feature | Routes | Main Components | Main Hooks | Status |
|--------|--------|----------------|------------|--------|
| **Authentication** | `/signin`, `/verify-otp`, `/confirm-identity`, `/user-type`, `/claim-account/*`, `/signup` | `PhoneSignInScreen`, `ConfirmIdentityScreen`, `UserTypeScreen`, `ConfirmModal` | `usePhoneAuth`, `useSignIn`, `useSignUp` | ✅ Complete |
| **Groups** | `/groups`, `/groups/[group_id]`, `/create-group`, `/dinner-party-search` | `GroupsScreen`, `GroupDetailScreen`, `CreateGroupScreen` | `useGroups`, `useGroupDetails`, `useRSVP` | ✅ Complete |
| **Chat** | `/inbox`, `/inbox/[chat_id]` | `InboxScreen`, `ChatDetailScreen` | `useChatRooms`, `useChatMessages`, `useSendMessage` | ✅ Complete |
| **Home** | `/home` | `HomeScreen` | `useChatRooms`, `useUserData`, `useLatestMessage` | ✅ Complete |
| **Leader Tools** | `/leader-tools`, `/leader-tools/[group_id]/*` | `LeaderToolsScreen`, `RecentAttendance`, `AttendanceDetails` | `useRecentAttendanceStats`, `useMeetingDates`, `useGroupMembers` | ✅ Complete |
| **Profile** | `/profile`, `/edit-profile` | `ProfileScreen`, `EditProfileScreen` | `useProfile`, `useUpdateProfile` | ✅ Complete |
| **Settings** | `/settings` | `SettingsScreen` | `useSettings`, `useUpdateSettings` | ✅ Complete |
| **Admin** | `/admin/dashboard`, `/admin/*` | `AdminDashboardScreen` | `useAdminDashboard` | ⚠️ Partial |

---

## Feature Module Structure

Each feature follows this structure:

```
features/[feature-name]/
├── components/           # Feature-specific components
│   ├── ComponentName.tsx
│   └── index.ts         # Barrel export
├── hooks/                # Feature-specific hooks
│   ├── useFeature.ts
│   └── index.ts
├── services/             # Feature-specific API calls
│   ├── feature.api.ts
│   └── index.ts
├── utils/                # Feature-specific utilities
│   ├── utility.ts
│   └── index.ts
├── types.ts              # Feature-specific types
└── index.ts              # Barrel export (re-exports all)
```

## How to Use This Documentation

1. **Start with the feature index** (this file) to get an overview
2. **Read the feature documentation** for detailed information about each feature
3. **Check the Architecture Decision Records** (`docs/architecture/decisions/`) for architectural context
4. **Refer to Developer Guides** (`docs/development/`) for practical implementation guidance

## Related Documentation

- [Architecture Decision Records](../architecture/decisions/) - Why we made architectural decisions
- [Developer Guides](../development/) - How to work with the codebase
- [Routing Guide](../development/ROUTING.md) - Expo Router patterns
- [API Integration Guide](../development/API_INTEGRATION.md) - API client patterns

