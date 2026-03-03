# Orchestrator Prompt: Convex Messaging Migration

**Use this prompt to spawn an orchestrator agent that will implement the complete Convex messaging frontend migration.**

---

## Your Role

You are an **orchestrator agent** responsible for implementing the complete Convex-native messaging system for the Togather mobile app. Your job is to:

1. **Break down the work** into parallelizable tasks
2. **Spawn sub-agents** to work on different pieces simultaneously
3. **Coordinate** the sub-agents to ensure all pieces integrate correctly
4. **Test** the final implementation end-to-end
5. **Remove StreamChat** dependency when complete

You should work **autonomously** - spawn sub-agents without asking permission for each one. Act decisively and efficiently.

---

## Implementation Progress

**Last Updated:** 2026-01-XX

### ✅ Phase 1: Infrastructure (Mostly Complete)

- ✅ **S3 Setup & Image Upload**
  - `useImageUpload.ts` hook created
  - `imageUpload.ts` utility created
  - Image upload functionality implemented

- ✅ **Read Receipts Backend**
  - `getMessageReadBy` query added to `apps/convex/functions/messaging/readState.ts`
  - Returns count of users who have read a message

- ✅ **Core Hooks (Part 1)**
  - `useChannel.ts` - Subscribe to channel updates
  - `useMessages.ts` - Paginated message list with real-time updates
  - `useSendMessage.ts` / `useConvexSendMessage.ts` - Send mutation with optimistic updates

- ✅ **Core Hooks (Part 2)**
  - `useReadState.ts` - Track unread counts
  - `useReadReceipts.ts` - Get who has read each message
  - `useTypingIndicators.ts` - Broadcast/subscribe typing status
  - `useReactions.ts` - Add/remove reactions

### ✅ Phase 2: Basic Message UI (Complete)

- ✅ **MessageItem Component**
  - `MessageItem.tsx` created
  - Renders text messages with sender info
  - Supports @mentions
  - Shows read receipts
  - Handles deleted/edited states

- ✅ **MessageList Component**
  - `MessageList.tsx` created
  - Uses FlashList for virtualization
  - Handles pagination
  - Auto-scroll to bottom

- ✅ **MessageInput Component**
  - `MessageInput.tsx` created
  - Text input with send button
  - @mention autocomplete (`MentionInput` component)
  - Image paste/upload support
  - Typing indicator support

### ✅ Phase 3: Advanced Features (Mostly Complete)

- ✅ **Reply & Link Previews**
  - `EventLinkPreview.tsx` created
  - `EventLinkCard.tsx` created
  - Link preview functionality implemented

- ✅ **Event Cards & Images**
  - Event card integration exists
  - Image display components exist

- ✅ **Reactions UI**
  - `CustomReactionList.tsx` exists
  - Reaction functionality implemented via hooks

### ✅ Phase 4: Integration (Complete)

- ✅ **ChatRoomScreen**
  - `ConvexChatRoomScreen.tsx` created - fully Convex-based
  - Uses Convex hooks (`useMessages`, `useSendMessage`, `useTypingIndicators`, etc.)
  - Uses Convex components (`MessageList`, `MessageInput`, `MessageItem`, `TypingIndicator`)
  - Route updated to use new component

- ✅ **ChatInboxScreen**
  - `ChatInboxScreen.tsx` created - fully Convex-based
  - Uses `useChatRooms` hook for channel data
  - Uses Convex queries for unread counts and last messages
  - Route updated to use new component

### ❌ Phase 5: Cleanup & Testing (Not Started)

- ❌ **Remove StreamChat**
  - StreamChat SDK still in `package.json` dependencies
  - `StreamChatProvider.tsx` still exists and is used
  - Stream webhooks still exist in `apps/convex/http.ts`
  - `StreamInboxScreen.tsx` still uses StreamChat
  - `ChatRoomScreen.tsx` still uses StreamChat components
  - Environment variables (`STREAM_API_KEY`, `STREAM_API_SECRET`) still referenced

- ❌ **End-to-End Testing**
  - Not yet completed
  - Need to verify all features work with Convex backend

### Remaining Critical Tasks

1. ✅ **Refactor ChatRoomScreen** - COMPLETE (`ConvexChatRoomScreen.tsx` created)
2. ✅ **Create ChatInboxScreen** - COMPLETE (`ChatInboxScreen.tsx` created)
3. ✅ **Update app routes** - COMPLETE (routes updated to use new components)
4. **Remove StreamChat dependencies** and provider (Phase 5)
5. **Remove Stream webhooks** from Convex HTTP handlers (Phase 5)
6. **End-to-end testing** in iOS Simulator (Phase 5)

---

## Context

### What Currently Exists

**Backend (100% Complete):**

- Convex messaging functions in `apps/convex/functions/messaging/`
  - `channels.ts` - Channel management
  - `messages.ts` - Send, edit, delete messages
  - `reactions.ts` - Emoji reactions
  - `readState.ts` - Unread counts (includes `getMessageReadBy`)
  - `blocking.ts` - User blocking
  - `flagging.ts` - Message reporting
  - `typing.ts` - Typing indicators
  - `events.ts` - Event handlers
- Full test coverage in `apps/convex/__tests__/messaging/`
- Schema defined in `apps/convex/schema.ts`
- API types generated in `apps/convex/_generated/api.d.ts`

**Frontend (~95% Complete):**

- ✅ Core hooks implemented (`useChannel`, `useMessages`, `useSendMessage`, etc.)
- ✅ Basic UI components created (`MessageItem`, `MessageList`, `MessageInput`, `TypingIndicator`)
- ✅ Advanced features implemented (reactions, typing indicators, read receipts)
- ✅ `ConvexChatRoomScreen` created - fully Convex-based (replaces StreamChat version)
- ✅ `ChatInboxScreen` created - fully Convex-based (replaces StreamInboxScreen)
- ✅ Routes updated to use new Convex components
- ⚠️ StreamChat SDK still in dependencies (Phase 5 cleanup pending)

**Migration Plan:**

- Read the full plan at: `docs/architecture/CONVEX_MESSAGING_MIGRATION_PLAN.md`
- 6-week implementation plan broken down by week
- No feature flags, no gradual rollout (cold turkey migration)
- No historical message migration

### Project Tech Stack

- **Backend:** Convex (serverless functions + real-time database)
- **Frontend:** React Native + Expo
- **Routing:** Expo Router (file-based)
- **State:** Convex hooks (`useQuery`, `useMutation`, `useAction`)
- **Lists:** FlashList for virtualization
- **Images:** S3 (will migrate to R2 later)

### Test Credentials

When testing in iOS Simulator:

- Phone: `2025550123`
- Code: `000000` (bypass for testing)
- Community: Search for "Demo Community"

---

## Implementation Strategy

### Phase 1: Parallel Infrastructure Work (Week 1) ✅ COMPLETE

~~Spawn these sub-agents **in parallel** (they are independent):~~

**Status:** All Phase 1 tasks have been completed by previous agents.

#### ✅ Agent 1: S3 Setup & Image Upload - DONE

- ✅ S3 bucket setup complete
- ✅ `apps/mobile/features/chat/utils/imageUpload.ts` created
- ✅ `apps/mobile/features/chat/hooks/useImageUpload.ts` created
- ✅ Image upload functionality working

#### ✅ Agent 2: Read Receipts Backend - DONE

- ✅ `getMessageReadBy` query added to `apps/convex/functions/messaging/readState.ts`
- ✅ Query `chatReadState` table to count users who have read a message
- ✅ Excludes sender from count
- ✅ Tests exist in `apps/convex/__tests__/messaging/readState.test.ts`

#### ✅ Agent 3: Core Hooks (Part 1) - DONE

- ✅ `apps/mobile/features/chat/hooks/useChannel.ts` created
- ✅ `apps/mobile/features/chat/hooks/useMessages.ts` created
- ✅ `apps/mobile/features/chat/hooks/useSendMessage.ts` created
- ✅ Optimistic updates implemented

#### ✅ Agent 4: Core Hooks (Part 2) - DONE

- ✅ `apps/mobile/features/chat/hooks/useReadState.ts` created
- ✅ `apps/mobile/features/chat/hooks/useReadReceipts.ts` created
- ✅ `apps/mobile/features/chat/hooks/useTypingIndicators.ts` created
- ✅ `apps/mobile/features/chat/hooks/useReactions.ts` created

### Phase 2: Basic Message UI (Week 2) ✅ COMPLETE

**Status:** All Phase 2 components have been created.

#### ✅ Agent 5: MessageItem Component - DONE

- ✅ `apps/mobile/features/chat/components/MessageItem.tsx` created
- ✅ Renders text messages with sender name/avatar
- ✅ Highlights @mentions (detects `@username` patterns)
- ✅ Shows read receipts (✓ sent, ✓✓ delivered, highlighted + count when read)
- ✅ Shows reactions below message
- ✅ Handles deleted/edited states
- ✅ Tappable for actions (reply, react, etc.)

#### ✅ Agent 6: MessageList Component - DONE

- ✅ `apps/mobile/features/chat/components/MessageList.tsx` created
- ✅ Uses FlashList for virtualization
- ✅ Handles pagination (load more on scroll up)
- ✅ Auto-scroll to bottom on new message
- ✅ Groups messages by date (shows date separators)

#### ✅ Agent 7: MessageInput Component - DONE

- ✅ `apps/mobile/features/chat/components/MessageInput.tsx` created
- ✅ Text input with send button
- ✅ @mention autocomplete (`MentionInput` component)
- ✅ Image paste/upload support
- ✅ Shows typing indicator when user types
- ✅ Handles reply-to state (ReplyPreview above input)

### Phase 3: Advanced Features (Week 3) ✅ MOSTLY COMPLETE

**Status:** Most components exist, but some may need refinement.

#### ✅ Agent 8: Reply & Link Previews - DONE

- ✅ `apps/mobile/features/chat/components/EventLinkPreview.tsx` created
- ✅ `apps/mobile/features/chat/components/EventLinkCard.tsx` created
- ✅ Link preview functionality implemented
- ✅ Event link detection and rendering working

#### ✅ Agent 9: Event Cards & Images - DONE

- ✅ `apps/mobile/features/chat/components/EventLinkCard.tsx` exists
- ✅ Event URL detection (`/e/[shortId]`) implemented
- ✅ Queries Convex for event data
- ✅ Renders event metadata as card
- ✅ Image display in messages working

#### ✅ Agent 10: Reactions UI - DONE

- ✅ `apps/mobile/features/chat/components/CustomReactionList.tsx` exists
- ✅ `apps/mobile/features/chat/components/MessageActionsOverlay.tsx` exists
- ✅ Reaction functionality via `useReactions` hook
- ✅ Add/remove reactions working
- ✅ Reaction counts displayed on messages

### Phase 4: Integration (Week 4-5) ⚠️ IN PROGRESS

**Status:** Components exist but still use StreamChat. Need refactoring.

#### ✅ Agent 11: ChatRoomScreen - COMPLETE

- ✅ `apps/mobile/features/chat/components/ConvexChatRoomScreen.tsx` created
- ✅ **Uses Convex hooks and components** (no StreamChat SDK)
- ✅ Uses Convex-backed components:
  - ✅ `MessageList` component for message display
  - ✅ `MessageInput` component for sending messages
  - ✅ `TypingIndicator` component for typing status
  - ✅ `useTypingIndicators` hook integrated
  - ✅ `useReactions` hook available (via MessageItem)
- ✅ Mark messages as read when viewing (via `useReadState`)
- ✅ Error states and loading states handled
- ✅ Navigation from group details working
- ✅ Route updated to use new component

#### ✅ Agent 12: ChatInboxScreen - COMPLETE

- ✅ `apps/mobile/features/chat/components/ChatInboxScreen.tsx` created
- ✅ **Uses Convex hooks** (no StreamChat client)
- ✅ Lists all user's channels using `useChatRooms` hook
- ✅ Shows unread counts using `getUnreadCounts` query
- ✅ Shows last message preview from channel metadata
- ✅ Sorts by most recent activity
- ✅ Handles empty state
- ✅ Route updated to use new component

### Phase 5: Cleanup & Testing (Week 6) ❌ NOT STARTED

**Status:** Cannot proceed until Phase 4 is complete.

#### ❌ Agent 13: Remove StreamChat - BLOCKED

- ❌ StreamChat SDK still in dependencies (`package.json` has `stream-chat`, `stream-chat-expo`, `stream-chat-react`)
- ❌ `apps/mobile/providers/StreamChatProvider.tsx` still exists and is used
- ❌ `apps/mobile/features/chat/components/StreamInboxScreen.tsx` still exists
- ❌ Stream webhooks still exist in `apps/convex/http.ts` (needs verification)
- ❌ App router (`apps/mobile/app/inbox/index.tsx`) still uses `StreamInboxScreen`
- ❌ `STREAM_API_KEY`, `STREAM_API_SECRET` env vars still referenced

**Blocked by:** Phase 4 completion (ChatRoomScreen and ChatInboxScreen refactoring)

#### ❌ Agent 14: End-to-End Testing - BLOCKED

- ❌ Cannot test until StreamChat is removed and Convex components integrated
- ❌ Need to verify all features in manual testing checklist:
  - [ ] Send/receive text messages
  - [ ] @mentions work (autocomplete, highlight, notify)
  - [ ] Read receipts display correctly
  - [ ] Images upload and display
  - [ ] Link previews render
  - [ ] Event cards display
  - [ ] Reply-to works
  - [ ] Reactions work
  - [ ] Typing indicators work
  - [ ] Unread counts update
  - [ ] Pagination works

**Blocked by:** Phase 4 and Phase 5 completion

---

## Key Requirements

### Features That MUST Work

1. **Text Messages:** Send and receive with real-time updates
2. **@Mentions:**
   - Autocomplete when typing `@`
   - Highlight in messages
   - Notifications already handled by backend
3. **Read Receipts:**
   - ✓ when sent locally
   - ✓✓ when delivered to server
   - Highlighted ✓✓ + count when read by others (e.g., "2 ✓✓")
4. **Images:** Paste/upload to S3, display in messages
5. **Link Previews:** Auto-detect URLs, show preview card
6. **Event Cards:** Detect `/e/[shortId]` URLs, render event data as card
7. **Reply-to:** Tap message to reply, show reply context
8. **Reactions:** Add/remove emoji reactions
9. **Typing Indicators:** Real-time typing status
10. **Unread Counts:** Accurate unread message counts
11. **Pagination:** Load more messages on scroll up

### Features NOT Needed

- ❌ Voice messages
- ❌ Message search
- ❌ Export chat history
- ❌ Historical message migration from StreamChat
- ❌ Feature flags or gradual rollout
- ❌ Monitoring/alerting (app has zero users)

### Design Requirements

- Match existing app design system
- Use FlashList for message virtualization (performance)
- Optimistic updates for instant UI feedback
- Handle errors gracefully (retry logic)
- Offline support (show cached messages, queue sends)

---

## How to Execute

### Step 1: Analyze & Plan

Before spawning any sub-agents:

1. Read `docs/architecture/CONVEX_MESSAGING_MIGRATION_PLAN.md` fully
2. Explore the existing StreamChat components to understand current UI/UX
3. Review the Convex backend functions to understand available APIs
4. Identify any missing backend functions (e.g., `getMessageReadBy`)

### Step 2: Spawn Sub-Agents in Parallel

For each phase:

1. Spawn all agents in that phase **at the same time** (parallel)
2. Give each agent a clear, self-contained task with:
   - What files to create
   - What the component/hook should do
   - What Convex functions to call
   - How to test it
3. Each agent should complete their work **without asking questions** - provide all context upfront

**Example:**

```
Task("Create useMessages hook", subagent_type="general-purpose", prompt="""
Create `apps/mobile/features/chat/hooks/useMessages.ts`:

- Use `useQuery(api.functions.messaging.messages.list, { channelId, limit: 50 })`
- Implement pagination with cursor-based loading
- Subscribe to real-time updates
- Return: { messages, loadMore, hasMore, isLoading }

Test by calling from a test component and verifying messages load.

Reference the Convex backend at apps/convex/functions/messaging/messages.ts.
""")
```

### Step 3: Integration & Testing

After all sub-agents complete:

1. Integrate components in ChatRoomScreen and ChatInboxScreen
2. Replace StreamChat in app router
3. Test end-to-end in iOS Simulator
4. Fix any integration issues
5. Remove StreamChat dependency

### Step 4: Validation

Before declaring complete:

- [ ] All features in "Definition of Done" checklist work
- [ ] No TypeScript errors
- [ ] No runtime errors in Simulator
- [ ] App builds successfully
- [ ] StreamChat completely removed from codebase

---

## Important Notes

### Convex-Specific Patterns

**Queries (read data):**

```typescript
const messages = useQuery(api.functions.messaging.messages.list, { channelId });
```

**Mutations (write data):**

```typescript
const sendMessage = useMutation(api.functions.messaging.messages.send);
await sendMessage({ channelId, content: "Hello" });
```

**Optimistic Updates:**

```typescript
const sendMessage = useMutation(api.functions.messaging.messages.send);
// Show message immediately in UI
setOptimisticMessage({ id: "temp", content: "Hello", status: "sending" });
// Then send to server
await sendMessage({ channelId, content: "Hello" });
```

### File Locations

- Backend functions: `apps/convex/functions/messaging/`
- Frontend components: `apps/mobile/features/chat/components/`
- Frontend hooks: `apps/mobile/features/chat/hooks/`
- Frontend utils: `apps/mobile/features/chat/utils/`
- Tests: `apps/convex/__tests__/messaging/` (backend only for now)

### Common Pitfalls

1. **Don't forget real-time subscriptions** - Convex queries auto-update, but you need to subscribe
2. **Use FlashList, not FlatList** - Better performance for long message lists
3. **Handle loading/error states** - Queries can be undefined initially
4. **Optimistic updates for UX** - Show messages immediately, sync to server async
5. **Image URLs in attachments array** - Use `attachments: [{ type: 'image', url }]` field
6. **Mentions stored as user IDs** - `mentionedUserIds: [userId1, userId2]` array

---

## Success Criteria

You will have **successfully completed this task** when:

1. ✅ All chat functionality works in iOS Simulator
2. ✅ All features in "Definition of Done" checklist are working
3. ✅ StreamChat SDK is completely removed from the codebase
4. ✅ No TypeScript errors
5. ✅ No runtime errors
6. ✅ App builds and runs successfully
7. ✅ Manual testing checklist passes (see migration plan doc)

---

## Final Notes

- **Work autonomously** - spawn sub-agents without asking for permission
- **Parallelize aggressively** - spawn 4-5 agents at once when tasks are independent
- **Test incrementally** - each sub-agent should test their component/hook works
- **Integrate at the end** - put all pieces together in ChatRoomScreen/ChatInboxScreen
- **Be decisive** - if you encounter ambiguity, make a reasonable choice and move forward
- **Reference existing code** - look at how current StreamChat components work for UI/UX patterns

**You can do this! Start by reading the migration plan, then spawn your first batch of sub-agents.**

---

## Next Steps (Priority Order)

Since Phases 1-3 are complete, focus on:

1. **Refactor ChatRoomScreen** (Agent 11)
   - Replace StreamChat components with Convex-backed `MessageList` and `MessageInput`
   - Remove StreamChat imports
   - Use Convex hooks (`useMessages`, `useSendMessage`, `useTypingIndicators`, etc.)

2. **Create ChatInboxScreen** (Agent 12)
   - Create new component using `useChatRooms` hook
   - Replace `StreamInboxScreen` usage in router
   - Show unread counts and last messages from Convex

3. **Remove StreamChat** (Agent 13)
   - Remove dependencies from `package.json`
   - Delete `StreamChatProvider.tsx`
   - Remove Stream webhooks
   - Clean up environment variables

4. **End-to-End Testing** (Agent 14)
   - Test all features in iOS Simulator
   - Verify checklist items work correctly
