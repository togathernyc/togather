# Convex Messaging Migration Plan

**Status:** Ready for Implementation
**Related ADR:** [ADR-020: Convex-Native Messaging System](./ADR-020-convex-native-messaging.md)
**Created:** 2026-01-15
**Updated:** 2026-01-15

## Overview

This document provides a detailed, actionable plan for migrating the Togather mobile app from Stream Chat to the Convex-native messaging system. The backend infrastructure (Phase 1) is complete.

**Migration Strategy:** Cold turkey - no feature flags, no gradual rollout, no historical message migration. The app has zero users currently, so we're replacing StreamChat entirely with Convex-backed UI.

---

## Current State

### ✅ Completed

- Convex messaging backend fully implemented (`apps/convex/functions/messaging/`)
- Complete database schema in Convex
- Full test coverage for all messaging functions
- API types generated and available

### ❌ Not Yet Started

- Frontend UI integration (React Native components)
- Replacing StreamChat components with Convex-backed UI

### Active Dependencies to Remove

- Stream Chat SDK (`stream-chat-expo`) - will be removed
- All mobile chat UI uses Stream components - will be replaced
- Stream webhooks in `apps/convex/http.ts` - will be removed

---

## Implementation Plan

### Frontend Integration (Cold Turkey Replacement)

**Goal:** Replace all StreamChat UI with Convex-backed components.

#### Frontend Architecture

**New Components (Replace Stream Chat):**

```
apps/mobile/features/chat/
├── components/
│   ├── ChatInboxScreen.tsx            # Inbox list (replace Stream)
│   ├── ChatRoomScreen.tsx             # Chat room UI (replace Stream)
│   ├── MessageList.tsx                # Message list with pagination
│   ├── MessageItem.tsx                # Individual message
│   ├── MessageInput.tsx               # Send messages + image upload
│   ├── ReplyPreview.tsx               # Reply-to indicator above input
│   ├── LinkPreview.tsx                # Link preview card
│   ├── EventCard.tsx                  # Custom event card (already exists?)
│   ├── ImagePreview.tsx               # Image display in messages
│   ├── TypingIndicator.tsx            # Real-time typing
│   └── ReactionPicker.tsx             # Emoji reactions
├── hooks/
│   ├── useChannel.ts                  # Subscribe to channel
│   ├── useMessages.ts                 # Paginated messages
│   ├── useSendMessage.ts              # Send mutation
│   ├── useReadState.ts                # Unread counts
│   ├── useTypingIndicators.ts         # Typing status
│   ├── useReactions.ts                # Add/remove reactions
│   └── useImageUpload.ts              # Upload to S3
└── utils/
    ├── messageHelpers.ts              # Format, parse messages
    ├── linkPreviewParser.ts           # Extract URLs, fetch previews
    └── imageUpload.ts                 # S3 upload logic
```

**Router Integration:**

```typescript
// apps/mobile/app/(tabs)/inbox.tsx
export default function InboxScreen() {
  return <ChatInboxScreen />; // Now uses Convex
}
```

#### Implementation Checklist

**Week 1: Core Hooks & Infrastructure**

- [ ] Set up S3 image upload
  - [ ] Configure S3 bucket + IAM permissions
  - [ ] Create `useImageUpload` hook (upload to S3, return URL)
  - [ ] Add image URLs to Convex message schema (already has `attachments` array)
- [ ] Add backend function for read receipts
  - [ ] Create `getMessageReadBy` query in `apps/convex/functions/messaging/readState.ts`
  - [ ] Returns array of users who have read a specific message
- [ ] Create `useChannel` - subscribe to channel updates
- [ ] Create `useMessages` - paginated message list with real-time updates
- [ ] Create `useSendMessage` - send mutation with optimistic updates
- [ ] Create `useReadState` - track unread counts
- [ ] Create `useReadReceipts` - get who has read each message
- [ ] Create `useTypingIndicators` - broadcast/subscribe typing status
- [ ] Create `useReactions` - add/remove reactions

**Week 2: Basic Message UI**

- [ ] Build `MessageItem` component
  - [ ] Render text messages
  - [ ] Show timestamp
  - [ ] Show sender name/avatar
  - [ ] Support @mentions (clickable, highlighted)
  - [ ] Show read receipts:
    - [ ] Single checkmark (✓) when sent locally
    - [ ] Double checkmark (✓✓) when delivered to server
    - [ ] Highlighted checkmarks + count when read (e.g., "2 ✓✓")
    - [ ] Query read state from `chatReadState` table
  - [ ] Show reactions below message
  - [ ] Deleted/edited states
- [ ] Build `MessageList` component
  - [ ] Render list of messages
  - [ ] Handle pagination (load more on scroll up)
  - [ ] Auto-scroll to bottom on new message
- [ ] Build `MessageInput` component
  - [ ] Text input with send button
  - [ ] @mention autocomplete (type @ to search channel members)
  - [ ] Paste image support
  - [ ] Show typing indicator when user types

**Week 3: Reply & Link Previews**

- [ ] Build reply-to functionality
  - [ ] `ReplyPreview` component (shows above input)
  - [ ] Tap message → reply action
  - [ ] Store `replyToMessageId` in Convex schema
  - [ ] Render reply context in `MessageItem`
- [ ] Build link preview system
  - [ ] `linkPreviewParser` util - detect URLs in text
  - [ ] Fetch link metadata (title, description, image)
  - [ ] `LinkPreview` component - render card
  - [ ] Store link metadata in message or separate table
  - [ ] Show preview while typing (before sending)

**Week 4: Event Cards & Images**

- [ ] Event card integration
  - [ ] Detect event links (e.g., `/e/[shortId]`)
  - [ ] Fetch event data from Convex
  - [ ] Render `EventCard` component (reuse existing?)
  - [ ] Store event metadata in message
- [ ] Image messages
  - [ ] `ImagePreview` component - display images in messages
  - [ ] Image upload flow: paste/select → upload to S3 → send message with image URL
  - [ ] Image lightbox/zoom on tap
  - [ ] Show upload progress indicator

**Week 5: Chat Room Screen**

- [ ] Build `ChatRoomScreen`
  - [ ] Integrate `MessageList`
  - [ ] Integrate `MessageInput`
  - [ ] Show typing indicators
  - [ ] Mark messages as read when viewing
  - [ ] Handle pull-to-refresh
  - [ ] Error states & retry
- [ ] Add reactions UI
  - [ ] Tap message → reaction picker
  - [ ] Add/remove reactions
  - [ ] Show reaction counts
- [ ] Navigation from group details

**Week 6: Inbox & Polish**

- [ ] Build `ChatInboxScreen`
  - [ ] List all user's channels
  - [ ] Show unread counts (badges)
  - [ ] Show last message preview
  - [ ] Sort by most recent activity
  - [ ] Handle empty state
- [ ] Replace StreamChat in app router
  - [ ] Remove `StreamChatProvider`
  - [ ] Remove `StreamInboxScreen`, `StreamChatRoomScreen`
  - [ ] Update navigation to use new components
- [ ] Polish
  - [ ] Match existing design system
  - [ ] Performance optimization (virtualized lists with FlashList)
  - [ ] Error handling and retry logic
  - [ ] Basic offline support (show cached messages)

---

### Cleanup: Remove Stream Chat

**After frontend is complete and working:**

- [ ] Remove Stream Chat SDK from dependencies
  ```bash
  pnpm remove stream-chat stream-chat-expo stream-chat-react-native
  ```
- [ ] Delete Stream Chat provider and components
  ```bash
  rm -rf apps/mobile/features/chat/components/Stream*.tsx
  rm apps/mobile/providers/StreamChatProvider.tsx
  ```
- [ ] Remove Stream webhooks from `apps/convex/http.ts`
  - Delete `/webhooks/stream` endpoint
  - Remove Stream signature verification functions
- [ ] Update environment variables
  - Remove `STREAM_API_KEY`, `STREAM_API_SECRET`
- [ ] Cancel Stream Chat subscription
- [ ] Update documentation
  - Archive `STREAM_CHAT_IMPLEMENTATION_GUIDE.md`
  - Update `README.md` to reference Convex messaging

---

## Testing Strategy

### Unit Tests

- ✅ Backend functions already have full coverage
- [ ] Add tests for frontend hooks
- [ ] Add tests for frontend components

### Manual Testing Checklist

- [ ] Send text message → appears in recipient's chat
- [ ] Type @username → autocomplete shows channel members → mention renders highlighted
- [ ] Paste image → uploads to S3 → displays in message
- [ ] Paste link → shows preview before send → displays as card in message
- [ ] Share event link → displays as event card in message
- [ ] Reply to message → shows reply context
- [ ] Add reaction → displays on message
- [ ] Start typing → other user sees typing indicator
- [ ] Read receipts work:
  - [ ] Single checkmark (✓) appears when message sent
  - [ ] Double checkmark (✓✓) appears when delivered to server
  - [ ] Checkmarks highlight and show count when read by others (e.g., "2 ✓✓")
- [ ] Unread count updates correctly
- [ ] Messages paginate when scrolling up

---

## Technical Considerations

### S3 Image Upload

- Set up S3 bucket with public read access for images
- Generate presigned URLs for uploads (or use IAM role)
- Store image URLs in Convex message schema: `imageUrl: v.optional(v.string())`
- Future: Migrate to Cloudflare R2

### Link Preview Generation

- Parse URLs from message text
- Fetch Open Graph metadata (title, description, image)
- Store in message
- Handle errors gracefully (show URL if fetch fails)

### Event Card Detection

- Detect URLs matching `/e/[shortId]` pattern
- Query Convex for event data using `api.functions.meetings.getByShortId`
- Render existing `EventCard` component (or create if doesn't exist)
- Store event metadata in message for fast rendering

### Read Receipts

Read receipts use the existing `chatReadState` table to show message delivery status:

**States:**
1. **Sent (✓):** Message created locally, optimistic update
2. **Delivered (✓✓):** Message successfully saved to Convex
3. **Read (highlighted ✓✓ + count):** Query `chatReadState` for users who have read this message
   - Show count: "2 ✓✓" means 2 people have read it
   - Highlight checkmarks to indicate read status

**Backend Function Needed:**
```typescript
// apps/convex/functions/messaging/readState.ts
export const getMessageReadBy = query({
  args: {
    messageId: v.id("chatMessages"),
    channelId: v.id("chatChannels"),
  },
  handler: async (ctx, args) => {
    // Query chatReadState where lastReadMessageId >= messageId
    // Return count of users who have read this message
    // Exclude the sender
  },
});
```

**Frontend Implementation:**
```typescript
// Use in MessageItem component
const readCount = useQuery(api.functions.messaging.readState.getMessageReadBy, {
  messageId: message._id,
  channelId: message.channelId,
});

// Render read receipts
<Text>
  {readCount > 0 ? `${readCount} ✓✓` : '✓✓'}
</Text>
```

### @Mentions

Mentions are stored in the `mentionedUserIds` array on messages:

**Features:**
- Type `@` in input → trigger autocomplete of channel members
- Select user → insert `@Username` in text
- Store user IDs in `mentionedUserIds` field
- Render mentions as highlighted/clickable text (tap to view profile)
- Backend already handles mention notifications (push + email)

**Parsing:**
- Use regex to detect `@` patterns in message text
- Match against channel member names
- Highlight in UI with different color/background

### Performance

- Use FlashList for message virtualization
- Paginate messages (50 per page)
- Database indexes already defined in schema
- Optimistic updates for instant UI feedback

---

## Definition of Done

- [ ] Can send and receive text messages
- [ ] @Mentions work (autocomplete, highlight, notifications)
- [ ] Read receipts display correctly (✓ sent, ✓✓ delivered, highlighted + count when read)
- [ ] Images upload to S3 and display in messages
- [ ] Link previews render correctly
- [ ] Event links display as event cards
- [ ] Reply-to functionality works
- [ ] Reactions can be added/removed
- [ ] Typing indicators show in real-time
- [ ] Unread counts update correctly
- [ ] Messages paginate when scrolling
- [ ] StreamChat SDK completely removed from codebase
- [ ] All chat functionality working in iOS Simulator

---

## Decisions Made

1. **No Feature Flags:** Cold turkey migration, no gradual rollout (zero users currently)
2. **No Historical Messages:** Start fresh, don't preserve old StreamChat messages
3. **No Voice Messages:** Not needed for initial version
4. **Media Storage:** S3 for now, migrate to R2 later
5. **No Search:** Not needed for initial version
6. **No Export:** Users don't need to export chat history

---

## Next Steps

1. **Set up S3 bucket** for image uploads
   - Create bucket with public read access
   - Configure IAM role or presigned URL generation
   - Add S3 credentials to environment variables

2. **Start Week 1 implementation**
   - Build core hooks (`useChannel`, `useMessages`, `useSendMessage`, etc.)
   - Implement S3 image upload utility

3. **Create UI components week-by-week** following the checklist above

4. **Test manually** using iOS Simulator with test credentials:
   - Phone: 2025550123 (code: 000000)
   - Community: "Demo Community"

5. **Remove StreamChat** once all features working

---

## References

- [ADR-020: Convex-Native Messaging System](./ADR-020-convex-native-messaging.md)
- [Stream Chat Implementation Guide](./STREAM_CHAT_IMPLEMENTATION_GUIDE.md) (current system)
- Convex Functions: `apps/convex/functions/messaging/`
- Tests: `apps/convex/__tests__/messaging/`
