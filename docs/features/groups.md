# Groups Feature

## Overview

The Groups feature handles group management, RSVP functionality, group search, and group creation. It provides components, hooks, and utilities for displaying groups, managing RSVPs, and creating new groups.

## Purpose

- Display groups list and group details
- RSVP functionality (Going, Maybe, Not Going)
- Group creation
- Group search
- Member and leader management

## User Flows

### Groups List Flow

1. User navigates to `/groups` → `GroupsScreen` component
2. Screen fetches user groups via `useGroups` hook
3. Groups displayed in `GroupsList` component
4. User can pull to refresh → `useGroupRefresh` hook
5. User clicks group → Navigates to `/groups/[group_id]`

### Group Detail Flow (Member)

1. User navigates to `/groups/[group_id]` → `GroupDetailScreen` component
2. Screen fetches group details via `useGroupDetails` hook
3. Screen checks membership via `isGroupMember` utility
4. **If user is a member:**
   - Group information displayed:
     - Group header with image/placeholder, name, and cadence
     - Description section
     - Next event section with RSVP button
     - Members row with avatars
     - Highlights grid (2x2)
   - User clicks 3-dot menu → `GroupOptionsModal` opens
   - User can:
     - Message Group → Navigate to group chat
     - Leave Group → `useLeaveGroup` hook removes membership
     - Cancel → Close modal
   - User clicks RSVP button → `RSVPModal` opens
   - User selects RSVP status → `useRSVP` hook updates RSVP
   - On success → Group details refreshed

### Group Detail Flow (Non-Member)

1. User navigates to `/groups/[group_id]` → `GroupDetailScreen` component
2. Screen fetches group details via `useGroupDetails` hook (uses `/details/` endpoint)
3. Screen checks membership via `isGroupMember` utility
4. **If user is not a member:**
   - `GroupNonMemberView` component displayed:
     - Group header with image/placeholder, name, and cadence (no menu button)
     - Description section
     - Members row with avatars
     - Highlights grid (2x2)
     - "Join Dinner Party" button fixed at bottom
   - User clicks "Join Dinner Party" button → `useJoinGroup` hook called
   - On success → Group queries invalidated, screen re-renders showing member view
   - On error → Error alert displayed

### Create Group Flow

1. User navigates to `/create-group` → `CreateGroupScreen` component
2. User fills out form → `CreateGroupForm` component
3. User submits → `useCreateGroup` hook creates group
4. On success → User redirected to groups list

### Group Search Flow

1. User navigates to `/dinner-party-search` → `GroupSearchScreen` component
2. **Default view:** All groups are displayed by default (no search required)
3. **Text search:** User enters search query → `useGroupSearch` hook with debouncing (500ms)
4. **Location search:** User clicks location button → Requests location permission → Gets zip code from location → Searches by zip code
5. **Zip code search:** User can enter a 5-digit zip code directly in the search field
6. Search results displayed → `GroupSearchList` component with "ALL GROUPS" header
7. User clicks result → Navigates to group detail

## Route Structure

| Route                  | File                                       | Component                         |
| ---------------------- | ------------------------------------------ | --------------------------------- |
| `/groups`              | `app/groups/index.tsx`                     | `GroupsScreen`                    |
| `/groups/[group_id]`   | `app/groups/[group_id]/index.tsx`          | `GroupDetailScreen`               |
| `/create-group`        | `app/(user)/create-group/index.tsx`        | `CreateGroupScreen`               |
| `/dinner-party-search` | `app/(user)/dinner-party-search/index.tsx` | `GroupSearchScreen`               |
| `/home`                | `app/home/index.tsx`                       | Uses `GroupRsvpSection` component |

## Components

### GroupsScreen

**Location:** `features/groups/components/GroupsScreen.tsx`

**Purpose:** Main groups screen with loading/error states.

**Features:**

- Loading skeleton
- Error handling
- Empty state
- Pull-to-refresh

**Usage:**

```typescript
import { GroupsScreen } from "@/features/groups/components/GroupsScreen";
```

### GroupsList

**Location:** `features/groups/components/GroupsList.tsx`

**Purpose:** Groups list with empty state and pull-to-refresh.

**Features:**

- FlatList with groups
- Pull-to-refresh
- Empty state
- Loading skeleton

**Usage:**

```typescript
import { GroupsList } from "@/features/groups/components/GroupsList";
```

### GroupCard

**Location:** `features/groups/components/GroupCard.tsx`

**Purpose:** Group card with image background and gradient overlay.

**Features:**

- Group image display
- Group title
- Group metadata (members, date)
- Group type badge
- Navigation on press

**Usage:**

```typescript
import { GroupCard } from "@/features/groups/components/GroupCard";
```

### GroupCardSimple

**Location:** `features/groups/components/GroupCardSimple.tsx`

**Purpose:** Simple group card for groups without images.

**Features:**

- Group title
- Group metadata
- Group type badge
- Navigation on press

**Usage:**

```typescript
import { GroupCardSimple } from "@/features/groups/components/GroupCardSimple";
```

### GroupDetailScreen

**Location:** `features/groups/components/GroupDetailScreen.tsx`

**Purpose:** Main group detail screen with redesigned UI matching mock design. Conditionally renders member or non-member view based on membership status.

**Features:**

- **Membership detection:** Uses `isGroupMember` utility to check if current user is a member
- **Conditional rendering:**
  - **Member view:** Shows full group details with RSVP, options menu, etc.
  - **Non-member view:** Shows `GroupNonMemberView` with join button
- **Member view features:**
  - Group header with image/placeholder, name, and cadence overlay
  - Description section
  - Map section (if location is available)
  - Next event section with RSVP button
  - Members row with avatars (leaders highlighted)
  - Highlights grid (2x2)
  - Options modal (Message Group, Leave Group, Cancel)
- **Non-member view features:**
  - Group header (no menu button)
  - Description section
  - Map section (if location is available)
  - Members row with avatars (leaders highlighted)
  - Highlights grid (2x2)
  - "Join Dinner Party" button fixed at bottom

**Usage:**

```typescript
import { GroupDetailScreen } from "@/features/groups/components/GroupDetailScreen";
```

### GroupHeader

**Location:** `features/groups/components/GroupHeader.tsx`

**Purpose:** Group header with image, gradient overlay, name, cadence, back button, and optional menu button.

**Features:**

- Group image with gradient overlay (or grey placeholder)
- Group name (large, white, bold) - always displayed with fallback to "Group"
- Cadence text (e.g., "Wednesdays at 2:31pm") - displayed when schedule data is available
- Back button (top-left)
- 3-dot menu button (top-right, conditionally rendered via `showMenu` prop)
- **Text visibility:** Text color adapts based on whether image is present (white for images, dark for placeholder)
- **Props:**
  - `group` - Group data
  - `onMenuPress` - Optional menu press handler
  - `showMenu` - Optional boolean to show/hide menu button (default: true)

**Usage:**

```typescript
import { GroupHeader } from "@/features/groups/components/GroupHeader";

// With menu button (default)
<GroupHeader group={group} onMenuPress={handleMenuPress} />

// Without menu button (for non-members)
<GroupHeader group={group} showMenu={false} />
```

### GroupOptionsModal

**Location:** `features/groups/components/GroupOptionsModal.tsx`

**Purpose:** Slide-up modal with group options (Message Group, Leave Group, Cancel).

**Features:**

- Slide-up animation
- Message Group button (black background, white text)
- Leave Group button (red background, white text)
- Cancel button (grey background, black text)
- Navigation to group chat
- **Automatic chat creation:** If chat doesn't exist, creates it automatically
- Leave group functionality

**Chat Creation Flow:**

1. Checks for existing dinner party chat room (type 2)
2. If exists, navigates to existing chat
3. If not exists, creates new chat room using `useCreateDinnerPartyChatRoom` hook
4. Navigates to created chat room on success
5. Shows error alert on failure

**Usage:**

```typescript
import { GroupOptionsModal } from "@/features/groups/components/GroupOptionsModal";
```

### NextEventSection

**Location:** `features/groups/components/NextEventSection.tsx`

**Purpose:** Displays next event date with RSVP button.

**Features:**

- Next event date formatting
- RSVP button/status
- Light grey background section

**Usage:**

```typescript
import { NextEventSection } from "@/features/groups/components/NextEventSection";
```

### MembersRow

**Location:** `features/groups/components/MembersRow.tsx`

**Purpose:** Horizontal scrollable row of member avatars with +X count and leader highlighting.

**Features:**

- Horizontal scrollable avatars
- "+X" count for additional members
- **Leader highlighting:** Leaders are displayed first and highlighted with:
  - Blue border around avatar (#007AFF)
  - Small blue badge indicator in top-right corner
- **Deduplication:** Members who are also leaders are not duplicated
- Uses Avatar component
- **Props:**
  - `members` - Array of group members (optional)
  - `leaders` - Array of group leaders (optional)
  - `maxVisible` - Maximum number of avatars to show before "+X" count (default: 10)

**Usage:**

```typescript
import { MembersRow } from "@/features/groups/components/MembersRow";

// With members and leaders
<MembersRow members={group.members} leaders={group.leaders} />

// With only members
<MembersRow members={group.members} />

// With only leaders
<MembersRow leaders={group.leaders} />
```

### GroupMapSection

**Location:** `features/groups/components/GroupMapSection.tsx`

**Purpose:** Displays group location with map icon and option to open in maps app.

**Features:**

- Location display with map icon
- "Open in Maps" button that opens location in native maps app
- **Platform support:**
  - iOS: Opens in Apple Maps
  - Android/Web: Opens in Google Maps
- **Conditional rendering:** Only renders when group has a location
- **Props:**
  - `group` - Group data (must have `location` field)

**Usage:**

```typescript
import { GroupMapSection } from "@/features/groups/components/GroupMapSection";

<GroupMapSection group={group} />;
```

### HighlightsGrid

**Location:** `features/groups/components/HighlightsGrid.tsx`

**Purpose:** 2x2 grid layout for group highlight images.

**Features:**

- 2x2 grid layout
- Rounded corners on images
- Handles image loading and errors
- Placeholder for missing images

**Usage:**

```typescript
import { HighlightsGrid } from "@/features/groups/components/HighlightsGrid";
```

### RSVPSection

**Location:** `features/groups/components/RSVPSection.tsx`

**Purpose:** RSVP section with next meeting date and RSVP status.

**Features:**

- Next meeting display
- RSVP status badge
- RSVP button
- Date formatting

**Usage:**

```typescript
import { RSVPSection } from "@/features/groups/components/RSVPSection";
```

### RSVPModal

**Location:** `features/groups/components/RSVPModal.tsx`

**Purpose:** RSVP modal with Going/Maybe/Not Going options.

**Features:**

- RSVP options (Going, Maybe, Not Going)
- Date display
- Loading states
- Error handling

**Usage:**

```typescript
import { RSVPModal } from "@/features/groups/components/RSVPModal";
```

### MembersList

**Location:** `features/groups/components/MembersList.tsx`

**Purpose:** Members list with "View all" button.

**Features:**

- Member avatars
- Member names
- "View all" button
- Member count

**Usage:**

```typescript
import { MembersList } from "@/features/groups/components/MembersList";
```

### LeadersList

**Location:** `features/groups/components/LeadersList.tsx`

**Purpose:** Leaders list with badges.

**Features:**

- Leader avatars
- Leader names
- Leader badges

**Usage:**

```typescript
import { LeadersList } from "@/features/groups/components/LeadersList";
```

### CreateGroupScreen

**Location:** `features/groups/components/CreateGroupScreen.tsx`

**Purpose:** Main create group screen with header and form.

**Features:**

- Header with back button
- Create group form
- Loading states
- Error handling

**Usage:**

```typescript
import { CreateGroupScreen } from "@/features/groups/components/CreateGroupScreen";
```

### CreateGroupForm

**Location:** `features/groups/components/CreateGroupForm.tsx`

**Purpose:** Form with validation (title, description, location, zip_code).

**Features:**

- Title input
- Description input
- Location input
- Zip code input
- Validation
- Error handling

**Usage:**

```typescript
import { CreateGroupForm } from "@/features/groups/components/CreateGroupForm";
```

### GroupSearchScreen

**Location:** `features/groups/components/GroupSearchScreen.tsx`

**Purpose:** Main search screen with enhanced search bar and location functionality.

**Features:**

- **Modern search bar design:**
  - Magnifying glass icon on the left
  - Location button on the right (triggers location-based search)
  - Placeholder: "Keyword or zip code"
  - Rounded, light gray background
  - Uses `ProgrammaticTextInput` for web compatibility
- **Location search:**
  - Requests location permissions
  - Gets current location
  - Reverse geocodes to extract zip code
  - Automatically searches by zip code
- **Header:** "Group Search" title
- **Default view:** Shows all groups by default (no search required)
- Search results list
- Loading states
- Empty state

**Usage:**

```typescript
import { GroupSearchScreen } from "@/features/groups/components/GroupSearchScreen";
```

### GroupSearchList

**Location:** `features/groups/components/GroupSearchList.tsx`

**Purpose:** Results list with "ALL GROUPS" header, loading and empty states.

**Features:**

- **"ALL GROUPS" section header:** Uppercase, light gray text above the list
- **Default display:** Shows all groups when no search query
- Search results display
- Loading skeleton
- Empty state (when searching with no results)
- Navigation to group detail

**Usage:**

```typescript
import { GroupSearchList } from "@/features/groups/components/GroupSearchList";
```

### GroupSearchItem

**Location:** `features/groups/components/GroupSearchItem.tsx`

**Purpose:** Individual group item in search results with modern card design.

**Features:**

- **Horizontal layout:**
  - **Left side:** Square group image (80x80) or colored placeholder with initials
  - **Right side:** Group information
    - Category label (e.g., "Team", "Community Group", "Dinner Party") - light gray, small, uppercase
    - Group name - bold, dark text
    - Schedule (e.g., "Sundays at 10:00am") - light gray, small text (formatted via `formatCadence`)
    - Member avatars row:
      - Shows up to 6 member avatars horizontally
      - Overlapping avatars with count badge (e.g., "+557") if more members exist
      - Uses `Avatar` component from `components/ui/Avatar.tsx`
- **Styling:**
  - White background card with rounded corners
  - Proper shadows and elevations
  - Modern spacing and typography
- Navigation on press

**Usage:**

```typescript
import { GroupSearchItem } from "@/features/groups/components/GroupSearchItem";
```

### GroupRsvpSection

**Location:** `features/groups/components/GroupRsvpSection.tsx`

**Purpose:** RSVP section for home page.

**Features:**

- Upcoming group meetings
- RSVP status
- Navigation to group detail

**Usage:**

```typescript
import { GroupRsvpSection } from "@/features/groups/components/GroupRsvpSection";
```

### MessagesSection

**Location:** `features/groups/components/MessagesSection.tsx`

**Purpose:** Messages section for group detail page.

**Features:**

- Group messages display
- Navigation to chat

**Usage:**

```typescript
import { MessagesSection } from "@/features/groups/components/MessagesSection";
```

### GroupNonMemberView

**Location:** `features/groups/components/GroupNonMemberView.tsx`

**Purpose:** View displayed when user is not a member of a group. Shows group information with a dynamic join button.

**Features:**

- Group header (without menu button)
- Description section
- Map section (if location is available)
- Members row with avatars (leaders highlighted)
- Highlights grid (2x2)
- Join button fixed at bottom (via `JoinGroupButton` component) - text changes based on group type (e.g., "Join Dinner Party", "Join Team", "Join Table")
- Loading state when joining

**Props:**

- `group` - Group data
- `onJoinPress` - Join button press handler
- `isJoining` - Optional boolean indicating join is in progress

**Usage:**

```typescript
import { GroupNonMemberView } from "@/features/groups/components/GroupNonMemberView";

<GroupNonMemberView
  group={group}
  onJoinPress={handleJoinGroup}
  isJoining={isJoining}
/>;
```

### JoinGroupButton

**Location:** `features/groups/components/JoinGroupButton.tsx`

**Purpose:** Fixed bottom button for joining a group. Matches screenshot design with dark grey background. Button text dynamically changes based on group type.

**Features:**

- Dark grey button (#4A4A4A) matching screenshot design
- Full width with rounded corners
- Fixed position at bottom of screen
- Loading state with activity indicator
- Disabled state when joining
- **Dynamic button text:** Changes based on group type (e.g., "Join Dinner Party", "Join Team", "Join Table")
- Uses `getGroupTypeLabel` to get the correct label from church settings

**Props:**

- `onPress` - Button press handler
- `isPending` - Optional boolean indicating join is in progress
- `group` - Optional group data to determine button text (if not provided, defaults to "Join Dinner Party")

**Usage:**

```typescript
import { JoinGroupButton } from "@/features/groups/components/JoinGroupButton";

<JoinGroupButton onPress={handleJoin} isPending={isJoining} group={group} />;
```

## Hooks

### useGroups

**Location:** `features/groups/hooks/useGroups.ts`

**Purpose:** Fetches user groups via `getUserByToken()`, extracts groups from memberships.

**Returns:**

- `data` - Groups array
- `isLoading` - Loading state
- `error` - Error state
- `refetch` - Refetch function

**Usage:**

```typescript
import { useGroups } from "@/features/groups/hooks/useGroups";

const { data: groups, isLoading, error } = useGroups(user);
```

### useGroupDetails

**Location:** `features/groups/hooks/useGroupDetails.ts`

**Purpose:** Fetches group details via `getDPDetails()`.

**Returns:**

- `data` - Group details
- `isLoading` - Loading state
- `error` - Error state
- `refetch` - Refetch function

**Usage:**

```typescript
import { useGroupDetails } from "@/features/groups/hooks/useGroupDetails";

const { data: group, isLoading, error } = useGroupDetails(groupId);
```

### useRSVP

**Location:** `features/groups/hooks/useRSVP.ts`

**Purpose:** Handles RSVP mutations with query invalidation.

**Returns:**

- `mutate` - RSVP mutation function
- `isLoading` - Loading state
- `error` - Error state

**Usage:**

```typescript
import { useRSVP } from "@/features/groups/hooks/useRSVP";

const { mutate: updateRSVP, isLoading, error } = useRSVP();

updateRSVP({ dinner: groupId, modes: mode, date: groupDate });
```

### useGroupRefresh

**Location:** `features/groups/hooks/useGroupRefresh.ts`

**Purpose:** Handles pull-to-refresh logic.

**Returns:**

- `refreshing` - Refreshing state
- `onRefresh` - Refresh function

**Usage:**

```typescript
import { useGroupRefresh } from "@/features/groups/hooks/useGroupRefresh";

const { refreshing, onRefresh } = useGroupRefresh();
```

### useCreateGroup

**Location:** `features/groups/hooks/useCreateGroup.ts`

**Purpose:** Handles group creation mutation with query invalidation.

**Returns:**

- `mutate` - Create group mutation function
- `isLoading` - Loading state
- `error` - Error state

**Usage:**

```typescript
import { useCreateGroup } from "@/features/groups/hooks/useCreateGroup";

const { mutate: createGroup, isLoading, error } = useCreateGroup();

createGroup({ title, description, location, zip_code });
```

### useGroupSearch

**Location:** `features/groups/hooks/useGroupSearch.ts`

**Purpose:** Handles search query state with debouncing, supports text search, zip code search, and fetching all groups by default.

**Returns:**

- `searchQuery`, `setSearchQuery` - Search query state
- `debouncedQuery` - Debounced search query (500ms delay)
- `groupsList` - Search results (all groups by default)
- `isLoading` - Loading state
- `error` - Error state
- `zipCode`, `setZipCode` - Zip code state for location search

**Features:**

- **Default behavior:** Fetches all groups when no search query and no zip code
- **Text search:** Searches by group name/title
- **Zip code detection:** Automatically detects 5-digit zip codes in search query
- **Location search:** Supports zip code parameter for location-based search
- **Debouncing:** 500ms delay to prevent excessive API calls

**Usage:**

```typescript
import { useGroupSearch } from "@/features/groups/hooks/useGroupSearch";

const {
  searchQuery,
  setSearchQuery,
  debouncedQuery,
  groupsList,
  isLoading,
  error,
  zipCode,
  setZipCode,
} = useGroupSearch();
```

### useLeaveGroup

**Location:** `features/groups/hooks/useLeaveGroup.ts`

**Purpose:** Handles leaving a group mutation with query invalidation and navigation.

**Returns:**

- `mutate` - Leave group mutation function
- `isLoading` - Loading state
- `error` - Error state

**Usage:**

```typescript
import { useLeaveGroup } from "@/features/groups/hooks/useLeaveGroup";

const { mutate: leaveGroup, isLoading, error } = useLeaveGroup(groupId);

leaveGroup();
```

### useJoinGroup

**Location:** `features/groups/hooks/useJoinGroup.ts`

**Purpose:** Handles joining a group mutation with query invalidation. Uses `requestToJoinDP` API and automatically refreshes group data on success.

**Returns:**

- `mutate` - Join group mutation function
- `isPending` - Loading state
- `error` - Error state

**Mutation Data:**

- `user` - User ID
- `dinnerGroup` - Group ID

**Query Invalidation:**

- Invalidates group details query on success
- Invalidates user groups query on success
- Automatically refreshes group data to show member view

**Error Handling:**

- Shows error alert on failure
- Displays error message from API response

**Usage:**

```typescript
import { useJoinGroup } from "@/features/groups/hooks/useJoinGroup";

const { mutate: joinGroup, isPending, error } = useJoinGroup(groupId);

joinGroup(
  {
    user: userId,
    dinnerGroup: groupId,
  },
  {
    onSuccess: () => {
      // Group data will be automatically refreshed
    },
  }
);
```

## API Endpoints

**Location:** `features/groups/services/groups.api.ts`

The groups service re-exports from the main API modules:

```typescript
import { groupsApi, chatApi, membersApi } from "../../../services/api";

export const groupsFeatureApi = {
  // Group methods
  getGroups: groupsApi.getGroups,
  getGroup: groupsApi.getGroup,
  getDPDetails: groupsApi.getDPDetails,
  getAllDinnerParties: groupsApi.getAllDinnerParties,
  createDinnerParty: groupsApi.createDinnerParty,
  updateDinnerParty: groupsApi.updateDinnerParty,
  removeDinnerParty: groupsApi.removeDinnerParty,
  requestToJoinDP: groupsApi.requestToJoinDP,
  removeMemberFromDP: groupsApi.removeMemberFromDP,
  setLeaderDP: groupsApi.setLeaderDP,

  // Chat methods (for messages section)
  getAllRooms: chatApi.getAllRooms,

  // Member methods
  getUserByToken: membersApi.getUserByToken,
  voteRSVP: membersApi.voteRSVP,

  // Create Group methods
  createPublicGroup: groupsApi.createPublicGroup,

  // Search methods
  searchGroups: groupsApi.searchGroups,

  // Get all groups (for default view)
  getGroups: groupsApi.getGroups,
};
```

**Available Methods:**

- `getDPDetails(groupId)` - Get group details
- `getUserByToken()` - Get user data (includes groups)
- `voteRSVP(data)` - Update RSVP status
- `createPublicGroup(data)` - Create new group
- `searchGroups(params)` - Search for groups (supports `search`, `title`, and `zip` parameters)
- `getGroups()` - Get all groups (for default view)

## Utilities

### formatNextMeeting

**Location:** `features/groups/utils/formatNextMeeting.ts`

**Purpose:** Formats date as "Today at X:XX", "Tomorrow at X:XX", or "MMM d, h:mm a".

**Usage:**

```typescript
import { formatNextMeeting } from "@/features/groups/utils/formatNextMeeting";

const formatted = formatNextMeeting(date);
// "Today at 7:00 PM" or "Tomorrow at 7:00 PM" or "Jan 15, 7:00 PM"
```

### formatDateDisplay

**Location:** `features/groups/utils/formatDateDisplay.ts`

**Purpose:** Formats date for detailed display.

**Usage:**

```typescript
import { formatDateDisplay } from "@/features/groups/utils/formatDateDisplay";

const formatted = formatDateDisplay(date);
```

### getGroupTypeLabel

**Location:** `features/groups/utils/getGroupTypeLabel.ts`

**Purpose:** Returns group type label based on type number and church settings.

**Usage:**

```typescript
import { getGroupTypeLabel } from "@/features/groups/utils/getGroupTypeLabel";

const label = getGroupTypeLabel(type, churchSettings);
// "Dinner Parties", "Teams", "Tables", etc.
```

### getGroupTypeColors

**Location:** `features/groups/utils/getGroupTypeColors.ts`

**Purpose:** Returns color scheme for group type.

**Usage:**

```typescript
import { getGroupTypeColors } from "@/features/groups/utils/getGroupTypeColors";

const colors = getGroupTypeColors(type);
// { bg: "#FF5733", color: "#FFFFFF" }
```

### extractGroupsFromMemberships

**Location:** `features/groups/utils/extractGroupsFromMemberships.ts`

**Purpose:** Extracts groups from memberships array.

**Usage:**

```typescript
import { extractGroupsFromMemberships } from "@/features/groups/utils/extractGroupsFromMemberships";

const groups = extractGroupsFromMemberships(memberships);
```

### debounceSearch

**Location:** `features/groups/utils/debounceSearch.ts`

**Purpose:** Generic debounce utility for search.

**Usage:**

```typescript
import { debounceSearch } from "@/features/groups/utils/debounceSearch";

const debouncedSearch = debounceSearch((query) => {
  // Search logic
}, 300);
```

### formatCadence

**Location:** `features/groups/utils/formatCadence.ts`

**Purpose:** Formats group schedule/cadence for display (e.g., "Wednesdays at 2:31pm").

**Usage:**

```typescript
import { formatCadence } from "@/features/groups/utils/formatCadence";

const cadence = formatCadence(group);
// "Wednesdays at 2:31pm" or null
```

### isGroupMember

**Location:** `features/groups/utils/isGroupMember.ts`

**Purpose:** Utility function to check if a user is a member of a group by comparing user ID with group members array.

**Parameters:**

- `group` - Group data (DinnerGroup or null/undefined)
- `userId` - User ID to check (number or null/undefined)

**Returns:**

- `true` if user is a member of the group
- `false` if user is not a member, group is null/undefined, userId is null/undefined, or members array is empty/undefined

**Usage:**

```typescript
import { isGroupMember } from "@/features/groups/utils/isGroupMember";

const isMember = isGroupMember(group, user?.id);
// true if user is in group.members array, false otherwise
```

## Types

**Location:** `features/groups/types.ts`

### RSVPStatus

```typescript
type RSVPStatus = 0 | 1 | 2 | null;
// 0: Going
// 1: Maybe
// 2: Not Going
// null: Not Set
```

### GroupType

```typescript
enum GroupType {
  DINNER_PARTY = 1,
  TEAM = 2,
  PUBLIC_GROUP = 3,
  TABLE = 4,
}
```

### GroupTypeColors

```typescript
interface GroupTypeColors {
  bg: string;
  color: string;
}
```

### DinnerGroup

```typescript
interface DinnerGroup {
  id: number;
  title?: string;
  name?: string;
  type: number;
  date?: string;
  next_meeting_date?: string;
  next_meeting_date_created_at?: string;
  preview?: string;
  image_url?: string;
  description?: string;
  table_description?: string;
  location?: string;
  members_count?: number;
  is_new?: boolean;
  status?: number;
  rsvp?: RSVPStatus;
  rsvp_mode?: RSVPStatus;
  members?: GroupMember[];
  leaders?: GroupMember[];
  highlights?: GroupHighlight[];
  group_schedule_details?: GroupScheduleDetails;
  group_schedule?: GroupScheduleDetails;
  day?: number;
  start_time?: string;
}
```

### GroupHighlight

```typescript
interface GroupHighlight {
  id: number;
  image_url?: string;
  width?: number;
  height?: number;
  created_at?: string;
}
```

### GroupScheduleDetails

```typescript
interface GroupScheduleDetails {
  id?: number;
  first_meeting_date?: string;
  repeat_period?: number;
  repeat_value?: number;
  status?: number;
  created_at?: string;
  updated_at?: string;
}
```

### GroupMember

```typescript
interface GroupMember {
  id: number;
  first_name: string;
  last_name: string;
  email?: string;
  profile_photo?: string;
}
```

### GroupMembership

```typescript
interface GroupMembership {
  id: number;
  dinner_group: DinnerGroup;
  rsvpMode: number; // 0: Not Going, 1: Going, 2: Maybe/Not Set
}
```

## Examples

### Using Groups Hook

```typescript
import { useGroups } from "@/features/groups/hooks/useGroups";

function GroupsList() {
  const { data: groups, isLoading, error } = useGroups(user);

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

### Using RSVP Hook

```typescript
import { useRSVP } from "@/features/groups/hooks/useRSVP";

function RSVPButton({ groupId, groupDate }) {
  const { mutate: updateRSVP, isLoading } = useRSVP();

  const handleRSVP = (mode) => {
    updateRSVP({
      dinner: groupId,
      modes: mode,
      date: groupDate,
    });
  };

  return (
    <Button onPress={() => handleRSVP(1)} disabled={isLoading}>
      Going
    </Button>
  );
}
```

## Related Documentation

- [Feature Index](./README.md)
- [Architecture Decision Records](../architecture/decisions/)
- [Routing Guide](../development/ROUTING.md)
- [API Integration Guide](../development/API_INTEGRATION.md)
