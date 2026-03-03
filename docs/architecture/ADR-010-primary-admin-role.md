# ADR-010: Primary Admin Role

## Status
Implemented

## Context
Communities need a hierarchical admin structure where one person (the "Primary Admin") has exclusive authority to promote and demote other admins. This is important for:

1. **Church contexts**: "Owner" terminology is inappropriate; "Primary Admin" fits better
2. **Preventing admin conflicts**: Regular admins shouldn't be able to demote each other
3. **Clear accountability**: One person is ultimately responsible for the community
4. **Transfer of responsibility**: When leadership changes, there's a clear handoff process

### Previous State
- Single admin role level (`roles >= 3` = admin)
- Any admin could promote/demote any other admin
- Last admin protection prevented orphaned communities
- No distinction between who "owns" the community

### Alternatives Considered
1. **Multiple Primary Admins**: More flexible but dilutes accountability
2. **Owner + Admins + Moderators**: Too complex for current needs
3. **Granular permissions**: Enterprise-level complexity, overkill for churches

## Decision
Implement a **single Primary Admin per community** with exclusive admin management powers.

### Role Hierarchy
```
PRIMARY_ADMIN (role = 4)
    ↓ can promote/demote
ADMIN (role = 3)
    ↓ can manage groups, members, settings
MODERATOR (role = 2) [reserved, not used]
MEMBER (role = 1)
```

### Key Rules
1. **One Primary Admin per community** - enforced at database level
2. **Only Primary Admin can promote/demote admins** - regular admins cannot
3. **Primary Admin cannot leave** - must transfer first
4. **Primary Admin cannot self-demote** - must transfer to another member
5. **Transfer target can be any member** - not just existing admins
6. **Transfer is atomic** - old Primary Admin becomes regular Admin immediately
7. **Both Admin and Primary Admin get admin access** - `roles >= 3` checks still work

### Transfer Flow
```
Primary Admin selects target member
    ↓
Confirmation dialog 1: "Are you sure?"
    ↓
Confirmation dialog 2: "You will be demoted to Admin"
    ↓
Transaction:
  - Old Primary Admin → role = 3 (Admin)
  - Target Member → role = 4 (Primary Admin)
  - Sync announcement group leadership
```

## Schema Changes
No schema changes required. Uses existing `user_community.roles` field:
- `1` = Member
- `2` = Moderator (reserved)
- `3` = Admin
- `4` = Primary Admin (NEW)

## Implementation

### Backend

#### Role Constants (`apps/api-trpc/src/routers/groups/access.ts`)
```typescript
export const COMMUNITY_ROLES = {
  MEMBER: 1,
  MODERATOR: 2,
  ADMIN: 3,
  PRIMARY_ADMIN: 4,
} as const;

export const ADMIN_ROLE_THRESHOLD = COMMUNITY_ROLES.ADMIN; // 3
```

#### Helper Functions
- `requirePrimaryAdmin(prisma, communityId, userId)` - throws if not Primary Admin
- `isCommunityPrimaryAdmin(communityId, userId)` - returns boolean
- `getCommunityRole(communityId, userId)` - returns role level

#### Updated Endpoints
- `admin.communityMembers.updateRole` - now checks if caller is Primary Admin for admin-level changes
- `admin.communityMembers.transferPrimaryAdmin` - new endpoint for transfer

#### Leave Protection
- `leaveCommunity()` service blocks Primary Admin from leaving
- Error message directs them to transfer first

### Frontend

#### User Context
- `User.is_primary_admin` added to type
- `AuthProvider` sets this from API response
- Available via `useAuth()` hook

#### PersonDetailScreen
- Shows "Primary Admin" or "Admin" badge next to name
- "Admin Role" section visible only to Primary Admin
- "Make Admin" / "Remove Admin" buttons with confirmation

#### PeopleContent (Member List)
- "Primary Admin" badge (purple) vs "Admin" badge (orange)
- Both badges visible in member list

### Migration
Script: `scripts/set-primary-admins.ts`
- Sets Josh Kelsey as Primary Admin in Fount
- Sets demo user (2025550123) as Primary Admin in Demo Community

## Consequences

### Positive
- Clear ownership and accountability per community
- Prevents admin power struggles
- Simple mental model for users
- Backward compatible - existing `roles >= 3` checks work

### Negative
- Single point of failure if Primary Admin becomes unavailable
- Requires UI for transfer (partially implemented)
- Migration needed for existing communities

## Affected Files

### Backend
- `apps/api-trpc/src/routers/groups/access.ts` - Role constants, helper functions
- `apps/api-trpc/src/routers/admin.ts` - `requirePrimaryAdmin`, `updateRole`, `transferPrimaryAdmin`
- `apps/api-trpc/src/routers/auth.ts` - Returns `isAdmin`/`isPrimaryAdmin` in communities
- `apps/api-trpc/src/routers/user.ts` - Returns role info in `me` endpoint
- `apps/api-trpc/src/routers/integrations.ts` - Uses `ADMIN_ROLE_THRESHOLD`
- `apps/api-trpc/src/lib/notifications.ts` - Uses `ADMIN_ROLE_THRESHOLD`
- `apps/api-trpc/src/services/communityMembership.ts` - Blocks Primary Admin leave

### Frontend
- `apps/mobile/types/shared.ts` - `is_primary_admin` field
- `apps/mobile/providers/AuthProvider.tsx` - Sets `is_primary_admin`
- `apps/mobile/features/admin/components/PersonDetailScreen.tsx` - Admin management UI
- `apps/mobile/features/admin/components/PeopleContent.tsx` - Role badges

### Scripts
- `scripts/set-primary-admins.ts` - Migration script

## Outstanding Work
1. **Transfer Primary Admin UI** - Backend endpoint exists, frontend 2-step confirmation needed
2. **Run migration script** - Execute `set-primary-admins.ts` on production
3. **Test full flow** - Verify promote/demote/transfer works end-to-end

## Related
- ADR-008: Community Announcement Groups (role sync affects announcement group leadership)
