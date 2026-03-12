# Plan: Shared Channel Member Selection

## Problem

When a group is invited to a shared channel and accepts, **all members of that group** automatically get access. There's no way to hand-pick which members from the secondary group participate. The user wants to select specific people from other groups to add to a shared channel **without** adding them to the primary group.

## Current State

- **`addChannelMembers`** mutation (channels.ts:2086) already adds users directly to `chatChannelMembers` without touching `groupMembers` — but it's restricted to custom channels
- **members.tsx** screen already has an "Add Members" modal with `MemberSearch` in multi-select mode — but only for custom channels
- **Shared channel access** is currently group-level: if your group is in `sharedGroups` with status "accepted", ALL group members can see the channel
- **`respondToChannelInvite`** only updates the `sharedGroups` status — it doesn't create individual `chatChannelMembers` entries

## Approach

Add a `memberSelection` mode to shared channels so that when a group is shared, the primary group leader can choose between:
- **"All members"** (current behavior — all secondary group members get access)
- **"Selected members"** (new — only hand-picked members get `chatChannelMembers` entries)

This requires changes in 3 areas: schema, backend, and frontend.

---

## Implementation Steps

### Step 1: Schema — Add `memberSelection` to `sharedGroups`

**File:** `apps/convex/schema.ts`

Add a `memberSelection` field to each entry in the `sharedGroups` array:

```typescript
sharedGroups: v.optional(v.array(v.object({
  groupId: v.id("groups"),
  status: v.union(v.literal("pending"), v.literal("accepted")),
  invitedById: v.id("users"),
  invitedAt: v.number(),
  respondedById: v.optional(v.id("users")),
  respondedAt: v.optional(v.number()),
  sortOrder: v.optional(v.number()),
  // NEW: Controls whether all group members or only selected members have access
  memberSelection: v.optional(v.union(v.literal("all"), v.literal("selected"))),
}))),
```

Default is `undefined` which means `"all"` (backwards compatible).

### Step 2: Backend — Allow `addChannelMembers` for shared channels

**File:** `apps/convex/functions/messaging/channels.ts`

Modify `addChannelMembers` (line ~2086):
- Currently restricted to custom channels — extend to also allow shared channels
- Auth check: caller must be a leader of the primary group OR a leader of an accepted secondary group
- When adding members to a shared channel with `memberSelection: "selected"`, validate that each user is a member of one of the accepted shared groups (or the primary group)
- Create `chatChannelMembers` entries for each selected user (same as current custom channel logic)

### Step 3: Backend — Update channel access control for "selected" mode

**File:** `apps/convex/functions/messaging/channels.ts`

Modify the shared channel access logic in `getChannelBySlug` (lines ~197-225) and `getChannelsByGroup` (lines ~287-357):

- When `memberSelection` is `"all"` (or undefined): current behavior — any member of an accepted shared group can access the channel
- When `memberSelection` is `"selected"`: check for an active `chatChannelMembers` entry for the user — only explicitly added members can access

### Step 4: Backend — Update `inviteGroupToChannel` to accept `memberSelection`

**File:** `apps/convex/functions/messaging/sharedChannels.ts`

Modify `inviteGroupToChannel` (line ~32):
- Add optional `memberSelection` arg (default `"all"`)
- Store it in the `sharedGroups` entry

### Step 5: Backend — New mutation `addMembersToSharedChannel`

**File:** `apps/convex/functions/messaging/sharedChannels.ts`

Create a new convenience mutation:
```typescript
export const addMembersToSharedChannel = mutation({
  args: {
    token: v.string(),
    channelId: v.id("chatChannels"),
    userIds: v.array(v.id("users")),
  },
  handler: async (ctx, args) => {
    // 1. Verify channel is shared
    // 2. Verify caller is leader of primary group or an accepted secondary group
    // 3. For each userId, verify they're a member of one of the shared groups
    // 4. Create chatChannelMembers entries (skip if already active member)
    // 5. Update memberCount
    // 6. Return { addedCount }
  },
});
```

### Step 6: Frontend — Add member picker to shared channel invite flow

**File:** `apps/mobile/app/inbox/[groupId]/[channelSlug]/members.tsx`

When inviting a group to a shared channel (the "Share with Groups" modal), add an option:
- After selecting a group to share with, show a choice: "Add all members" vs "Select members"
- If "Select members" is chosen, show a `MemberSearch` filtered to only show members of the selected secondary group
- Pass `memberSelection: "selected"` to `inviteGroupToChannel`
- After the invite is accepted, navigate to a member picker to add specific members

### Step 7: Frontend — Enable "Add Members" for shared channels

**File:** `apps/mobile/app/inbox/[groupId]/[channelSlug]/members.tsx`

The members.tsx screen already has an "Add Members" button but only for custom channels. Extend it:
- Show the "Add Members" button for shared channels with `memberSelection: "selected"`
- In the `AddMemberModalContent`, filter `MemberSearch` to show members from ALL groups in the shared channel (primary + accepted secondary groups)
- Use `excludeUserIds` to hide already-added channel members
- Call `addMembersToSharedChannel` (or the extended `addChannelMembers`) on selection

### Step 8: Frontend — Show member selection mode in shared channel UI

**File:** `apps/mobile/app/inbox/[groupId]/[channelSlug]/members.tsx`

In the shared channel banner area (lines ~464-484):
- If `memberSelection: "selected"`, show a badge/indicator like "Selected members only"
- If leader, show option to switch between "all" and "selected" modes (with warning that switching to "selected" won't auto-remove anyone, but new members won't be auto-added)

---

## Files to Modify

| File | Changes |
|------|---------|
| `apps/convex/schema.ts` | Add `memberSelection` to `sharedGroups` object |
| `apps/convex/functions/messaging/channels.ts` | Extend `addChannelMembers` for shared channels; update access control in `getChannelBySlug` and `getChannelsByGroup` |
| `apps/convex/functions/messaging/sharedChannels.ts` | Add `memberSelection` arg to `inviteGroupToChannel`; new `addMembersToSharedChannel` mutation |
| `apps/mobile/app/inbox/[groupId]/[channelSlug]/members.tsx` | Enable "Add Members" for shared channels; member picker UI |

## Testing

1. Create a shared channel between two groups with `memberSelection: "selected"`
2. Verify that secondary group members do NOT automatically see the channel
3. Add specific members from the secondary group via the member picker
4. Verify only those members can see/access the channel
5. Verify those members are NOT added to the primary group's `groupMembers`
6. Test backwards compatibility: existing shared channels with no `memberSelection` field should continue working as "all members"
