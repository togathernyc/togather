# Convex Migration Guide for Togather

A comprehensive reference for migrating Togather from Supabase/tRPC/Prisma to Convex.

## Table of Contents

1. [Core Setup (React Native / Expo)](#1-core-setup-react-native--expo)
2. [Schema Definition](#2-schema-definition)
3. [Functions (Queries, Mutations, Actions)](#3-functions-queries-mutations-actions)
4. [Data Migration](#4-data-migration)
5. [External Integrations](#5-external-integrations)
6. [Togather-Specific Patterns](#6-togather-specific-patterns)

---

## 1. Core Setup (React Native / Expo)

### Installation

```bash
# Install Convex
pnpm add convex

# Initialize Convex (creates apps/convex/ folder)
npx convex dev
```

### Environment Variables

Create `.env` in your Expo app:

```env
EXPO_PUBLIC_CONVEX_URL=https://your-deployment.convex.cloud
```

### Project Structure for Monorepo

```
togather/
├── apps/
│   ├── mobile/
│   │   ├── app/
│   │   │   └── _layout.tsx      # ConvexProvider setup
│   │   └── .env                 # EXPO_PUBLIC_CONVEX_URL
│   └── convex/                  # Convex backend
│       ├── schema.ts            # Database schema
│       ├── _generated/          # Auto-generated types
│       ├── functions/
│       │   ├── groups.ts        # Group functions
│       │   ├── meetings.ts      # Meeting functions
│       │   └── auth.ts          # Auth helpers
│       └── lib/                 # Shared utilities
├── convex -> apps/convex        # Symlink for backwards compatibility
└── convex.json                  # Root config
```

### ConvexProvider Setup

In `apps/mobile/app/_layout.tsx`:

```typescript
import { ConvexProvider, ConvexReactClient } from "convex/react";
import { Stack } from "expo-router";

const convex = new ConvexReactClient(process.env.EXPO_PUBLIC_CONVEX_URL!, {
  unsavedChangesWarning: false,
});

export default function RootLayout() {
  return (
    <ConvexProvider client={convex}>
      <Stack>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      </Stack>
    </ConvexProvider>
  );
}
```

### Using Queries in Components

```typescript
import { api } from "@/convex/_generated/api";
import { useQuery, useMutation } from "convex/react";

export function GroupList() {
  // Query - automatically re-renders when data changes
  const groups = useQuery(api.functions.groups.listByUser, { userId: "..." });

  // Mutation - returns a function to call
  const createGroup = useMutation(api.functions.groups.create);

  if (groups === undefined) {
    return <ActivityIndicator />;
  }

  return (
    <FlatList
      data={groups}
      renderItem={({ item }) => <GroupCard group={item} />}
    />
  );
}
```

**Official Docs:**
- [React Native Quickstart](https://docs.convex.dev/quickstart/react-native)
- [Convex React Client](https://docs.convex.dev/client/react-native)

---

## 2. Schema Definition

### Basic Schema Structure

In `apps/convex/schema.ts`:

```typescript
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  // Define each table
  communities: defineTable({
    name: v.string(),
    logo: v.optional(v.string()),
    timezone: v.optional(v.string()),
    subdomain: v.optional(v.string()),
    primaryColor: v.optional(v.string()),
    secondaryColor: v.optional(v.string()),
    // Nested object for address
    address: v.optional(v.object({
      line1: v.optional(v.string()),
      line2: v.optional(v.string()),
      city: v.optional(v.string()),
      state: v.optional(v.string()),
      zipCode: v.optional(v.string()),
      country: v.optional(v.string()),
    })),
  }),

  groups: defineTable({
    name: v.string(),
    description: v.optional(v.string()),
    communityId: v.id("communities"),  // Foreign key reference
    groupTypeId: v.id("groupTypes"),
    isArchived: v.boolean(),
    archivedAt: v.optional(v.number()),  // Unix timestamp
    isOnBreak: v.optional(v.boolean()),
    breakUntil: v.optional(v.number()),
    // Nested object for defaults
    defaults: v.optional(v.object({
      day: v.optional(v.number()),
      startTime: v.optional(v.string()),
      endTime: v.optional(v.string()),
      meetingType: v.optional(v.number()),
      meetingLink: v.optional(v.string()),
    })),
    // Nested object for location
    location: v.optional(v.object({
      addressLine1: v.optional(v.string()),
      addressLine2: v.optional(v.string()),
      city: v.optional(v.string()),
      state: v.optional(v.string()),
      zipCode: v.optional(v.string()),
      coordinates: v.optional(v.object({
        latitude: v.number(),
        longitude: v.number(),
      })),
    })),
  })
    // Indexes for queries
    .index("by_community", ["communityId"])
    .index("by_community_type", ["communityId", "groupTypeId"])
    .index("by_community_archived", ["communityId", "isArchived"]),

  groupMembers: defineTable({
    groupId: v.id("groups"),
    userId: v.id("users"),
    role: v.string(),  // "leader" | "co_leader" | "member"
    joinedAt: v.number(),
    leftAt: v.optional(v.number()),
    notificationsEnabled: v.boolean(),
    // Request tracking
    requestStatus: v.optional(v.string()),
    requestedAt: v.optional(v.number()),
    reviewedAt: v.optional(v.number()),
    reviewedById: v.optional(v.id("users")),
  })
    // Compound index for unique constraint simulation
    .index("by_group_user", ["groupId", "userId"])
    .index("by_group", ["groupId"])
    .index("by_user", ["userId"])
    .index("by_group_role", ["groupId", "role"]),
});
```

### Validators Reference

```typescript
import { v } from "convex/values";

// Basic types
v.string()              // string
v.number()              // number (use for dates as Unix timestamps)
v.boolean()             // boolean
v.null()                // null
v.int64()               // 64-bit integer
v.bytes()               // ArrayBuffer

// References
v.id("tableName")       // Reference to another table's _id

// Optional fields
v.optional(v.string())  // string | undefined

// Arrays
v.array(v.string())     // string[]
v.array(v.id("users"))  // Id<"users">[]

// Objects (nested documents)
v.object({
  name: v.string(),
  value: v.optional(v.number()),
})

// Union types
v.union(
  v.literal("pending"),
  v.literal("approved"),
  v.literal("declined")
)

// Records (dynamic keys)
v.record(v.string(), v.number())  // Record<string, number>

// Any value (escape hatch)
v.any()
```

### Reusable Validators

```typescript
// apps/convex/lib/validators.ts
import { v } from "convex/values";

// Reusable validator for meeting types
export const meetingTypeValidator = v.union(
  v.literal(1),  // In-Person
  v.literal(2),  // Online
  v.literal(3)   // Hybrid
);

// Reusable validator for member roles
export const memberRoleValidator = v.union(
  v.literal("leader"),
  v.literal("co_leader"),
  v.literal("member")
);

// Reusable address validator
export const addressValidator = v.object({
  line1: v.optional(v.string()),
  line2: v.optional(v.string()),
  city: v.optional(v.string()),
  state: v.optional(v.string()),
  zipCode: v.optional(v.string()),
});

// Infer TypeScript types from validators
import { Infer } from "convex/values";
export type MemberRole = Infer<typeof memberRoleValidator>;
export type Address = Infer<typeof addressValidator>;
```

### Index Guidelines

```typescript
// Indexes are crucial for query performance
defineTable({...})
  // Single field index
  .index("by_community", ["communityId"])

  // Compound index (queries left-to-right)
  .index("by_community_type", ["communityId", "groupTypeId"])

  // Note: by_foo_bar covers queries for:
  // - by_community_type (both fields)
  // - by_community (first field only)
  // So you don't need separate by_community if you have by_community_type
```

**Official Docs:**
- [Schemas](https://docs.convex.dev/database/schemas)
- [Data Types](https://docs.convex.dev/database/types)
- [Indexes](https://docs.convex.dev/database/reading-data/indexes/)

---

## 3. Functions (Queries, Mutations, Actions)

### Queries (Read Data)

```typescript
// apps/convex/functions/groups.ts
import { query } from "../_generated/server";
import { v } from "convex/values";

// List groups for a community
export const listByCommunity = query({
  args: {
    communityId: v.id("communities"),
    includeArchived: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    let groups = await ctx.db
      .query("groups")
      .withIndex("by_community", (q) => q.eq("communityId", args.communityId))
      .collect();

    if (!args.includeArchived) {
      groups = groups.filter((g) => !g.isArchived);
    }

    return groups;
  },
});

// Get a single group with related data
export const getWithMembers = query({
  args: { groupId: v.id("groups") },
  handler: async (ctx, args) => {
    const group = await ctx.db.get(args.groupId);
    if (!group) return null;

    // Fetch related data (no JOINs - just code!)
    const members = await ctx.db
      .query("groupMembers")
      .withIndex("by_group", (q) => q.eq("groupId", args.groupId))
      .filter((q) => q.eq(q.field("leftAt"), undefined))
      .collect();

    // Fetch user details for each member
    const membersWithUsers = await Promise.all(
      members.map(async (member) => {
        const user = await ctx.db.get(member.userId);
        return { ...member, user };
      })
    );

    return { ...group, members: membersWithUsers };
  },
});
```

### Mutations (Write Data)

```typescript
// apps/convex/functions/groups.ts
import { mutation } from "../_generated/server";
import { v } from "convex/values";

export const create = mutation({
  args: {
    name: v.string(),
    description: v.optional(v.string()),
    communityId: v.id("communities"),
    groupTypeId: v.id("groupTypes"),
  },
  handler: async (ctx, args) => {
    // Check authentication
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Not authenticated");
    }

    // Create the group
    const groupId = await ctx.db.insert("groups", {
      name: args.name,
      description: args.description,
      communityId: args.communityId,
      groupTypeId: args.groupTypeId,
      isArchived: false,
    });

    return groupId;
  },
});

export const archive = mutation({
  args: { groupId: v.id("groups") },
  handler: async (ctx, args) => {
    const group = await ctx.db.get(args.groupId);
    if (!group) {
      throw new Error("Group not found");
    }

    await ctx.db.patch(args.groupId, {
      isArchived: true,
      archivedAt: Date.now(),
    });
  },
});

// Upsert pattern (for group members)
export const joinGroup = mutation({
  args: {
    groupId: v.id("groups"),
    userId: v.id("users"),
    role: v.string(),
  },
  handler: async (ctx, args) => {
    // Check if membership already exists
    const existing = await ctx.db
      .query("groupMembers")
      .withIndex("by_group_user", (q) =>
        q.eq("groupId", args.groupId).eq("userId", args.userId)
      )
      .unique();

    if (existing) {
      // Update existing membership
      await ctx.db.patch(existing._id, {
        role: args.role,
        leftAt: undefined,  // Re-join if previously left
      });
      return existing._id;
    }

    // Create new membership
    return await ctx.db.insert("groupMembers", {
      groupId: args.groupId,
      userId: args.userId,
      role: args.role,
      joinedAt: Date.now(),
      notificationsEnabled: true,
    });
  },
});
```

### Actions (External API Calls)

```typescript
// apps/convex/functions/authInternal.ts
import { action, internalAction } from "../_generated/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";

// Public action (callable from client)
export const sendVerificationCode = action({
  args: { phoneNumber: v.string() },
  handler: async (ctx, args) => {
    // Generate code
    const code = Math.floor(100000 + Math.random() * 900000).toString();

    // Call Twilio via fetch
    const accountSid = process.env.TWILIO_ACCOUNT_SID!;
    const authToken = process.env.TWILIO_AUTH_TOKEN!;
    const fromNumber = process.env.TWILIO_PHONE_NUMBER!;

    const response = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${btoa(`${accountSid}:${authToken}`)}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          To: args.phoneNumber,
          From: fromNumber,
          Body: `Your Togather verification code is: ${code}`,
        }),
      }
    );

    if (!response.ok) {
      throw new Error("Failed to send SMS");
    }

    // Store the code via a mutation (actions can't write directly)
    await ctx.runMutation(internal.auth.storeVerificationCode, {
      phoneNumber: args.phoneNumber,
      code,
      expiresAt: Date.now() + 10 * 60 * 1000, // 10 minutes
    });

    return { success: true };
  },
});

// Internal action (only callable from other Convex functions)
export const syncWithStreamChat = internalAction({
  args: {
    userId: v.string(),
    groupId: v.string(),
    action: v.union(v.literal("add"), v.literal("remove")),
  },
  handler: async (ctx, args) => {
    // Call Stream Chat API
    const response = await fetch("https://chat.stream-io-api.com/...", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.STREAM_API_SECRET}`,
      },
      body: JSON.stringify({
        userId: args.userId,
        channelId: args.groupId,
      }),
    });

    return response.json();
  },
});
```

### Authentication Pattern

```typescript
// apps/convex/functions/auth.ts
import { query, mutation, internalMutation } from "../_generated/server";
import { v } from "convex/values";

// Store/update user on login
export const storeUser = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Not authenticated");
    }

    // Check if user exists
    const existingUser = await ctx.db
      .query("users")
      .withIndex("by_token", (q) =>
        q.eq("tokenIdentifier", identity.tokenIdentifier)
      )
      .unique();

    if (existingUser) {
      // Update last login
      await ctx.db.patch(existingUser._id, {
        lastLogin: Date.now(),
      });
      return existingUser._id;
    }

    // Create new user
    return await ctx.db.insert("users", {
      tokenIdentifier: identity.tokenIdentifier,
      email: identity.email,
      firstName: identity.givenName,
      lastName: identity.familyName,
      profilePhoto: identity.pictureUrl,
      lastLogin: Date.now(),
    });
  },
});

// Helper to get current user in queries/mutations
export async function getCurrentUser(ctx: any) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    return null;
  }

  return await ctx.db
    .query("users")
    .withIndex("by_token", (q) =>
      q.eq("tokenIdentifier", identity.tokenIdentifier)
    )
    .unique();
}

// Internal mutation for verification codes
export const storeVerificationCode = internalMutation({
  args: {
    phoneNumber: v.string(),
    code: v.string(),
    expiresAt: v.number(),
  },
  handler: async (ctx, args) => {
    // Delete any existing codes for this phone
    const existing = await ctx.db
      .query("verificationCodes")
      .withIndex("by_phone", (q) => q.eq("phoneNumber", args.phoneNumber))
      .collect();

    for (const code of existing) {
      await ctx.db.delete(code._id);
    }

    // Insert new code
    await ctx.db.insert("verificationCodes", args);
  },
});
```

**Official Docs:**
- [Queries](https://docs.convex.dev/functions/query-functions)
- [Mutations](https://docs.convex.dev/functions/mutation-functions)
- [Actions](https://docs.convex.dev/functions/actions)
- [Auth in Functions](https://docs.convex.dev/auth/functions-auth)

---

## 4. Data Migration

### Step 1: Export from PostgreSQL

```bash
# Connect to your Supabase/Postgres instance
psql $DATABASE_URL

# Export each table to JSONL format
\copy ( SELECT row_to_json(community) FROM community ) TO '/tmp/communities.jsonl';
\copy ( SELECT row_to_json(t) FROM "group" t ) TO '/tmp/groups.jsonl';
\copy ( SELECT row_to_json(group_member) FROM group_member ) TO '/tmp/group_members.jsonl';
\copy ( SELECT row_to_json(t) FROM "user" t ) TO '/tmp/users.jsonl';
\copy ( SELECT row_to_json(meeting) FROM meeting ) TO '/tmp/meetings.jsonl';
# ... repeat for all tables
```

### Step 2: Transform Data

Create a transformation script to:
1. Convert snake_case to camelCase
2. Convert PostgreSQL timestamps to Unix timestamps
3. Add legacy ID field for reference lookups

```typescript
// scripts/transform-migration-data.ts
import fs from "fs";
import readline from "readline";

async function transformTable(
  inputPath: string,
  outputPath: string,
  transformFn: (row: any) => any
) {
  const input = fs.createReadStream(inputPath);
  const output = fs.createWriteStream(outputPath);
  const rl = readline.createInterface({ input });

  for await (const line of rl) {
    const row = JSON.parse(line);
    const transformed = transformFn(row);
    output.write(JSON.stringify(transformed) + "\n");
  }

  output.end();
}

// Transform groups
await transformTable(
  "/tmp/groups.jsonl",
  "/tmp/groups-convex.jsonl",
  (row) => ({
    // Keep legacy ID for lookups during migration
    legacyId: row.id,
    name: row.name,
    description: row.description,
    // These will be updated in a second pass to Convex IDs
    legacyCommunityId: row.community_id,
    legacyGroupTypeId: row.group_type_id,
    isArchived: row.is_archived,
    archivedAt: row.archived_at ? new Date(row.archived_at).getTime() : undefined,
    isOnBreak: row.is_on_break,
    breakUntil: row.break_until ? new Date(row.break_until).getTime() : undefined,
    defaults: {
      day: row.default_day,
      startTime: row.default_start_time,
      endTime: row.default_end_time,
      meetingType: row.default_meeting_type,
      meetingLink: row.default_meeting_link,
    },
    location: {
      addressLine1: row.address_line1,
      addressLine2: row.address_line2,
      city: row.city,
      state: row.state,
      zipCode: row.zip_code,
      coordinates: row.coordinates,
    },
  })
);
```

### Step 3: Import to Convex

```bash
# Import each table
npx convex import --format jsonLines --table communities /tmp/communities-convex.jsonl
npx convex import --format jsonLines --table groups /tmp/groups-convex.jsonl
npx convex import --format jsonLines --table groupMembers /tmp/group_members-convex.jsonl

# For production, add --prod flag
npx convex import --prod --format jsonLines --table communities /tmp/communities-convex.jsonl
```

### Step 4: Update Foreign Key References

After import, run a migration to convert legacy IDs to Convex IDs:

```typescript
// apps/convex/migrations/updateReferences.ts
import { internalMutation } from "../_generated/server";

// Run this via dashboard or scheduled function
export const updateGroupReferences = internalMutation({
  handler: async (ctx) => {
    // Build lookup maps from legacy IDs to Convex IDs
    const communities = await ctx.db.query("communities").collect();
    const communityMap = new Map(
      communities.map((c) => [c.legacyId, c._id])
    );

    const groupTypes = await ctx.db.query("groupTypes").collect();
    const groupTypeMap = new Map(
      groupTypes.map((t) => [t.legacyId, t._id])
    );

    // Update each group
    const groups = await ctx.db.query("groups").collect();
    for (const group of groups) {
      await ctx.db.patch(group._id, {
        communityId: communityMap.get(group.legacyCommunityId),
        groupTypeId: groupTypeMap.get(group.legacyGroupTypeId),
        // Clean up legacy fields (optional)
        legacyCommunityId: undefined,
        legacyGroupTypeId: undefined,
      });
    }
  },
});
```

### Migration Component (For Larger Datasets)

For large datasets, use the Convex Migrations component:

```typescript
// apps/convex/convex.config.ts
import { defineApp } from "convex/server";
import migrations from "@convex-dev/migrations/convex.config";

const app = defineApp();
app.use(migrations);
export default app;

// apps/convex/migrations/migrateGroups.ts
import { migrations } from "@convex-dev/migrations";
import { components } from "../_generated/api";

const migration = migrations(components.migrations);

export const migrateGroupsToNewSchema = migration.define({
  table: "groups",
  migrateOne: async (ctx, doc) => {
    // Transform each document
    return {
      ...doc,
      // Add computed fields, transform data, etc.
      displayName: doc.name.trim(),
      searchableText: `${doc.name} ${doc.description || ""}`.toLowerCase(),
    };
  },
});
```

**Official Docs:**
- [Data Import](https://docs.convex.dev/database/import-export/import)
- [Migrating from Postgres](https://stack.convex.dev/migrate-data-postgres-to-convex)
- [Migrations Component](https://www.convex.dev/components/migrations)

---

## 5. External Integrations

### Environment Variables / Secrets

Set via Convex Dashboard or CLI:

```bash
# Set environment variable for a deployment
npx convex env set TWILIO_ACCOUNT_SID "your_sid"
npx convex env set TWILIO_AUTH_TOKEN "your_token"
npx convex env set TWILIO_PHONE_NUMBER "+1234567890"
npx convex env set STREAM_API_KEY "your_key"
npx convex env set STREAM_API_SECRET "your_secret"

# For production
npx convex env set --prod TWILIO_ACCOUNT_SID "your_prod_sid"
```

Access in actions:

```typescript
export const myAction = action({
  handler: async (ctx) => {
    const twilioSid = process.env.TWILIO_ACCOUNT_SID;
    // ...
  },
});
```

### Twilio Integration (OTP)

Using the official Convex Twilio component:

```bash
pnpm add @convex-dev/twilio
```

```typescript
// apps/convex/convex.config.ts
import { defineApp } from "convex/server";
import twilio from "@convex-dev/twilio/convex.config";

const app = defineApp();
app.use(twilio);
export default app;

// apps/convex/twilio.ts
import { Twilio } from "@convex-dev/twilio";
import { components } from "./_generated/api";

export const twilio = new Twilio(components.twilio, {
  defaultFrom: process.env.TWILIO_PHONE_NUMBER!,
});

// apps/convex/functions/auth.ts
import { action } from "../_generated/server";
import { twilio } from "../twilio";

export const sendOTP = action({
  args: { phoneNumber: v.string() },
  handler: async (ctx, args) => {
    const code = Math.floor(100000 + Math.random() * 900000).toString();

    await twilio.sendMessage(ctx, {
      to: args.phoneNumber,
      body: `Your Togather code is: ${code}`,
    });

    await ctx.runMutation(internal.auth.storeCode, {
      phone: args.phoneNumber,
      code,
    });

    return { success: true };
  },
});
```

### File Storage (S3 Alternative)

Convex has built-in file storage:

```typescript
// apps/convex/functions/uploads.ts
import { mutation, query } from "../_generated/server";
import { v } from "convex/values";

// Generate upload URL (Step 1)
export const generateUploadUrl = mutation({
  handler: async (ctx) => {
    // Auth check
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Not authenticated");
    }

    return await ctx.storage.generateUploadUrl();
  },
});

// Save file reference (Step 3)
export const saveProfilePhoto = mutation({
  args: {
    storageId: v.id("_storage"),
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    // Get the URL
    const url = await ctx.storage.getUrl(args.storageId);

    // Update user profile
    await ctx.db.patch(args.userId, {
      profilePhoto: args.storageId,
      profilePhotoUrl: url,
    });
  },
});

// Get file URL
export const getFileUrl = query({
  args: { storageId: v.id("_storage") },
  handler: async (ctx, args) => {
    return await ctx.storage.getUrl(args.storageId);
  },
});
```

Client-side upload:

```typescript
// In React Native component
const generateUploadUrl = useMutation(api.files.generateUploadUrl);
const saveProfilePhoto = useMutation(api.files.saveProfilePhoto);

async function uploadImage(imageUri: string) {
  // Get upload URL
  const uploadUrl = await generateUploadUrl();

  // Upload the file
  const response = await fetch(imageUri);
  const blob = await response.blob();

  const result = await fetch(uploadUrl, {
    method: "POST",
    body: blob,
    headers: { "Content-Type": blob.type },
  });

  const { storageId } = await result.json();

  // Save reference
  await saveProfilePhoto({ storageId, userId: currentUser._id });
}
```

If you still need S3 for specific use cases, use actions:

```typescript
// apps/convex/functions/s3.ts
import { action } from "../_generated/server";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

const s3 = new S3Client({
  region: process.env.AWS_REGION!,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
});

export const uploadToS3 = action({
  args: { key: v.string(), contentType: v.string() },
  handler: async (ctx, args) => {
    // Generate presigned URL for client upload
    // ...
  },
});
```

### Scheduled Functions (Reminder Bots)

```typescript
// apps/convex/crons.ts
import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Run every 5 minutes
crons.interval(
  "check-meeting-reminders",
  { minutes: 5 },
  internal.functions.scheduledJobs.sendDueReminders
);

// Run daily at 9am UTC
crons.daily(
  "send-weekly-digest",
  { hourUTC: 9, minuteUTC: 0 },
  internal.functions.notifications.sendWeeklyDigest
);

// Traditional cron syntax (monthly on the 1st)
crons.cron(
  "monthly-stats",
  "0 0 1 * *",
  internal.functions.analytics.generateMonthlyStats
);

export default crons;

// apps/convex/functions/scheduledJobs.ts
import { internalMutation, internalAction } from "../_generated/server";

export const sendDueReminders = internalMutation({
  handler: async (ctx) => {
    const now = Date.now();
    const fiveMinutesFromNow = now + 5 * 60 * 1000;

    // Find meetings with reminders due
    const meetings = await ctx.db
      .query("meetings")
      .withIndex("by_reminder_time")
      .filter((q) =>
        q.and(
          q.lte(q.field("reminderAt"), fiveMinutesFromNow),
          q.eq(q.field("reminderSent"), false)
        )
      )
      .collect();

    for (const meeting of meetings) {
      // Schedule the actual notification send (action for external API)
      await ctx.scheduler.runAfter(
        0,
        internal.notifications.sendMeetingReminder,
        { meetingId: meeting._id }
      );

      // Mark as sent
      await ctx.db.patch(meeting._id, { reminderSent: true });
    }
  },
});
```

### HTTP Actions (Webhooks)

```typescript
// apps/convex/http.ts
import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";

const http = httpRouter();

// Twilio webhook for incoming SMS
http.route({
  path: "/webhooks/twilio/sms",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const formData = await request.formData();
    const from = formData.get("From") as string;
    const body = formData.get("Body") as string;

    // Process the incoming message
    await ctx.runMutation(internal.sms.processIncoming, { from, body });

    // Return TwiML response
    return new Response(
      '<?xml version="1.0" encoding="UTF-8"?><Response></Response>',
      { headers: { "Content-Type": "application/xml" } }
    );
  }),
});

// Stream Chat webhook
http.route({
  path: "/webhooks/stream-chat",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    // Verify webhook signature
    const signature = request.headers.get("x-signature");
    // ... verify signature

    const payload = await request.json();

    await ctx.runMutation(internal.chat.handleWebhook, { payload });

    return new Response("OK", { status: 200 });
  }),
});

export default http;
```

**Official Docs:**
- [Environment Variables](https://docs.convex.dev/production/environment-variables)
- [File Storage](https://docs.convex.dev/file-storage)
- [Cron Jobs](https://docs.convex.dev/scheduling/cron-jobs)
- [Scheduled Functions](https://docs.convex.dev/scheduling/scheduled-functions)
- [HTTP Actions](https://docs.convex.dev/functions/http-actions)
- [Twilio Component](https://www.convex.dev/components/twilio)

---

## 6. Togather-Specific Patterns

### Multi-Tenant Queries (Filter by Community)

```typescript
// apps/convex/functions/groups.ts
export const listForCommunity = query({
  args: {
    communityId: v.id("communities"),
    groupTypeId: v.optional(v.id("groupTypes")),
    includeArchived: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    // Use the most specific index available
    let query = ctx.db
      .query("groups")
      .withIndex("by_community_archived", (q) =>
        q.eq("communityId", args.communityId)
          .eq("isArchived", args.includeArchived ?? false)
      );

    let groups = await query.collect();

    // Filter by type in memory if needed
    if (args.groupTypeId) {
      groups = groups.filter((g) => g.groupTypeId === args.groupTypeId);
    }

    return groups;
  },
});

// Helper for common multi-tenant pattern
async function requireCommunityAccess(
  ctx: any,
  communityId: Id<"communities">
) {
  const user = await getCurrentUser(ctx);
  if (!user) {
    throw new Error("Not authenticated");
  }

  const membership = await ctx.db
    .query("userCommunities")
    .withIndex("by_user_community", (q) =>
      q.eq("userId", user._id).eq("communityId", communityId)
    )
    .unique();

  if (!membership) {
    throw new Error("Not a member of this community");
  }

  return { user, membership };
}
```

### Compound Unique Constraints

Convex doesn't have built-in unique constraints, but you can enforce them:

```typescript
// apps/convex/functions/groupMembers.ts
export const addMember = mutation({
  args: {
    groupId: v.id("groups"),
    userId: v.id("users"),
    role: v.string(),
  },
  handler: async (ctx, args) => {
    // Check for existing membership (unique constraint simulation)
    const existing = await ctx.db
      .query("groupMembers")
      .withIndex("by_group_user", (q) =>
        q.eq("groupId", args.groupId).eq("userId", args.userId)
      )
      .unique();

    if (existing) {
      throw new Error("User is already a member of this group");
    }

    return await ctx.db.insert("groupMembers", {
      groupId: args.groupId,
      userId: args.userId,
      role: args.role,
      joinedAt: Date.now(),
      notificationsEnabled: true,
    });
  },
});

// Upsert pattern when you want to update if exists
export const upsertMember = mutation({
  args: {
    groupId: v.id("groups"),
    userId: v.id("users"),
    role: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("groupMembers")
      .withIndex("by_group_user", (q) =>
        q.eq("groupId", args.groupId).eq("userId", args.userId)
      )
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, { role: args.role });
      return existing._id;
    }

    return await ctx.db.insert("groupMembers", {
      groupId: args.groupId,
      userId: args.userId,
      role: args.role,
      joinedAt: Date.now(),
      notificationsEnabled: true,
    });
  },
});
```

### Soft Deletes / Archiving

```typescript
// Schema pattern
defineTable({
  name: v.string(),
  // ... other fields
  isArchived: v.boolean(),
  archivedAt: v.optional(v.number()),
  // For scheduled hard deletes (Ents pattern)
  deletionTime: v.optional(v.number()),
})
  .index("by_archived", ["isArchived"])
  .index("by_deletion_time", ["deletionTime"]);

// Soft delete mutation
export const archiveGroup = mutation({
  args: { groupId: v.id("groups") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.groupId, {
      isArchived: true,
      archivedAt: Date.now(),
    });
  },
});

// Restore
export const restoreGroup = mutation({
  args: { groupId: v.id("groups") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.groupId, {
      isArchived: false,
      archivedAt: undefined,
    });
  },
});

// Query excluding archived
export const listActive = query({
  args: { communityId: v.id("communities") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("groups")
      .withIndex("by_community_archived", (q) =>
        q.eq("communityId", args.communityId).eq("isArchived", false)
      )
      .collect();
  },
});

// Scheduled hard delete (clean up after 30 days)
export const cleanupDeletedGroups = internalMutation({
  handler: async (ctx) => {
    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;

    const toDelete = await ctx.db
      .query("groups")
      .withIndex("by_deletion_time")
      .filter((q) =>
        q.and(
          q.neq(q.field("deletionTime"), undefined),
          q.lt(q.field("deletionTime"), thirtyDaysAgo)
        )
      )
      .collect();

    for (const group of toDelete) {
      // Delete related data first
      const members = await ctx.db
        .query("groupMembers")
        .withIndex("by_group", (q) => q.eq("groupId", group._id))
        .collect();
      for (const member of members) {
        await ctx.db.delete(member._id);
      }

      // Then delete the group
      await ctx.db.delete(group._id);
    }
  },
});
```

### JSON Fields as Structured Data

```typescript
// Schema with nested objects
defineTable({
  meetingId: v.id("meetings"),
  // Structured RSVP options (previously JSON)
  rsvpOptions: v.array(v.object({
    id: v.number(),
    label: v.string(),
    enabled: v.boolean(),
    emoji: v.optional(v.string()),
  })),
  // Bot config (flexible JSON -> structured)
  config: v.object({
    enabled: v.boolean(),
    schedule: v.optional(v.object({
      frequency: v.string(),
      time: v.string(),
    })),
    settings: v.record(v.string(), v.any()), // Flexible key-value for unknown settings
  }),
  // Coordinates
  coordinates: v.optional(v.object({
    latitude: v.number(),
    longitude: v.number(),
  })),
});

// Working with nested data
export const updateRsvpOption = mutation({
  args: {
    meetingId: v.id("meetings"),
    optionId: v.number(),
    label: v.string(),
  },
  handler: async (ctx, args) => {
    const meeting = await ctx.db.get(args.meetingId);
    if (!meeting) throw new Error("Meeting not found");

    const updatedOptions = meeting.rsvpOptions.map((opt) =>
      opt.id === args.optionId ? { ...opt, label: args.label } : opt
    );

    await ctx.db.patch(args.meetingId, {
      rsvpOptions: updatedOptions,
    });
  },
});
```

### Relationships Without JOINs

```typescript
// apps/convex/lib/utils.ts
import { Doc, Id } from "../_generated/dataModel";

// Helper to fetch related documents
export async function getGroupWithRelations(
  ctx: any,
  groupId: Id<"groups">
): Promise<{
  group: Doc<"groups">;
  community: Doc<"communities">;
  groupType: Doc<"groupTypes">;
  members: Array<Doc<"groupMembers"> & { user: Doc<"users"> }>;
}> {
  const group = await ctx.db.get(groupId);
  if (!group) throw new Error("Group not found");

  // Fetch related documents in parallel
  const [community, groupType, membersRaw] = await Promise.all([
    ctx.db.get(group.communityId),
    ctx.db.get(group.groupTypeId),
    ctx.db
      .query("groupMembers")
      .withIndex("by_group", (q) => q.eq("groupId", groupId))
      .filter((q) => q.eq(q.field("leftAt"), undefined))
      .collect(),
  ]);

  // Fetch users for members
  const members = await Promise.all(
    membersRaw.map(async (member) => ({
      ...member,
      user: await ctx.db.get(member.userId),
    }))
  );

  return { group, community, groupType, members };
}

// Usage in a query
export const getGroupDetails = query({
  args: { groupId: v.id("groups") },
  handler: async (ctx, args) => {
    return await getGroupWithRelations(ctx, args.groupId);
  },
});
```

### Type-Safe ID Handling

```typescript
// apps/convex/schema.ts - IDs are automatically typed
import { Doc, Id } from "./_generated/dataModel";

// In functions, you get full type safety
export const getGroup = query({
  args: { groupId: v.id("groups") },
  handler: async (ctx, args) => {
    // args.groupId is typed as Id<"groups">
    const group: Doc<"groups"> | null = await ctx.db.get(args.groupId);
    return group;
  },
});

// Converting from legacy IDs
export const getByLegacyId = query({
  args: { legacyId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("groups")
      .withIndex("by_legacy_id", (q) => q.eq("legacyId", args.legacyId))
      .unique();
  },
});
```

---

## Quick Reference Card

### Common Patterns

| Pattern | Prisma/tRPC | Convex |
|---------|-------------|--------|
| Get by ID | `prisma.group.findUnique({ where: { id } })` | `ctx.db.get(groupId)` |
| List with filter | `prisma.group.findMany({ where: { communityId } })` | `ctx.db.query("groups").withIndex("by_community", q => q.eq("communityId", id)).collect()` |
| Create | `prisma.group.create({ data: {...} })` | `ctx.db.insert("groups", {...})` |
| Update | `prisma.group.update({ where: { id }, data: {...} })` | `ctx.db.patch(groupId, {...})` |
| Delete | `prisma.group.delete({ where: { id } })` | `ctx.db.delete(groupId)` |
| Upsert | `prisma.group.upsert({...})` | Check with `.unique()` then insert or patch |
| Count | `prisma.group.count({ where: {...} })` | `(await query.collect()).length` |
| Unique constraint | `@@unique([groupId, userId])` | Query with compound index + check before insert |

### Environment

| Task | Command |
|------|---------|
| Start dev | `npx convex dev` |
| Deploy to prod | `npx convex deploy` |
| Set env var | `npx convex env set KEY value` |
| Import data | `npx convex import --table name file.jsonl` |
| View dashboard | `npx convex dashboard` |

---

## Additional Resources

- [Convex Documentation](https://docs.convex.dev/)
- [React Native Quickstart](https://docs.convex.dev/quickstart/react-native)
- [Schemas](https://docs.convex.dev/database/schemas)
- [Indexes](https://docs.convex.dev/database/reading-data/indexes/)
- [Functions](https://docs.convex.dev/functions)
- [Actions](https://docs.convex.dev/functions/actions)
- [Cron Jobs](https://docs.convex.dev/scheduling/cron-jobs)
- [File Storage](https://docs.convex.dev/file-storage)
- [Data Import](https://docs.convex.dev/database/import-export/import)
- [Postgres Migration Guide](https://stack.convex.dev/migrate-data-postgres-to-convex)
- [Relationship Helpers](https://stack.convex.dev/functional-relationships-helpers)
- [Convex Ents (Relationships)](https://labs.convex.dev/convex-ents/schema)
- [Types and Validators Cookbook](https://stack.convex.dev/types-cookbook)
- [Best Practices](https://docs.convex.dev/understanding/best-practices/)
- [Twilio Component](https://www.convex.dev/components/twilio)
- [Monorepo Template](https://github.com/get-convex/turbo-expo-nextjs-clerk-convex-monorepo)
