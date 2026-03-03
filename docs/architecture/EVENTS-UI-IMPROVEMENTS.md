# Events UI Improvements - Implementation Plan

This document outlines the implementation plan for events feature improvements. It serves as a checklist for LLMs to implement, test, and continue work.

## Overview

Changes span three main areas:
1. **Chat RSVP behavior** - Loading states, link rendering, composer preview
2. **Event creation flow** - Send-to-chat popup logic
3. **Event details page** - UI improvements, guest list, floating RSVP

---

## Key Files Reference

### Chat Components
- `apps/mobile/features/chat/components/EventLinkCard.tsx` - RSVP card in chat
- `apps/mobile/features/chat/components/CustomMessage.tsx` - Message rendering, link detection
- `apps/mobile/features/chat/components/ChatRoomScreen.tsx` - Chat room with composer
- `apps/mobile/features/chat/components/CustomSendButton.tsx` - Send button

### Event Components
- `apps/mobile/features/leader-tools/components/CreateEventScreen.tsx` - Event create/edit form
- `apps/mobile/features/leader-tools/components/EventDetails.tsx` - Event details page
- `apps/mobile/app/(user)/leader-tools/[group_id]/events/[event_id]/index.tsx` - Event details route

### Backend
- `apps/api-trpc/src/routers/groups/meetings.ts` - Event CRUD operations
- `apps/api-trpc/src/routers/groups/meetings-rsvp.ts` - RSVP operations
- `apps/api-trpc/src/routers/groups/helpers/postEventToChat.ts` - Send event to chat

### Shared
- `apps/mobile/components/ui/Avatar.tsx` - Avatar with placeholder

---

## Implementation Checklist

### Phase 1: Chat RSVP Loading Spinner

**Goal:** Show loading spinner on specific RSVP option when tapped in chat cards

**File:** `apps/mobile/features/chat/components/EventLinkCard.tsx`

- [ ] **1.1** Add loading state tracking for individual RSVP options
  ```typescript
  const [loadingOptionId, setLoadingOptionId] = useState<number | null>(null);
  ```

- [ ] **1.2** Update RSVP submission handler to set loading state
  ```typescript
  const handleRsvpSelect = async (optionId: number) => {
    setLoadingOptionId(optionId);
    try {
      await submitRsvp.mutateAsync({ ... });
    } finally {
      setLoadingOptionId(null);
    }
  };
  ```

- [ ] **1.3** Replace radio button with `ActivityIndicator` when loading
  - Show spinner where the radio circle normally appears
  - Keep other options enabled (user can tap different option)
  - Use app's primary purple color (#8C10FE) for spinner

- [ ] **1.4** Test scenarios:
  - Tap RSVP option → spinner shows on that option only
  - Tap different option while loading → new spinner replaces old
  - Success → spinner disappears, selection updates
  - Error → spinner disappears, show error feedback

---

### Phase 2: Event Link Display (Hide Link Text, Show Only Card)

**Goal:** When `{your-domain}/e/[short_id]` link is detected, show only the card (not link text)

**File:** `apps/mobile/features/chat/components/CustomMessage.tsx`

- [ ] **2.1** Modify `CustomMessageContent` to strip event links from displayed text
  ```typescript
  const EVENT_LINK_REGEX = /(?:https?:\/\/)?{your-domain}\/e\/([a-zA-Z0-9]+)/g; // domain configured in domain.ts

  // Remove event links from text for display
  const textWithoutEventLinks = message.text?.replace(EVENT_LINK_REGEX, '').trim();
  ```

- [ ] **2.2** Update rendering logic:
  - If message has text (after stripping links) → show text + card below as attachment
  - If message is ONLY the link (empty after stripping) → show only card, no text bubble
  - Handle multiple event links in one message (each gets its own card)

- [ ] **2.3** Adjust message bubble styling:
  - When card-only: no text bubble, just the card
  - When text + card: normal text bubble, card appears below

- [ ] **2.4** Test scenarios:
  - Message with only event link → shows only card
  - Message with "Check this out: [link]" → shows "Check this out:" + card below
  - Message with multiple links → shows text (links removed) + multiple cards
  - Regular messages (no event links) → unchanged behavior

---

### Phase 3: Composer Event Link Preview

**Goal:** Show inline card preview in composer when event link is typed/pasted

**Files:**
- `apps/mobile/features/chat/components/ChatRoomScreen.tsx`
- New: `apps/mobile/features/chat/components/EventLinkPreview.tsx`

- [ ] **3.1** Create `EventLinkPreview` component
  ```typescript
  // Props: shortId, onDismiss
  // Renders: Compact event card preview with X button
  // Uses: Same data fetch as EventLinkCard but simplified display
  ```

- [ ] **3.2** Add state to track detected event link in composer
  ```typescript
  const [previewEventShortId, setPreviewEventShortId] = useState<string | null>(null);
  ```

- [ ] **3.3** Monitor text input for event links
  - Use `onChangeText` or message composer state from Stream
  - Detect `{your-domain}/e/[short_id]` pattern (domain from domain.ts)
  - Extract shortId and set preview state

- [ ] **3.4** Render preview inline (replacing link text visually)
  - Show compact card with event title, date, image thumbnail
  - X button in corner to dismiss
  - Preview appears where the link text would be

- [ ] **3.5** Handle dismiss (X button):
  - Remove the link from the text input entirely
  - Clear preview state
  - User must re-paste to add it back

- [ ] **3.6** Handle send:
  - Send the message with original link text intact
  - Stream processes it, recipient sees card (from Phase 2)

- [ ] **3.7** Test scenarios:
  - Paste event link → preview appears inline
  - Type event link character by character → preview appears when complete
  - Tap X → link removed from input, preview disappears
  - Send message with preview → recipient sees card
  - Multiple links → show multiple previews (or first only - design decision)

---

### Phase 4: Send-to-Chat Popup (Create Only)

**Goal:** Only show "send to chat" popup when creating new events, not when updating

**File:** `apps/mobile/features/leader-tools/components/CreateEventScreen.tsx`

- [ ] **4.1** Locate the `showPostToChatDialog` calls (lines ~165-193)

- [ ] **4.2** Modify update mutation `onSuccess`:
  ```typescript
  // Before: showPostToChatDialog(meetingId!, false)
  // After: Just navigate back without dialog
  onSuccess: () => {
    router.back();
  }
  ```

- [ ] **4.3** Keep create mutation `onSuccess` unchanged (still shows dialog)

- [ ] **4.4** Test scenarios:
  - Create new event → dialog appears asking to post to chat
  - Edit existing event → no dialog, returns to previous screen
  - Verify event updates are saved correctly without dialog

---

### Phase 5: Event Details - Placeholder Image

**Goal:** Show grey box with calendar icon when event has no image

**File:** `apps/mobile/features/leader-tools/components/EventDetails.tsx`

- [ ] **5.1** Create placeholder component (or inline JSX)
  ```typescript
  // Grey background (#E5E5E5 or similar)
  // Centered calendar icon (use existing icon library)
  // Same aspect ratio/height as normal cover images
  ```

- [ ] **5.2** Update cover image section:
  ```typescript
  {meeting.coverImage ? (
    <Image source={{ uri: getMediaUrl(meeting.coverImage) }} ... />
  ) : (
    <View style={styles.imagePlaceholder}>
      <CalendarIcon color="#9CA3AF" size={48} />
    </View>
  )}
  ```

- [ ] **5.3** Match styling from chat card placeholder (reference `EventLinkCard.tsx`)

- [ ] **5.4** Test scenarios:
  - Event with image → image displays
  - Event without image → grey placeholder with calendar icon
  - Verify placeholder has correct dimensions

---

### Phase 6: Event Details - Group Info & Image

**Goal:** Ensure group/community info shows for all event types with proper image loading

**File:** `apps/mobile/features/leader-tools/components/EventDetails.tsx`

- [ ] **6.1** Verify group info section renders for all visibility types:
  - `public` events
  - `community` events
  - `group` events (already working)

- [ ] **6.2** Fix group image loading:
  ```typescript
  // Current: May show grey circle placeholder
  // Fix: Use Avatar component or proper Image with fallback
  <Avatar
    name={meeting.group.name}
    imageUrl={meeting.group.image}
    size={48}
  />
  ```

- [ ] **6.3** Ensure community name displays below group name

- [ ] **6.4** Test scenarios:
  - Group event → shows group image/name + community name
  - Community event → shows group image/name + community name
  - Public event → shows group image/name + community name
  - Group with no image → shows initial placeholder

---

### Phase 7: Event Details - Location Map Action

**Goal:** Tapping location opens Apple Maps / Google Maps picker

**File:** `apps/mobile/features/leader-tools/components/EventDetails.tsx`

- [ ] **7.1** Make location row pressable:
  ```typescript
  <Pressable onPress={handleLocationPress}>
    <LocationIcon />
    <Text>{meeting.locationOverride}</Text>
  </Pressable>
  ```

- [ ] **7.2** Implement `handleLocationPress`:
  ```typescript
  import { ActionSheetIOS, Alert, Linking, Platform } from 'react-native';

  const handleLocationPress = () => {
    const address = encodeURIComponent(meeting.locationOverride);
    const appleMapsUrl = `maps://maps.apple.com/?q=${address}`;
    const googleMapsUrl = `https://www.google.com/maps/search/?api=1&query=${address}`;

    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options: ['Cancel', 'Open in Apple Maps', 'Open in Google Maps'],
          cancelButtonIndex: 0,
        },
        (buttonIndex) => {
          if (buttonIndex === 1) Linking.openURL(appleMapsUrl);
          if (buttonIndex === 2) Linking.openURL(googleMapsUrl);
        }
      );
    } else {
      Alert.alert('Open Location', 'Choose an app', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Google Maps', onPress: () => Linking.openURL(googleMapsUrl) },
      ]);
    }
  };
  ```

- [ ] **7.3** Add visual affordance (chevron icon or subtle styling to indicate tappable)

- [ ] **7.4** Test scenarios:
  - iOS: Tap location → ActionSheet with Apple Maps / Google Maps options
  - Android: Tap location → Alert with Google Maps option
  - Verify URLs open correct apps with location query

---

### Phase 8: Event Details - Guest List Section

**Goal:** Add guest list section below description with avatar preview and access control

**Files:**
- `apps/mobile/features/leader-tools/components/EventDetails.tsx`
- New: `apps/mobile/features/leader-tools/components/GuestListSection.tsx`
- New: `apps/mobile/app/(user)/leader-tools/[group_id]/events/[event_id]/guests.tsx`

#### 8A: Guest List Preview Section

- [ ] **8.1** Create `GuestListSection` component:
  ```typescript
  interface Props {
    eventId: string;
    groupId: string;
    totalGoing: number;
    topGuests: Array<{ id: string; firstName: string; profileImage?: string }>;
    userHasRsvpd: boolean;
    isGroupLeader: boolean;
    onViewAll: () => void;
  }
  ```

- [ ] **8.2** Layout:
  ```
  ┌─────────────────────────────────────────┐
  │ Guest List                    View all  │
  │ 14 Going                                │
  │ [👤][👤][👤][👤][👤][👤] +8             │
  └─────────────────────────────────────────┘
  ```

- [ ] **8.3** Avatar stack implementation:
  - Show up to 6 avatars, overlapping slightly (negative margin)
  - Use `Avatar` component with proper fallback
  - "+N" badge for overflow count

- [ ] **8.4** Position below description in EventDetails

#### 8B: Guest List Full Page

- [ ] **8.5** Create guest list route:
  ```
  apps/mobile/app/(user)/leader-tools/[group_id]/events/[event_id]/guests.tsx
  ```

- [ ] **8.6** Implement access control:
  ```typescript
  // Check if user can view full list
  const canViewGuestList = userHasRsvpd || isGroupLeader;

  if (!canViewGuestList) {
    // Show restricted access modal over blurred list
  }
  ```

- [ ] **8.7** Restricted Access Modal (Partiful-style):
  ```
  ┌─────────────────────────────────────┐
  │            🔒                       │
  │      Restricted Access              │
  │                                     │
  │  Only RSVP'd guests can view        │
  │  event activity & see who's going   │
  │                                     │
  │  ┌─────────────────────────────┐    │
  │  │          RSVP               │    │
  │  └─────────────────────────────┘    │
  │  ┌─────────────────────────────┐    │
  │  │    ⏰ Remind me later       │    │
  │  └─────────────────────────────┘    │
  │                                     │
  │  ℹ️ Not sure? Pick "Maybe"          │
  └─────────────────────────────────────┘
  ```

- [ ] **8.8** Full guest list layout (when authorized):
  - List of all RSVP'd users
  - Grouped by response type (Going, Maybe, Can't Go)
  - Each row: Avatar + Name + Response badge

- [ ] **8.9** Backend check for leader status:
  - May need to pass `isGroupLeader` from parent or fetch separately
  - Leaders always bypass the RSVP requirement

- [ ] **8.10** Test scenarios:
  - User not RSVP'd, not leader → sees preview, restricted modal on tap
  - User RSVP'd → sees preview, full list on tap
  - Group leader not RSVP'd → sees preview, full list on tap (bypass)
  - RSVP from modal → modal dismisses, list becomes visible

---

### Phase 9: Event Details - Floating RSVP Buttons

**Goal:** Partiful-style floating RSVP circles at bottom, replaced by status card after RSVP

**File:** `apps/mobile/features/leader-tools/components/EventDetails.tsx`

#### 9A: Floating RSVP Circles (Before RSVP)

- [ ] **9.1** Create floating container:
  ```typescript
  // Position: absolute, bottom with safe area inset
  // Background: semi-transparent blur or solid
  // Content: 3 circular buttons
  ```

- [ ] **9.2** Circular button design (Partiful-style):
  ```typescript
  // Each button:
  // - Circular shape (~60-70px diameter)
  // - Gradient or solid color background
  // - Emoji centered (👍 🤔 😢)
  // - Label below ("Going", "Maybe", "Can't Go")

  // Colors (adapt to app theme):
  // Going: Blue/Purple gradient
  // Maybe: Orange/Amber gradient
  // Can't Go: Grey/Dark gradient
  ```

- [ ] **9.3** Layout: 3 buttons horizontally centered with spacing

- [ ] **9.4** Tap handler: Submit RSVP, show loading state, then transition to card

#### 9B: Floating Status Card (After RSVP)

- [ ] **9.5** Create status card component:
  ```
  ┌─────────────────────────────────────────┐
  │ 👍  Going                         ✏️ 💬 │
  │     Edit your RSVP                      │
  └─────────────────────────────────────────┘
  ```

- [ ] **9.6** Card elements:
  - Left: Emoji matching their response
  - Center: Response text + "Edit your RSVP" subtitle
  - Right: Action icons (edit, message?)

- [ ] **9.7** Tap behavior: Opens RSVP options to change response

- [ ] **9.8** Always visible: Card stays at bottom while scrolling (not dismissible)

#### 9C: Integration

- [ ] **9.9** Conditionally render based on RSVP status:
  ```typescript
  const { data: myRsvp } = trpc.groups.meetings.rsvp.myRsvp.useQuery(...);

  // In render:
  {myRsvp?.optionId ? (
    <FloatingRsvpCard response={myRsvp} onEdit={openRsvpSheet} />
  ) : (
    <FloatingRsvpButtons onSelect={handleRsvpSelect} />
  )}
  ```

- [ ] **9.10** Remove or hide existing inline RSVP section (avoid duplicate UI)

- [ ] **9.11** Handle loading/transition states smoothly

- [ ] **9.12** Test scenarios:
  - User not RSVP'd → sees 3 floating circles
  - Tap "Going" → loading, then card appears showing "Going"
  - Tap card → can change RSVP
  - Change to "Maybe" → card updates to show "Maybe"
  - Scroll page → floating element stays visible at bottom
  - Past events → floating UI may be hidden or disabled

---

## Testing Strategy

### Manual Testing Checklist

```markdown
## Chat RSVP
- [ ] Tap RSVP option in chat → spinner on that option
- [ ] RSVP completes → spinner gone, option selected
- [ ] Event link only → shows card, no link text
- [ ] Event link in sentence → shows sentence (no link) + card below
- [ ] Paste link in composer → inline preview appears
- [ ] Tap X on preview → link removed from input
- [ ] Send with preview → recipient sees card

## Event Creation
- [ ] Create event → "Post to chat?" dialog appears
- [ ] Edit event → no dialog, returns directly

## Event Details Page
- [ ] Event with no image → grey placeholder with calendar icon
- [ ] Group image loads correctly
- [ ] Group with no image → initial placeholder
- [ ] Community/public events show group info
- [ ] Tap location → Apple Maps / Google Maps options
- [ ] Guest list preview shows avatars + count
- [ ] Non-RSVP'd user taps guest list → restricted modal
- [ ] RSVP'd user taps guest list → sees full list
- [ ] Leader (not RSVP'd) taps guest list → sees full list
- [ ] Not RSVP'd → floating circles visible
- [ ] After RSVP → floating card visible
- [ ] Tap floating card → can edit RSVP
- [ ] Scroll → floating element stays at bottom
```

### Automated Tests

- [ ] Update `EventDetails.test.tsx` for new components
- [ ] Add tests for `GuestListSection` component
- [ ] Add tests for `EventLinkPreview` component
- [ ] Add tests for floating RSVP state transitions

---

## Dependencies & Order

Recommended implementation order (phases can be parallelized within groups):

```
Group 1 (Independent - can parallelize):
├── Phase 1: Chat RSVP Loading Spinner
├── Phase 4: Send-to-Chat Popup
├── Phase 5: Event Details Placeholder Image
├── Phase 6: Event Details Group Info
└── Phase 7: Event Details Location Action

Group 2 (Depends on Group 1 chat work):
├── Phase 2: Event Link Display
└── Phase 3: Composer Preview

Group 3 (Can start after Phase 5-6):
├── Phase 8: Guest List Section
└── Phase 9: Floating RSVP Buttons
```

---

## Design References

### Colors (App Theme)
- Primary Purple: `#8C10FE`
- Secondary Purple: `#9333EA`
- Grey Placeholder: `#E5E5E5`
- Text Primary: `#111827`
- Text Secondary: `#6B7280`

### RSVP Emojis
- Going: 👍
- Maybe: 🤔
- Can't Go: 😢

### Partiful Reference
The floating RSVP buttons and guest list UI should mimic Partiful's design:
- Circular buttons with gradient backgrounds
- Emoji + label layout
- Blurred restricted access modal
- Compact post-RSVP card

---

## Notes for Future LLMs

1. **Read before editing**: Always read the target file first to understand current implementation
2. **Check Stream Chat SDK**: Some chat features may require understanding Stream's component props
3. **Test on iOS Simulator**: Use the iOS simulator MCP tools to verify UI changes
4. **Commit frequently**: Make atomic commits after each phase/sub-task
5. **Use existing patterns**: Reference `Avatar.tsx` for placeholder patterns, existing modals for styling
6. **Backend changes**: Most changes are frontend-only, but guest list access control may need API updates

---

## Completion Tracking

| Phase | Description | Status |
|-------|-------------|--------|
| 1 | Chat RSVP Loading Spinner | ⬜ Not Started |
| 2 | Event Link Display | ⬜ Not Started |
| 3 | Composer Event Link Preview | ⬜ Not Started |
| 4 | Send-to-Chat Popup | ⬜ Not Started |
| 5 | Event Details Placeholder | ✅ Completed |
| 6 | Event Details Group Info | ✅ Completed |
| 7 | Location Map Action | ✅ Completed |
| 8 | Guest List Section | ✅ Completed |
| 9 | Floating RSVP Buttons | ✅ Completed |

### Implementation Notes (2025-12-23)

**Phase 5 & 6 - Event Details Placeholder & Group Info:**
- Already had placeholder image with calendar icon
- Replaced Image component with Avatar component for GROUP image (not community logo)
- Avatar provides fallback to initials when image fails/missing
- **Backend changes:** Updated `meetings.ts` to include `groupImage` from `meeting.group.preview`
- **Backend changes:** Added `preview` to group select in Prisma query
- **Frontend:** Changed to use `event.groupImage` instead of `event.communityLogo`
- **Avatar fix:** Fixed `components/ui/Avatar.tsx` to properly handle image load errors with `imageError` state

**Phase 7 - Location Map Action:**
- Made location row tappable
- Shows ActionSheet on iOS with Apple Maps/Google Maps options
- Shows Alert on Android with Google Maps option
- Added visual affordance (purple color, external link icon)

**Phase 8 - Guest List Section:**
- Added `GuestListSection` component
- Shows "Guest List" header with "View all" button
- Displays count of guests going
- Shows avatar stack (top 6) with overflow indicator (+N)
- Removed redundant inline RSVP section (radio buttons)

**Phase 9 - Floating RSVP Buttons:**
- Already implemented with gradient circular buttons
- Fixed emoji mapping to handle labels with embedded emojis (e.g., "Going 👍")
- Added `getEmojiForLabel`, `getGradientForLabel`, `getCleanLabel` helper functions
- Each RSVP option now shows correct emoji (👍, 🤔, 😢)

Last Updated: 2025-12-23
