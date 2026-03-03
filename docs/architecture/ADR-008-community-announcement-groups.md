# ADR-008: Community Announcement Groups

## Status
Proposed

## Context
Communities need a way to broadcast announcements to all members. Requirements:
1. Every community has a single announcement channel
2. All community members automatically have access
3. Only community admins can post; members can react
4. Needs leaders chat for admin coordination
5. Should support events, like regular groups
6. Members shouldn't be able to leave (except by leaving community)

Two approaches were considered:
1. **Extend features community-wide**: Make `group_id` nullable on events, create separate community channels
2. **System Group pattern**: Create a special group that auto-syncs with community membership

## Decision
Use the **System Group pattern** - create a group per community with `is_announcement_group = true`.

### Why System Group?
- **Reuses existing infrastructure**: Events, chat, leaders channels, RSVPs work immediately
- **Lower risk**: Additive changes, doesn't modify core data model
- **Simpler codebase**: One code path for events, not conditional group/community logic
- **Proven pattern**: Discord, Slack use "system channels" that behave like regular channels

### Sync Strategy
Hook into existing flows rather than separate sync jobs:
- `auth.selectCommunity` → auto-add to announcement group
- `admin.updateRole` → sync leadership when admin status changes
- No periodic batch jobs needed

### Posting Restrictions
Stream Chat doesn't support per-member posting permissions. Enforce at application layer:
- Backend rejects message sends from non-leaders in announcement groups
- Frontend hides message input, shows "Only admins can post" banner

## Schema Changes
```prisma
model group {
  // ... existing fields
  is_announcement_group  Boolean  @default(false)
}
```

## Consequences

### Positive
- All group features (events, RSVP, chat, leaders) work without modification
- Announcement group appears in regular group list (familiar UX)
- Community admins manage it like any group
- Name can be customized per community

### Negative
- Requires sync logic when users join/leave community
- Requires sync logic when admin status changes
- Announcement group is technically a "fake" group users didn't create

## Affected Files

### Schema
- `apps/api-trpc/src/prisma/schema.prisma` - Add `is_announcement_group` field

### Backend
- `apps/api-trpc/src/routers/auth.ts` - Hook community join
- `apps/api-trpc/src/routers/admin.ts` - Add admin role management
- `apps/api-trpc/src/routers/groups/members.ts` - Block leaving
- `apps/api-trpc/src/routers/chat.ts` - Enforce posting restrictions
- `apps/api-trpc/src/routers/groups/helpers/announcement.ts` - New helper functions
- `apps/api-trpc/src/routers/groups/announcement.ts` - New router

### Frontend
- `apps/mobile/features/groups/components/GroupOptionsModal.tsx` - Leave UX
- `apps/mobile/features/chat/` - Read-only input for non-admins

## Related
- ADR-001: Stream Chat Channel Naming (channels follow same pattern)
- ADR-002: Event RSVP Chat Integration (events post to announcement chat)
