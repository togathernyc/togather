# ADR-012: Notification System and Offline Job Worker

**Note:** This ADR was never implemented. Scheduled jobs use Convex native crons. See `apps/convex/crons.ts`.

## Status
Superseded

---

## Current Codebase Context

> **For implementing agents:** This section describes what already exists. Read this first to understand the starting point.

### Project Structure

```
apps/
├── api-trpc/              # Backend tRPC server (Fastify)
│   ├── src/
│   │   ├── lib/           # Shared utilities (expo.ts, stream.ts, prisma.ts)
│   │   ├── routers/       # tRPC routers
│   │   │   ├── groups/
│   │   │   │   ├── meetings.ts
│   │   │   │   └── meetings-rsvp.ts
│   │   │   └── notifications.ts
│   │   ├── webhooks/      # Webhook handlers (stream.ts)
│   │   └── prisma/
│   │       └── schema.prisma
│   └── package.json
├── mobile/                # React Native Expo app
└── link-preview/          # Link preview service

packages/
└── shared/                # Shared types and API contracts
```

### Existing Push Notification Implementation

**Files:**
- `apps/api-trpc/src/lib/expo.ts` - Expo SDK wrapper
- `apps/api-trpc/src/lib/notifications.ts` - Higher-level notification helpers
- `apps/api-trpc/src/routers/notifications.ts` - Notification tRPC endpoints

**How it works:**
```typescript
// Current push notification flow
import { sendPushNotification } from "./lib/expo";
import { notifyUser } from "./lib/notifications";

// Send to specific user (all their active tokens)
await notifyUser(userId, { title, body, data });

// Send to community admins
await notifyCommunityAdmins(communityId, { title, body, data });
```

**Token storage:** `push_token` table with `token`, `platform`, `device_id`, `is_active`, `user_id`

**Mock mode:** Set `DISABLE_NOTIFICATION=true` to skip sending in tests

### Existing Database Schema (Relevant Models)

```prisma
model user {
  id                  BigInt       @id @default(autoincrement())
  first_name          String
  last_name           String
  phone               String?
  email               String?
  created_at          DateTime     @default(now())
  push_token          push_token[]
  // NOTE: These fields need to be ADDED:
  // push_notifications_enabled    Boolean @default(true)
  // email_notifications_enabled   Boolean @default(true)
}

model push_token {
  id           String   @id @default(uuid())
  token        String   @unique
  platform     String   // "ios" | "android" | "web"
  device_id    String?
  is_active    Boolean  @default(true)
  user_id      BigInt
  user         user     @relation(...)
}

model meeting {
  id              String    @id @default(uuid())
  title           String
  scheduled_at    DateTime
  status          String    @default("scheduled")
  group_id        String
  created_by_id   BigInt
  rsvp_enabled    Boolean   @default(true)
  rsvp_options    Json?     // [{id, label, enabled}]
  // NOTE: These fields need to be ADDED:
  // reminder_at     DateTime?
  // reminder_sent   Boolean   @default(false)

  group           group     @relation(...)
  rsvps           meeting_rsvp[]
}

model meeting_rsvp {
  id              String   @id @default(uuid())
  meeting_id      String
  user_id         BigInt
  rsvp_option_id  Int      // Maps to rsvp_options[].id
  created_at      DateTime @default(now())

  meeting         meeting  @relation(...)
  user            user     @relation(...)

  @@unique([meeting_id, user_id])
}

model group {
  id            String   @id @default(uuid())
  name          String
  community_id  BigInt
  // NOTE: This relation needs to be ADDED:
  // bot_configs   group_bot_config[]

  community     community @relation(...)
  members       group_member[]
  meetings      meeting[]
}

model group_member {
  id                    Int      @id @default(autoincrement())
  group_id              String
  user_id               BigInt
  role                  String   // "leader" | "member" | "admin"
  notifications_enabled Boolean  @default(true)
  joined_at             DateTime @default(now())
}

model community {
  id        BigInt   @id @default(autoincrement())
  name      String
  timezone  String?
}

model notification {
  id                String   @id @default(uuid())
  notification_type String
  title             String
  body              String
  data              Json?
  status            String   // "pending" | "sent" | "failed"
  is_read           Boolean  @default(false)
  user_id           BigInt
}
```

### Existing Meetings & RSVP Implementation

**Files:**
- `apps/api-trpc/src/routers/groups/meetings.ts` - Meeting CRUD
- `apps/api-trpc/src/routers/groups/meetings-rsvp.ts` - RSVP handling

**Key endpoints:**
- `meetings.create` - Creates meeting, optionally posts to group chat
- `meetings.rsvp.submit` - Upserts RSVP (this is where we'll schedule reminders)
- `meetings.rsvp.remove` - Removes RSVP

**RSVP options:** Default `["Going 👍", "Maybe 🤔", "Can't Go 😢"]`, stored as JSON

### Existing Stream Chat Integration

**Files:**
- `apps/api-trpc/src/lib/stream.ts` - Stream client setup
- `apps/api-trpc/src/webhooks/stream.ts` - Webhook handler for `message.new`

**Channel format:** `community{id}_group{uuid}_{main|leaders}`

**Current webhook:** Handles `message.new` → sends push notifications to members

### Existing Dependencies (apps/api-trpc/package.json)

```json
{
  "@prisma/client": "5.22.0",
  "prisma": "5.22.0",
  "expo-server-sdk": "^4.0.0",
  "stream-chat": "^9.26.0",
  "@trpc/server": "^11.8.0",
  "fastify": "^5.6.2",
  "twilio": "^5.10.7",
  "zod": "^3.23.8"
}
```

**NOT installed (need to add):**
- `@trigger.dev/sdk` - Job scheduling
- `resend` - Email sending
- `@react-email/components` - Email templates

### Key Constraints

1. **No job queue exists** - All operations are synchronous
2. **No email library** - Only SMS (Twilio) and push notifications
3. **Stream is source of truth** for chat - We just send messages via SDK
4. **Visibility model** - Meetings have `public`, `community`, or `group` visibility

---

## Context

The app needs a robust notification system to reach users through multiple channels (push, email, SMS) and an offline job worker to handle scheduled tasks that aren't triggered by user actions.

### Current Gaps
1. **Push notifications exist** - Expo Push Notifications implemented with token storage
2. **No email capability** - No email provider integrated
3. **No background jobs** - All operations are synchronous in request handlers
4. **No scheduled tasks** - Can't send reminders at specific times (e.g., 2 hours before meeting)

### Use Cases Driving This Decision
1. **Meeting reminders** - Notify RSVPed users 2 hours before events
2. **Birthday bot** - Groups can configure bots to announce member birthdays
3. **Future**: Activity digests, follow-up reminders, engagement notifications

## Decision

### Part 1: Notification Service Architecture

Create a unified notification service that abstracts channel delivery and respects user preferences.

#### Channel Priority Cascade
```
Push → Email → SMS (future)
```

- Attempt channels in priority order
- Skip channels the user has disabled
- Stop after first successful delivery (unless notification requests multiple channels)
- If all channels disabled, notification is not delivered (user's choice)

#### Notification Service Interface

```typescript
// packages/shared/src/notifications/types.ts
export type NotificationChannel = "push" | "email" | "sms";

export interface NotificationPayload {
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  // Which channels to attempt (in order). Defaults to all enabled.
  channels?: NotificationChannel[];
  // Force specific channels even if lower priority
  forceChannels?: NotificationChannel[];
}

export type NotificationType =
  | "meeting_reminder"
  | "rsvp_confirmation"
  | "birthday_announcement"
  | "group_message"
  | "follow_up_reminder";

export interface NotificationResult {
  success: boolean;
  channelUsed?: NotificationChannel;
  error?: string;
}
```

#### Email Integration (Resend)

```typescript
// packages/notifications/src/email/client.ts
import { Resend } from "resend";

export const resend = new Resend(process.env.RESEND_API_KEY);

// packages/notifications/src/email/templates/MeetingReminder.tsx
import { Html, Text, Section } from "@react-email/components";

export function MeetingReminderEmail({
  meetingTitle,
  meetingTime,
  groupName
}: Props) {
  return (
    <Html>
      <Section>
        <Text>Reminder: {meetingTitle} starts in 2 hours</Text>
        <Text>{groupName} - {meetingTime}</Text>
      </Section>
    </Html>
  );
}
```

#### User Preferences Schema

```prisma
// Addition to user model
model user {
  // ... existing fields
  push_notifications_enabled    Boolean @default(true)
  email_notifications_enabled   Boolean @default(true)
  sms_notifications_enabled     Boolean @default(false) // Future
}
```

### Part 2: Offline Job Worker (Trigger.dev Cloud)

Use Trigger.dev Cloud for scheduled and background jobs. **Trigger.dev executes your job code on their infrastructure** - no worker process to deploy or manage.

#### How It Works

```
┌─────────────────────────────────────────────────────────────────────────┐
│                                                                          │
│   Your Infrastructure                  Trigger.dev Cloud                 │
│   ────────────────────                 ─────────────────                 │
│                                                                          │
│   ┌──────────────────┐                 ┌──────────────────┐             │
│   │  Fly.io API      │   schedule      │  Job Queue &     │             │
│   │  (api-trpc)      │ ───────────────▶│  Scheduler       │             │
│   │                  │                 │                  │             │
│   │  - RSVP handler  │                 │  - Stores jobs   │             │
│   │    schedules     │                 │  - Tracks state  │             │
│   │    reminders     │                 │  - Handles retry │             │
│   └──────────────────┘                 └────────┬─────────┘             │
│                                                 │                        │
│                                                 │ executes               │
│                                                 ▼                        │
│   ┌──────────────────┐                 ┌──────────────────┐             │
│   │  Supabase        │◀────────────────│  Your Job Code   │             │
│   │  (PostgreSQL)    │   reads/writes  │  (deployed to    │             │
│   │                  │                 │   Trigger.dev)   │             │
│   └──────────────────┘                 │                  │             │
│                                        │  - meeting-      │             │
│   ┌──────────────────┐                 │    reminder.ts   │             │
│   │  Resend          │◀────────────────│  - birthday-     │             │
│   │  (Email)         │   sends email   │    bot.ts        │             │
│   └──────────────────┘                 └──────────────────┘             │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

Key points:
- **No worker to deploy** - Trigger.dev runs your code on their servers
- **Your DB is source of truth** - Jobs only store IDs, fetch fresh data at execution
- **Deploy with one command** - `npx trigger.dev deploy`

#### Project Structure

Jobs live in their own app, separate from the API:

```
apps/
├── api-trpc/                    # Your existing API
│   └── src/
│       ├── routers/
│       │   └── groups/
│       │       └── meetings.ts  # Schedules jobs via trigger client
│       └── lib/
│           └── trigger.ts       # Trigger.dev client for scheduling
│
├── jobs/                        # NEW: Trigger.dev jobs app
│   ├── package.json
│   ├── trigger.config.ts        # Trigger.dev configuration
│   └── src/
│       ├── index.ts             # Export all jobs
│       ├── client.ts            # Prisma client for jobs
│       ├── jobs/
│       │   ├── meeting-reminder.ts
│       │   └── birthday-bot.ts
│       └── services/
│           └── notification.ts  # Notification service (used by jobs)
│
├── mobile/                      # Your existing mobile app
└── ...

packages/
├── shared/                      # Shared types
│   └── src/
│       └── notifications/
│           └── types.ts         # NotificationPayload, NotificationType, etc.
│
└── notifications/               # NEW: Shared notification logic
    ├── package.json
    └── src/
        ├── index.ts
        ├── service.ts           # NotificationService implementation
        ├── channels/
        │   ├── push.ts          # Expo push notifications
        │   └── email.ts         # Resend email
        └── email/
            └── templates/
                ├── MeetingReminder.tsx
                └── BirthdayAnnouncement.tsx
```

#### Trigger.dev Configuration

```typescript
// apps/jobs/trigger.config.ts
import { defineConfig } from "@trigger.dev/sdk/v3";

export default defineConfig({
  project: "togather-jobs",
  runtime: "node",
  logLevel: "info",
  retries: {
    enabledInDev: true,
    default: {
      maxAttempts: 3,
      minTimeoutInMs: 1000,
      maxTimeoutInMs: 60000,
      factor: 2,
    },
  },
});
```

```json
// apps/jobs/package.json
{
  "name": "@togather/jobs",
  "private": true,
  "scripts": {
    "dev": "trigger dev",
    "deploy": "trigger deploy",
    "generate": "prisma generate"
  },
  "dependencies": {
    "@trigger.dev/sdk": "^3.0.0",
    "@prisma/client": "^5.22.0",
    "@togather/notifications": "workspace:*",
    "@togather/shared": "workspace:*"
  }
}
```

#### Time Bucket Pattern for Meeting Reminders

Instead of creating one job per user per meeting, we use **time buckets** with idempotent scheduling. Meetings at the same time share a single job that batch-processes all reminders.

```
Meeting A created: starts 7:00am → reminder at 5:00am
Meeting B created: starts 7:00am → same reminder time, same bucket
Meeting C created: starts 7:05am → reminder at 5:05am, different bucket

Jobs created:
  ✓ "reminder-2024-01-15T05:00:00.000Z" → handles A + B together
  ✓ "reminder-2024-01-15T05:05:00.000Z" → handles C
```

#### Meeting Schema Addition

```prisma
model meeting {
  // ... existing fields
  reminder_at      DateTime?  // Calculated: start_time - 2 hours
  reminder_sent    Boolean    @default(false)

  @@index([reminder_at, reminder_sent])
}
```

#### Meeting Reminder Bucket Job

```typescript
// apps/jobs/src/jobs/meeting-reminder-bucket.ts
import { task } from "@trigger.dev/sdk/v3";
import { prisma } from "../client";
import { notificationService } from "@togather/notifications";

export const meetingReminderBucketTask = task({
  id: "meeting-reminder-bucket",
  retry: {
    maxAttempts: 3,
  },
  run: async (payload: { bucketTime: string }) => {
    const bucketTime = new Date(payload.bucketTime);

    // Find all meetings with this exact reminder time
    const meetings = await prisma.meeting.findMany({
      where: {
        reminder_at: bucketTime,
        reminder_sent: false,
        cancelled: false,
      },
      include: {
        group: true,
        rsvps: {
          where: { status: "going" },
        },
      },
    });

    if (meetings.length === 0) {
      return { processed: 0, reason: "no_meetings_in_bucket" };
    }

    // Build batch notifications for all users across all meetings
    const notifications = meetings.flatMap((meeting) =>
      meeting.rsvps.map((rsvp) => ({
        userId: rsvp.user_id,
        type: "meeting_reminder" as const,
        title: `${meeting.title} starts in 2 hours`,
        body: `Your meeting with ${meeting.group.name} is coming up`,
        data: {
          meetingId: meeting.id,
          groupId: meeting.group_id,
          screen: "meeting-detail",
        },
      }))
    );

    // Send all notifications in batch
    const results = await notificationService.sendBatch(notifications);

    // Mark all meetings as reminder sent
    await prisma.meeting.updateMany({
      where: { id: { in: meetings.map((m) => m.id) } },
      data: { reminder_sent: true },
    });

    return {
      meetingsProcessed: meetings.length,
      notificationsSent: notifications.length,
      successCount: results.filter((r) => r.success).length,
    };
  },
});
```

#### Scheduling Bucket Jobs from API

```typescript
// apps/api-trpc/src/lib/trigger.ts
import { tasks } from "@trigger.dev/sdk/v3";
import { subHours } from "date-fns";
import type { meetingReminderBucketTask } from "@togather/jobs";

export async function scheduleReminderBucket(reminderAt: Date) {
  // Only schedule if in the future
  if (reminderAt <= new Date()) {
    return null;
  }

  // Use exact time as bucket ID - meetings at same time share one job
  const bucketId = `reminder-${reminderAt.toISOString()}`;

  // Idempotency key ensures only ONE job per bucket time
  // If job already exists for this time, this is a no-op
  const handle = await tasks.trigger<typeof meetingReminderBucketTask>(
    "meeting-reminder-bucket",
    { bucketTime: reminderAt.toISOString() },
    {
      delay: reminderAt,
      idempotencyKey: bucketId,
    }
  );

  return handle.id;
}
```

```typescript
// apps/api-trpc/src/routers/groups/meetings.ts
import { scheduleReminderBucket } from "../../lib/trigger";
import { subHours } from "date-fns";

export const meetingsRouter = router({
  create: protectedProcedure
    .input(createMeetingSchema)
    .mutation(async ({ ctx, input }) => {
      const reminderAt = subHours(input.startTime, 2);

      // Create meeting with calculated reminder time
      const meeting = await prisma.meeting.create({
        data: {
          ...input,
          reminder_at: reminderAt,
        },
      });

      // Schedule bucket job (idempotent - won't duplicate if bucket exists)
      await scheduleReminderBucket(reminderAt);

      return meeting;
    }),

  update: protectedProcedure
    .input(updateMeetingSchema)
    .mutation(async ({ ctx, input }) => {
      const reminderAt = input.startTime
        ? subHours(input.startTime, 2)
        : undefined;

      const meeting = await prisma.meeting.update({
        where: { id: input.id },
        data: {
          ...input,
          reminder_at: reminderAt,
          // Reset reminder_sent if time changed
          reminder_sent: reminderAt ? false : undefined,
        },
      });

      // Schedule new bucket if time changed
      if (reminderAt) {
        await scheduleReminderBucket(reminderAt);
      }

      return meeting;
    }),
});
```

#### How Idempotent Bucketing Works

```
Timeline:
─────────────────────────────────────────────────────────────────────▶

10:00am - Meeting A created (starts 7:00am tomorrow)
          → reminder_at = 5:00am
          → Schedule bucket "reminder-2024-01-15T05:00:00.000Z"
          → Job CREATED ✓

10:30am - Meeting B created (starts 7:00am tomorrow, same time!)
          → reminder_at = 5:00am
          → Schedule bucket "reminder-2024-01-15T05:00:00.000Z"
          → Same idempotencyKey, job already exists, SKIPPED ✓

11:00am - Meeting C created (starts 7:05am tomorrow)
          → reminder_at = 5:05am
          → Schedule bucket "reminder-2024-01-15T05:05:00.000Z"
          → Different bucket, Job CREATED ✓

5:00am  - Bucket job runs
          → Fetches meetings A + B from DB (both have reminder_at = 5:00am)
          → Fetches all "going" RSVPs for both meetings
          → Sends batch notifications
          → Marks both as reminder_sent = true
          → Done ✓

5:05am  - Bucket job runs
          → Fetches meeting C
          → Sends notifications
          → Done ✓
```

#### Batch Notification Service

```typescript
// packages/notifications/src/service.ts
import { chunk } from "lodash";

class NotificationService {
  async sendBatch(payloads: NotificationPayload[]): Promise<NotificationResult[]> {
    // Group by preferred channel based on user preferences
    const grouped = await this.groupByPreferredChannel(payloads);

    // Expo supports up to 100 notifications per request
    const pushResults = await this.sendPushBatch(grouped.push);

    // Resend batch API - up to 100 emails per request
    const emailResults = await this.sendEmailBatch(grouped.email);

    return [...pushResults, ...emailResults];
  }

  private async sendPushBatch(notifications: PushNotification[]) {
    const chunks = chunk(notifications, 100);
    const results = await Promise.all(
      chunks.map((c) => expo.sendPushNotificationsAsync(c))
    );
    return results.flat();
  }

  private async sendEmailBatch(notifications: EmailNotification[]) {
    const chunks = chunk(notifications, 100);
    const results = await Promise.all(
      chunks.map((c) => resend.batch.send(c))
    );
    return results.flat();
  }
}
```

#### Edge Cases

| Scenario | Handling |
|----------|----------|
| Meeting rescheduled | New `reminder_at` calculated, `reminder_sent` reset to false, new bucket scheduled. Old bucket job runs but won't find this meeting. |
| Meeting cancelled | Job runs, query excludes `cancelled: true` |
| User un-RSVPs before reminder | Job fetches fresh RSVPs at runtime, user not included |
| Job fails | Trigger.dev retries. `reminder_sent` only set after success. |
| No meetings in bucket | Job exits early with no-op (meeting deleted or rescheduled) |

### Part 4: Bot Framework

A TypeScript-based bot framework that allows platform-defined bots to run on schedules or react to events. Groups can enable/disable bots. Designed to be extensible for community-created bots in the future.

#### Architecture Overview

```
Event Sources                     Bot Runtime                      Actions
─────────────                     ───────────                      ───────

┌─────────────────┐              ┌─────────────────┐              ┌─────────────┐
│  Stream Chat    │──webhook────▶│                 │──────────────▶│ sendMessage │
│  (member.added) │              │                 │              │ (Stream)    │
└─────────────────┘              │                 │              └─────────────┘
                                 │   Trigger.dev   │
┌─────────────────┐              │                 │              ┌─────────────┐
│  Our API        │──trigger────▶│   Bot Runner    │──────────────▶│ sendNotif   │
│  (meeting.created)             │                 │              │ (Push/Email)│
└─────────────────┘              │                 │              └─────────────┘
                                 │                 │
┌─────────────────┐              │                 │
│  Cron Schedule  │──schedule───▶│                 │
│  (daily 9am)    │              │                 │
└─────────────────┘              └─────────────────┘
```

#### Bot Definition Interface

```typescript
// apps/jobs/src/bots/types.ts

export interface BotDefinition {
  id: string;
  name: string;
  description: string;
  icon: string;
  trigger: BotTrigger;
  state?: Record<string, unknown>;  // Persisted state between runs
  run: (ctx: BotContext) => Promise<void>;
}

export type BotTrigger =
  | { type: "cron"; schedule: string }
  | { type: "event"; event: EventType };

export type EventType =
  | "member.joined"
  | "member.left"
  | "meeting.created"
  | "meeting.updated"
  | "meeting.cancelled"
  | "rsvp.going"
  | "rsvp.notGoing";

export interface BotContext {
  group: GroupContext;
  community: CommunityContext;
  member?: MemberContext;      // For member-triggered events
  meeting?: MeetingContext;    // For meeting-triggered events
  state: BotState;
  actions: BotActions;
}

export interface GroupContext {
  id: string;
  name: string;
  members: MemberContext[];
  leaders: MemberContext[];
  meetings: MeetingContext[];
}

export interface CommunityContext {
  id: string;
  name: string;
}

export interface MemberContext {
  id: string;
  firstName: string;
  lastName: string;
  birthday: Date | null;
  joinedAt: Date;
}

export interface MeetingContext {
  id: string;
  title: string;
  startTime: Date;
  endTime: Date;
}

export interface BotState {
  get<T>(key: string): T | undefined;
  set<T>(key: string, value: T): void;
}

export interface BotActions {
  sendMessage(text: string): Promise<void>;
  sendNotification(params: {
    to: string | string[];
    title: string;
    body: string;
    data?: Record<string, unknown>;
  }): Promise<void>;
}
```

#### Helper Functions

```typescript
// apps/jobs/src/bots/helpers.ts

export function cron(schedule: string): BotTrigger {
  return { type: "cron", schedule };
}

export function event(eventType: EventType): BotTrigger {
  return { type: "event", event: eventType };
}

export function defineBot(definition: BotDefinition): BotDefinition {
  return definition;
}
```

#### Example Bots

```typescript
// apps/jobs/src/bots/definitions/birthday-bot.ts
import { defineBot, cron } from "../helpers";

export default defineBot({
  id: "birthday",
  name: "Birthday Bot",
  description: "Celebrates member birthdays in group chat",
  icon: "🎂",
  trigger: cron("0 9 * * *"),  // Daily at 9am UTC
  state: { lastLeaderIndex: 0 },

  async run({ group, state, actions }) {
    const today = new Date();
    const birthdays = group.members.filter((m) => {
      if (!m.birthday) return false;
      return (
        m.birthday.getMonth() === today.getMonth() &&
        m.birthday.getDate() === today.getDate()
      );
    });

    if (birthdays.length === 0) return;

    const names = birthdays.map((m) => m.firstName);
    const message =
      names.length === 1
        ? `🎂 Happy Birthday, ${names[0]}! 🎉`
        : `🎂 Happy Birthday to ${names.join(" and ")}! 🎉`;

    await actions.sendMessage(message);
  },
});
```

```typescript
// apps/jobs/src/bots/definitions/welcome-bot.ts
import { defineBot, event } from "../helpers";

export default defineBot({
  id: "welcome",
  name: "Welcome Bot",
  description: "Welcomes new members to the group",
  icon: "👋",
  trigger: event("member.joined"),

  async run({ group, member, actions }) {
    await actions.sendMessage(
      `Welcome to ${group.name}, ${member.firstName}! 👋`
    );
  },
});
```

```typescript
// apps/jobs/src/bots/definitions/birthday-leader-reminder.ts
import { defineBot, cron } from "../helpers";

export default defineBot({
  id: "birthday-leader-reminder",
  name: "Birthday Leader Reminder",
  description: "Notifies a rotating leader to wish members happy birthday",
  icon: "🎂",
  trigger: cron("0 8 * * *"),
  state: { lastLeaderIndex: 0 },

  async run({ group, state, actions }) {
    const today = new Date();
    const birthdays = group.members.filter((m) => {
      if (!m.birthday) return false;
      return (
        m.birthday.getMonth() === today.getMonth() &&
        m.birthday.getDate() === today.getDate()
      );
    });

    if (birthdays.length === 0 || group.leaders.length === 0) return;

    for (const member of birthdays) {
      // Round-robin through leaders
      const leaderIndex = state.get<number>("lastLeaderIndex") ?? 0;
      const leader = group.leaders[leaderIndex % group.leaders.length];
      state.set("lastLeaderIndex", leaderIndex + 1);

      await actions.sendNotification({
        to: leader.id,
        title: "Birthday duty 🎂",
        body: `Hey ${leader.firstName}, it's your turn to wish ${member.firstName} happy birthday!`,
      });
    }
  },
});
```

#### Bot Registry

```typescript
// apps/jobs/src/bots/registry.ts
import birthdayBot from "./definitions/birthday-bot";
import welcomeBot from "./definitions/welcome-bot";
import birthdayLeaderReminder from "./definitions/birthday-leader-reminder";

export const botRegistry = {
  birthday: birthdayBot,
  welcome: welcomeBot,
  "birthday-leader-reminder": birthdayLeaderReminder,
} as const;

export type BotId = keyof typeof botRegistry;
```

#### Bot Runner (Trigger.dev Jobs)

```typescript
// apps/jobs/src/bots/runner.ts
import { task, schedules } from "@trigger.dev/sdk/v3";
import { prisma } from "../client";
import { botRegistry, BotId } from "./registry";
import { createBotContext } from "./context";

// Cron-triggered bots
export const cronBotRunner = schedules.task({
  id: "cron-bot-runner",
  cron: "* * * * *",  // Every minute, checks which bots need to run
  run: async () => {
    // For each cron bot, check if it's time to run based on its schedule
    // This is simplified - in practice, use a proper cron parser
    for (const [botId, bot] of Object.entries(botRegistry)) {
      if (bot.trigger.type !== "cron") continue;

      // Find groups with this bot enabled
      const configs = await prisma.group_bot_config.findMany({
        where: { bot_type: botId, enabled: true },
        include: { group: { include: { community: true } } },
      });

      for (const config of configs) {
        const ctx = await createBotContext(config.group, bot, config);
        await bot.run(ctx);
      }
    }
  },
});

// Event-triggered bots
export const eventBotRunner = task({
  id: "event-bot-runner",
  run: async (payload: {
    event: string;
    groupId: string;
    data: Record<string, unknown>;
  }) => {
    // Find bots that listen to this event
    const matchingBots = Object.entries(botRegistry).filter(
      ([_, bot]) =>
        bot.trigger.type === "event" && bot.trigger.event === payload.event
    );

    for (const [botId, bot] of matchingBots) {
      // Check if this group has the bot enabled
      const config = await prisma.group_bot_config.findUnique({
        where: {
          group_id_bot_type: { group_id: payload.groupId, bot_type: botId },
        },
        include: { group: { include: { community: true } } },
      });

      if (!config?.enabled) continue;

      const ctx = await createBotContext(config.group, bot, config, payload.data);
      await bot.run(ctx);
    }
  },
});
```

#### Event Webhook Handler

```typescript
// apps/api-trpc/src/webhooks/stream.ts
import { tasks } from "@trigger.dev/sdk/v3";

export async function handleStreamWebhook(event: StreamWebhookEvent) {
  // Map Stream events to our event types
  const eventMap: Record<string, string> = {
    "member.added": "member.joined",
    "member.removed": "member.left",
  };

  const ourEvent = eventMap[event.type];
  if (!ourEvent) return;

  // Extract group ID from channel
  const groupId = extractGroupIdFromChannel(event.channel_id);
  if (!groupId) return;

  // Trigger the event bot runner
  await tasks.trigger("event-bot-runner", {
    event: ourEvent,
    groupId,
    data: {
      memberId: event.user?.id,
    },
  });
}
```

```typescript
// apps/api-trpc/src/routers/groups/meetings.ts
// When a meeting is created, trigger event bots

create: protectedProcedure
  .input(createMeetingSchema)
  .mutation(async ({ ctx, input }) => {
    const meeting = await prisma.meeting.create({ ... });

    // Trigger event bots
    await tasks.trigger("event-bot-runner", {
      event: "meeting.created",
      groupId: meeting.group_id,
      data: { meetingId: meeting.id },
    });

    return meeting;
  }),
```

#### Bot Configuration Schema

```prisma
// apps/api-trpc/prisma/schema.prisma

model group_bot_config {
  id          String   @id @default(uuid())
  group_id    String
  bot_type    String   // "birthday", "welcome", etc.
  enabled     Boolean  @default(true)
  state       Json     @default("{}")  // Persisted bot state
  created_at  DateTime @default(now())
  updated_at  DateTime @updatedAt

  group       group    @relation(fields: [group_id], references: [id], onDelete: Cascade)

  @@unique([group_id, bot_type])
  @@index([bot_type, enabled])
}
```

#### Bot Management API

```typescript
// apps/api-trpc/src/routers/groups/bots.ts

export const botsRouter = router({
  // List available bots
  available: protectedProcedure.query(async () => {
    return Object.entries(botRegistry).map(([id, bot]) => ({
      id,
      name: bot.name,
      description: bot.description,
      icon: bot.icon,
      triggerType: bot.trigger.type,
    }));
  }),

  // List bots enabled for a group
  list: protectedProcedure
    .input(z.object({ groupId: z.string() }))
    .query(async ({ input }) => {
      const configs = await prisma.group_bot_config.findMany({
        where: { group_id: input.groupId },
      });

      return configs.map((config) => ({
        botId: config.bot_type,
        enabled: config.enabled,
        ...botRegistry[config.bot_type as BotId],
      }));
    }),

  // Enable/disable a bot for a group
  toggle: protectedProcedure
    .input(z.object({
      groupId: z.string(),
      botId: z.string(),
      enabled: z.boolean(),
    }))
    .mutation(async ({ input }) => {
      await prisma.group_bot_config.upsert({
        where: {
          group_id_bot_type: {
            group_id: input.groupId,
            bot_type: input.botId,
          },
        },
        create: {
          group_id: input.groupId,
          bot_type: input.botId,
          enabled: input.enabled,
        },
        update: { enabled: input.enabled },
      });
    }),
});
```

#### Future: Community-Created Bots

The architecture supports extending to community-created bots:

1. **Bot definitions stored in database** instead of code
2. **YAML config language** for simpler, sandboxed bot definitions
3. **Approval workflow** for marketplace submissions
4. **Per-community bot visibility** (private to community vs public marketplace)

```prisma
// Future schema addition
model bot_definition {
  id            String   @id @default(uuid())
  slug          String   @unique
  name          String
  description   String
  icon          String
  definition    Json     // YAML parsed to JSON
  visibility    String   // "platform", "community", "marketplace"
  community_id  String?  // If community-specific
  approved      Boolean  @default(false)
  created_by    String
  created_at    DateTime @default(now())
}
```

### Part 3: Notification Preferences API

```typescript
// apps/api-trpc/src/routers/notifications.ts - additions

export const notificationsRouter = router({
  // ... existing endpoints

  getChannelPreferences: protectedProcedure.query(async ({ ctx }) => {
    const user = await prisma.user.findUnique({
      where: { id: ctx.user.id },
      select: {
        push_notifications_enabled: true,
        email_notifications_enabled: true,
        sms_notifications_enabled: true,
        email: true,
        phone: true,
      },
    });

    return {
      push: {
        enabled: user.push_notifications_enabled,
        available: true,
      },
      email: {
        enabled: user.email_notifications_enabled,
        available: !!user.email,
      },
      sms: {
        enabled: user.sms_notifications_enabled,
        available: !!user.phone,
      },
    };
  }),

  updateChannelPreferences: protectedProcedure
    .input(z.object({
      push: z.boolean().optional(),
      email: z.boolean().optional(),
      sms: z.boolean().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      await prisma.user.update({
        where: { id: ctx.user.id },
        data: {
          push_notifications_enabled: input.push,
          email_notifications_enabled: input.email,
          sms_notifications_enabled: input.sms,
        },
      });
    }),
});
```

## Deployment

### Jobs App (Trigger.dev Cloud)

Jobs are deployed directly to Trigger.dev, not to Fly.io:

```bash
# Deploy jobs to Trigger.dev Cloud
cd apps/jobs
pnpm deploy  # runs: trigger deploy
```

Environment variables are set in the Trigger.dev dashboard:
- `DATABASE_URL` - Supabase connection string
- `RESEND_API_KEY` - For email notifications
- `EXPO_TOKEN` - For push notifications
- `STREAM_API_KEY` / `STREAM_API_SECRET` - For chat messages

### API (Fly.io) - No Changes

The API only needs the Trigger.dev secret key to schedule jobs:
- `TRIGGER_SECRET_KEY` - Added to 1Password/Fly.io secrets

## Implementation Plan

### Phase 1: Foundation
1. Create `packages/notifications` with notification service (push + email channels)
2. Add Resend dependency and email templates
3. Add user preference columns to database (`push_notifications_enabled`, `email_notifications_enabled`)
4. Update notification preferences UI in settings

### Phase 2: Job Worker
1. Create `apps/jobs` with Trigger.dev configuration
2. Set up Trigger.dev project (cloud.trigger.dev)
3. Add `reminder_at` and `reminder_sent` columns to meeting table
4. Implement meeting reminder bucket job
5. Add trigger client to API for scheduling
6. Hook into meeting create/update to schedule reminder buckets

### Phase 3: Bot Framework
1. Add `group_bot_config` table with state field
2. Create bot framework types and helpers (`defineBot`, `cron`, `event`)
3. Implement bot registry and runner (cron + event triggers)
4. Create initial bots: birthday bot, welcome bot
5. Add Stream webhook handler for event-triggered bots
6. Add bot management API (list available, enable/disable for group)
7. Add bot configuration UI in group leader tools

## Environment Variables

### Trigger.dev Dashboard (for apps/jobs)
```bash
DATABASE_URL=postgresql://...
RESEND_API_KEY=re_xxxxx
EXPO_TOKEN=xxxxx
STREAM_API_KEY=xxxxx
STREAM_API_SECRET=xxxxx
```

### Fly.io / 1Password (for apps/api-trpc)
```bash
# Existing vars...
TRIGGER_SECRET_KEY=tr_xxxxx  # NEW: For scheduling jobs
```

### Local Development
```bash
# .env.local in apps/jobs
DATABASE_URL=postgresql://...
RESEND_API_KEY=re_test_xxxxx

# Run Trigger.dev dev server
cd apps/jobs
pnpm dev  # runs: trigger dev
```

## Consequences

### Positive
- **No infrastructure to manage** - Trigger.dev handles job execution
- **Unified notification system** - Push, email, (future SMS) through one interface
- **User control** - Preferences respected, channel fallback
- **Type-safe scheduling** - TypeScript throughout
- **Great observability** - Trigger.dev dashboard for monitoring and debugging
- **Clean separation** - Jobs are their own app, notification logic is a shared package

### Negative
- **External dependency** - Reliant on Trigger.dev (mitigated: can self-host or migrate to BullMQ)
- **Additional cost** - Trigger.dev and Resend (both have generous free tiers)
- **More packages** - `apps/jobs` and `packages/notifications` added to monorepo

### Future Extensions
- SMS channel implementation (Twilio already integrated)
- More bot types (weekly digest, follow-up reminders)
- Notification templates with localization
- Delivery analytics

## Affected Files

### New Packages/Apps
- `apps/jobs/` - Trigger.dev jobs application
- `packages/notifications/` - Shared notification service

### New Files in Existing Packages
- `apps/api-trpc/src/lib/trigger.ts` - Trigger client for scheduling
- `apps/api-trpc/src/webhooks/stream.ts` - Stream webhook handler for bot events
- `apps/api-trpc/src/routers/groups/bots.ts` - Bot management API
- `apps/jobs/src/bots/` - Bot framework (types, helpers, registry, runner)
- `apps/jobs/src/bots/definitions/` - Platform bot definitions
- `packages/shared/src/notifications/types.ts` - Shared types

### Modified Files
- `apps/api-trpc/prisma/schema.prisma` - User preferences, meeting reminder fields, bot config
- `apps/api-trpc/src/routers/notifications.ts` - Channel preferences endpoints
- `apps/api-trpc/src/routers/groups/meetings.ts` - Schedule reminder buckets, trigger bot events
- `apps/mobile/features/settings/` - Notification preferences UI
- `apps/mobile/features/leader-tools/` - Bot configuration UI
- `pnpm-workspace.yaml` - Add new packages

## Related
- ADR-011: Timezone Handling (meetings use timezones for reminder scheduling)
- ADR-002: Event RSVP Chat Integration (RSVPs trigger reminders)

---

## Implementation Checklist

> **For implementing agents:** Work through these checkboxes in order. Each phase should be completed before moving to the next.

### Phase 1: Foundation (Notification Service)

#### 1.1 Database Schema Updates
- [ ] Add `push_notifications_enabled` (Boolean, default true) to `user` table
- [ ] Add `email_notifications_enabled` (Boolean, default true) to `user` table
- [ ] Add `sms_notifications_enabled` (Boolean, default false) to `user` table
- [ ] Run `prisma migrate dev` to create migration
- [ ] Verify migration applies cleanly

#### 1.2 Create Notifications Package
- [ ] Create `packages/notifications/package.json` with dependencies:
  - `resend`
  - `@react-email/components`
  - `expo-server-sdk`
  - `@togather/shared` (workspace dependency)
- [ ] Add to `pnpm-workspace.yaml`
- [ ] Create `packages/notifications/src/index.ts` - main export
- [ ] Create `packages/notifications/src/types.ts` - NotificationPayload, NotificationResult
- [ ] Create `packages/notifications/src/service.ts` - NotificationService class

#### 1.3 Implement Notification Channels
- [ ] Create `packages/notifications/src/channels/push.ts`
  - Wrap existing `expo-server-sdk` logic
  - Support batch sending (chunks of 100)
- [ ] Create `packages/notifications/src/channels/email.ts`
  - Initialize Resend client
  - Support batch sending
- [ ] Implement channel priority cascade in service.ts
- [ ] Implement user preference checking (query user's enabled channels)

#### 1.4 Email Templates
- [ ] Create `packages/notifications/src/email/templates/MeetingReminder.tsx`
- [ ] Create `packages/notifications/src/email/templates/BaseLayout.tsx` (shared layout)
- [ ] Test email rendering locally with `react-email dev`

#### 1.5 API Endpoints
- [ ] Add `getChannelPreferences` to `apps/api-trpc/src/routers/notifications.ts`
- [ ] Add `updateChannelPreferences` to `apps/api-trpc/src/routers/notifications.ts`
- [ ] Test endpoints via tRPC playground or curl

#### 1.6 Environment Variables
- [ ] Add `RESEND_API_KEY` to 1Password (dev, staging, prod)
- [ ] Add `RESEND_API_KEY` to local `.env`
- [ ] Verify Resend account and domain verification

#### 1.7 Testing
- [ ] Write unit tests for NotificationService
- [ ] Write unit tests for channel priority logic
- [ ] Test push notification sending (use mock mode)
- [ ] Test email sending (use Resend test mode)

---

### Phase 2: Job Worker (Trigger.dev + Meeting Reminders)

#### 2.1 Database Schema Updates
- [ ] Add `reminder_at` (DateTime, nullable) to `meeting` table
- [ ] Add `reminder_sent` (Boolean, default false) to `meeting` table
- [ ] Add index on `[reminder_at, reminder_sent]`
- [ ] Run `prisma migrate dev`

#### 2.2 Trigger.dev Project Setup
- [ ] Create account at cloud.trigger.dev
- [ ] Create new project "togather-jobs"
- [ ] Note down `TRIGGER_SECRET_KEY` and `TRIGGER_API_KEY`

#### 2.3 Create Jobs App
- [ ] Create `apps/jobs/package.json` with dependencies:
  - `@trigger.dev/sdk`
  - `@prisma/client`
  - `@togather/notifications` (workspace)
  - `@togather/shared` (workspace)
- [ ] Create `apps/jobs/trigger.config.ts`
- [ ] Create `apps/jobs/src/client.ts` - Prisma client
- [ ] Create `apps/jobs/src/index.ts` - export all jobs
- [ ] Add to `pnpm-workspace.yaml`
- [ ] Run `pnpm install`

#### 2.4 Implement Meeting Reminder Bucket Job
- [ ] Create `apps/jobs/src/jobs/meeting-reminder-bucket.ts`
- [ ] Implement job logic:
  - Query meetings where `reminder_at = bucketTime` and `reminder_sent = false`
  - Fetch all RSVPs with status "going"
  - Build batch notifications
  - Send via notification service
  - Mark meetings as `reminder_sent = true`
- [ ] Test job locally with `pnpm trigger:dev`

#### 2.5 API Integration
- [ ] Create `apps/api-trpc/src/lib/trigger.ts` - trigger client
- [ ] Add `TRIGGER_SECRET_KEY` to 1Password and local `.env`
- [ ] Implement `scheduleReminderBucket()` function with idempotency key

#### 2.6 Hook into Meeting Creation
- [ ] Modify `apps/api-trpc/src/routers/groups/meetings.ts`:
  - Calculate `reminder_at` as `scheduled_at - 2 hours`
  - Save `reminder_at` to database
  - Call `scheduleReminderBucket(reminder_at)`
- [ ] Handle meeting updates (recalculate `reminder_at`, reset `reminder_sent`)

#### 2.7 Deployment
- [ ] Deploy jobs to Trigger.dev: `cd apps/jobs && pnpm deploy`
- [ ] Set environment variables in Trigger.dev dashboard:
  - `DATABASE_URL`
  - `RESEND_API_KEY`
  - `EXPO_TOKEN`
- [ ] Deploy API with new `TRIGGER_SECRET_KEY`
- [ ] Test end-to-end: create meeting → verify job scheduled → verify reminder sent

#### 2.8 Testing
- [ ] Write tests for bucket job
- [ ] Test idempotency (same bucket time = no duplicate jobs)
- [ ] Test edge cases: meeting deleted, meeting rescheduled, user un-RSVPs

---

### Phase 3: Bot Framework

#### 3.1 Database Schema Updates
- [ ] Create `group_bot_config` table:
  - `id` (UUID)
  - `group_id` (FK to group)
  - `bot_type` (String)
  - `enabled` (Boolean, default true)
  - `state` (Json, default {})
  - Unique constraint on `[group_id, bot_type]`
- [ ] Add relation to `group` model
- [ ] Run `prisma migrate dev`

#### 3.2 Bot Framework Core
- [ ] Create `apps/jobs/src/bots/types.ts` - BotDefinition, BotContext, etc.
- [ ] Create `apps/jobs/src/bots/helpers.ts` - `defineBot()`, `cron()`, `event()`
- [ ] Create `apps/jobs/src/bots/context.ts` - `createBotContext()` function
- [ ] Create `apps/jobs/src/bots/registry.ts` - bot registry

#### 3.3 Bot Runners
- [ ] Create `apps/jobs/src/bots/runner.ts`:
  - `cronBotRunner` - scheduled task that checks cron bots
  - `eventBotRunner` - triggered by events
- [ ] Implement cron schedule matching logic
- [ ] Implement bot state persistence (read/write to `group_bot_config.state`)

#### 3.4 Initial Bot Definitions
- [ ] Create `apps/jobs/src/bots/definitions/birthday-bot.ts`
- [ ] Create `apps/jobs/src/bots/definitions/welcome-bot.ts`
- [ ] Register bots in registry

#### 3.5 Event Triggers
- [ ] Update `apps/api-trpc/src/webhooks/stream.ts`:
  - Map Stream events to bot events (`member.added` → `member.joined`)
  - Trigger `eventBotRunner` job
- [ ] Add event triggers to meetings router:
  - `meeting.created`, `meeting.updated`, `meeting.cancelled`
- [ ] Add event triggers to RSVP router:
  - `rsvp.going`, `rsvp.notGoing`

#### 3.6 Bot Management API
- [ ] Create `apps/api-trpc/src/routers/groups/bots.ts`:
  - `available` - list all platform bots
  - `list` - list bots for a group (with enabled status)
  - `toggle` - enable/disable bot for group
- [ ] Add to groups router

#### 3.7 Deployment
- [ ] Deploy updated jobs to Trigger.dev
- [ ] Deploy updated API
- [ ] Verify bots run on schedule
- [ ] Verify event-triggered bots work

#### 3.8 Testing
- [ ] Test birthday bot with test user having birthday today
- [ ] Test welcome bot by adding member to group
- [ ] Test bot enable/disable via API
- [ ] Test bot state persistence

---

### Final Verification

- [ ] All migrations applied to production
- [ ] All environment variables set in production
- [ ] Jobs deployed to Trigger.dev production
- [ ] API deployed to Fly.io
- [ ] Create test meeting and verify reminder is scheduled
- [ ] Enable birthday bot for test group
- [ ] Monitor Trigger.dev dashboard for job execution
- [ ] Check notification delivery (push + email)

---

### Rollback Plan

If issues arise:
1. **Disable jobs**: Set `enabled: false` in Trigger.dev dashboard
2. **Revert API**: Roll back to previous Fly.io deployment
3. **Revert migrations**: Prisma migrations can be reverted with `prisma migrate resolve`
4. **Feature flags**: Consider adding feature flags for gradual rollout
