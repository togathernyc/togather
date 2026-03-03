# ADR-020: Convex-Native Messaging System

## Status
Accepted

## Context
The current chat system uses GetStream Chat as a third-party service for messaging. While Stream Chat provides a robust real-time messaging solution, it introduces:
- External dependency with associated costs
- Complexity in maintaining sync between Convex DB and Stream
- Limited customization for our specific use cases
- Additional latency for cross-service communication

A Convex-native messaging solution would provide:
- Single source of truth in Convex DB
- Native real-time subscriptions (Convex's core strength)
- Full customization control
- Reduced costs and operational complexity
- Better data locality and performance

## Decision
Implement a Convex-native messaging system that replaces GetStream Chat for group messaging.

### Schema Design

The messaging system uses the following tables:

#### `chatChannels`
Represents a chat channel (group chat, direct message, or announcement channel).

```typescript
chatChannels: defineTable({
  groupId: v.id("groups"),                    // Associated group
  channelType: v.string(),                    // "main" | "leaders" | "dm"
  name: v.string(),                           // Display name
  description: v.optional(v.string()),
  createdById: v.id("users"),
  createdAt: v.number(),                      // Unix timestamp ms
  updatedAt: v.number(),
  isArchived: v.boolean(),
  archivedAt: v.optional(v.number()),
  // Denormalized for performance
  lastMessageAt: v.optional(v.number()),
  lastMessagePreview: v.optional(v.string()), // First 100 chars
  memberCount: v.number(),
})
```

#### `chatChannelMembers`
Junction table for channel membership with role and notification preferences.

```typescript
chatChannelMembers: defineTable({
  channelId: v.id("chatChannels"),
  userId: v.id("users"),
  role: v.string(),                           // "admin" | "moderator" | "member"
  joinedAt: v.number(),
  leftAt: v.optional(v.number()),
  isMuted: v.boolean(),
  mutedUntil: v.optional(v.number()),
  // Denormalized user info for display
  displayName: v.optional(v.string()),
  profilePhoto: v.optional(v.string()),
})
```

#### `chatMessages`
Stores all messages with support for threads and soft deletion.

```typescript
chatMessages: defineTable({
  channelId: v.id("chatChannels"),
  senderId: v.id("users"),
  content: v.string(),                        // Message text
  contentType: v.string(),                    // "text" | "image" | "file" | "system"
  attachments: v.optional(v.array(v.object({
    type: v.string(),                         // "image" | "file" | "link"
    url: v.string(),
    name: v.optional(v.string()),
    size: v.optional(v.number()),
    mimeType: v.optional(v.string()),
    thumbnailUrl: v.optional(v.string()),
  }))),
  // Threading
  parentMessageId: v.optional(v.id("chatMessages")),
  threadReplyCount: v.optional(v.number()),
  // Timestamps
  createdAt: v.number(),
  updatedAt: v.optional(v.number()),
  editedAt: v.optional(v.number()),
  // Soft delete
  isDeleted: v.boolean(),
  deletedAt: v.optional(v.number()),
  deletedById: v.optional(v.id("users")),
  // Denormalized sender info
  senderName: v.optional(v.string()),
  senderProfilePhoto: v.optional(v.string()),
  // Mentions
  mentionedUserIds: v.optional(v.array(v.id("users"))),
})
```

#### `chatMessageReactions`
Stores individual reactions to messages.

```typescript
chatMessageReactions: defineTable({
  messageId: v.id("chatMessages"),
  userId: v.id("users"),
  emoji: v.string(),                          // Emoji character or shortcode
  createdAt: v.number(),
})
```

#### `chatReadState`
Tracks read/unread state per user per channel.

```typescript
chatReadState: defineTable({
  channelId: v.id("chatChannels"),
  userId: v.id("users"),
  lastReadMessageId: v.optional(v.id("chatMessages")),
  lastReadAt: v.number(),
  unreadCount: v.number(),
})
```

#### `chatTypingIndicators`
Ephemeral typing indicators with automatic cleanup.

```typescript
chatTypingIndicators: defineTable({
  channelId: v.id("chatChannels"),
  userId: v.id("users"),
  startedAt: v.number(),
  expiresAt: v.number(),                      // Auto-cleanup after 5s
})
```

#### `chatUserBlocks`
User-to-user blocking within the chat system.

```typescript
chatUserBlocks: defineTable({
  blockerId: v.id("users"),
  blockedId: v.id("users"),
  createdAt: v.number(),
  reason: v.optional(v.string()),
})
```

#### `chatMessageFlags`
Content moderation flags for messages.

```typescript
chatMessageFlags: defineTable({
  messageId: v.id("chatMessages"),
  reportedById: v.id("users"),
  reason: v.string(),                         // "spam" | "harassment" | "inappropriate" | "other"
  details: v.optional(v.string()),
  status: v.string(),                         // "pending" | "reviewed" | "dismissed" | "actioned"
  reviewedById: v.optional(v.id("users")),
  reviewedAt: v.optional(v.number()),
  actionTaken: v.optional(v.string()),
  createdAt: v.number(),
})
```

#### `chatUserFlags`
Content moderation flags for users (pattern of behavior).

```typescript
chatUserFlags: defineTable({
  userId: v.id("users"),
  reportedById: v.id("users"),
  channelId: v.optional(v.id("chatChannels")), // Context where reported
  reason: v.string(),
  details: v.optional(v.string()),
  status: v.string(),
  reviewedById: v.optional(v.id("users")),
  reviewedAt: v.optional(v.number()),
  actionTaken: v.optional(v.string()),
  createdAt: v.number(),
})
```

#### `chatPushNotificationQueue`
Queue for push notifications (replaces Stream webhooks).

```typescript
chatPushNotificationQueue: defineTable({
  channelId: v.id("chatChannels"),
  messageId: v.id("chatMessages"),
  recipientId: v.id("users"),
  type: v.string(),                           // "new_message" | "mention" | "reply"
  status: v.string(),                         // "pending" | "sent" | "failed"
  scheduledFor: v.number(),
  sentAt: v.optional(v.number()),
  error: v.optional(v.string()),
  retryCount: v.number(),
})
```

### API Design

#### Channel Operations (`channels.ts`)
```typescript
// Queries
getChannel(channelId): Channel
getChannelsByGroup(groupId): Channel[]
getUserChannels(userId): Channel[]

// Mutations
createChannel(groupId, channelType, name): Channel
updateChannel(channelId, updates): Channel
archiveChannel(channelId): void
addMember(channelId, userId, role): void
removeMember(channelId, userId): void
updateMemberRole(channelId, userId, role): void
```

#### Message Operations (`messages.ts`)
```typescript
// Queries
getMessages(channelId, cursor?, limit?): PaginatedMessages
getMessage(messageId): Message
getThreadReplies(parentMessageId, cursor?, limit?): PaginatedMessages

// Mutations
sendMessage(channelId, content, attachments?, parentMessageId?): Message
editMessage(messageId, content): Message
deleteMessage(messageId): void  // Soft delete
```

#### Reaction Operations (`reactions.ts`)
```typescript
// Queries
getReactions(messageId): ReactionSummary[]

// Mutations
toggleReaction(messageId, emoji): void
```

#### Read State Operations (`readState.ts`)
```typescript
// Queries
getUnreadCount(channelId, userId): number
getUnreadCounts(userId): Map<channelId, count>

// Mutations
markAsRead(channelId, messageId?): void
markAllAsRead(userId): void
```

#### Blocking Operations (`blocking.ts`)
```typescript
// Queries
getBlockedUsers(userId): User[]
isBlocked(blockerId, blockedId): boolean

// Mutations
blockUser(blockedId, reason?): void
unblockUser(blockedId): void
```

#### Flagging/Moderation Operations (`flagging.ts`)
```typescript
// Queries
getPendingFlags(): Flag[]
getFlagsForMessage(messageId): Flag[]
getFlagsForUser(userId): Flag[]

// Mutations
flagMessage(messageId, reason, details?): void
flagUser(userId, reason, details?): void
reviewFlag(flagId, action): void
```

#### Typing Indicators (`typing.ts`)
```typescript
// Queries
getTypingUsers(channelId): User[]

// Mutations
startTyping(channelId): void
stopTyping(channelId): void

// Internal
cleanupExpiredIndicators(): void  // Scheduled job
```

#### Event Handlers (`events.ts`)
Internal functions triggered by mutations to handle side effects:
- `onMessageSent`: Update channel's lastMessageAt, queue push notifications
- `onMemberAdded`: Update channel memberCount
- `onMemberRemoved`: Update channel memberCount
- `onChannelArchived`: Notify members, cleanup

### Authentication
All functions require authentication via `requireAuth(ctx, args.token)`.

### Access Control
- Channel access is determined by `chatChannelMembers` membership
- Group membership in Convex determines initial channel access
- Leaders channel requires leader/admin role in group
- Announcement groups: only leaders can send, all can read/react

### Real-time Updates
Convex provides native real-time subscriptions. Clients use:
```typescript
const messages = useQuery(api.messaging.messages.getMessages, { channelId });
const typingUsers = useQuery(api.messaging.typing.getTypingUsers, { channelId });
```

### Migration Strategy
1. Implement new system alongside Stream Chat
2. Feature flag to enable Convex messaging for specific groups
3. Migrate historical messages (optional, batch job)
4. Gradually roll out to all groups
5. Deprecate Stream Chat integration

## Consequences

### Positive
- **Single Source of Truth**: All data in Convex, no sync issues
- **Native Real-time**: Leverage Convex's reactive queries
- **Full Control**: Custom features without Stream limitations
- **Cost Reduction**: No third-party API costs
- **Better Performance**: No cross-service latency
- **Simplified Architecture**: Fewer moving parts

### Negative
- **Initial Development**: Significant upfront implementation effort
- **Feature Parity**: Must implement features Stream provides out-of-box
- **Scaling Considerations**: Message volume handled by Convex (should be fine)

### Risks
- **Message Volume**: High-traffic channels may need pagination optimization
- **Push Notifications**: Must implement reliable delivery ourselves

## Implementation Files

```
apps/convex/functions/messaging/
├── channels.ts      # Channel CRUD, access control
├── messages.ts      # Send, edit, delete, list with pagination
├── reactions.ts     # Toggle reactions, aggregation
├── readState.ts     # Unread counts, mark read
├── blocking.ts      # User blocking/unblocking
├── flagging.ts      # Message/user reporting, moderation
├── typing.ts        # Typing indicators with cleanup
├── events.ts        # Internal event handlers
└── index.ts         # Barrel file
```

## Test Coverage

Tests in `apps/convex/__tests__/messaging/`:
- `channels.test.ts`: Channel creation, membership, access control
- `messages.test.ts`: Send, edit, delete, pagination, threading
- `reactions.test.ts`: Add/remove reactions, aggregation
- `readState.test.ts`: Mark read, unread counts
- `blocking.test.ts`: Block/unblock users, message filtering
- `flagging.test.ts`: Report content, moderation workflow
- `typing.test.ts`: Typing indicators, expiration
- `events.test.ts`: Event handlers, notifications

## References
- [Convex Documentation](https://docs.convex.dev/)
- [ADR-001: Stream Chat Channel Naming](./ADR-001-stream-chat-channel-naming.md)
- [Stream Chat Implementation Guide](./STREAM_CHAT_IMPLEMENTATION_GUIDE.md)
