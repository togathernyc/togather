# Mentions Feature Research Summary

**Branch:** `feature/mentions-research`
**Date:** 2025-12-31
**Status:** Research Complete - Ready for Implementation Planning

---

## Requirements Summary

Based on discussions, here are the confirmed requirements:

### Core Functionality
- **Trigger**: User types `@` followed by text
- **Matching**: Match against first name, last name, email, phone number
- **Confirmation**: Must click dropdown item to confirm mention (captures user ID)
- **Display**: Show first name only (e.g., "@John")
- **Scope**: Individual mentions only - no @everyone or @leaders

### Notification Behavior
- **Push Check**: BOTH user's global `push_notifications_enabled` AND group-level `group_member.notifications_enabled` must be true
- **Fallback**: If push is disabled, send email (no separate email toggle currently)
- **Visual**: Highlight both the @mention text AND the message background when user is mentioned

### Data Storage
- **Location**: StreamChat's `mentioned_users` custom field
- **Rationale**: Less code, Stream handles storage with message

### UI Design
- **Autocomplete**: Dropdown popup (like Slack/Discord)
- **Filters**: As user types after @, filter group members in real-time

---

## Codebase Architecture Analysis

### 1. Chat System

**Technology Stack:**
- Frontend: `stream-chat-expo` v8.11.0 (React Native)
- Backend: `stream-chat` v9.26.0 (Server SDK)
- tRPC router at `/apps/api-trpc/src/routers/chat.ts`

**Key Components:**

| File | Purpose |
|------|---------|
| `ChatRoomScreen.tsx` | Main chat interface, wraps Stream components |
| `CustomMessage.tsx` | Custom message renderer (handles event links) |
| `useChatRoom.ts` | Hook managing channel state, tabs, navigation |
| `StreamChatProvider.tsx` | Context provider for Stream client |

**Message Input Flow:**
```
NativeMessageInput (Stream SDK)
  → User types message
  → Stream SDK sends via channel.sendMessage()
  → Backend webhook receives message.new event
  → Notifications sent to members
```

**Modification Points for Mentions:**
1. Need custom `MessageInput` wrapper to intercept `@` typing
2. Need to modify `CustomMessage.tsx` to render mention highlights
3. Need custom autocomplete dropdown component

### 2. Groups & Members

**Database Schema (Prisma):**
```prisma
model group_member {
  id: Int
  group_id: String (UUID)
  user_id: BigInt
  role: String ('member' | 'leader' | 'admin')
  notifications_enabled: Boolean
  left_at: DateTime?  // null = active member
}

model user {
  id: BigInt
  first_name: String
  last_name: String
  email: String
  phone: String?
  push_notifications_enabled: Boolean
  email_notifications_enabled: Boolean
}
```

**Channel Types:**
- `_main` channel: All active group members
- `_leaders` channel: Leaders and admins only

**Getting Group Members:**
- tRPC: `groups.members.list({ groupId })`
- Returns: user ID, first/last name, email, role

### 3. Notification System

**Push Notifications:**
- Service: Expo Server SDK (`/apps/api-trpc/src/lib/expo.ts`)
- Tokens stored in `push_token` table
- `sendPushNotification({ tokens, title, body, data })`

**Email:**
- Service: Resend API (`/packages/notifications/src/channels/email.ts`)
- Notification system handles channel cascade (push → email → SMS)

**Existing Messaging:**
- Convex-native messaging (`/apps/convex/functions/messaging/`)
- Sends push notifications to group members on new messages
- **This is the ideal place to add mention notification logic**

### 4. Stream Chat SDK Mention Capabilities

Stream Chat SDK has built-in mention support:

**Sending messages with mentions:**
```typescript
channel.sendMessage({
  text: "Hey @John check this out",
  mentioned_users: ["user_123"]  // Array of user IDs
});
```

**Webhook payload includes:**
```typescript
{
  type: "message.new",
  message: {
    mentioned_users: [{ id: "user_123", name: "John" }]
  }
}
```

**Native SDK Components:**
- `AutoCompleteInput` - Can show user suggestions
- `MentionsInput` - Handles @ detection
- However, we want custom UI/behavior

---

## Implementation Architecture

### Frontend Components Needed

```
/apps/mobile/features/chat/components/
├── MentionInput/
│   ├── MentionTextInput.tsx      # Wraps message input, detects @
│   ├── MentionDropdown.tsx       # Popup with member list
│   ├── MentionItem.tsx           # Single member row
│   └── useMentionInput.ts        # Hook for @ detection logic
├── MentionHighlight.tsx          # Renders @Name with styling
└── CustomMessage.tsx             # Modify to detect/highlight mentions
```

### Backend Changes Needed

```
/apps/api-trpc/src/
├── routers/
│   └── groups/
│       └── members.ts            # Add search endpoint for autocomplete
├── webhooks/
│   └── stream.ts                 # Add mention notification logic
└── lib/
    └── mentions.ts               # Helper functions for mention processing
```

### Data Flow

```
1. USER TYPES "@jo"
   ↓
2. MentionTextInput detects @ pattern
   ↓
3. Query: trpc.groups.members.search({ groupId, query: "jo" })
   ↓
4. MentionDropdown shows filtered members
   ↓
5. User clicks "John Smith"
   ↓
6. Insert "@John" into text, store userId in mentions array
   ↓
7. On send: channel.sendMessage({ text, mentioned_users: [userId] })
   ↓
8. Stream webhook fires with mentioned_users
   ↓
9. Backend checks notification preferences:
   - user.push_notifications_enabled
   - group_member.notifications_enabled (for this group)
   ↓
10. Send push OR email based on preferences
```

---

## Key Files to Modify

### Frontend

| File | Change |
|------|--------|
| `ChatRoomScreen.tsx` | Replace `NativeMessageInput` with custom `MentionInput` |
| `CustomMessage.tsx` | Add mention detection and highlighting |
| New: `MentionInput/` | New component folder for mention UI |
| `features/chat/types.ts` | Add mention-related types |

### Backend

| File | Change |
|------|--------|
| `webhooks/stream.ts` | Add mention notification handler |
| `routers/groups/members.ts` | Add member search endpoint |
| New: `lib/mentions.ts` | Mention parsing/notification helpers |

---

## API Endpoints Needed

### New Endpoint: Member Search

```typescript
// routers/groups/members.ts
search: protectedProcedure
  .input(z.object({
    groupId: z.string().uuid(),
    query: z.string().min(1).max(50),
    limit: z.number().optional().default(10),
  }))
  .query(async ({ input, ctx }) => {
    // Search by first_name, last_name, email, phone
    // Return: { id, first_name, last_name, profile_photo }
  })
```

---

## Notification Logic (Backend)

```typescript
// In webhooks/stream.ts handleStreamWebhook()

if (payload.message?.mentioned_users?.length > 0) {
  const mentionedUserIds = payload.message.mentioned_users.map(u => u.id);

  for (const userId of mentionedUserIds) {
    // 1. Get user preferences
    const user = await prisma.user.findUnique({ where: { id: userId } });

    // 2. Get group membership notification setting
    const membership = await prisma.group_member.findFirst({
      where: { user_id: userId, group_id: groupId, left_at: null }
    });

    // 3. Check if push is enabled (both global AND group-level)
    const pushEnabled = user.push_notifications_enabled && membership.notifications_enabled;

    if (pushEnabled) {
      // Get push tokens and send
      await sendMentionPushNotification(userId, senderName, messageText);
    } else {
      // Fallback to email
      await sendMentionEmail(user.email, senderName, messageText, groupName);
    }
  }
}
```

---

## Visual Design Notes

### Mention Highlighting
- **@Name text**: Blue color, slightly bold
- **Message background**: Light blue tint when user is mentioned
- Could use existing theme colors from `useCommunityTheme()`

### Dropdown Popup
- Position: Above or below input based on space
- Max height: ~200px (show ~4-5 members)
- Each row: Profile photo + First Name + Last Name
- Filter in real-time as user types

---

## Risks & Considerations

1. **Stream SDK Compatibility**: Ensure `mentioned_users` field works as expected with stream-chat-expo
2. **Performance**: Member search should be fast - consider caching group members
3. **Edge Cases**:
   - User mentions themselves
   - Mentioned user is not in group anymore
   - Message deleted after notification sent
4. **Web Support**: `ChatRoomScreen.tsx` has separate web rendering - need to implement for both

---

## Next Steps

1. **Implementation Planning**: Create detailed task breakdown
2. **Frontend First**: Build mention input + dropdown (visible progress)
3. **Backend Second**: Add search endpoint + webhook handler
4. **Testing**: Test both general and leaders channels
5. **Email Template**: Create mention-specific email template

---

## Questions Resolved

| Question | Answer |
|----------|--------|
| Mention format? | Match first/last name, email, phone. Display as @FirstName |
| Group mentions? | No - individual only |
| Storage location? | StreamChat custom fields |
| Autocomplete style? | Dropdown popup |
| Notification check? | Both global + group-level must be enabled |
| Email fallback? | Always send if push disabled |
| Visual indicator? | Both @name highlight + message background |
