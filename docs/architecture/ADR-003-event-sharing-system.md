# ADR-003: Partiful-Style Event Sharing System

**Status:** Complete
**Created:** 2024-12-22

## Context

Current event sharing in chat has issues:
1. Events take full width instead of rendering as chat bubbles
2. Event updates don't reflect in chat (static data embedded in message)
3. No shareable public URLs like Partiful

## Decision

Implement a Partiful-style event sharing system with:
- Shareable URLs: `{your-domain}/e/[shortId]`
- Rich event preview cards in chat (bubble style)
- Auto-updating event cards (live data fetching)
- Access control for community/group-only events

## Implementation Progress

### Phase 1: Database & Backend Foundation
- [x] Add nanoid package to api-trpc
- [x] Create `apps/api-trpc/src/lib/shortId.ts` utility
- [x] Add `short_id` field to meeting model in schema.prisma
- [x] Run database migration (`npx prisma db push`)
- [x] Create backfill script for existing events (`scripts/backfill-short-ids.ts`)
- [x] Update meetings.create to generate short_id
- [x] Add `byShortId` endpoint with access control

### Phase 2: Update Post to Chat
- [x] Modify postEventToChat to store only short_id

### Phase 3: Chat Rendering Updates
- [x] Update EventMessage for bubble styling
- [x] Update EventMessage to fetch live data
- [x] Add image viewer integration (tap to view full-size)
- [x] Remove fixed aspect ratio, preserve original
- [x] Add link detection to CustomMessage.tsx
- [x] Create EventLinkCard component

### Phase 4: Public Event Pages
- [x] Create `/e/[shortId]` route
- [x] Create AccessPromptScreen component
- [x] Handle sign_in, join_community, request_group prompts

### Phase 5: Image Handling
- [x] Add save/share functionality for cover images

---

## Technical Details

### Short ID Format
Using nanoid with URL-safe alphabet, 8 characters (e.g., `V1StGXR8`)

### Access Control Response
```typescript
{
  hasAccess: boolean;
  accessPrompt?: {
    type: 'sign_in' | 'join_community' | 'request_group';
    message: string;
    communityId?: bigint;
    groupId?: string;
  };
}
```

### Chat Message Payload (New)
```typescript
event: {
  short_id: string;  // Primary - for live fetching
  meeting_id: string; // Fallback for old messages
  group_id: string;
}
```

### Bubble Styling
```typescript
bubbleContainer: {
  maxWidth: '85%',
  alignSelf: 'flex-start', // or flex-end for own messages
}
```

### Link Detection
Regex: `/{your-domain}\/e\/([a-zA-Z0-9]+)/g` (domain configured in domain.ts)

---

## Critical Files

| File | Changes |
|------|---------|
| `apps/api-trpc/src/prisma/schema.prisma` | Add `short_id` field |
| `apps/api-trpc/src/routers/groups/meetings.ts` | Add `byShortId` endpoint, update `create` |
| `apps/api-trpc/src/routers/groups/helpers/postEventToChat.ts` | Store only `short_id` |
| `apps/mobile/features/chat/components/EventMessage.tsx` | Live data, bubble style, image handling |
| `apps/mobile/features/chat/components/CustomMessage.tsx` | Link detection |
| `apps/mobile/features/chat/types.ts` | Update EventData interface |
| `apps/mobile/app/e/[shortId].tsx` | New public event page |

## Backwards Compatibility

For existing chat messages without `short_id`:
```typescript
const { data: event } = shortId
  ? trpc.groups.meetings.byShortId.useQuery({ shortId })
  : trpc.groups.meetings.byId.useQuery({ meetingId });
```
