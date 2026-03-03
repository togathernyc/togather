# Convex Messaging Hooks

This directory contains React hooks for the Convex-native messaging system. These hooks provide a clean, type-safe interface to the messaging backend functions.

## Core Hooks

### useReadState

Track unread counts and mark messages as read.

```tsx
import { useReadState, useAllUnreadCounts } from '@features/chat/hooks';

// Single channel unread count
const { unreadCount, markAsRead, isLoading } = useReadState(channelId);

// Mark channel as read
await markAsRead();

// Mark as read up to a specific message
await markAsRead(messageId);

// All channels unread counts
const { unreadCounts, isLoading } = useAllUnreadCounts();
const totalUnread = Object.values(unreadCounts).reduce((sum, count) => sum + count, 0);
```

**Backend**: `apps/convex/functions/messaging/readState.ts`

### useReadReceipts

Get read receipt information for messages.

```tsx
import { useReadReceipts } from '@features/chat/hooks';

const { readByCount, totalMembers, readBy, isLoading } = useReadReceipts(
  messageId,
  channelId
);

// Show "Read by 5 of 10"
console.log(`Read by ${readByCount} of ${totalMembers}`);
```

**Note**: The backend query `getMessageReadBy` is not yet implemented. This hook is prepared for future implementation.

**Backend**: `apps/convex/functions/messaging/readState.ts` (query to be added)

### useTypingIndicators

Broadcast and subscribe to typing status.

```tsx
import { useTypingIndicators } from '@features/chat/hooks';

const { typingUsers, setTyping, isLoading } = useTypingIndicators(channelId);

// When user types
const handleTextChange = (text: string) => {
  setTyping(text.length > 0);
};

// Display typing indicator
if (typingUsers.length > 0) {
  const names = typingUsers.map(u => u.firstName).join(', ');
  console.log(`${names} ${typingUsers.length === 1 ? 'is' : 'are'} typing...`);
}
```

**Features**:
- Automatic debouncing (1 second) to prevent server spam
- Auto-cleanup on unmount
- Ephemeral indicators with TTL (5 seconds on backend)

**Backend**: `apps/convex/functions/messaging/typing.ts`

### useReactions

Add and remove reactions on messages.

```tsx
import { useReactions } from '@features/chat/hooks';

const { reactions, addReaction, removeReaction, toggleReaction, isLoading } =
  useReactions(messageId);

// Add a reaction
await addReaction('👍');

// Remove a reaction
await removeReaction('👍');

// Toggle a reaction (add if not present, remove if present)
await toggleReaction('👍');

// Display reactions
reactions.forEach(reaction => {
  console.log(`${reaction.emoji} ${reaction.count}`);
  if (reaction.hasReacted) {
    console.log('You reacted with this');
  }
});
```

**Backend**: `apps/convex/functions/messaging/reactions.ts`

## Authentication

All hooks use the authenticated Convex hooks pattern:

- `useAuthenticatedQuery` - Automatically adds auth token from AsyncStorage
- `useAuthenticatedMutation` - Automatically adds auth token to mutations

The token is retrieved from `AsyncStorage` with key `'auth_token'`.

## Testing

Test components are available in `__tests__/`:

- `useReadState.test.tsx` - Test read state and unread counts
- `useReadReceipts.test.tsx` - Test read receipts
- `useTypingIndicators.test.tsx` - Test typing indicators
- `useReactions.test.tsx` - Test reactions
- `MessagingHooksTestScreen.tsx` - Combined test screen for all hooks

### Running Tests

```tsx
import { MessagingHooksTestScreen } from '@features/chat/hooks/__tests__/MessagingHooksTestScreen';

// Navigate to test screen
navigation.navigate('MessagingHooksTest', {
  channelId: 'your-channel-id',
  messageId: 'your-message-id'
});
```

## Type Safety

All hooks are fully typed with TypeScript:

```tsx
import type { Id } from '@services/api/convex';

// Channel ID type
channelId: Id<"chatChannels"> | null

// Message ID type
messageId: Id<"chatMessages"> | null

// Reaction type
interface Reaction {
  emoji: string;
  count: number;
  userIds: Id<"users">[];
  hasReacted: boolean;
}
```

## Architecture

```
Frontend Hook          Backend Function                      Database Table
─────────────────     ──────────────────────────           ─────────────────
useReadState      →   getUnreadCount                   →   chatReadState
                      markAsRead                       →   chatReadState

useReadReceipts   →   getMessageReadBy (TODO)          →   chatReadState

useTypingIndicators → getTypingUsers                   →   chatTypingIndicators
                      startTyping                      →   chatTypingIndicators
                      stopTyping                       →   chatTypingIndicators

useReactions      →   getReactions                     →   chatMessageReactions
                      toggleReaction                   →   chatMessageReactions
```

## Best Practices

1. **Always pass null-safe IDs**: Hooks accept `channelId | null` and `messageId | null` to handle loading states.

2. **Handle loading states**: Check `isLoading` before displaying data.

3. **Error handling**: Wrap mutation calls in try/catch blocks.

4. **Debouncing**: `useTypingIndicators` handles debouncing automatically - don't add your own.

5. **Cleanup**: Hooks handle cleanup automatically via `useEffect` - no manual cleanup needed.

## Example: Message Component

```tsx
import { useReadState, useTypingIndicators, useReactions } from '@features/chat/hooks';

function MessageThread({ channelId, messages }) {
  const { unreadCount, markAsRead } = useReadState(channelId);
  const { typingUsers, setTyping } = useTypingIndicators(channelId);

  useEffect(() => {
    // Mark as read when user views the thread
    markAsRead();
  }, [channelId]);

  return (
    <View>
      {messages.map(msg => (
        <MessageItem key={msg._id} message={msg} />
      ))}
      {typingUsers.length > 0 && (
        <TypingIndicator users={typingUsers} />
      )}
    </View>
  );
}

function MessageItem({ message }) {
  const { reactions, toggleReaction } = useReactions(message._id);

  return (
    <View>
      <Text>{message.text}</Text>
      <ReactionPicker
        reactions={reactions}
        onToggle={toggleReaction}
      />
    </View>
  );
}
```

## Migration Notes

These hooks are part of the Convex messaging migration. They replace the Stream Chat SDK equivalents:

| Stream Chat | Convex Hook |
|------------|-------------|
| `channel.countUnread()` | `useReadState()` |
| `channel.markRead()` | `markAsRead()` |
| `channel.keystroke()` | `setTyping(true)` |
| `channel.stopTyping()` | `setTyping(false)` |
| `message.react()` | `addReaction()` |
| `message.deleteReaction()` | `removeReaction()` |

See `/docs/convex-migration-plan.md` for full migration details.
