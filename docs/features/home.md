# Home Feature

## Overview

The Home feature provides the main dashboard for authenticated users, displaying an overview of their activity, upcoming events, and church resources. It shows recent messages, group RSVPs, enabled group types, and the latest church message.

## Purpose

- Display recent chat messages (top 2)
- Display groups needing RSVP (top 2)
- Display enabled group types (Get Connected section)
- Display latest church message with preview
- Pull-to-refresh functionality

## User Flows

### Home Dashboard Flow

1. User navigates to `/home` → `HomeScreen` component
2. Screen fetches data via multiple hooks:
   - `useChatRooms` - Recent messages
   - `useUserData` - User groups and RSVPs
   - `useLatestMessage` - Latest church message
   - `useChurchSettings` - Enabled group types
3. Data displayed in sections:
   - New Messages section (top 2 messages)
   - Group RSVPs section (groups needing RSVP)
   - Get Connected section (enabled group types)
   - Latest Message section (church message)
4. User can pull to refresh → All data refreshed
5. User clicks message → Navigates to `/inbox/[chat_id]`
6. User clicks RSVP button → Navigates to `/groups/[group_id]`
7. User clicks group type → Navigates to `/dinner-party-search`

## Route Structure

| Route | File | Component |
|-------|------|-----------|
| `/home` | `app/home/index.tsx` | `HomeScreen` |

## Components

### HomeScreen

**Location:** `features/home/components/HomeScreen.tsx`

**Purpose:** Main home screen with all sections.

**Features:**
- New Messages section (top 2)
- Group RSVPs section (groups needing RSVP)
- Get Connected section (enabled group types)
- Latest Message section (church message)
- Pull-to-refresh
- Loading skeleton
- Error handling

**Usage:**
```typescript
import { HomeScreen } from "@/features/home/components/HomeScreen";
```

## Hooks

### useChatRooms

**Location:** `features/home/hooks/useChatRooms.ts`

**Purpose:** Fetches and sorts chat rooms.

**Returns:**
- `data` - Chat rooms array (sorted by last message time)
- `isLoading` - Loading state
- `error` - Error state
- `refetch` - Refetch function

**Usage:**
```typescript
import { useChatRooms } from "@/features/home/hooks/useChatRooms";

const { data: chatRooms, isLoading, error } = useChatRooms(user);
```

**Features:**
- Sorts by last message time
- Returns top 2 for display
- Checks if more messages exist

### useUserData

**Location:** `features/home/hooks/useUserData.ts`

**Purpose:** Fetches user data including groups and RSVPs.

**Returns:**
- `data` - User data (includes `group_memberships` and `rsvps`)
- `isLoading` - Loading state
- `error` - Error state
- `refetch` - Refetch function

**Usage:**
```typescript
import { useUserData } from "@/features/home/hooks/useUserData";

const { data: userData, isLoading, error } = useUserData(user);
```

**Features:**
- Fetches user profile
- Includes group memberships
- Includes RSVPs

### useLatestMessage

**Location:** `features/home/hooks/useLatestMessage.ts`

**Purpose:** Fetches latest church message.

**Returns:**
- `data` - Latest message
- `isLoading` - Loading state
- `error` - Error state
- `refetch` - Refetch function

**Usage:**
```typescript
import { useLatestMessage } from "@/features/home/hooks/useLatestMessage";

const { data: latestMessage, isLoading, error } = useLatestMessage(churchId);
```

**Features:**
- Fetches latest message for church
- Handles 404 gracefully (no message)
- Includes preview image, notes, links

### useChurchSettings

**Location:** `features/home/hooks/useChurchSettings.ts`

**Purpose:** Fetches church settings to check enabled group types.

**Returns:**
- `data` - Church settings (includes enabled group types)
- `isLoading` - Loading state
- `error` - Error state
- `refetch` - Refetch function

**Usage:**
```typescript
import { useChurchSettings } from "@/features/home/hooks/useChurchSettings";

const { data: churchSettings, isLoading, error } = useChurchSettings(churchId);
```

**Features:**
- Fetches church settings
- Includes enabled group types
- Includes group type names

### useGroupsNeedingRSVP

**Location:** `features/home/hooks/useGroupsNeedingRSVP.ts`

**Purpose:** Filters groups that need RSVP (memoized hook).

**Returns:**
- Filtered groups array (groups with upcoming meetings where user hasn't RSVP'd)

**Usage:**
```typescript
import { useGroupsNeedingRSVP } from "@/features/home/hooks/useGroupsNeedingRSVP";

const groupsNeedingRSVP = useGroupsNeedingRSVP(userGroups, userData);
```

**Features:**
- Filters groups with upcoming meetings
- Filters out groups where user has RSVP'd
- Filters out groups with past meeting dates
- Sorts by meeting date (earliest first)
- Memoized for performance

## API Endpoints

**Location:** `features/home/services/home.api.ts`

The home service re-exports from the main API modules:

```typescript
import { chatApi, membersApi, adminApi, resourcesApi } from "../../../services/api";

export const homeService = {
  getAllRooms: chatApi.getAllRooms,
  getUserByToken: membersApi.getUserByToken,
  getLatestMessage: adminApi.getLatestMessage,
  getChurchSettings: adminApi.getChurchSettings,
};
```

**Available Methods:**
- `getAllRooms()` - Get all chat rooms
- `getUserByToken()` - Get user data (includes groups and RSVPs)
- `getLatestMessage(churchId)` - Get latest church message
- `getChurchSettings()` - Get church settings (includes enabled group types)

## Sections

### New Messages Section

**Purpose:** Displays the 2 most recent chat messages.

**Features:**
- Shows top 2 messages
- Shows sender name, message preview, and date
- Shows unread indicators (purple dot)
- "View All Messages" button if more than 2 messages
- Navigation to chat detail on message click
- Navigation to inbox on "View All" click

### Group RSVPs Section

**Purpose:** Shows upcoming group meetings where the user hasn't RSVP'd yet.

**Features:**
- Shows up to 2 groups needing RSVP
- Filters out groups with past meeting dates
- Filters out groups where user has RSVP'd
- Sorts by meeting date (earliest first)
- "View All" button if more than 2 groups
- RSVP button navigates to group detail
- Navigation to groups list on "View All" click

### Get Connected Section

**Purpose:** Horizontal scrollable list of enabled group types.

**Features:**
- Shows enabled group types (Dinner Parties, Teams, Tables, Public Groups)
- Uses dynamic group type names from church settings
- Horizontal scrollable cards
- Navigation to group search on card click

### Latest Message Section

**Purpose:** Displays the most recent church message.

**Features:**
- Shows preview image (or placeholder if missing)
- Shows message notes preview
- "Watch or Listen" section with icons (YouTube, Spotify, Apple Podcast)
- Opens external links via `Linking.openURL()`
- "Message Notes" section with "Read" button
- Handles 404 gracefully (no message)

## Types

**Location:** `features/home/types.ts`

### ChurchSettings

```typescript
interface ChurchSettings {
  id: number;
  dinner_party_enabled: boolean;
  team_enabled: boolean;
  table_enabled: boolean;
  public_group_enabled: boolean;
  custom_group_type_enabled: boolean;
  custom_group_type_name?: string;
  // ... other settings
}
```

### GroupType

```typescript
interface GroupType {
  id: number;
  name: string;
  subtitle: string;
}
```

## Examples

### Using Home Hooks

```typescript
import { useChatRooms, useUserData, useLatestMessage, useChurchSettings, useGroupsNeedingRSVP } from "@/features/home";

function HomeScreen() {
  const { user, church } = useAuth();
  
  const { data: allMessages } = useChatRooms(!!user);
  const { data: userData } = useUserData(!!user);
  const { data: latestMessage } = useLatestMessage(church?.id);
  const { data: churchSettings } = useChurchSettings(church?.id);
  
  const recentMessages = allMessages?.slice(0, 2) || [];
  const userGroups = userData?.group_memberships || [];
  const groupsNeedingRSVP = useGroupsNeedingRSVP(userGroups, userData);
  
  return (
    <ScrollView>
      <NewMessagesSection messages={recentMessages} />
      <GroupRSVPsSection groups={groupsNeedingRSVP.slice(0, 2)} />
      <GetConnectedSection settings={churchSettings} />
      <LatestMessageSection message={latestMessage} />
    </ScrollView>
  );
}
```

## Related Documentation

- [Feature Index](./README.md)
- [Architecture Decision Records](../architecture/decisions/)
- [Routing Guide](../development/ROUTING.md)
- [API Integration Guide](../development/API_INTEGRATION.md)

