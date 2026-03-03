# Convex Backend Best Practices

This document serves as special instructions when working with Convex in the Togather codebase. It combines official Convex best practices with lessons learned from our specific implementation.

**Official Convex Documentation References:**
- [Database Types & System Fields](https://docs.convex.dev/database/types)
- [Validators (v)](https://docs.convex.dev/api/modules/values#v)
- [Best Practices](https://docs.convex.dev/production/best-practices/)
- [The Zen of Convex](https://docs.convex.dev/zen)

## Table of Contents

1. [The Zen of Convex](#the-zen-of-convex)
2. [Schema Design](#schema-design)
3. [TypeScript Types](#typescript-types)
4. [Queries and Mutations](#queries-and-mutations)
5. [Transactional Operations](#transactional-operations)
6. [Channel Membership Sync](#channel-membership-sync)
7. [Scheduler vs Direct Calls](#scheduler-vs-direct-calls)
8. [Actions](#actions)
9. [Avoiding Duplicate Functions](#avoiding-duplicate-functions)
10. [Error Handling](#error-handling)
11. [Logging](#logging)
12. [Testing](#testing)
13. [Common Patterns](#common-patterns)
14. [Cleanup Tasks](#cleanup-tasks)

---

## The Zen of Convex

### Performance Philosophy

**Double down on the sync engine.** The deterministic, reactive database is the heart of Convex. The more you center your app around its properties, the better:
- Easier to understand and refactor
- Screaming fast performance
- No consistency or state management problems

**Use a query for nearly every app read.** Queries are reactive, automatically cacheable, consistent, and resilient. With very few exceptions, every read operation should happen via a query function.

**Keep sync engine functions light & fast.** Mutations and queries should work with less than a few hundred records and finish in less than 100ms. It's nearly impossible to maintain a snappy app if synchronous transactions involve more work than this.

**Use actions sparingly and incrementally.** Actions are wonderful for batch jobs and integrating with outside services, but they're slower, more expensive, and Convex provides fewer guarantees. Never use an action if a query or mutation will get the job done.

**Don't over-complicate client-side state management.** Convex builds caching and consistency controls into the client library. Let your client-side code take advantage of these built-in performance boosts.

### Architecture Philosophy

**Create server-side frameworks using "just code."** Solve composition and encapsulation problems using standard TypeScript patterns. This is why Convex is "just code."

**Don't misuse actions:**
- Don't invoke actions directly from your app (anti-pattern)
- Trigger actions by invoking a mutation that writes a record AND schedules the action
- Think "workflow", not "background jobs"

**Record progress one step at a time.** Actions should do smaller batches of work, perform individual transformations, then record progress with a mutation. This makes it easy to debug, resume partial jobs, and report incremental progress.

---

## Schema Design

### System Fields

Every document in Convex has two automatically-generated system fields:

- `_id`: The document ID
- `_creationTime`: Time created (milliseconds since Unix epoch)

**You do NOT need to add indices for these - they're automatic.**

### Validator Reference (`v`)

```typescript
import { v } from "convex/values";

// Primitives
v.string()           // string
v.number()           // number (float64)
v.boolean()          // boolean
v.null()             // null
v.int64()            // bigint
v.bytes()            // ArrayBuffer

// References
v.id("tableName")    // Document ID reference

// Complex types
v.literal("value")   // Exact value
v.array(v.string())  // Array of type
v.object({ ... })    // Object with fields
v.union(v.literal("a"), v.literal("b"))  // Union type
v.optional(v.string())  // Optional field
v.record(v.string(), v.number())  // Record/map type
v.any()              // Any type (avoid when possible)
```

### Schema Best Practices

```typescript
// ✅ GOOD: Well-crafted schema
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  users: defineTable({
    firstName: v.string(),
    lastName: v.string(),
    phone: v.string(),
    phoneVerified: v.boolean(),
    // Don't add createdAt - use _creationTime instead!
  }).index("by_phone", ["phone"]),

  // Use IDs for references between tables
  groupMembers: defineTable({
    groupId: v.id("groups"),
    userId: v.id("users"),
    role: v.string(),
    joinedAt: v.number(),
    leftAt: v.optional(v.number()),  // Soft delete pattern
  })
    .index("by_group", ["groupId"])
    .index("by_user", ["userId"])
    .index("by_group_user", ["groupId", "userId"]),

  // Union types for role-based data
  messages: defineTable({
    content: v.string(),
    channelId: v.id("chatChannels"),
    author: v.union(
      v.object({
        role: v.literal("system"),
      }),
      v.object({
        role: v.literal("user"),
        userId: v.id("users"),
      }),
    ),
  }).index("by_channel", ["channelId"]),
});
```

### Schema Anti-Patterns

```typescript
// ❌ BAD: Don't duplicate system fields
defineTable({
  id: v.string(),           // Use _id instead
  createdAt: v.number(),    // Use _creationTime instead
  ...
})

// ❌ BAD: Don't nest when you should reference
defineTable({
  members: v.array(v.object({  // Use separate table with references
    userId: v.string(),
    role: v.string(),
  })),
})

// ✅ GOOD: Use tables for separate object types
// Table: groupMembers
defineTable({
  groupId: v.id("groups"),
  userId: v.id("users"),
  role: v.string(),
})
```

---

## TypeScript Types

### Using Generated Types

```typescript
import { Doc, Id } from "../convex/_generated/dataModel";

// For document references
function MemberCard(props: { member: Doc<"groupMembers"> }) {
  return <div>{props.member.role}</div>;
}

// For ID props
function GroupDetail(props: { groupId: Id<"groups"> }) {
  const group = useQuery(api.functions.groups.getById, { groupId: props.groupId });
  // ...
}
```

### Using WithoutSystemFields

```typescript
import { WithoutSystemFields } from "convex/server";

// For creating new documents (without _id and _creationTime)
type NewGroup = WithoutSystemFields<Doc<"groups">>;

const newGroup: NewGroup = {
  name: "Book Club",
  communityId: someCommunityId,
  // _id and _creationTime not needed
};
```

### Inferring Types from Validators

```typescript
import { Infer } from "convex/values";

const memberValidator = v.object({
  userId: v.id("users"),
  role: v.union(v.literal("member"), v.literal("leader")),
});

type Member = Infer<typeof memberValidator>;
// { userId: Id<"users">, role: "member" | "leader" }
```

---

## Queries and Mutations

### Prefer Queries and Mutations Over Actions

You should generally avoid using actions when the same goal can be achieved using queries or mutations. Since actions can have side effects, they can't be automatically retried nor their results cached.

### Use Indexes for Large Tables

```typescript
// ❌ BAD: Full table scan
const allMembers = await ctx.db.query("groupMembers").collect();
const groupMembers = allMembers.filter(m => m.groupId === groupId);

// ✅ GOOD: Indexed query
const groupMembers = await ctx.db
  .query("groupMembers")
  .withIndex("by_group", (q) => q.eq("groupId", groupId))
  .collect();
```

### Use Pagination for Large Results

```typescript
// ✅ GOOD: Paginated query
const results = await ctx.db
  .query("messages")
  .withIndex("by_channel", (q) => q.eq("channelId", channelId))
  .order("desc")
  .paginate(args.paginationOpts);
```

### Helper Functions for Shared Code

```typescript
// ✅ GOOD: Shared helper (same transaction)
async function isCommunityAdmin(
  ctx: QueryCtx | MutationCtx,
  communityId: Id<"communities">,
  userId: Id<"users">
): Promise<boolean> {
  const membership = await ctx.db
    .query("userCommunities")
    .withIndex("by_user_community", (q) =>
      q.eq("userId", userId).eq("communityId", communityId)
    )
    .first();
  return !!(membership && membership.roles >= 3);
}

// Use in mutation
export const sensitiveAction = mutation({
  handler: async (ctx, args) => {
    if (!await isCommunityAdmin(ctx, communityId, userId)) {
      throw new Error("Not authorized");
    }
    // ...
  },
});
```

---

## Transactional Operations

### The Golden Rule

> **All related database operations that must be consistent should happen in the same mutation.**

Convex mutations are transactional - all database operations within a single mutation either succeed together or fail together. Use this to your advantage.

### Anti-Pattern: Async Scheduling for Critical Operations

```typescript
// ❌ BAD: Race condition - user sees success but sync happens later
export const approveJoinRequest = mutation({
  handler: async (ctx, args) => {
    await ctx.db.patch(membershipId, { leftAt: undefined });

    // This runs AFTER the mutation returns!
    await ctx.scheduler.runAfter(0, internal.syncMemberships, { userId });

    return { success: true };
    // User tries to access group immediately → ERROR
  },
});
```

```typescript
// ✅ GOOD: Sync happens in same transaction
import { syncUserChannelMembershipsLogic } from "./sync/memberships";

export const approveJoinRequest = mutation({
  handler: async (ctx, args) => {
    await ctx.db.patch(membershipId, { leftAt: undefined });

    // Direct call - happens before mutation returns
    await syncUserChannelMembershipsLogic(ctx, userId, groupId);

    return { success: true };
    // User can access group immediately ✓
  },
});
```

### When to Use Transactions (Direct Calls)

Use direct function calls (same transaction) when:
- User expects immediate access after an action
- Data consistency is critical (memberships, permissions)
- Failure of the secondary operation should fail the whole action
- The operations are logically atomic

### When Async Scheduling is OK

Use `scheduler.runAfter()` for:
- Notifications (non-critical, can be delayed)
- Analytics/logging (fire-and-forget)
- Background jobs that can retry independently
- Operations that don't affect immediate user experience

---

## Channel Membership Sync

### The Sync Functions

We have centralized sync functions in `functions/sync/memberships.ts`:

```typescript
// For syncing a user's channel memberships in a group
import { syncUserChannelMembershipsLogic } from "./sync/memberships";
await syncUserChannelMembershipsLogic(ctx, userId, groupId);

// For syncing announcement group membership based on community role
import { syncAnnouncementGroupMembership } from "./sync/memberships";
await syncAnnouncementGroupMembership(ctx, userId, communityId);
```

### When to Call Sync

**ALWAYS** call sync transactionally when:

| Action | Sync Function |
|--------|---------------|
| User joins group | `syncUserChannelMembershipsLogic(ctx, userId, groupId)` |
| User leaves group | `syncUserChannelMembershipsLogic(ctx, userId, groupId)` |
| Join request approved | `syncUserChannelMembershipsLogic(ctx, userId, groupId)` |
| Member added to group | `syncUserChannelMembershipsLogic(ctx, userId, groupId)` |
| Member removed from group | `syncUserChannelMembershipsLogic(ctx, userId, groupId)` |
| Member role changed | `syncUserChannelMembershipsLogic(ctx, userId, groupId)` |
| Community admin status changed | `syncAnnouncementGroupMembership(ctx, userId, communityId)` |
| User leaves community | Loop: `syncUserChannelMembershipsLogic` for each group |

### What the Sync Does

`syncUserChannelMembershipsLogic`:
- Checks user's current group membership status
- For **main channel**: Adds/removes based on active membership
- For **leaders channel**: Adds/removes based on leader/admin role
- Updates `chatChannelMembers` table
- Updates channel `memberCount`

`syncAnnouncementGroupMembership`:
- Checks user's community role
- Makes them **leader** in announcement group if community admin
- Makes them **member** if regular community member
- Removes them if no longer in community
- Also syncs the announcement group's channels

---

## Scheduler vs Direct Calls

### Decision Matrix

| Scenario | Use | Reason |
|----------|-----|--------|
| User needs result immediately | Direct call | No race condition |
| Failure should rollback main action | Direct call | Same transaction |
| Push notification | `scheduler.runAfter(0, ...)` | Non-critical |
| Email sending | `scheduler.runAfter(0, ...)` | Can retry independently |
| Audit logging | `scheduler.runAfter(0, ...)` | Fire-and-forget |
| Data sync user depends on | Direct call | Must complete first |

### Scheduler Patterns

```typescript
// Non-blocking notification (OK to be async)
ctx.scheduler.runAfter(0, internal.functions.notifications.notify, { ... });

// Delayed job
ctx.scheduler.runAfter(60000, internal.functions.cleanup.run, { ... }); // 1 min

// NEVER use scheduler for data the user needs immediately
// ❌ ctx.scheduler.runAfter(0, internal.syncMemberships, { ... });
```

---

## Actions

### When to Use Actions

Actions are for:
- Calling third-party APIs (Twilio, external services, etc.)
- Batch jobs that take longer than 100ms
- Operations with external side effects

### Action Anti-Patterns

```typescript
// ❌ BAD: Calling action directly from client
// In mobile app:
const result = await myAction({ ... });

// ✅ GOOD: Mutation triggers action
export const startProcess = mutation({
  handler: async (ctx, args) => {
    // Create a record to track the job
    const jobId = await ctx.db.insert("jobs", {
      status: "pending",
      userId: args.userId,
    });

    // Schedule the action
    await ctx.scheduler.runAfter(0, internal.processJob, { jobId });

    return { jobId };
  },
});

// Action updates the record as it progresses
export const processJob = internalAction({
  handler: async (ctx, args) => {
    // Do external work...
    await ctx.runMutation(internal.updateJobStatus, {
      jobId: args.jobId,
      status: "complete",
    });
  },
});
```

### Action Workflow Pattern

Think "workflow", not "background job":

```
mutation (create record)
  → action (external work)
  → mutation (record progress)
  → action (more external work)
  → mutation (complete)
```

This allows:
- Apps to follow progress via queries
- Easy debugging
- Resumable partial jobs
- Incremental progress reporting

### Record Progress Incrementally

While actions could work with thousands of records and call dozens of APIs, it's normally best to:
1. Do smaller batches of work
2. Perform individual transformations with outside services
3. Record progress with a mutation

```typescript
// ✅ GOOD: Chunked processing with progress
export const processLargeBatch = internalAction({
  handler: async (ctx, args) => {
    const CHUNK_SIZE = 50;

    for (let i = 0; i < args.items.length; i += CHUNK_SIZE) {
      const chunk = args.items.slice(i, i + CHUNK_SIZE);

      // Process chunk
      await processChunk(chunk);

      // Record progress
      await ctx.runMutation(internal.updateProgress, {
        jobId: args.jobId,
        processed: i + chunk.length,
        total: args.items.length,
      });
    }
  },
});
```

---

## Avoiding Duplicate Functions

### The Problem

Duplicate functions with similar purposes lead to:
- Inconsistent behavior (one has bug fix, other doesn't)
- Confusion about which to use
- Maintenance burden

### Example: Join Request Approval

We had TWO functions for approving join requests:
- `groupMembers.reviewJoinRequest` - **dead code, was never used**
- `admin.reviewPendingRequest` - **actually used in the app**

Only the second one got the channel sync fix initially.

### Prevention Checklist

Before creating a new function:

1. **Search for existing functions** with similar names/purposes
   ```bash
   grep -r "functionName\|similar words" apps/convex/functions/
   ```

2. **Check the mobile app** to see what's actually called
   ```bash
   grep -r "api.functions.moduleName" apps/mobile/
   ```

3. **If duplicate exists**: Consolidate, don't create another

4. **If creating new**: Add a comment pointing to related functions
   ```typescript
   /**
    * Approve a join request.
    *
    * NOTE: This is the only function for approving join requests.
    * Used by: PendingRequestsScreen, PendingRequestsContent
    */
   ```

### Finding Dead Code

```bash
# Find exported functions
grep -r "export const functionName" apps/convex/functions/

# Check if used in mobile
grep -r "functionName" apps/mobile/ --include="*.ts" --include="*.tsx"

# If only in tests → likely dead code
```

---

## Error Handling

### User-Facing Errors

```typescript
// ✅ Clear, actionable error messages
if (!membership) {
  throw new Error("You are not a member of this group");
}

if (!isAdmin) {
  throw new Error("Only community admins can approve join requests");
}

// ❌ Vague errors
throw new Error("Not authorized");
throw new Error("Error");
```

### Internal Errors (Logging)

```typescript
// Log context for debugging, throw user-friendly message
if (!channel) {
  console.error(`[getMessages] Channel ${channelId} not found for user ${userId}`);
  throw new Error("Channel not found");
}
```

### Permission Checks

Always verify permissions early:

```typescript
export const sensitiveAction = mutation({
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);

    // Check permissions FIRST
    const isAdmin = await isCommunityAdmin(ctx, communityId, userId);
    if (!isAdmin) {
      throw new Error("Only admins can perform this action");
    }

    // Then do the work...
  },
});
```

---

## Logging

### When to Log

- **Always log** state changes in sync functions
- **Log warnings** for unexpected but recoverable situations
- **Log errors** with context before throwing

### Log Format

```typescript
// Use consistent prefix format: [functionName]
console.log(`[syncUserChannelMembershipsLogic] Added user ${userId} to ${channelType} channel ${channelId}`);
console.warn(`[syncAnnouncementGroupMembership] No announcement group found for community ${communityId}`);
```

### What to Include

```typescript
// ✅ Good: Includes IDs for debugging
console.log(`[reviewPendingRequest] Approved user ${userId} for group ${groupId}`);

// ❌ Bad: No context
console.log("Approved request");
```

### Viewing Logs

```bash
# Stream logs from dev/staging
npx convex logs

# Or use the pnpm script
pnpm convex:logs
```

---

## Testing

### Test Transactional Behavior

```typescript
// Test that sync happens IMMEDIATELY (no scheduler needed)
test("approved user can immediately access channel", async () => {
  // Approve the request
  await t.mutation(api.functions.admin.reviewPendingRequest, {
    token: adminToken,
    membershipId,
    action: "accept",
  });

  // DO NOT call finishAllScheduledFunctions here!
  // The sync should have happened transactionally.

  // Verify immediate access
  const membership = await getChannelMembership(t, channelId, userId);
  expect(membership).not.toBeNull();
  expect(membership?.leftAt).toBeUndefined();
});
```

### Test Both Success and Failure Paths

```typescript
test("non-admin cannot approve requests", async () => {
  await expect(
    t.mutation(api.functions.admin.reviewPendingRequest, {
      token: memberToken, // Not an admin
      membershipId,
      action: "accept",
    })
  ).rejects.toThrow("Only community admins");
});
```

### Run Tests Before Deploying

```bash
# Run all Convex tests
pnpm test apps/convex/

# Run specific test file
cd apps/convex && pnpm vitest run __tests__/path/to/test.ts
```

---

## Common Patterns

### Membership Change Pattern

Whenever group membership changes:

```typescript
import { syncUserChannelMembershipsLogic } from "./sync/memberships";

export const membershipChange = mutation({
  handler: async (ctx, args) => {
    // 1. Validate permissions
    const adminId = await requireAuth(ctx, args.token);
    await requireCommunityAdmin(ctx, communityId, adminId);

    // 2. Make the membership change
    await ctx.db.patch(membershipId, {
      leftAt: undefined,
      joinedAt: Date.now(),
    });

    // 3. Sync channel memberships (TRANSACTIONAL)
    await syncUserChannelMembershipsLogic(ctx, userId, groupId);

    // 4. Non-critical notifications (OK to be async)
    ctx.scheduler.runAfter(0, internal.notifications.notify, { ... });

    return { success: true };
  },
});
```

### Community Role Change Pattern

When community admin status changes:

```typescript
import { syncAnnouncementGroupMembership } from "./sync/memberships";

export const updateCommunityRole = mutation({
  handler: async (ctx, args) => {
    const wasAdmin = currentRole >= ADMIN_THRESHOLD;
    const willBeAdmin = newRole >= ADMIN_THRESHOLD;

    await ctx.db.patch(membershipId, { roles: newRole });

    // Only sync if admin status actually changed
    if (wasAdmin !== willBeAdmin) {
      await syncAnnouncementGroupMembership(ctx, userId, communityId);
    }
  },
});
```

### Query with Membership Check

```typescript
export const getMessages = query({
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);

    // Always verify membership before returning data
    const membership = await ctx.db
      .query("chatChannelMembers")
      .withIndex("by_channel_user", (q) =>
        q.eq("channelId", args.channelId).eq("userId", userId)
      )
      .first();

    if (!membership || membership.leftAt) {
      throw new Error("Not a member of this channel");
    }

    // Now safe to return data...
  },
});
```

---

## Cleanup Tasks

### Code to Review/Fix

Based on this bug, the following should be audited:

1. **Search for all `scheduler.runAfter` calls with sync functions**
   ```bash
   grep -rn "scheduler.runAfter.*sync" apps/convex/functions/
   ```
   Convert critical syncs to direct calls.

2. **Find duplicate functions**
   ```bash
   # Look for similar function names
   grep -rn "export const.*[Rr]eview\|[Aa]pprove\|[Aa]ccept" apps/convex/functions/
   ```

3. **Verify all membership changes call sync**
   Search for `leftAt: undefined` or `joinedAt:` and ensure sync follows.

4. **Remove dead code**
   Functions only referenced in tests, not in the mobile app.

---

## Summary

| Do | Don't |
|----|-------|
| Use direct calls for user-critical operations | Use scheduler for data user needs immediately |
| Call sync functions transactionally | Schedule sync with `runAfter(0, ...)` |
| Search for existing functions first | Create duplicates |
| Log with context `[functionName]` | Log vague messages |
| Test immediate behavior (no scheduler wait) | Assume scheduler runs instantly |
| Check permissions early | Do work before validating access |
