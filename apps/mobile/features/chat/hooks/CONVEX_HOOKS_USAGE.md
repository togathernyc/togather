# Convex Messaging Hooks Usage Guide

This guide explains how to use the three core Convex messaging hooks.

## Overview

These hooks provide real-time messaging functionality backed by Convex:

1. **useChannel** - Subscribe to channel updates
2. **useMessages** - Paginated message list with real-time updates
3. **useConvexSendMessage** - Send messages with optimistic updates

## 1. useChannel

Subscribe to a channel's data with automatic real-time updates.

### Usage

```typescript
import { useChannel } from '@features/chat/hooks';
import type { Id } from '@services/api/convex';

function ChannelHeader({ channelId }: { channelId: Id<"chatChannels"> }) {
  const channel = useChannel(channelId);

  if (!channel) {
    return <Text>Loading channel...</Text>;
  }

  return (
    <View>
      <Text>{channel.name}</Text>
      <Text>{channel.memberCount} members</Text>
    </View>
  );
}
```

### Parameters

- `channelId: Id<"chatChannels"> | null` - The channel ID to subscribe to, or null to skip

### Returns

- `channel: Channel | null | undefined` - Channel data
  - `undefined` = loading
  - `null` = not found or no access
  - `Channel` = channel data

### Features

- ✅ Real-time updates when channel changes
- ✅ Automatic subscription management
- ✅ Null safety (pass null to skip query)

## 2. useMessages

Load and paginate messages with real-time updates.

### Usage

```typescript
import { useMessages } from '@features/chat/hooks';
import type { Id } from '@services/api/convex';

function MessageList({ channelId }: { channelId: Id<"chatChannels"> }) {
  const { messages, loadMore, hasMore, isLoading } = useMessages(channelId, 50);

  return (
    <FlatList
      data={messages}
      renderItem={({ item }) => <MessageItem message={item} />}
      onEndReached={hasMore ? loadMore : undefined}
      onEndReachedThreshold={0.5}
      refreshing={isLoading}
      inverted // Show newest at bottom
    />
  );
}
```

### Parameters

- `channelId: Id<"chatChannels"> | null` - The channel ID to fetch messages from
- `limit?: number` - Messages per page (default: 50)

### Returns

```typescript
{
  messages: Message[];      // Array of messages (newest first)
  loadMore: () => void;      // Load next page
  hasMore: boolean;          // True if more messages available
  isLoading: boolean;        // True during initial load
  cursor: string | undefined; // Current pagination cursor
}
```

### Features

- ✅ Real-time message updates
- ✅ Pagination support
- ✅ Automatic deduplication
- ✅ Resets when channel changes

## 3. useConvexSendMessage

Send messages with optimistic updates.

### Usage

```typescript
import { useConvexSendMessage } from '@features/chat/hooks';
import type { Id } from '@services/api/convex';

function MessageInput({ channelId }: { channelId: Id<"chatChannels"> }) {
  const [text, setText] = useState('');
  const { sendMessage, optimisticMessages, isSending } = useConvexSendMessage(channelId);

  const handleSend = async () => {
    if (!text.trim()) return;

    try {
      await sendMessage(text.trim());
      setText('');
    } catch (error) {
      Alert.alert('Error', 'Failed to send message');
    }
  };

  return (
    <View>
      <TextInput
        value={text}
        onChangeText={setText}
        placeholder="Type a message..."
      />
      <Button
        title={isSending ? 'Sending...' : 'Send'}
        onPress={handleSend}
        disabled={!text.trim() || isSending}
      />
    </View>
  );
}
```

### Parameters

- `channelId: Id<"chatChannels"> | null` - The channel to send messages to

### Returns

```typescript
{
  sendMessage: (content: string, options?: SendMessageOptions) => Promise<void>;
  optimisticMessages: OptimisticMessage[]; // Messages being sent
  isSending: boolean;                      // True while sending
}
```

### Send Options

```typescript
interface SendMessageOptions {
  attachments?: Array<{
    type: string;
    url: string;
    name?: string;
    size?: number;
    mimeType?: string;
    thumbnailUrl?: string;
  }>;
  mentionedUserIds?: Id<"users">[];
  parentMessageId?: Id<"chatMessages">; // For thread replies
}
```

### Examples

#### Basic Message

```typescript
await sendMessage("Hello, world!");
```

#### With Mentions

```typescript
await sendMessage("Hey @john, check this out!", {
  mentionedUserIds: [johnUserId],
});
```

#### With Attachments

```typescript
await sendMessage("Check out this image", {
  attachments: [{
    type: "image",
    url: "https://...",
    thumbnailUrl: "https://...",
  }],
});
```

#### Thread Reply

```typescript
await sendMessage("Replying to your message", {
  parentMessageId: parentMsg._id,
});
```

### Features

- ✅ Optimistic updates (instant UI feedback)
- ✅ Automatic retry on failure
- ✅ Status tracking (sending/sent/error)
- ✅ Automatic cleanup of optimistic messages

## Complete Example

Here's a complete messaging screen using all three hooks:

```typescript
import React, { useState } from 'react';
import { View, FlatList, TextInput, Button } from 'react-native';
import { useChannel, useMessages, useConvexSendMessage } from '@features/chat/hooks';
import type { Id } from '@services/api/convex';

function MessagingScreen({ channelId }: { channelId: Id<"chatChannels"> }) {
  const [text, setText] = useState('');

  // Load channel data
  const channel = useChannel(channelId);

  // Load messages with pagination
  const { messages, loadMore, hasMore, isLoading } = useMessages(channelId);

  // Send messages with optimistic updates
  const { sendMessage, optimisticMessages, isSending } = useConvexSendMessage(channelId);

  // Combine real and optimistic messages
  const allMessages = [...messages, ...optimisticMessages].sort(
    (a, b) => b.createdAt - a.createdAt
  );

  const handleSend = async () => {
    if (!text.trim()) return;
    await sendMessage(text.trim());
    setText('');
  };

  return (
    <View style={{ flex: 1 }}>
      {/* Channel Header */}
      <Text>{channel?.name || 'Loading...'}</Text>

      {/* Message List */}
      <FlatList
        data={allMessages}
        inverted
        renderItem={({ item }) => (
          <View>
            <Text>{item.senderName}</Text>
            <Text>{item.content}</Text>
            {item._optimistic && <Text>({item._status})</Text>}
          </View>
        )}
        onEndReached={hasMore ? loadMore : undefined}
      />

      {/* Message Input */}
      <View>
        <TextInput
          value={text}
          onChangeText={setText}
          placeholder="Type a message..."
        />
        <Button
          title="Send"
          onPress={handleSend}
          disabled={!text.trim() || isSending}
        />
      </View>
    </View>
  );
}
```

## Testing

To test the hooks, use the `ConvexMessagingTest` component:

```typescript
import { ConvexMessagingTest } from '@features/chat/components/ConvexMessagingTest';

// In your test screen
<ConvexMessagingTest channelId={channelId} />
```

This component tests all three hooks and provides a simple UI for verification.
