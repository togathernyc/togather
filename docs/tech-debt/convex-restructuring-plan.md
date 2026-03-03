# Convex Best Practice Violations - Fix Plan

This document identifies Convex anti-patterns in the codebase and provides a fix plan.

**Related**: See `docs/tech-debt/convex-restructuring-plan.md` for the file restructuring plan (completed).

---

## Executive Summary

| Severity | Count | Description |
|----------|-------|-------------|
| **CRITICAL** | 3 | Transaction/atomicity violations - can leave data inconsistent |
| **HIGH** | 7 | Data consistency + Performance issues |
| **MEDIUM** | 3 | Validation gaps |
| **LOW** | 2 | Code quality (error messages, logging) |

**Total: 15 issues identified**

**Key Principles Violated**:
1. Actions calling multiple mutations are NOT atomic
2. Full table scans instead of indexed queries
3. Actions called directly from client (should use mutation → scheduler → action)

---

## CRITICAL Issues (Transaction/Atomicity)

### 1. Channel Creation Non-Atomic with Group Creation

**File**: `functions/messaging/channels.ts` (lines 634-674)
**Function**: `ensureChannels` action

**Problem**: Groups can exist without channels. The `ensureChannels` action is called separately after group creation - if it fails, you get orphaned groups.

**Current flow**:
```
1. Group mutation creates group ✓
2. Separate action creates channels ✗ (can fail independently)
```

**Fix**: Move channel creation INTO the group creation mutation.

**Files to modify**:
- `functions/groups/mutations.ts` - call channel creation in `create` mutation
- `functions/messaging/channels.ts` - extract logic to internal callable function

---

### 2. Auth `selectCommunity` Calls 2 Mutations Sequentially

**File**: `functions/auth/login.ts` (lines 194-210)
**Function**: `selectCommunity` action

**Problem**: Calls `ensureUserCommunityInternal` then `updateActiveCommunityInternal` as separate transactions. If second fails, user has membership but wrong `activeCommunityId`.

**Current code**:
```typescript
// Mutation 1
await ctx.runMutation(internal.functions.authInternal.ensureUserCommunityInternal, {...});
// Mutation 2 - separate transaction!
await ctx.runMutation(internal.functions.authInternal.updateActiveCommunityInternal, {...});
```

**Fix**: Combine into single `ensureAndActivateCommunityInternal` mutation.

**Files to modify**:
- `functions/authInternal.ts` - create combined mutation
- `functions/auth/login.ts` - use new combined mutation

---

### 3. Notification Actions Loop Over Mutations

**File**: `functions/notifications/actions.ts` (lines 114, 140, 185, 229, 248)
**Function**: `sendPushNotification` and related

**Problem**: 5 separate `ctx.runMutation` calls to create notification records. If any fail mid-loop, notifications are partially created.

**Fix**: Batch notification creation into single `createNotificationsBatch` mutation.

**Files to modify**:
- `functions/notifications/mutations.ts` - add batch creation mutation
- `functions/notifications/actions.ts` - collect notifications, batch at end

---

## HIGH Issues (Data Consistency)

### 4. Member Count Denormalization Race Condition

**File**: `functions/messaging/channels.ts` (lines 453-455, 493-495)

**Problem**: Member count uses optimistic `+1/-1` which can drift with concurrent operations:
```typescript
memberCount: (channel.memberCount || 0) + 1  // Can drift!
```

**Fix**: Always recompute count from actual membership records:
```typescript
async function updateChannelMemberCount(ctx, channelId) {
  const activeMembers = await ctx.db.query("chatChannelMembers")
    .withIndex("by_channel", q => q.eq("channelId", channelId))
    .filter(q => q.eq(q.field("leftAt"), undefined))
    .collect();
  await ctx.db.patch(channelId, { memberCount: activeMembers.length });
}
```

---

### 5. Incomplete User Removal Cleanup

**File**: `functions/communities.ts` - `removeUserFromCommunity`

**Current cleanup**:
- ✓ Delete `userCommunities` record
- ✓ Delete `groupMembers` records
- ✓ Delete `meetingRsvps` records
- ✓ Sync channel memberships

**Missing cleanup**:
- `chatChannelMembers` with stale `displayName`/`profilePhoto`
- Audit: Document that `meetingAttendances.recordedById` preserved intentionally

---

### 6. Orphaned Scheduled Jobs on Event Reschedule

**File**: `functions/communityWideEvents.ts` (lines 237-241)

**Problem**: When event rescheduled, old jobs not cancelled. TODO comment exists in code.

**Fix**:
1. Add `reminderJobId` and `attendanceConfirmationJobId` fields to meetings schema
2. Store job IDs when scheduling
3. Cancel old jobs before scheduling new ones

**Schema change required** (additive, non-breaking):
```typescript
// meetings table
reminderJobId: v.optional(v.id("_scheduled_functions")),
attendanceConfirmationJobId: v.optional(v.id("_scheduled_functions")),
```

---

### 7. Denormalized User Data Never Updated

**File**: `functions/sync/memberships.ts` (lines 252-280)

**Problem**: `displayName` and `profilePhoto` copied into `chatChannelMembers` at join time, never updated when user changes profile.

**Fix**: Add `syncUserProfileToChannels` internal mutation, call from user profile update.

---

## MEDIUM Issues (Validation)

### 8. Silent Failure on Missing Announcement Group

**File**: `functions/communities.ts` (lines 44-49)

**Problem**: `addUserToAnnouncementGroup` returns silently if no announcement group exists.

**Fix**: Auto-create announcement group if missing (defensive creation).

---

### 9. Inconsistent `leftAt` Soft Delete Checking

**Multiple files**

**Problem**: Some queries filter `leftAt === undefined`, others don't.

**Fix**: Create helper functions in `lib/helpers.ts`:
```typescript
export function isActiveMembership(record: { leftAt?: number } | null): boolean {
  return record != null && record.leftAt === undefined;
}
```

---

### 10. No Re-validation Before Meeting Creation Loop

**File**: `functions/groups/mutations.ts` (lines 101-147)

**Problem**: Groups fetched, then loop creates meetings. Theoretically group could be archived between.

**Reality**: Actually safe - Convex mutations are atomic, query and inserts in same transaction. Add defensive check for clarity only.

---

## HIGH Issues (Performance)

### 11. Full Table Scans Without Indexes/Pagination

**Pattern**: `.collect()` on tables then filter in JavaScript instead of using database indexes.

**Violations**:

| File | Lines | Issue |
|------|-------|-------|
| `admin/requests.ts` | 57-60 | Collects ALL pending requests, filters in JS |
| `admin/requests.ts` | 120-123 | Loop calling `.collect()` per user |
| `admin/cleanup.ts` | 42 | Scans ALL communities |
| `admin/cleanup.ts` | 70-74, 88-93, 147-150 | Multiple full table scans |
| `resources.ts` | 183-185 | Takes 200 communities, filters in JS |
| `groupMembers.ts` | 42-46, 244-247 | Hardcoded `.take(500)` limits |

**Fix**: Use `.withIndex()` queries and proper `.paginate()` for client-facing queries.

**Example fix**:
```typescript
// BAD
const allPending = await ctx.db.query("groupMembers")
  .withIndex("by_requestStatus", q => q.eq("requestStatus", "pending"))
  .collect();  // Gets ALL pending across ALL groups
const filtered = allPending.filter(m => groupIds.includes(m.groupId));

// GOOD - use compound index
const pending = await ctx.db.query("groupMembers")
  .withIndex("by_group_requestStatus", q =>
    q.eq("groupId", groupId).eq("requestStatus", "pending"))
  .collect();  // Only gets pending for THIS group
```

---

### 12. Actions Called Directly From Mobile Client

**Best Practice Violated**: "Don't invoke actions directly from your app" (The Zen of Convex)

**Violations**:

| File | Line | Action |
|------|------|--------|
| `mobile/app/planning-center/callback.tsx` | 27 | `useAction(completePlanningCenterAuth)` |
| `mobile/features/integrations/hooks/usePlanningCenterAuth.ts` | 61-62 | `useAction(startPlanningCenterAuth)` |
| `mobile/features/integrations/hooks/usePlanningCenterAuth.ts` | 167 | `useAction(disconnectPlanningCenter)` |

**Fix**: Convert to mutation → scheduler → action pattern:
```typescript
// Mobile calls mutation (not action)
const startAuth = useMutation(api.integrations.startPlanningCenterAuthIntent);

// Mutation creates job record, schedules action
export const startPlanningCenterAuthIntent = mutation({
  handler: async (ctx, args) => {
    const jobId = await ctx.db.insert("integrationJobs", {
      type: "planning_center_auth",
      status: "pending",
      userId: args.userId,
    });
    await ctx.scheduler.runAfter(0, internal.integrations.startPlanningCenterAuth, { jobId });
    return { jobId };
  }
});
```

---

### 13. Sequential Database Operations in Loops

**Pattern**: Mutations with loops performing individual inserts without batching.

**Violations**:

| File | Lines | Issue |
|------|-------|-------|
| `admin/requests.ts` | 593-601 | Loop inserting leaders one at a time |
| `groupCreationRequests.ts` | 458-477 | Loop inserting proposed leaders |

**Impact**: For N leaders, makes N database roundtrips. Violates "Keep sync engine functions light & fast" (<100ms).

**Fix**: While Convex doesn't have batch insert, consider:
1. Limit maximum leaders per group (e.g., 5)
2. Document the expected scale
3. For large batches, use action with chunked processing

---

## LOW Issues (Code Quality)

### 14. Vague Error Messages

**Violations**:

| File | Line | Current | Better |
|------|------|---------|--------|
| `auth/phoneOtp.ts` | 548 | `"Failed to send SMS"` | `"SMS delivery failed: ${errorCode}. Please try again."` |
| `uploads.ts` | 96 | `"Failed to get URL for uploaded file"` | `"[confirmUpload] Failed to retrieve URL for storage ${storageId}"` |

---

### 15. Inconsistent Log Prefixes

**Best Practice**: All logs should use `[functionName]` prefix format.

**Violations**:
- `authInternal.ts` lines 91, 114: Debug logs without `[function]` prefix

**Fix**: Add consistent prefixes:
```typescript
// Before
console.log('Community logo debug:', {...});

// After
console.log('[getUserWithCommunitiesInternal] Community logo resolution:', {...});
```

---

## Implementation Phases

| Phase | Fixes | Risk | Mobile Impact |
|-------|-------|------|---------------|
| **1: Quick Wins** | #8, #9, #10, #14, #15 | Very Low | None |
| **2: Atomicity** | #1, #2, #3 | Medium | None |
| **3: Consistency** | #4, #6, #7 | Medium | Schema migration (#6) |
| **4: Performance** | #11, #13 | Medium | None |
| **5: Action Pattern** | #12 | Medium | Yes - mobile refactor |
| **6: Cleanup** | #5 | Low | None |

---

## Verification Strategy

### For Each Fix
1. Write failing test that demonstrates the bug
2. Implement fix
3. Verify test passes
4. Run full test suite: `pnpm test apps/convex/`

### Specific Tests Needed

| Fix | Test Case |
|-----|-----------|
| #1 | Create group → verify channels exist in same transaction |
| #2 | Select community → verify membership AND activeCommunityId set atomically |
| #3 | Send notifications to 5 users → verify all records created or none |
| #4 | Concurrent add/remove member → verify count accurate |
| #6 | Reschedule event → verify old jobs cancelled |
| #7 | Update user profile → verify channel members updated |

---

## Critical Files

| File | Fixes |
|------|-------|
| `functions/messaging/channels.ts` | #1, #4 |
| `functions/authInternal.ts` | #2, #15 |
| `functions/auth/login.ts` | #2 |
| `functions/auth/phoneOtp.ts` | #14 |
| `functions/notifications/actions.ts` | #3 |
| `functions/notifications/mutations.ts` | #3 |
| `functions/communities.ts` | #5, #8 |
| `functions/communityWideEvents.ts` | #6 |
| `functions/sync/memberships.ts` | #7 |
| `functions/admin/requests.ts` | #11, #13 |
| `functions/admin/cleanup.ts` | #11 |
| `functions/resources.ts` | #11 |
| `functions/groupMembers.ts` | #11 |
| `functions/groupCreationRequests.ts` | #13 |
| `functions/uploads.ts` | #14 |
| `functions/integrations.ts` | #12 |
| `mobile/.../usePlanningCenterAuth.ts` | #12 |
| `schema.ts` | #6, #11 (new indexes) |
| `lib/helpers.ts` (new) | #9 |

---

## Convex Best Practices Reference

### DO: Single Mutation for Related Changes
```typescript
// GOOD - atomic
const createGroupWithChannels = mutation({
  handler: async (ctx, args) => {
    const groupId = await ctx.db.insert("groups", {...});
    await ctx.db.insert("chatChannels", { groupId, type: "main" });
    await ctx.db.insert("chatChannels", { groupId, type: "leaders" });
    return groupId;
  }
});
```

### DON'T: Action Calling Multiple Mutations
```typescript
// BAD - not atomic
const createGroupAction = action({
  handler: async (ctx, args) => {
    await ctx.runMutation(internal.createGroup, {...});
    await ctx.runMutation(internal.createChannels, {...}); // Can fail independently!
  }
});
```

### DO: Mutation Schedules Action
```typescript
// GOOD - data first, external work scheduled
const createGroup = mutation({
  handler: async (ctx, args) => {
    const groupId = await ctx.db.insert("groups", {...});
    await ctx.scheduler.runAfter(0, internal.notifyAdmins, { groupId });
    return groupId;
  }
});
```

---

## Progress Tracking

| Fix | Description | Status | PR |
|-----|-------------|--------|-----|
| #1 | Channel atomicity | ✅ Complete | - |
| #2 | Auth atomicity | ✅ Complete | - |
| #3 | Notification batching | ✅ Complete | - |
| #4 | Member count race | ✅ Complete | - |
| #5 | User removal cleanup | ✅ Complete | - |
| #6 | Job cancellation | ✅ Complete | - |
| #7 | Profile sync | ✅ Complete | - |
| #8 | Announcement group | ✅ Complete | - |
| #9 | leftAt helpers | ✅ Complete | - |
| #10 | Loop validation | ✅ Complete | - |
| #11 | Full table scans | ✅ Complete | - |
| #12 | Direct action calls | ✅ Complete | - |
| #13 | Sequential DB loops | ✅ Complete | - |
| #14 | Vague errors | ✅ Complete | - |
| #15 | Log prefixes | ✅ Complete | - |

---

## OLD CONTENT BELOW (Restructuring Plan - COMPLETED)

The restructuring phases below have been completed. See PR #247.

---

## Phase 1: Stream Chat, Migration Code & Notifications Duplication Cleanup

### Overview
Remove all Stream Chat code, migration/backfill code, and consolidate duplicated notification utilities.

### Files to DELETE (5 files, ~3,674 lines)

| File | Lines | Reason |
|------|-------|--------|
| `lib/stream.ts` | 238 | Stream Chat REST API client |
| `functions/chat.ts` | 1,363 | All Stream Chat operations |
| `__tests__/chat.test.ts` | ~300 | Tests for Stream Chat |
| `__tests__/security-http-webhook.test.ts` | 1,241 | Tests for Stream webhook |
| `lib/notifications/definitions/index.ts` | 532 | Unused duplicate of definitions.ts |

### Files to MODIFY

#### 1. `functions/messaging/channels.ts` (2,276 → ~575 lines)
Delete lines 676-1767 and 1951-2276 (backfill/migration code):
- `runBackfill`, `backfillChannels`
- `runMemberBackfill`, `backfillChannelMembers`
- `runStep1Backfill`, `runStep2Backfill`
- `backfillSingleCommunity`, `backfillLargeCommunity`
- `backfillAnnouncementGroupMembersBatch`
- `runBatchMemberBackfill`, `backfillGroupBatch`
- `addUserToChannel`, `updateChannelMemberCount` (helpers)
- `getBasicCounts`, `findLargeCommunities` (diagnostics)
- `getGroupChannelMemberCount`, `getTotalChannelMembersCount`
- `findGroupsNeedingChannelSync`
- `backfillSingleGroupChannelMembers`, `backfillLargeGroupChannels`

#### 2. `http.ts` (~400 lines to remove)
- Remove Stream imports (lines 17-23)
- Remove `StreamWebhookPayload` interface
- Remove `validateStreamWebhookPayload` function
- Remove `extractChannelId` function
- Remove `verifyStreamSignature` function
- Remove entire `/webhooks/stream` route
- Remove `handleMessageNew`, `handleMentionNotifications`
- Remove `handleMemberRemoved`, `handleMessageFlagged`

#### 3. `functions/notifications.ts` (~100 lines to remove)
- Remove `sendChatMessage` action (lines 2933-3015)
- Update/remove Stream-related comments throughout

#### 4. `functions/groups.ts` (~20 lines to remove)
- Remove import: `import { buildStreamChannelId, type StreamChannelType } from "@togather/shared/stream";`
- Remove `type ChatType = StreamChannelType;`
- Remove `buildStreamChannelId` calls in `getGroupsForInbox`

#### 5. `functions/scheduledJobs.ts` (1 line)
- Update comment to remove "Stream chat" reference

#### 6. `__tests__/birthday-bot.test.ts` (3 lines)
- Remove `STREAM_API_KEY` and `STREAM_API_SECRET` env vars

### Notifications Duplication Cleanup

#### Delete duplicate definitions file
- DELETE `lib/notifications/definitions/index.ts` (532 lines)
- KEEP `lib/notifications/definitions.ts` (628 lines) - this is the one imported by registry.ts

#### Consolidate `escapeHtml` to single location
| Location | Action |
|----------|--------|
| `lib/notifications/emailTemplates.ts` (line 19) | **KEEP** - canonical location, already exported |
| `lib/notifications/definitions.ts` (lines 154-161) | **DELETE** - import from emailTemplates instead |
| `functions/notifications.ts` (lines 2113-2125) | **DELETE** - import from emailTemplates instead |

#### Consolidate `getCurrentEnvironment` (if duplicated)
Check both locations and keep only one:
- `functions/notifications.ts`
- `lib/notifications/send.ts`

### Environment Variables to Remove
- `STREAM_API_KEY`
- `STREAM_API_SECRET`

### Verification
1. Run `pnpm test apps/convex/` - all tests should pass (minus deleted test files)
2. Run `npx convex dev` - should compile without errors
3. Check mobile app still works with messaging

---

## Phase 2: Split admin.ts (4,369 → 8 files)

### Overview
Split the largest file into domain-focused modules. Clean break on API paths.

### New Structure
```
functions/admin/
├── index.ts           (~50 lines)  - Re-exports for discoverability only
├── auth.ts            (~80 lines)  - Authorization helpers & role constants
├── requests.ts        (~400 lines) - Join requests + group creation requests
├── members.ts         (~500 lines) - Community member management
├── stats.ts           (~600 lines) - Analytics/attendance stats
├── settings.ts        (~250 lines) - Community settings + group types
├── duplicates.ts      (~500 lines) - Duplicate account management
├── cleanup.ts         (~800 lines) - Inactive user cleanup + deletion
└── migrations.ts      (~60 lines)  - Legacy data migration

__tests__/admin/
├── requests.test.ts
├── members.test.ts
├── stats.test.ts
├── settings.test.ts
├── duplicates.test.ts
└── cleanup.test.ts
```

### Function Distribution

| New File | Functions |
|----------|-----------|
| `auth.ts` | `COMMUNITY_ROLES`, `ADMIN_ROLE_THRESHOLD`, `LEADER_ROLES`, `requireCommunityAdmin`, `requirePrimaryAdmin`, `checkCommunityAdmin`, `checkPrimaryAdmin` |
| `requests.ts` | `listPendingRequests`, `reviewPendingRequest`, `listGroupCreationRequests`, `getGroupCreationRequestById`, `reviewGroupCreationRequest` |
| `members.ts` | `listCommunityMembers`, `searchCommunityMembers`, `getCommunityMemberById`, `updateMemberRole`, `transferPrimaryAdmin`, `getUserGroupHistory` |
| `stats.ts` | `getTotalAttendance`, `getNewSignups`, `getActiveMembers`, `getNewMembersThisMonth`, `getAttendanceByGroupType`, `getActiveMembersList`, `getNewMembersList`, `getGroupAttendanceDetails`, `exportAttendanceByGroupType`, `getGroupAttendanceForExport`, `getExportSetupData` |
| `settings.ts` | `getCommunitySettings`, `updateCommunitySettings`, `listGroupTypes`, `createGroupType`, `updateGroupType`, `listAllGroups` |
| `duplicates.ts` | `listDuplicateAccounts`, `mergeDuplicateAccounts`, `listMergedAccounts` |
| `cleanup.ts` | All `*Internal` queries, `dryRunActiveUsers*`, `previewInactiveUserDeletion`, `deleteInactiveUserData`, `exportCommunityAttendanceCSV` |
| `migrations.ts` | `upsertGroupTypeFromLegacy` |

### Mobile App Updates Required
Update all imports from `api.functions.admin.*` to new paths like:
- `api.functions.admin.requests.listPendingRequests`
- `api.functions.admin.members.updateMemberRole`
- etc.

### Verification
1. Run all admin tests
2. Search mobile app for `api.functions.admin` and update imports
3. Test admin dashboard functionality end-to-end

---

## Phase 3: Split notifications.ts (3,024 → 10 files)

### Overview
Split into domain-focused modules. Much of Phase 1 cleanup will already reduce this file.

### Architecture Note
Keep `lib/notifications/` separate from `functions/notifications/`:
- **lib/notifications/** = Pure utilities, types, templates (no Convex functions)
- **functions/notifications/** = Convex query/mutation/action definitions

The lib code is imported BY the function definitions.

### New Structure
```
functions/notifications/
├── index.ts           (~50 lines)  - Re-exports
├── tokens.ts          (~200 lines) - Push token management
├── preferences.ts     (~150 lines) - User/group notification settings
├── queries.ts         (~150 lines) - List, unread count
├── mutations.ts       (~100 lines) - Mark read, create notification
├── actions.ts         (~200 lines) - sendPushNotification, sendTest
├── internal.ts        (~300 lines) - Internal queries/mutations/actions
├── moderation.ts      (~250 lines) - Report emails, block emails
├── debug.ts           (~150 lines) - Debug queries (dev only)
└── migrations.ts      (~100 lines) - Legacy migration functions

__tests__/notifications/
├── tokens.test.ts
├── preferences.test.ts
├── queries.test.ts
└── moderation.test.ts
```

### Function Distribution

| New File | Functions |
|----------|-----------|
| `tokens.ts` | `registerToken`, `unregisterToken`, `cleanupLegacyTokens`, `cleanupAllLegacyTokens`, `getActiveTokensForUser`, `getActiveTokensForUsers` |
| `preferences.ts` | `setGroupNotifications`, `getGroupNotifications`, `preferences`, `getChannelPreferences`, `updateChannelPreferences`, `updatePreferences` |
| `queries.ts` | `list`, `unreadCount` |
| `mutations.ts` | `markRead`, `markAllRead`, `createNotification` |
| `actions.ts` | `sendTest`, `sendPushNotification`, `sendTestNotification`, `getNotificationTypes`, `getEmailPreview` |
| `internal.ts` | `getCommunityAdmins`, `getGroupInfo`, `getUserDisplayName`, `getUserEmailInfo`, `getUserForNotification`, `getGroupMembersForNotification`, `notifyJoinRequest*`, `notifyGroupCreation*`, `notifyLeaderPromotion`, `sendEmailNotification`, `sendBatchPushNotifications` |
| `moderation.ts` | `sendModerationEmail`, `sendUserBlockedEmail`, `reportUserBlocked` |
| `debug.ts` | `debugTokensForUser`, `debugRecentNotifications`, `debugMessageNotifications`, `debugChannelMembership` |
| `migrations.ts` | `upsertPushTokenFromLegacy`, `getUserByLegacyId`, `getGroupByLegacyId`, `getUsersByLegacyIds`, `getGroupMembersWithNotifications` |

### Verification
1. Run notification tests
2. Test push notifications end-to-end
3. Test email sending

---

## Phase 4: Split remaining large files

### 4a. meetings.ts (1,877 → 6 files)

```
functions/meetings/
├── index.ts           (~100 lines) - Re-exports, basic CRUD
├── rsvp.ts            (~150 lines) - RSVP functions
├── attendance.ts      (~350 lines) - Attendance tracking
├── communityEvents.ts (~400 lines) - Community-wide events
├── explore.ts         (~350 lines) - communityEvents, myRsvpEvents queries
└── migrations.ts      (~50 lines)  - Legacy sync functions
```

### 4b. auth.ts (1,801 → 8 files)

```
functions/auth/
├── index.ts           (~100 lines) - Re-exports
├── phoneOtp.ts        (~400 lines) - sendPhoneOTP, verifyPhoneOTP
├── emailOtp.ts        (~300 lines) - Email verification
├── registration.ts    (~250 lines) - registerNewUser, signup
├── login.ts           (~200 lines) - legacyLogin, phoneLookup
├── tokens.ts          (~150 lines) - refreshToken, updateLastActivity
├── accountClaim.ts    (~300 lines) - claimAccount, submitAccountClaimRequest
└── helpers.ts         (~150 lines) - Twilio helpers, error mapping
```

### 4c. groups.ts (1,490 → 5 files)

```
functions/groups/
├── index.ts           (~100 lines) - Re-exports
├── queries.ts         (~500 lines) - Read operations
├── mutations.ts       (~400 lines) - Write operations
├── members.ts         (~300 lines) - Member-related queries
└── internal.ts        (~100 lines) - Internal queries
```

### Verification
1. Run all tests for each domain
2. Update mobile app imports
3. Test critical user flows

---

## Phase 5: Extract shared utilities

### Overview
Eliminate code duplication by extracting to `lib/`.

### New Files

#### `lib/permissions.ts` (~150 lines)
Extract from: admin.ts, groups.ts, groupMembers.ts, meetings.ts, communities.ts

```typescript
export const COMMUNITY_ADMIN_THRESHOLD = 3;
export const PRIMARY_ADMIN_ROLE = 4;

export async function isCommunityAdmin(ctx, communityId, userId): Promise<boolean>
export async function isGroupLeader(ctx, groupId, userId): Promise<boolean>
export async function requireCommunityAdmin(ctx, communityId, userId): Promise<void>
export async function requireGroupLeader(ctx, groupId, userId): Promise<void>
```

#### `lib/twilio.ts` (~200 lines)
Extract from: functions/auth.ts

```typescript
export function mapTwilioError(status, errorCode, errorMessage): string
export function getTwilioAuthCredentials(): { username, password } | null
export function isTestPhone(phone: string): boolean
export function isTestEmail(email: string): boolean
```

#### `lib/meetingConfig.ts` (~50 lines)
Extract from: meetings.ts, groups.ts

```typescript
export const DEFAULT_REMINDER_OFFSET_MS = 60 * 60 * 1000;
export const DEFAULT_MEETING_DURATION_MS = 60 * 60 * 1000;
export const DEFAULT_ATTENDANCE_CONFIRMATION_OFFSET_MS = 30 * 60 * 1000;
export const DEFAULT_RSVP_OPTIONS = [...]
```

### Verification
1. Search for duplicated code patterns
2. Update all imports
3. Run full test suite

---

## Progress Tracking

| Phase | Status | PR | Notes |
|-------|--------|-----|-------|
| 1. Stream/Migration/Notifications Cleanup | ✅ Complete | [#246](https://github.com/togathernyc/togather/pull/246) | ~6,400 lines removed |
| 2. Split admin.ts | ✅ Complete | [#247](https://github.com/togathernyc/togather/pull/247) | 4,369 → 8 files |
| 3. Split notifications.ts | ✅ Complete | [#247](https://github.com/togathernyc/togather/pull/247) | 3,024 → 10 files |
| 4a. Split meetings.ts | ✅ Complete | [#247](https://github.com/togathernyc/togather/pull/247) | 1,877 → 6 files |
| 4b. Split auth.ts | ✅ Complete | [#247](https://github.com/togathernyc/togather/pull/247) | 1,801 → 8 files |
| 4c. Split groups.ts | ✅ Complete | [#247](https://github.com/togathernyc/togather/pull/247) | 1,490 → 5 files |
| 5. Extract shared utilities | ✅ Complete | [#247](https://github.com/togathernyc/togather/pull/247) | Create 3 new lib files |

### Status Legend
- ⬜ Not Started
- 🟡 In Progress
- ✅ Complete
- ❌ Blocked

---

## Agent Instructions

### For New Agents
1. Read this entire document first
2. Check the Progress Tracking section for current status
3. Work on the next incomplete phase
4. Update Progress Tracking when starting/completing phases
5. Run verification steps before marking complete

### For Audit Agents
1. Compare actual file structure against plan
2. Verify line counts are within 500-700 limit
3. Check for any remaining code duplication
4. Ensure all tests pass
5. Report any deviations from plan
