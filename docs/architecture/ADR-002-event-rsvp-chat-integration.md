# ADR-002: Event RSVP with Chat Integration

**Status:** In Progress
**Date:** 2025-12-21
**Author:** Claude Code Agent

## Context

The app needs events with RSVP functionality that can be shared to group chats. Users should be able to:
- Create events with customizable RSVP options (Going, Maybe, Can't Go)
- Set event visibility (group-only, community, public)
- Post events to group chat
- Vote on RSVP options from the event details page
- See who's attending each event

## Technical Implementation

### Database Schema

The `meeting` table has these RSVP-related fields (defined in `apps/api-trpc/src/prisma/schema.prisma`):

```prisma
model meeting {
  // ... other fields
  rsvp_enabled   Boolean   @default(true)
  rsvp_options   Json?     // Array of RsvpOption objects
  visibility     String    @default("group")  // 'group' | 'community' | 'public'
  public_slug    String?   @unique
}

model meeting_rsvp {
  id             String   @id @default(uuid())
  meeting_id     String
  user_id        BigInt
  rsvp_option_id Int      // References rsvp_options[].id
  created_at     DateTime @default(now())
  updated_at     DateTime @updatedAt

  @@unique([meeting_id, user_id])  // One RSVP per user per meeting
}
```

**RSVP Options JSON Structure:**
```typescript
interface RsvpOption {
  id: number;      // 1, 2, or 3
  label: string;   // "Going 👍", "Maybe 🤔", "Can't Go 😢"
  enabled: boolean;
}

// Default options:
const DEFAULT_RSVP_OPTIONS: RsvpOption[] = [
  { id: 1, label: "Going 👍", enabled: true },
  { id: 2, label: "Maybe 🤔", enabled: true },
  { id: 3, label: "Can't Go 😢", enabled: true },
];
```

### API Endpoints (tRPC)

Located in `apps/api-trpc/src/routers/groups/`:

#### meetings.ts
- `meetings.create` - Creates meeting with RSVP options and visibility
- `meetings.update` - Updates meeting including RSVP settings
- `meetings.byId` - Returns meeting with `rsvpEnabled`, `rsvpOptions`, `visibility`

#### meetings-rsvp.ts
- `meetings.rsvp.submit` - Upsert user's RSVP (one per user per meeting)
- `meetings.rsvp.remove` - Delete user's RSVP
- `meetings.rsvp.list` - Get all RSVPs grouped by option with user details
- `meetings.rsvp.myRsvp` - Get current user's RSVP option

**Access Control by Visibility:**
- `group`: Only group members can RSVP
- `community`: Any community member can RSVP
- `public`: Any authenticated user can RSVP

### Frontend Components

#### EventDetails.tsx (`apps/mobile/features/leader-tools/components/`)
Shows event details with RSVP voting:

```typescript
// Key queries
const { data: meeting } = trpc.groups.meetings.byId.useQuery({ meetingId });
const { data: rsvpData } = trpc.groups.meetings.rsvp.list.useQuery({ meetingId });
const { data: myRsvp } = trpc.groups.meetings.rsvp.myRsvp.useQuery({ meetingId });

// Mutation
const submitRsvp = trpc.groups.meetings.rsvp.submit.useMutation({
  onSuccess: () => {
    utils.groups.meetings.rsvp.list.invalidate({ meetingId });
    utils.groups.meetings.rsvp.myRsvp.invalidate({ meetingId });
  },
});
```

**RSVP Section Visibility Logic:**
```typescript
{rsvpEnabled && rsvpOptions.length > 0 && !isPastEvent && (
  // Show RSVP options
)}
```

#### CreateEventScreen.tsx
- Toggle for "Enable RSVPs"
- RsvpOptionsEditor component for customizing options
- VisibilitySelector for group/community/public
- "Post to Group Chat" toggle

### Chat Integration (INCOMPLETE)

#### Current State
The `postEventToChat` helper (`apps/api-trpc/src/routers/groups/helpers/postEventToChat.ts`) posts events to Stream Chat, but currently only sends a **text message** like:

```
📅 Event: Christmas Party
📆 Dec 25, 2025 at 7:00 PM
📍 Church Hall
```

#### TODO: Custom Event Message UI
To display a rich event card with RSVP buttons in chat:

1. **Stream Chat Custom Message Type:**
   - Set `message.type = 'event'` or use custom attachment
   - Include event metadata in message

2. **EventMessage.tsx Component** (partially created):
   - Located at `apps/mobile/features/chat/components/EventMessage.tsx`
   - Needs to render event card with RSVP buttons
   - Should call `meetings.rsvp.submit` when user taps RSVP

3. **MessageBubble.tsx Integration:**
   - Check for event message type
   - Render EventMessage instead of regular text

**Stream Chat Message Structure for Events:**
```typescript
await channel.sendMessage({
  text: `📅 Event: ${title}`,
  custom_type: 'event',  // or use attachments
  event_data: {
    meetingId: meeting.id,
    title: meeting.title,
    scheduledAt: meeting.scheduled_at,
    rsvpEnabled: meeting.rsvp_enabled,
    rsvpOptions: meeting.rsvp_options,
  }
});
```

### Key Files Reference

| File | Purpose |
|------|---------|
| `apps/api-trpc/src/prisma/schema.prisma` | Database schema with meeting_rsvp table |
| `apps/api-trpc/src/routers/groups/meetings.ts` | Main meetings router |
| `apps/api-trpc/src/routers/groups/meetings-rsvp.ts` | RSVP sub-router |
| `apps/api-trpc/src/routers/groups/helpers/postEventToChat.ts` | Posts event to Stream Chat |
| `apps/api-trpc/src/routers/groups/helpers/index.ts` | Helper exports including isGroupLeader |
| `apps/mobile/features/leader-tools/components/EventDetails.tsx` | Event details with RSVP UI |
| `apps/mobile/features/leader-tools/components/CreateEventScreen.tsx` | Event creation form |
| `apps/mobile/features/chat/components/EventMessage.tsx` | Custom event message (incomplete) |
| `apps/mobile/features/chat/components/MessageBubble.tsx` | Chat message renderer |
| `apps/mobile/features/chat/types.ts` | Chat type definitions |

### Testing Notes

**How to Test This Feature:**

1. **Start the local servers:**
   ```bash
   # Start Convex and mobile together
   pnpm dev
   ```

2. **Login as test user:**
   - Phone: `2025550123`
   - OTP: `000000` (bypass code for testing)
   - This user is a leader in "Test 5" group in Demo Community

3. **Navigate to events:**
   - Go to a group where the user is a leader (e.g., "Test 5")
   - Click the **Events** button to see the events list
   - Click on an event to see the Event Details page with RSVP options
   - Or create a new event with "Enable RSVPs" toggled on

4. **Test RSVP functionality:**
   - Click on an RSVP option (Going/Maybe/Can't Go) to vote
   - Click the count badge to expand and see attendees
   - Click Edit button to modify event settings

**Important Notes:**
- **Events Need Saving:** Events created before RSVP feature need to be edited and saved to populate `rsvp_options` in the database
- **Leader Check:** Edit button only appears for group leaders - verify `userRole` from API response

## Next Steps

1. **Fix Chat Event Posting:** Implement custom message type for events in Stream Chat
2. **EventMessage Component:** Complete the rich event card UI with RSVP buttons
3. **Real-time Updates:** When user RSVPs from chat, update the count in real-time
4. **Public Event Pages:** Implement `/events/[slug]` for public event sharing

## Decision

Use Stream Chat's custom message types/attachments to display rich event cards in chat, rather than plain text messages. The RSVP state should be stored in our database (meeting_rsvp table), not in Stream Chat.
