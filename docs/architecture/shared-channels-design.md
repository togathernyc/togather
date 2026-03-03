# Shared Channels Between Groups — Design Document

## Problem Statement

Every `chatChannel` is scoped to exactly one `group` via a required `groupId`. Leaders need channels that span multiple groups within a community — for cross-group coordination, leadership alignment, and PCO service teams that don't map cleanly to a single group.

### Use Cases

1. **Cherry-Picked Cross-Group Channels** — A group leader creates a shared channel and invites other groups. Once accepted, the primary leader cherry-picks members from the secondary groups (e.g., "All Worship Leaders", "Campus Pastors").

2. **PCO-Synced Shared Channels** — A shared channel linked to PCO where membership auto-rotates based on the PCO schedule, pulling from all accepted groups.

---

## Chosen Approach: Primary Group Ownership + Inline Shared Groups Array

A shared channel **lives in its primary group** (`groupId` stays required). Additional groups are stored as an **array of objects directly on the channel document** — no separate table. Each entry tracks invitation status, who invited/responded, and per-group ordering.

### Why This Approach

- **No new tables** — everything lives on `chatChannels`
- **No schema migration** for existing channels — new fields are optional
- **Atomic updates** — modifying link status and channel data in one mutation
- **Simple deletion** — splice the entry from the array + remove members who only belonged through that group
- **Familiar pattern** — mirrors the existing group join request flow (`pending` → `accepted`)

---

## Data Model

### `chatChannels` (additions to existing table)

```typescript
chatChannels: defineTable({
  groupId: v.id("groups"),          // Required — the PRIMARY (owner) group
  // ... all existing fields unchanged ...

  // NEW FIELDS:
  isShared: v.optional(v.boolean()),  // Quick flag to identify shared channels

  sharedGroups: v.optional(v.array(v.object({
    groupId: v.id("groups"),                        // The secondary group
    status: v.string(),                              // "pending" | "accepted"
    invitedById: v.id("users"),                     // Primary group leader who sent invite
    invitedAt: v.number(),                           // Unix timestamp ms
    respondedById: v.optional(v.id("users")),       // Secondary group leader who responded
    respondedAt: v.optional(v.number()),             // Unix timestamp ms
    sortOrder: v.optional(v.number()),              // How this group orders the channel in their list
  }))),
})
```

**Example channel document:**
```json
{
  "_id": "ch_abc123",
  "groupId": "grp_worshipTeam",
  "name": "All Worship Leaders",
  "channelType": "custom",
  "isShared": true,
  "sharedGroups": [
    {
      "groupId": "grp_youthGroup",
      "status": "accepted",
      "invitedById": "usr_alice",
      "invitedAt": 1709000000000,
      "respondedById": "usr_bob",
      "respondedAt": 1709000100000,
      "sortOrder": 1
    },
    {
      "groupId": "grp_kidsMinistry",
      "status": "pending",
      "invitedById": "usr_alice",
      "invitedAt": 1709000200000
    }
  ]
}
```

### No new tables needed.

---

## Core Flows

### 1. Creating a Shared Channel

```
Primary Group Leader creates channel in Group A
  → chatChannels record with groupId: GroupA, isShared: true, sharedGroups: []
  → Leader is channel owner (chatChannelMembers role: "owner")
  → Channel appears in Group A's channel list normally
```

### 2. Inviting Additional Groups

```
Primary Group Leader invites Group B
  → Append to sharedGroups: { groupId: GroupB, status: "pending", invitedById, invitedAt }
  → Notification sent to Group B's leaders: "Worship Team invited your group to #all-worship-leaders"
```

Notification-driven — secondary group leaders find pending invites through their notifications, not a reverse query.

### 3. Accept / Decline Flow

```
Group B Leader taps notification → fetches channel → sees pending entry
  → ACCEPT: update entry in sharedGroups → status: "accepted", respondedById, respondedAt
    → Channel now appears in Group B's channel list (with external icon)
    → Primary leader can now browse Group B's members to add to the channel
  → DECLINE: remove the entry from sharedGroups array entirely
    → Primary leader notified: "Youth Group declined the invitation"
```

**Why decline = delete (not status change):** Keeps the array clean. If you want to re-invite, just append a new entry. No stale `declined` entries cluttering the array.

### 4. Removing a Link (Opt-Out)

Secondary group leaders can remove their group from the channel at any time, even after accepting:

```
Group B Leader opts out
  1. Find all channel members who are ONLY in Group B (not in primary group or other accepted groups)
  2. Soft-delete those members (set leftAt)
  3. Members who are also in Group A or Group C stay in the channel
  4. Remove Group B's entry from the sharedGroups array
  5. Update memberCount
  6. Notify primary group leaders: "Youth Group left #all-worship-leaders"
```

**The key deletion logic:**
```typescript
// Pseudo-code for member cleanup on group removal
const remainingGroupIds = [channel.groupId, ...channel.sharedGroups
  .filter(sg => sg.groupId !== removedGroupId && sg.status === "accepted")
  .map(sg => sg.groupId)];

for (const member of channelMembers) {
  const memberGroups = await getActiveGroupMemberships(member.userId);
  const memberGroupIds = memberGroups.map(m => m.groupId);

  // Keep member if they're in ANY remaining group
  const hasOtherGroup = remainingGroupIds.some(gId => memberGroupIds.includes(gId));

  if (!hasOtherGroup) {
    await softDeleteChannelMember(member._id);
  }
}
```

### 5. Adding Members After Accept

**Custom (cherry-pick):**
```
Primary Leader opens member management
  → Sees members grouped by source group with headers:
    ┌──────────────────────────┐
    │ WORSHIP TEAM (Primary)   │  ← Header
    │  👤 Alice (Owner)        │
    │  👤 Bob                  │
    │                          │
    │ YOUTH GROUP (External)   │  ← Header
    │  👤 Carol                │
    │  👤 Dave                 │
    │                          │
    │ + Add Members            │
    └──────────────────────────┘
  → "Add Members" shows picker with sections per accepted group
  → Can only search members from accepted groups
```

**PCO-synced:**
```
Primary Leader configures PCO sync on the shared channel
  → autoChannelConfigs points to this channel
  → PCO rotation engine pulls members from ALL accepted groups
  → Members auto-added/removed based on PCO schedule
```

### 6. Member Group Assignment in UI

When displaying the member list, each member shows under a group header:

1. Look up the member's `groupMembers` records
2. If they're in the **primary group** → show under primary group header
3. If they're in **multiple additional groups** → show under the **first matching accepted group**
4. The header uses the group's display name

### 7. Archive Cascade

```
Primary Group archived
  → All channels where groupId = primaryGroupId are archived
  → This includes shared channels — they archive with their owner group
  → Secondary groups see the channel disappear from their list

Secondary Group archived
  → Same logic as "Removing a Link" — remove members only in that group
  → Remove the entry from sharedGroups array
  → Channel stays alive (owned by primary group)
```

**Note:** Currently group archiving does NOT cascade to channels. We need to add this cascade logic as part of this feature.

### 8. Channel Ordering in Secondary Groups

Each secondary group controls where the shared channel appears via `sortOrder` in their `sharedGroups` entry:

- Secondary group leaders can reorder shared channels within their group's channel list
- Primary group uses its existing `pinnedChannelSlugs` for ordering
- Shared channels sort **after** system channels (main, leaders) but can be interleaved with custom channels

---

## Inbox / Channel List Loading

### Current Pattern (unchanged for non-shared channels)

```
1. Get user's group memberships (by_user index)
2. For each group, get channels (by_group index)
3. Get user's channel memberships (by_user index)
4. Filter: only show channels user is a member of
5. Sort by pinnedChannelSlugs + lastMessageAt
```

### Updated Pattern (adds shared channels)

```
1. Get user's group memberships → groupIds[]            (existing, indexed)
2. For each group, get channels by_group                (existing, indexed)
3. Get user's channel memberships → channelMemberships  (existing, indexed)
4. Fetch channel docs for all memberships by ID         (O(1) per channel)
5. NEW: For each channel with isShared === true:
   → Check if any of the user's groupIds appear in sharedGroups (accepted)
   → If yes, add the channel to that group's channel list
6. Deduplicate: if user sees the channel via primary group AND a secondary group,
   show it in both (each group has its own channel list section)
7. Sort: system channels → pinned → shared (by sortOrder) → custom (by lastMessageAt)
8. Mark shared channels with isShared flag for external icon rendering
```

**No extra queries needed.** We already fetch all the user's channel docs — we just check `sharedGroups` in memory.

### Channel Display in Inbox

```
┌─────────────────────────────────┐
│ ▾ WORSHIP TEAM (Primary)        │
│   # General                     │
│   # Leaders                     │
│   # Sunday Prep                 │  ← Regular custom channel
│   🔗 All Worship Leaders        │  ← Shared (this group owns it)
│                                 │
│ ▾ YOUTH GROUP                   │
│   # General                     │
│   # Leaders                     │
│   🔗 All Worship Leaders        │  ← Same channel, external icon
│                                 │
│ ▾ SMALL GROUP                   │
│   # General                     │
│   # Leaders                     │
└─────────────────────────────────┘
```

---

## Permissions Model

| Action | Who Can Do It |
|--------|---------------|
| Create shared channel | Leaders of the primary group |
| Invite additional group | Leaders of the primary group |
| Accept/decline invitation | Leaders of the invited group |
| Remove link (opt-out) | Leaders of the linked group (anytime) |
| Add members from primary group | Channel owner or primary group leaders |
| Add members from secondary group | Channel owner or primary group leaders (only after accept) |
| Remove members | Channel owner or primary group leaders |
| Archive shared channel | Channel owner or primary group leaders |
| Reorder in secondary group | Leaders of that secondary group |
| Configure PCO sync | Channel owner or primary group leaders |

**Key principle:** The primary group has full control. Secondary groups can only accept/decline/opt-out and reorder.

---

## Navigation

### Route Structure (unchanged)

```
/inbox/[groupId]/[channelSlug]     → Works for both regular and shared channels
```

The `groupId` in the URL is always the **viewing group** — the group context the user navigated from. For shared channels viewed from a secondary group, this means the URL `groupId` differs from the channel's actual `groupId` (the primary group).

### Decision: URL Uses the Viewing Group's ID

When a user taps a shared channel from Group B's channel list, the route is `/inbox/[GroupB]/[slug]`, not `/inbox/[GroupA-primary]/[slug]`.

**Why:** Both approaches require backend changes to `getChannelBySlug`. Using the primary group's ID in the URL would break the user's navigation context — wrong tab bar, wrong back button, wrong leader tools, wrong group page link. Using the viewing group's ID keeps everything contextually correct.

### `getChannelBySlug` — Updated Lookup Strategy

Current behavior uses the `by_group_slug` compound index `(groupId, slug)`. For shared channels viewed from a secondary group, this returns nothing because the channel's `groupId` is the primary group. Updated logic:

```
1. Try by_group_slug(urlGroupId, slug)
   → Finds native channels immediately (indexed, fast)

2. Miss? Fallback for shared channels:
   → Query user's channel memberships (by_user index)
   → Find membership where channel slug matches
   → Fetch that channel doc by ID
   → Verify channel.sharedGroups includes urlGroupId with status "accepted"
   → Return channel if valid, null if not

3. Access control:
   → Verify user is a member of the URL groupId (existing check, unchanged)
   → Verify user is a member of the channel (existing check, unchanged)
```

**Performance:** Two queries max, usually one. The fallback only triggers for shared channels accessed from secondary groups. The `by_user` index on `chatChannelMembers` makes the membership lookup fast.

### What This Means for Each Screen

| Screen Element | Behavior |
|---------------|----------|
| Tab bar | Shows the viewing group's channels (including shared channels via that group) |
| Back button | Returns to the viewing group's channel list |
| Leader tools | Links to the viewing group (contextually correct) |
| Group header/name | Shows the viewing group |
| "Add Members" modal | For shared channels, shows members from all accepted groups (not just the viewing group) |

---

## Notifications

Notification-driven discovery — secondary group leaders find invitations through notifications, not a separate "pending invitations" screen.

| Event | Recipients | Message |
|-------|-----------|---------|
| Group invited to channel | Leaders of invited group | "Worship Team invited your group to join #all-worship-leaders" |
| Invitation accepted | Primary group leaders | "Youth Group accepted the invitation to #all-worship-leaders" |
| Invitation declined | Primary group leaders | "Youth Group declined the invitation to #all-worship-leaders" |
| Link removed (opt-out) | Primary group leaders | "Youth Group left #all-worship-leaders" |
| Added to shared channel | Added member | "You've been added to #all-worship-leaders" |
| Removed from shared channel | Removed member | "You've been removed from #all-worship-leaders" |

---

## Implementation Plan

### Phase 1: Schema & Backend Foundation
1. Add `isShared` and `sharedGroups` optional fields to `chatChannels`
2. Update `getChannelBySlug` with fallback lookup for shared channels via secondary groups
3. Add archive cascade: when a group is archived, archive all its owned channels
4. Add cascade for secondary group archival: remove members, splice entry from `sharedGroups`

### Phase 2: Invitation Flow
1. `inviteGroupToChannel` mutation — append pending entry, send notification
2. `respondToChannelInvite` mutation — update entry to accepted or splice out on decline
3. `removeGroupFromChannel` mutation — opt-out (remove members only in that group, splice entry)

### Phase 3: Cross-Group Member Management
1. Update `addChannelMembers` to validate members are from primary or accepted groups
2. `getEligibleMembers` query — returns members from all accepted groups, grouped by group
3. Update member list query to return group info per member (for headers)
4. Member group assignment logic (primary first, then first matching group)

### Phase 4: Inbox & Channel List
1. Update `getInboxChannels` to surface shared channels under secondary groups
2. Add `isShared` to channel response for external icon rendering
3. Implement `sortOrder` from `sharedGroups` entries for secondary group ordering
4. `reorderSharedChannel` mutation for secondary group leaders

### Phase 5: PCO Integration
1. Update `autoChannelConfigs` to work with shared channels
2. Update PCO rotation engine to pull members from all accepted groups
3. Ensure PCO sync respects link status (only sync from accepted groups)

### Phase 6: Frontend
1. External icon component for shared channels in channel list
2. "Share with Group" flow — group picker for primary leaders
3. Accept/decline UI triggered by notification deep link
4. Member list with group headers
5. Channel ordering controls for secondary groups
6. PCO config UI updates for shared channels

### Phase 7: Testing
1. Invitation lifecycle (invite → accept → add members → opt-out)
2. Opt-out member cleanup (only remove members exclusive to the removed group)
3. Archive cascade (primary group → channels, secondary group → members)
4. PCO sync with shared channels
5. Inbox loading with shared channels across multiple groups
6. Permission enforcement at every endpoint
