# Primary Admin Feature - Implementation Handoff

This document describes what was implemented for the Primary Admin feature and what remains to be done. Use this to continue the implementation.

## Feature Overview

The Primary Admin feature adds a hierarchical admin structure to communities:
- **Primary Admin** (role = 4): Single "owner" per community who can promote/demote admins
- **Admin** (role = 3): Can manage groups, members, settings, but cannot manage other admins
- **Member** (role = 1): Regular community member

## What Was Implemented

### 1. Backend Role System

**File: `apps/api-trpc/src/routers/groups/access.ts`**
- Added `COMMUNITY_ROLES` constant with role values (MEMBER=1, MODERATOR=2, ADMIN=3, PRIMARY_ADMIN=4)
- Added `ADMIN_ROLE_THRESHOLD = 3` for admin permission checks
- Added `isCommunityPrimaryAdmin()` helper function
- Added `getCommunityRole()` helper function
- Updated `isCommunityAdmin()` to use constants

**File: `apps/api-trpc/src/routers/admin.ts`**
- Added `requirePrimaryAdmin()` helper function (throws FORBIDDEN if not Primary Admin)
- Updated `updateRole` endpoint:
  - Only Primary Admin can promote/demote admins
  - Cannot modify Primary Admin through this endpoint
  - Input validation restricts role to 1-3 (no setting role 4 directly)
- Added `transferPrimaryAdmin` endpoint:
  - Only callable by current Primary Admin
  - Target can be any community member
  - Atomic transaction: old Primary Admin → Admin, target → Primary Admin
  - Syncs announcement group leadership
- Updated `communityMembers.list` to return `isPrimaryAdmin` and `role` fields
- Updated `communityMembers.byId` to return `isAdmin` and `isPrimaryAdmin` in membership data

**File: `apps/api-trpc/src/services/communityMembership.ts`**
- Updated `leaveCommunity()` to block Primary Admin from leaving
- Error message: "Primary Admin cannot leave the community. Transfer Primary Admin role to another member first."

**Files updated to use constants instead of hardcoded `roles >= 3`:**
- `apps/api-trpc/src/routers/integrations.ts`
- `apps/api-trpc/src/lib/notifications.ts`
- `apps/api-trpc/src/routers/user.ts`
- `apps/api-trpc/src/routers/auth.ts`

### 2. API Response Updates

**`user.me` endpoint** now returns in `communityMemberships`:
```typescript
{
  communityId: number;
  communityName: string;
  role: number;           // 1, 3, or 4
  isAdmin: boolean;       // true if role >= 3
  isPrimaryAdmin: boolean; // true if role === 4
  status: number;
  communityAnniversary: string | null;
}
```

**`auth.verifyOTP` endpoint** now returns in `communities`:
```typescript
{
  id: number;
  name: string;
  logo: string | null;
  logoFallback: string | null;
  role: number;
  isAdmin: boolean;
  isPrimaryAdmin: boolean;
}
```

### 3. Frontend Changes

**File: `apps/mobile/types/shared.ts`**
- Added `is_primary_admin?: boolean` to `User` interface

**File: `apps/mobile/providers/AuthProvider.tsx`**
- Now sets `is_primary_admin` from the API's `isPrimaryAdmin` field
- Available via `useAuth()` hook as `user.is_primary_admin`

**File: `apps/mobile/features/admin/components/PersonDetailScreen.tsx`**
- Shows "Primary Admin" badge (purple) or "Admin" badge (orange) next to member name
- Added "Admin Role" section visible only when:
  - Current user is Primary Admin (`currentUser?.is_primary_admin`)
  - Viewing someone else's profile (not self)
  - Target is not the Primary Admin
- "Make Admin" button with confirmation alert
- "Remove Admin" button with confirmation alert
- Uses `trpc.admin.communityMembers.updateRole` mutation
- Invalidates member list on success

**File: `apps/mobile/features/admin/components/PeopleContent.tsx`**
- Added `is_primary_admin` to `CommunityMember` interface
- Shows "Primary Admin" badge (purple, `#8C10FE`) for Primary Admins
- Shows "Admin" badge (orange, `#FFF5E7`/`#995C00`) for regular Admins

### 4. Migration Script

**File: `scripts/set-primary-admins.ts`**
- Sets Josh Kelsey as Primary Admin in "Fount" community
- Sets demo user (phone: 2025550123) as Primary Admin in "Demo Community"
- Demotes any existing Primary Admin to regular Admin before promoting new one

**To run:**
```bash
cd apps/api-trpc
npx ts-node ../../scripts/set-primary-admins.ts
```

## What Remains To Be Done

### 1. Transfer Primary Admin UI (HIGH PRIORITY)

The backend `transferPrimaryAdmin` endpoint exists but there's no UI to call it.

**Requirements:**
- Add a "Transfer Primary Admin" button/option in PersonDetailScreen (or a separate screen)
- Only visible to the current Primary Admin
- Target can be ANY community member (not just admins)
- **Must have 2-step confirmation:**
  1. First alert: "Are you sure you want to make [Name] the Primary Admin of this community?"
  2. Second alert: "This action cannot be undone. You will be demoted to a regular Admin. Are you absolutely sure?"
- On success, navigate back to member list and show success message
- Refresh user context (the current user's `is_primary_admin` will now be `false`)

**Suggested Implementation:**

```typescript
// In PersonDetailScreen.tsx

const transferMutation = trpc.admin.communityMembers.transferPrimaryAdmin.useMutation({
  onSuccess: () => {
    // Refresh current user's auth context
    refreshUser(); // from useAuth()
    // Navigate back
    router.back();
    Alert.alert("Success", "Primary Admin role has been transferred.");
  },
});

const handleTransferPrimaryAdmin = () => {
  Alert.alert(
    "Transfer Primary Admin",
    `Are you sure you want to make ${member?.first_name} ${member?.last_name} the Primary Admin?`,
    [
      { text: "Cancel", style: "cancel" },
      {
        text: "Continue",
        onPress: () => {
          // Second confirmation
          Alert.alert(
            "Confirm Transfer",
            "This action cannot be undone. You will be demoted to a regular Admin. Are you absolutely sure?",
            [
              { text: "Cancel", style: "cancel" },
              {
                text: "Transfer",
                style: "destructive",
                onPress: async () => {
                  try {
                    await transferMutation.mutateAsync({
                      targetUserId: String(userId),
                    });
                  } catch (error: any) {
                    Alert.alert("Error", error.message);
                  }
                },
              },
            ]
          );
        },
      },
    ]
  );
};
```

**Where to add the button:**
- In the "Admin Role" section, add a "Transfer Primary Admin to this Member" button
- Or add it to a separate "Primary Admin Actions" section
- Could also be an option in the header menu

### 2. Run Migration Script

Execute on production database:
```bash
cd apps/api-trpc
DATABASE_URL="your-production-url" npx ts-node ../../scripts/set-primary-admins.ts
```

### 3. Test Full Flow

Test these scenarios:
1. **As Primary Admin:**
   - View member list, see "Primary Admin" badge on yourself
   - View another member's profile
   - Promote a member to Admin
   - Demote an admin to Member
   - Try to leave community (should be blocked)
   - Transfer Primary Admin to another member

2. **As Regular Admin:**
   - View member list, see "Admin" badge on yourself
   - View another member's profile - should NOT see admin management buttons
   - Try to promote someone (should fail with FORBIDDEN)
   - Leave community (should work)

3. **As Member:**
   - No admin tab visible
   - Cannot access admin endpoints

### 4. Optional Improvements

1. **Settings screen option**: Add "Transfer Primary Admin" in community settings instead of on each member profile

2. **Primary Admin indicator in header**: Show a crown or special icon for the Primary Admin in the member list

3. **Audit log**: Track when admin promotions/demotions/transfers happen

## Key Files Reference

### Backend
| File | Purpose |
|------|---------|
| `apps/api-trpc/src/routers/groups/access.ts` | Role constants and helper functions |
| `apps/api-trpc/src/routers/admin.ts` | Admin endpoints (updateRole, transferPrimaryAdmin) |
| `apps/api-trpc/src/services/communityMembership.ts` | Leave community logic |
| `apps/api-trpc/src/routers/auth.ts` | Login returns role info |
| `apps/api-trpc/src/routers/user.ts` | user.me returns role info |

### Frontend
| File | Purpose |
|------|---------|
| `apps/mobile/types/shared.ts` | User type with is_primary_admin |
| `apps/mobile/providers/AuthProvider.tsx` | Sets is_primary_admin in context |
| `apps/mobile/features/admin/components/PersonDetailScreen.tsx` | Admin management UI |
| `apps/mobile/features/admin/components/PeopleContent.tsx` | Member list with badges |

### Scripts
| File | Purpose |
|------|---------|
| `scripts/set-primary-admins.ts` | Migration to set initial Primary Admins |

## API Endpoints

### `admin.communityMembers.updateRole`
```typescript
Input: { userId: string; role: 1 | 2 | 3 }
Output: { success: true }
Permissions: Primary Admin only for admin-level changes
```

### `admin.communityMembers.transferPrimaryAdmin`
```typescript
Input: { targetUserId: string }
Output: { success: true }
Permissions: Primary Admin only
Side effects:
  - Caller demoted to Admin (role 3)
  - Target promoted to Primary Admin (role 4)
  - Announcement group leadership synced
```

## Testing Credentials

Per CLAUDE.md:
- **Phone**: 2025550123 (use code `000000`)
- **Community**: Search for "Demo Community"
- **Password**: `password` (for local backend)

The demo user should be Primary Admin after running the migration script.
