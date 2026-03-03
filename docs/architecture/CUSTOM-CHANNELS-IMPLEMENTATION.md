# Custom Channels Implementation Spec

## Orchestrator Instructions

**You are the orchestrator agent.** Your job is to coordinate the implementation of custom channels by spawning subagents to work in parallel. Do NOT implement tasks yourself - delegate to subagents and coordinate their work.

### Your Responsibilities
1. Read this spec thoroughly before starting
2. Spawn subagents for tasks that can run in parallel
3. Wait for blocking dependencies before spawning dependent tasks
4. Review subagent outputs and resolve any integration issues
5. Track progress and report completion

### Parallelization Strategy

```
PHASE 1 (Parallel - No Dependencies)
├── Task 1A: Schema Migration
├── Task 1B: Slug Utilities
└── Task 1C: Helper Functions

PHASE 2 (Parallel - Depends on Phase 1)
├── Task 2A: Create Channel Mutation
├── Task 2B: Leave Channel Mutation
├── Task 2C: Archive Channel Mutation
└── Task 2D: Toggle Leaders Channel Mutation

PHASE 3 (Parallel - Depends on Phase 1)
├── Task 3A: Add Members Mutation
├── Task 3B: Remove Member Mutation
└── Task 3C: List Channels Query

PHASE 4 (Parallel - Depends on Phase 2 & 3)
├── Task 4A: Membership Sync Update
└── Task 4B: Channel Queries Update

PHASE 5 (Sequential - Depends on Phase 4)
├── Task 5A: Route Migration
├── Task 5B: Create Channel UI
├── Task 5C: Members Management UI
└── Task 5D: Group Page Channels Tab

PHASE 6 (After all above)
└── Task 6: Integration Testing
```

---

## Context (Include in ALL Subagent Prompts)

```
PROJECT CONTEXT:
- Monorepo with Convex backend at /apps/convex and React Native mobile app at /apps/mobile
- Using Expo Router for navigation
- Convex for real-time database and mutations
- Current channels: "main" (general) and "leaders" per group
- Goal: Add custom channels with manual membership management

KEY FILES:
- Schema: /apps/convex/schema.ts
- Channel functions: /apps/convex/functions/messaging/channels.ts
- Membership sync: /apps/convex/functions/sync/memberships.ts
- Validators: /apps/convex/lib/validators.ts
- Chat routes: /apps/mobile/app/inbox/[groupId]/
- Inbox UI: /apps/mobile/features/chat/components/

CHANNEL CATEGORIES:
- Auto Channels: "main", "leaders" - membership automatic, can't leave directly
- Custom Channels: user-created - manual membership, can leave

URL PATTERN:
- /inbox/[groupId]/[channelSlug] (e.g., /inbox/abc123/directors)
- Slugs are lowercase, alphanumeric + hyphens, unique per group, immutable

PERMISSIONS:
- Create channel: Group leaders only
- Add/remove members: Channel owner OR any group leader
- Archive: Channel owner OR any group leader
- Leave: Anyone (custom channels only)
```

---

## Task Definitions

### TASK 1A: Schema Migration

**Depends on:** Nothing
**Parallel with:** 1B, 1C
**Output:** Updated schema.ts with new field

```
TASK: Add `slug` field to chatChannels table

FILE TO MODIFY: /apps/convex/schema.ts

CHANGES:
1. Find the `chatChannels` table definition
2. Add this field after `groupId`:
   slug: v.string(),  // URL-friendly, unique per group, immutable

3. Add this index after existing indexes:
   .index("by_group_slug", ["groupId", "slug"])

DO NOT:
- Add any other fields (no `category`, no `isEnabled` - we derive these)
- Remove any existing fields
- Modify any other tables

ACCEPTANCE CRITERIA:
- Schema compiles without errors
- Index is defined for groupId + slug lookup
```

---

### TASK 1B: Slug Utilities

**Depends on:** Nothing
**Parallel with:** 1A, 1C
**Output:** New utility file for slug generation

```
TASK: Create slug generation utilities

FILE TO CREATE: /apps/convex/lib/slugs.ts

IMPLEMENTATION:

/**
 * Reserved slugs that cannot be used for custom channels
 */
export const RESERVED_SLUGS = ['general', 'leaders', 'create', 'settings', 'members'];

/**
 * Generate a URL-friendly slug from a channel name
 * Handles collisions by appending -2, -3, etc.
 */
export function generateChannelSlug(name: string, existingSlugs: string[]): string {
  // 1. Lowercase the name
  // 2. Replace non-alphanumeric with hyphens
  // 3. Remove leading/trailing hyphens
  // 4. Truncate to 50 chars
  // 5. If reserved, append "-channel"
  // 6. If collision, append -2, -3, etc. (case-insensitive check)

  let base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 50);

  if (RESERVED_SLUGS.includes(base)) {
    base = `${base}-channel`;
  }

  const lowerSlugs = existingSlugs.map(s => s.toLowerCase());
  let slug = base;
  let counter = 2;

  while (lowerSlugs.includes(slug)) {
    slug = `${base}-${counter}`;
    counter++;
  }

  return slug;
}

/**
 * Validate a slug format
 */
export function isValidSlug(slug: string): boolean {
  return /^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug) && slug.length <= 50;
}

ACCEPTANCE CRITERIA:
- "Directors" -> "directors"
- "BK Sunday Service" -> "bk-sunday-service"
- "Create" -> "create-channel" (reserved)
- "Directors" with existing ["directors"] -> "directors-2"
- Case insensitive collision detection
```

---

### TASK 1C: Helper Functions

**Depends on:** Nothing
**Parallel with:** 1A, 1B
**Output:** Helper functions for channel type checking

```
TASK: Add channel type helper functions

FILE TO MODIFY: /apps/convex/lib/helpers.ts (or create if doesn't exist)

ADD THESE FUNCTIONS:

/**
 * Check if a channel type is an auto-managed channel
 */
export function isAutoChannel(channelType: string): boolean {
  return channelType === "main" || channelType === "leaders";
}

/**
 * Check if a channel type is a custom channel
 */
export function isCustomChannel(channelType: string): boolean {
  return channelType === "custom";
}

/**
 * Get the display category for a channel type
 */
export function getChannelCategory(channelType: string): "auto" | "custom" {
  return isAutoChannel(channelType) ? "auto" : "custom";
}

ACCEPTANCE CRITERIA:
- Functions exported and usable from other files
- isAutoChannel("main") === true
- isAutoChannel("leaders") === true
- isAutoChannel("custom") === false
- isCustomChannel("custom") === true
```

---

### TASK 2A: Create Channel Mutation

**Depends on:** 1A, 1B, 1C
**Parallel with:** 2B, 2C, 2D
**Output:** createCustomChannel mutation

```
TASK: Implement createCustomChannel mutation

FILE TO MODIFY: /apps/convex/functions/messaging/channels.ts

ADD THIS MUTATION:

export const createCustomChannel = mutation({
  args: {
    token: v.string(),
    groupId: v.id("groups"),
    name: v.string(),
    description: v.optional(v.string()),
  },
  returns: v.object({
    channelId: v.id("chatChannels"),
    slug: v.string(),
  }),
  handler: async (ctx, args) => {
    // 1. Authenticate user with requireAuth
    // 2. Verify caller is group leader (use getActiveMembership + isLeaderRole)
    // 3. Count existing non-archived channels for this group
    //    - If >= 20, throw error: "This group has reached the maximum of 20 channels. Archive some channels to create new ones."
    // 4. Validate name: trim, check 1-50 chars
    //    - If invalid, throw: "Channel name must be 1-50 characters."
    // 5. Get existing slugs for this group
    // 6. Generate slug using generateChannelSlug()
    // 7. Insert chatChannels record:
    //    - groupId, slug, channelType: "custom", name, description
    //    - createdById: userId, createdAt: Date.now(), updatedAt: Date.now()
    //    - isArchived: false, memberCount: 1
    // 8. Insert chatChannelMembers record:
    //    - channelId, userId, role: "owner", joinedAt: Date.now(), isMuted: false
    // 9. Return { channelId, slug }
  },
});

ERROR MESSAGES:
- Not a leader: "Only group leaders can create channels."
- Channel limit: "This group has reached the maximum of 20 channels. Archive some channels to create new ones."
- Invalid name: "Channel name must be 1-50 characters."

ACCEPTANCE CRITERIA:
- Only group leaders can create
- Slug is auto-generated and unique
- Creator becomes owner
- Channel limit enforced at 20
```

---

### TASK 2B: Leave Channel Mutation

**Depends on:** 1C
**Parallel with:** 2A, 2C, 2D
**Output:** leaveChannel mutation

```
TASK: Implement leaveChannel mutation

FILE TO MODIFY: /apps/convex/functions/messaging/channels.ts

ADD THIS MUTATION:

export const leaveChannel = mutation({
  args: {
    token: v.string(),
    channelId: v.id("chatChannels"),
  },
  handler: async (ctx, args) => {
    // 1. Authenticate user
    // 2. Get channel, throw if not found
    // 3. Check if auto channel - block with helpful error:
    //    - "main": "You can't leave the General channel. To leave, you need to leave the group entirely from group settings."
    //    - "leaders": "You can't leave the Leaders channel directly. You're in this channel because you're a group leader. Ask another leader to change your role to Member, and you'll be automatically removed."
    // 4. Get user's channel membership, throw if not a member
    // 5. If user is owner:
    //    a. Find other active members
    //    b. If others exist, promote oldest to owner
    //    c. Schedule notification to new owner
    // 6. Soft delete membership (set leftAt: Date.now())
    // 7. Decrement memberCount
    // 8. If memberCount === 0, archive channel
  },
});

USE ConvexError FOR ERRORS:
throw new ConvexError({
  code: "CANNOT_LEAVE_AUTO_CHANNEL",
  message: "...",
});

ACCEPTANCE CRITERIA:
- Can leave custom channels
- Cannot leave auto channels (helpful error)
- Owner leaving promotes next member
- Last member leaving archives channel
```

---

### TASK 2C: Archive Channel Mutation

**Depends on:** 1C
**Parallel with:** 2A, 2B, 2D
**Output:** archiveCustomChannel mutation

```
TASK: Implement archiveCustomChannel mutation

FILE TO MODIFY: /apps/convex/functions/messaging/channels.ts

ADD THIS MUTATION:

export const archiveCustomChannel = mutation({
  args: {
    token: v.string(),
    channelId: v.id("chatChannels"),
  },
  handler: async (ctx, args) => {
    // 1. Authenticate user
    // 2. Get channel, throw if not found
    // 3. If not custom channel, throw: "You can't archive auto channels. Disable them in group settings instead."
    // 4. Verify caller is channel owner OR group leader
    //    - Get channel membership for caller
    //    - Get group membership for caller
    //    - canArchive = membership.role === "owner" || isLeaderRole(groupMembership.role)
    // 5. If !canArchive, throw permission error
    // 6. Update channel: isArchived: true, archivedAt: Date.now(), updatedAt: Date.now()
    // 7. Get all active members
    // 8. Schedule batch notification: "channel_archived"
  },
});

ACCEPTANCE CRITERIA:
- Only custom channels can be archived
- Channel owner can archive
- Any group leader can archive
- Members are notified
```

---

### TASK 2D: Toggle Leaders Channel Mutation

**Depends on:** Nothing (uses existing sync functions)
**Parallel with:** 2A, 2B, 2C
**Output:** toggleLeadersChannel mutation

```
TASK: Implement toggleLeadersChannel mutation

FILE TO MODIFY: /apps/convex/functions/messaging/channels.ts

ADD THIS MUTATION:

export const toggleLeadersChannel = mutation({
  args: {
    token: v.string(),
    groupId: v.id("groups"),
    enabled: v.boolean(),
  },
  handler: async (ctx, args) => {
    // 1. Authenticate user
    // 2. Verify caller is group leader
    // 3. Find leaders channel by group + slug "leaders"
    // 4. If enabling and not archived: return (no-op)
    // 5. If disabling and already archived: return (no-op)
    // 6. If enabling:
    //    a. Set isArchived: false, updatedAt: Date.now()
    //    b. Call syncLeadersChannelMembership(ctx, groupId) to re-add leaders
    // 7. If disabling:
    //    a. Set isArchived: true, archivedAt: Date.now(), updatedAt: Date.now()
    //    b. Get all active members of channel
    //    c. Set leftAt: Date.now() for each
    //    d. Set memberCount: 0
  },
});

NOTE: syncLeadersChannelMembership should already exist - find it and use it.
If it doesn't exist, create a helper that adds all current group leaders to the channel.

ACCEPTANCE CRITERIA:
- Only group leaders can toggle
- Enabling re-adds all leaders
- Disabling preserves history (archive, not delete)
```

---

### TASK 3A: Add Members Mutation

**Depends on:** 1C
**Parallel with:** 3B, 3C
**Output:** addChannelMembers mutation

```
TASK: Implement addChannelMembers mutation

FILE TO MODIFY: /apps/convex/functions/messaging/channels.ts

ADD THIS MUTATION:

export const addChannelMembers = mutation({
  args: {
    token: v.string(),
    channelId: v.id("chatChannels"),
    userIds: v.array(v.id("users")),
  },
  returns: v.object({ addedCount: v.number() }),
  handler: async (ctx, args) => {
    // 1. Authenticate user
    // 2. Get channel, verify it's custom type
    //    - If not custom: "You can only add members to custom channels."
    // 3. Check permission: caller is channel owner OR group leader
    //    - If not: "Only the channel owner or group leaders can add members."
    // 4. Validate all userIds are active group members
    //    - Collect invalid users' names
    //    - If any invalid: "These people aren't members of the group: {names}. Add them to the group first."
    // 5. For each valid user:
    //    a. Check if already a channel member
    //    b. If has leftAt, reactivate (clear leftAt, update joinedAt)
    //    c. If new, insert with role: "member"
    //    d. Count additions
    // 6. Update channel memberCount
    // 7. Schedule batch notification to added users
    // 8. Return { addedCount }
  },
});

ACCEPTANCE CRITERIA:
- Only works on custom channels
- Channel owner can add
- Any group leader can add
- Non-group members rejected with helpful error
- Previously removed members can be re-added
```

---

### TASK 3B: Remove Member Mutation

**Depends on:** 1C
**Parallel with:** 3A, 3C
**Output:** removeChannelMember mutation

```
TASK: Implement removeChannelMember mutation

FILE TO MODIFY: /apps/convex/functions/messaging/channels.ts

ADD THIS MUTATION:

export const removeChannelMember = mutation({
  args: {
    token: v.string(),
    channelId: v.id("chatChannels"),
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    // 1. Authenticate caller
    // 2. Get channel, verify it's custom type
    // 3. Check permission: caller is channel owner OR group leader
    // 4. Get target user's channel membership
    //    - If not a member: "This person is not a member of this channel."
    // 5. If removing owner:
    //    a. Find other active members
    //    b. Promote oldest to owner
    // 6. Soft delete membership (set leftAt)
    // 7. Decrement memberCount
    // 8. If memberCount === 0, archive channel
    // 9. Schedule notification to removed user
  },
});

ACCEPTANCE CRITERIA:
- Only works on custom channels
- Channel owner can remove
- Any group leader can remove
- Removing owner promotes next member
- Removed user is notified
```

---

### TASK 3C: List Channels Query

**Depends on:** 1A (needs slug field)
**Parallel with:** 3A, 3B
**Output:** listGroupChannels query

```
TASK: Implement listGroupChannels query

FILE TO MODIFY: /apps/convex/functions/messaging/channels.ts

ADD THIS QUERY:

export const listGroupChannels = query({
  args: {
    token: v.string(),
    groupId: v.id("groups"),
    includeArchived: v.optional(v.boolean()),
  },
  returns: v.array(v.object({
    _id: v.id("chatChannels"),
    slug: v.string(),
    channelType: v.string(),
    name: v.string(),
    description: v.optional(v.string()),
    memberCount: v.number(),
    isArchived: v.boolean(),
    isMember: v.boolean(),
    role: v.optional(v.string()),
    unreadCount: v.number(),
  })),
  handler: async (ctx, args) => {
    // 1. Authenticate user
    // 2. Verify user is group member
    // 3. Query all channels for group
    //    - Filter by isArchived unless includeArchived
    // 4. For each channel:
    //    a. Check if user is a member
    //    b. Get their role if member
    //    c. Get unread count from chatReadState
    // 5. Return sorted: main first, leaders second, custom by name
  },
});

ACCEPTANCE CRITERIA:
- Returns all channels user has access to
- Includes membership status
- Includes unread counts
- Proper sorting
```

---

### TASK 4A: Membership Sync Update

**Depends on:** Phase 1 complete
**Parallel with:** 4B
**Output:** Updated sync logic for custom channels

```
TASK: Update membership sync to handle custom channels on group leave

FILE TO MODIFY: /apps/convex/functions/sync/memberships.ts

FIND: syncUserChannelMembershipsLogic function (or similar)

ADD THIS LOGIC after existing main/leaders sync:

// Handle custom channels when user leaves group
const groupMembership = await getGroupMembership(ctx, groupId, userId);
const isActiveGroupMember = groupMembership && !groupMembership.leftAt;

if (!isActiveGroupMember) {
  // Remove from ALL custom channels in this group
  const customChannels = await ctx.db
    .query("chatChannels")
    .withIndex("by_group", q => q.eq("groupId", groupId))
    .filter(q => q.eq(q.field("channelType"), "custom"))
    .collect();

  for (const channel of customChannels) {
    const channelMembership = await ctx.db
      .query("chatChannelMembers")
      .withIndex("by_channel_user", q =>
        q.eq("channelId", channel._id).eq("userId", userId)
      )
      .first();

    if (channelMembership && !channelMembership.leftAt) {
      // Handle owner leaving
      if (channelMembership.role === "owner") {
        const otherMembers = await ctx.db
          .query("chatChannelMembers")
          .withIndex("by_channel", q => q.eq("channelId", channel._id))
          .filter(q => q.and(
            q.neq(q.field("userId"), userId),
            q.eq(q.field("leftAt"), undefined)
          ))
          .collect();

        if (otherMembers.length > 0) {
          const newOwner = otherMembers.sort((a, b) => a.joinedAt - b.joinedAt)[0];
          await ctx.db.patch(newOwner._id, { role: "owner" });
        } else {
          // Archive empty channel
          await ctx.db.patch(channel._id, {
            isArchived: true,
            archivedAt: Date.now(),
          });
        }
      }

      await ctx.db.patch(channelMembership._id, { leftAt: Date.now() });
      await ctx.db.patch(channel._id, {
        memberCount: Math.max(0, channel.memberCount - 1),
        updatedAt: Date.now(),
      });
    }
  }
}

ACCEPTANCE CRITERIA:
- User leaving group is removed from all custom channels
- Owner leaving promotes next member
- Empty channels are archived
- Existing main/leaders sync still works
```

---

### TASK 4B: Channel Queries Update

**Depends on:** 1A (needs slug field)
**Parallel with:** 4A
**Output:** Updated getInboxChannels and getChannel queries

```
TASK: Update channel queries to use slug

FILE TO MODIFY: /apps/convex/functions/messaging/channels.ts

1. ADD/UPDATE: getChannelBySlug query
export const getChannelBySlug = query({
  args: {
    token: v.string(),
    groupId: v.id("groups"),
    slug: v.string(),
  },
  handler: async (ctx, args) => {
    // Query by_group_slug index
    // Verify user has access
    // Return channel with membership info
  },
});

2. UPDATE: getInboxChannels query (if exists)
- Include custom channels in the response
- Only show channels user is a member of
- Include slug in response for routing

3. ENSURE: All channel responses include the slug field

ACCEPTANCE CRITERIA:
- Can lookup channel by groupId + slug
- Inbox includes custom channels
- All responses have slug for routing
```

---

### TASK 5A: Route Migration

**Depends on:** 4B (queries must support slug)
**Sequential:** Do before 5B, 5C, 5D
**Output:** Updated routing to use slugs

```
TASK: Migrate chat routes from channelType to channelSlug

FILES TO MODIFY:
- /apps/mobile/app/inbox/[groupId]/[channelType].tsx -> rename to [channelSlug].tsx

CHANGES:
1. Rename file from [channelType].tsx to [channelSlug].tsx

2. Update the component to use slug parameter:
   - const { groupId, channelSlug } = useLocalSearchParams()
   - Instead of channelType === "general" || "leaders"
   - Use the slug directly to fetch channel

3. Update ConvexChatRoomScreen (or equivalent):
   - Accept slug instead of channelType
   - Use getChannelBySlug query

4. Update navigation calls throughout the app:
   - router.push(`/inbox/${groupId}/general`) (was "main")
   - router.push(`/inbox/${groupId}/leaders`)
   - router.push(`/inbox/${groupId}/${customSlug}`)

5. Add route for channel creation:
   - /apps/mobile/app/inbox/[groupId]/create.tsx

6. Add route for member management:
   - /apps/mobile/app/inbox/[groupId]/[channelSlug]/members.tsx

ACCEPTANCE CRITERIA:
- /inbox/[groupId]/general works
- /inbox/[groupId]/leaders works
- /inbox/[groupId]/custom-slug works
- No broken navigation
```

---

### TASK 5B: Create Channel UI

**Depends on:** 2A (mutation), 5A (routing)
**Parallel with:** 5C, 5D (after 5A)
**Output:** Create channel screen

```
TASK: Implement create channel screen

FILE TO CREATE: /apps/mobile/app/inbox/[groupId]/create.tsx

UI REQUIREMENTS:
1. Header: "Create Channel" with back button
2. Form fields:
   - Channel Name (required, max 50 chars)
   - Helper text: "Channel names cannot be changed after creation"
   - Description (optional, textarea)
3. Create button (disabled if name empty)
4. Loading state while creating
5. On success: navigate to new channel

COMPONENT STRUCTURE:
- Use existing form patterns from the codebase
- Use useMutation hook for createCustomChannel
- Handle errors with toast/alert

IMPLEMENTATION:
export default function CreateChannelScreen() {
  const { groupId } = useLocalSearchParams();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const createChannel = useMutation(api.functions.messaging.channels.createCustomChannel);

  const handleCreate = async () => {
    try {
      const { slug } = await createChannel({ groupId, name, description });
      router.replace(`/inbox/${groupId}/${slug}`);
    } catch (error) {
      // Show error toast
    }
  };

  // Render form...
}

ACCEPTANCE CRITERIA:
- Name validation (1-50 chars)
- Shows warning about immutable names
- Creates channel and navigates to it
- Error handling with user feedback
```

---

### TASK 5C: Members Management UI

**Depends on:** 3A, 3B (mutations), 5A (routing)
**Parallel with:** 5B, 5D
**Output:** Channel members management screen

```
TASK: Implement channel members management screen

FILE TO CREATE: /apps/mobile/app/inbox/[groupId]/[channelSlug]/members.tsx

UI REQUIREMENTS:
1. Header: "{Channel Name}" with back button, "+ Add" button
2. Members list:
   - Show all members with avatar, name
   - Owner has "Owner" badge
   - "Remove" button for each (except owner if caller is not owner)
3. Add members flow:
   - Opens member picker (existing component)
   - Only shows group members not already in channel
   - Multi-select
   - Confirm button
4. Archive channel button at bottom (destructive style)

QUERIES/MUTATIONS NEEDED:
- getCustomChannelMembers query (or use existing)
- addChannelMembers mutation
- removeChannelMember mutation
- archiveCustomChannel mutation

ACCESS CONTROL:
- Only accessible to channel owner or group leaders
- If not authorized, show error and go back

ACCEPTANCE CRITERIA:
- List all members
- Add members from group
- Remove members (with confirmation)
- Archive channel (with confirmation)
- Proper permission checks
```

---

### TASK 5D: Group Page Channels Tab

**Depends on:** 3C (listGroupChannels query)
**Parallel with:** 5B, 5C
**Output:** Channels tab on group detail page

```
TASK: Add Channels tab to group detail page

FILES TO MODIFY:
- Find group detail screen (likely /apps/mobile/features/groups/components/GroupDetailScreen.tsx or similar)

UI REQUIREMENTS:
1. Add "Channels" tab alongside existing tabs (About, Events, etc.)

2. Channels tab content:
   a. "AUTO CHANNELS" section header
      - General channel row (always)
      - Leaders channel row (if enabled, show toggle for leaders)

   b. "CUSTOM CHANNELS" section header
      - List of custom channels user is member of
      - Each row: icon, name, member count, "Leave" button
      - For leaders: also show "Manage" button

   c. "+ Create Channel" button (leaders only)

3. Channel row component:
   - Tap row -> navigate to channel
   - Leave button -> confirmation -> call leaveChannel
   - Manage button -> navigate to members screen

4. Auto channel info:
   - General: "All members" subtitle
   - Leaders: "X leaders" subtitle + "You're here because you're a leader" info text

ACCEPTANCE CRITERIA:
- Shows all channels user is in
- Can leave custom channels
- Leaders see management options
- Leaders can create channels
- Leaders can toggle leaders channel
```

---

### TASK 6: Integration Testing

**Depends on:** All previous tasks
**Output:** Verified working feature

```
TASK: Test the complete custom channels feature

TEST SCENARIOS:

1. CHANNEL CREATION
   - [ ] Leader creates channel with valid name
   - [ ] Non-leader cannot create (sees error)
   - [ ] Channel appears in group channels list
   - [ ] Slug is generated correctly
   - [ ] Creator is owner

2. MEMBERSHIP
   - [ ] Owner can add group members
   - [ ] Group leader (non-owner) can add members
   - [ ] Adding non-group member shows helpful error
   - [ ] Owner can remove members
   - [ ] Group leader can remove members
   - [ ] Removed user gets notification

3. LEAVING
   - [ ] Member can leave custom channel
   - [ ] Cannot leave general channel (helpful error)
   - [ ] Cannot leave leaders channel (helpful error)
   - [ ] Owner leaving promotes next member
   - [ ] Last member leaving archives channel

4. GROUP LEAVE CASCADE
   - [ ] User leaving group is removed from all custom channels
   - [ ] Owner leaving group promotes next member in each channel

5. NAVIGATION
   - [ ] /inbox/[groupId]/general works
   - [ ] /inbox/[groupId]/leaders works
   - [ ] /inbox/[groupId]/custom-slug works
   - [ ] Deep links work

6. GROUP SETTINGS
   - [ ] Leaders can toggle leaders channel
   - [ ] Disabling archives but preserves history
   - [ ] Re-enabling re-adds all leaders

REPORT:
- List any failing scenarios
- Note any bugs found
- Suggest fixes if obvious
```

---

## Migration Script

Run this AFTER Task 1A (schema) is deployed:

```typescript
// /apps/convex/migrations/addChannelSlugs.ts

import { internalMutation } from "../_generated/server";

export const addSlugsToExistingChannels = internalMutation({
  handler: async (ctx) => {
    const channels = await ctx.db.query("chatChannels").collect();

    for (const channel of channels) {
      if (channel.slug) continue; // Already has slug

      const slug = channel.channelType === "main" ? "general" :
                   channel.channelType === "leaders" ? "leaders" :
                   // Custom channels (if any exist) - generate from name
                   channel.name.toLowerCase()
                     .replace(/[^a-z0-9]+/g, '-')
                     .replace(/^-|-$/g, '')
                     .slice(0, 50);

      await ctx.db.patch(channel._id, { slug });
    }

    return { migratedCount: channels.length };
  },
});
```

---

## Notification Types to Add

Add these to /apps/convex/lib/notifications/definitions.ts:

```typescript
{
  type: "added_to_channel",
  description: "User added to custom channel",
  formatters: {
    push: (ctx) => ({
      title: `Added to ${ctx.channelName}`,
      body: `You've been added to "${ctx.channelName}" in ${ctx.groupName}`,
      data: { groupId: ctx.groupId, channelSlug: ctx.channelSlug },
    }),
  },
  defaultChannels: ["push"],
},
{
  type: "removed_from_channel",
  description: "User removed from custom channel",
  formatters: {
    push: (ctx) => ({
      title: `Removed from ${ctx.channelName}`,
      body: `You've been removed from "${ctx.channelName}"`,
      data: { groupId: ctx.groupId },
    }),
  },
  defaultChannels: ["push"],
},
{
  type: "channel_archived",
  description: "Channel was archived",
  formatters: {
    push: (ctx) => ({
      title: "Channel archived",
      body: `"${ctx.channelName}" has been archived`,
      data: { groupId: ctx.groupId },
    }),
  },
  defaultChannels: ["push"],
},
{
  type: "channel_ownership_transferred",
  description: "User became channel owner",
  formatters: {
    push: (ctx) => ({
      title: `You're now the owner`,
      body: `You're now the owner of "${ctx.channelName}"`,
      data: { groupId: ctx.groupId, channelSlug: ctx.channelSlug },
    }),
  },
  defaultChannels: ["push"],
},
```

---

## Summary for Orchestrator

**Total Tasks:** 15 tasks across 6 phases

**Parallelization:**
- Phase 1: 3 tasks in parallel
- Phase 2: 4 tasks in parallel
- Phase 3: 3 tasks in parallel
- Phase 4: 2 tasks in parallel
- Phase 5: 1 sequential + 3 parallel
- Phase 6: 1 task

**Estimated Time:** If fully parallelized, ~4-5 sequential phases of work

**Critical Path:** Schema (1A) → Mutations (2A-2D) → Queries (4B) → Routes (5A) → UI (5B-5D) → Testing (6)

**Start by spawning:** Tasks 1A, 1B, 1C in parallel
