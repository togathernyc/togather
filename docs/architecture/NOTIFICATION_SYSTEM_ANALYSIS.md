# Notification System Deep Dive Analysis

> Generated: 2026-01-06
> Purpose: Comprehensive analysis of the Togather notification system with recommendations for consolidation and improvement

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Current Architecture Overview](#current-architecture-overview)
3. [Notification Types](#notification-types)
4. [Trigger Points](#trigger-points)
5. [Sending Infrastructure](#sending-infrastructure)
6. [Environment Separation](#environment-separation)
7. [Database Schema](#database-schema)
8. [Frontend Handling](#frontend-handling)
9. [Current Pain Points](#current-pain-points)
10. [Recommendations for Consolidation](#recommendations-for-consolidation)

---

## Executive Summary

The Togather notification system consists of **push notifications** (via Expo), **email notifications** (via Resend), and **in-app notifications** (via database). The system has grown organically with notification logic scattered across multiple files, making it difficult to maintain, debug, and extend.

### Key Findings

| Aspect | Current State | Risk Level |
|--------|--------------|------------|
| **Architecture** | Distributed across 10+ files | Medium |
| **Environment Separation** | Recently improved (PR #93) | Low |
| **Duplicate Prevention** | Handled via DB constraints | Low |
| **Observability** | Limited logging, no metrics | High |
| **Testing** | Manual only, no automated tests | High |
| **Documentation** | Partial, scattered | Medium |

### Critical Files

| File | Purpose | Lines of Code |
|------|---------|---------------|
| `apps/api-trpc/src/lib/notifications.ts` | High-level send functions | ~200 |
| `apps/api-trpc/src/lib/expo.ts` | Expo SDK wrapper | ~250 |
| `apps/api-trpc/src/routers/notifications.ts` | tRPC API routes | ~500 |
| `apps/api-trpc/src/webhooks/stream.ts` | Stream webhook handler | ~600 |
| `apps/mobile/providers/NotificationProvider.tsx` | Mobile notification handling | ~400 |
| `packages/notifications/src/service.ts` | Notification service class | ~150 |

---

## Current Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           NOTIFICATION TRIGGERS                          │
├─────────────────┬─────────────────┬─────────────────┬───────────────────┤
│  Stream Webhook │   tRPC Mutation │   Scheduled Job │   Admin Action    │
│  (message.new)  │  (join request) │   (reminders)   │   (approvals)     │
└────────┬────────┴────────┬────────┴────────┬────────┴─────────┬─────────┘
         │                 │                 │                  │
         ▼                 ▼                 ▼                  ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                        NOTIFICATION DISPATCH LAYER                       │
│                                                                          │
│   ┌──────────────────┐    ┌──────────────────┐    ┌──────────────────┐  │
│   │  notifyUser()    │    │ notifyCommunity  │    │ sendPushNotifi-  │  │
│   │  lib/notif...    │    │ Admins()         │    │ cation()         │  │
│   └────────┬─────────┘    └────────┬─────────┘    └────────┬─────────┘  │
│            │                       │                       │             │
│            └───────────────────────┴───────────────────────┘             │
│                                    │                                     │
└────────────────────────────────────┼─────────────────────────────────────┘
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                          CHANNEL ROUTING                                 │
│                                                                          │
│   ┌───────────────┐    ┌───────────────┐    ┌───────────────┐           │
│   │  Push (Expo)  │    │ Email (Resend)│    │ In-App (DB)   │           │
│   │  expo.ts      │    │ email.ts      │    │ notification  │           │
│   └───────┬───────┘    └───────┬───────┘    └───────┬───────┘           │
│           │                    │                    │                    │
└───────────┼────────────────────┼────────────────────┼────────────────────┘
            │                    │                    │
            ▼                    ▼                    ▼
┌───────────────────┐ ┌───────────────────┐ ┌───────────────────┐
│   Expo Service    │ │   Resend API      │ │   PostgreSQL      │
│   (APNs / FCM)    │ │                   │ │   (notification)  │
└───────────────────┘ └───────────────────┘ └───────────────────┘
```

---

## Notification Types

### Push Notifications

| Type | Description | Trigger Location |
|------|-------------|------------------|
| `new_message` | New message in group chat | `webhooks/stream.ts:210-353` |
| `mention` | User mentioned in message | `webhooks/stream.ts:256-271` |
| `join_request_received` | Someone requested to join | `routers/groups/join-requests.ts:90` |
| `join_request_approved` | User's request was approved | `routers/admin.ts:362` |
| `group_creation_request` | Someone requested new group | `routers/groups/creation-requests.ts:144` |
| `group_creation_approved` | Group request was approved | `routers/admin.ts:3068` |

### Email Notifications

| Type | Template | Purpose |
|------|----------|---------|
| `meeting_reminder` | `MeetingReminderEmail` | Scheduled event reminders |
| `event_updated` | `EventUpdatedEmail` | Event change notifications |
| `rsvp_confirmation` | `RSVPConfirmationEmail` | RSVP confirmations |
| `mention` | `MentionEmail` | Email fallback for mentions |
| `group_creation_request` | `GroupCreationRequestEmail` | Admin notification |
| `content_report` | `ContentReportEmail` | Flagged message alerts |

### In-App Notifications

Stored in the `notification` table for display in the app's notification center.

---

## Trigger Points

### 1. Stream Chat Webhook (`webhooks/stream.ts`)

**Events Handled:**
- `message.new` → Push to group members (excluding sender, active watchers)
- `message.flagged` → Email to moderation team
- `member.removed` → Internal bot triggers

**Environment Filtering:**
```typescript
// Channel prefix determines environment
// Staging: s_c35g550e8400-..._m
// Production: p_c35g550e8400-..._m
if (!isChannelForCurrentEnvironment(channelId)) {
  return; // Skip webhooks for wrong environment
}
```

### 2. tRPC Mutations

| Mutation | Notification Sent | Async? |
|----------|-------------------|--------|
| `joinRequests.create` | Admin notification | Yes (IIFE) |
| `creationRequests.create` | Admin notification | Yes (IIFE) |
| `admin.pendingRequests.review` | User notification | Yes (IIFE) |
| `admin.groupCreationRequests.approve` | Leader notification | Yes (IIFE) |

### 3. Scheduled Jobs (Convex crons & scheduled functions)

| Job | Schedule | Purpose |
|-----|----------|---------|
| Meeting reminders | Cron-based | 24h/1h before events |
| Birthday announcements | Daily | Community birthdays |

---

## Sending Infrastructure

### Expo Push (Primary Channel)

**SDK Configuration:**
```typescript
const expo = new Expo({
  accessToken: process.env.EXPO_TOKEN,
  useFcmV1: true, // FCM V1 API for Android
});
```

**Token Validation:**
```typescript
if (!Expo.isExpoPushToken(token)) {
  errors.push(`Invalid token: ${token}`);
  continue;
}
```

**Mock Mode (Development):**
```typescript
if (process.env.DISABLE_NOTIFICATION === 'true') {
  console.log('[Expo Push] MOCK MODE - Would send:', { title, body });
  return { success: true, ticketIds: [], errors: [] };
}
```

### Resend Email

**Configuration:**
```typescript
const resend = new Resend(process.env.RESEND_API_KEY);

// Batch sending (100 per chunk)
const chunks = chunkArray(emails, 100);
for (const chunk of chunks) {
  await resend.emails.send({ batch: chunk });
}
```

**From Address:** `Togather <togather@supa.media>`

---

## Environment Separation

### How It Works

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        ENVIRONMENT SEPARATION                            │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│   STAGING                              PRODUCTION                        │
│   ─────────                            ──────────                        │
│                                                                          │
│   Bundle ID:                           Bundle ID:                        │
│   life.togather.staging                app.gatherful.mobile              │
│                                                                          │
│   Channel Prefix: s_                   Channel Prefix: p_                │
│                                                                          │
│   API: api-staging.togather.nyc        API: api.togather.nyc             │
│                                                                          │
│   push_token.environment = 'staging'   push_token.environment = 'prod'  │
│                                                                          │
│   ┌─────────────────────────────────────────────────────────────────┐   │
│   │         SHARED STREAM CHAT ACCOUNT (Single Webhook URL)         │   │
│   │                                                                  │   │
│   │  Webhook → Both servers receive ALL events                       │   │
│   │            Each server filters by channel prefix (s_ vs p_)      │   │
│   └─────────────────────────────────────────────────────────────────┘   │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

### Token Registration Flow

```typescript
// apps/api-trpc/src/routers/notifications.ts

registerToken: protectedProcedure.mutation(async ({ input, ctx }) => {
  // Server determines environment (not trusted from client)
  const environment = getCurrentEnvironment(); // 'staging' or 'production'

  await ctx.db.push_token.upsert({
    where: { token_bundle_id: { token, bundle_id: input.bundleId } },
    create: {
      token,
      bundle_id: input.bundleId,
      environment,  // Server-determined
      // ...
    },
    update: { /* ... */ }
  });

  // Deactivate legacy tokens (rollout protection)
  await ctx.db.push_token.updateMany({
    where: { token, bundle_id: null },
    data: { is_active: false }
  });
});
```

### Query Filtering

```typescript
// ALL notification queries filter by environment
const tokens = await db.push_token.findMany({
  where: {
    user_id: { in: userIds },
    is_active: true,
    environment: getCurrentEnvironment(),  // ← Critical filter
  }
});
```

---

## Database Schema

### `push_token` Table

```sql
CREATE TABLE push_token (
  id UUID PRIMARY KEY,
  token VARCHAR(255) NOT NULL,
  platform VARCHAR(20) NOT NULL,        -- 'ios' | 'android' | 'web'
  device_id VARCHAR(255),
  bundle_id VARCHAR(100),               -- App bundle identifier
  environment VARCHAR(20),              -- 'staging' | 'production'
  is_active BOOLEAN DEFAULT TRUE,
  user_id BIGINT NOT NULL REFERENCES "user"(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  last_used_at TIMESTAMPTZ DEFAULT NOW(),

  CONSTRAINT push_token_token_bundle_id_key UNIQUE (token, bundle_id)
);

CREATE INDEX idx_push_token_user_active_env ON push_token(user_id, is_active, environment);
```

### `notification` Table

```sql
CREATE TABLE notification (
  id UUID PRIMARY KEY,
  notification_type VARCHAR(50) NOT NULL,
  title VARCHAR(255) NOT NULL,
  body TEXT,
  data JSONB,
  status VARCHAR(20) DEFAULT 'pending',
  is_read BOOLEAN DEFAULT FALSE,
  read_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  error_message TEXT,
  user_id BIGINT NOT NULL REFERENCES "user"(id),
  group_id UUID REFERENCES "group"(id),
  community_id BIGINT REFERENCES community(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_notification_user_read_created ON notification(user_id, is_read, created_at);
```

### `group_member` (Notification Preference)

```sql
-- Per-group notification toggle
notifications_enabled BOOLEAN DEFAULT TRUE
```

### `user` (Global Preferences)

```sql
push_notifications_enabled BOOLEAN DEFAULT TRUE,
email_notifications_enabled BOOLEAN DEFAULT TRUE,
sms_notifications_enabled BOOLEAN DEFAULT FALSE
```

---

## Frontend Handling

### Token Registration (`NotificationProvider.tsx`)

```typescript
// 1. Request permissions
const { status } = await Notifications.requestPermissionsAsync();

// 2. Get Expo push token
const token = await Notifications.getExpoPushTokenAsync({
  projectId: process.env.EXPO_PUBLIC_PROJECT_ID
});

// 3. Register with backend
await trpcVanilla.notifications.registerToken.mutate({
  token: token.data,
  platform: Platform.OS,
  bundleId: Constants.expoConfig?.ios?.bundleIdentifier
});
```

### Notification Listeners

```typescript
// Foreground notifications
Notifications.addNotificationReceivedListener((notification) => {
  setLastNotification(notification);
  refreshUnreadCount();
});

// Background/tap handling
Notifications.addNotificationResponseReceivedListener((response) => {
  const { type, url, groupId, channelId } = response.notification.request.content.data;
  handleNotificationTap(type, { url, groupId, channelId });
});
```

### Deep Link Routing

| Type | Route |
|------|-------|
| `join_request_received` | `/(tabs)/admin` |
| `join_request_approved` | `/groups/{groupId}` |
| `new_message` | `/inbox/{channelId}` |
| `event_updated` | `/e/{shortId}?source=app` |
| `meeting_reminder` | `/e/{shortId}?source=app` |

---

## Current Pain Points

### 1. Scattered Logic

**Problem:** Notification sending is spread across 10+ files with no central service.

**Impact:**
- Hard to understand what notifications exist
- Easy to introduce inconsistencies
- Difficult to add new notification types

**Examples:**
- `lib/notifications.ts` → `notifyUser()`, `notifyCommunityAdmins()`
- `lib/expo.ts` → `sendPushNotification()`
- `webhooks/stream.ts` → Direct notification sending
- `routers/admin.ts` → Inline notification calls in async IIFEs

### 2. No Centralized Registry

**Problem:** No single source of truth for all notification types.

**Impact:**
- Can't easily see all notifications the system sends
- Hard to maintain consistency in messaging
- Difficult to add notification preferences per type

### 3. Limited Observability

**Problem:** Minimal logging and no metrics.

**Impact:**
- Hard to debug delivery failures
- No visibility into notification volume
- Can't track delivery rates or engagement

**Current Logging:**
```typescript
// Only console.log in mock mode
if (MOCK_MODE) {
  console.log('[Expo Push] MOCK MODE - Would send:', { ... });
}
// No logging in production!
```

### 4. No Automated Tests

**Problem:** Notification logic has no test coverage.

**Impact:**
- Regressions go undetected
- Refactoring is risky
- Hard to verify correct behavior

### 5. Async Fire-and-Forget Pattern

**Problem:** Notifications sent in async IIFEs without error tracking.

**Example:**
```typescript
// routers/admin.ts:362
(async () => {
  try {
    await notifyUser(ctx.db, userId, notification);
  } catch (error) {
    console.error('Failed to send notification:', error);
    // Error silently swallowed
  }
})();
```

**Impact:**
- No way to know if notifications failed
- No retry mechanism
- Silent failures

### 6. Mention vs Regular Logic Complexity

**Problem:** Complex logic to handle mentions separately from regular messages.

**Location:** `webhooks/stream.ts:256-353`

**Issues:**
- Mentioned users excluded from regular notifications manually
- Active watchers excluded via API call to Stream
- Easy to introduce bugs when modifying

---

## Recommendations for Consolidation

### 1. Create a Unified Notification Service

**Proposal:** Create a single `NotificationOrchestrator` class that handles all notification dispatch.

```typescript
// packages/notifications/src/orchestrator.ts

interface NotificationConfig {
  type: NotificationType;
  title: string | ((ctx: NotificationContext) => string);
  body: string | ((ctx: NotificationContext) => string);
  channels: ('push' | 'email' | 'inApp')[];
  data?: Record<string, unknown>;
}

const NOTIFICATION_REGISTRY: Record<NotificationType, NotificationConfig> = {
  new_message: {
    type: 'new_message',
    title: (ctx) => ctx.senderName,
    body: (ctx) => ctx.messagePreview,
    channels: ['push', 'inApp'],
    data: { type: 'new_message', channelId: '{{channelId}}' }
  },
  // ... all notification types defined here
};

class NotificationOrchestrator {
  async send(type: NotificationType, recipients: string[], context: NotificationContext) {
    const config = NOTIFICATION_REGISTRY[type];

    // Log intent
    this.logger.info('notification.dispatch', { type, recipientCount: recipients.length });

    // Filter by preferences
    const eligibleRecipients = await this.filterByPreferences(recipients, type);

    // Send via configured channels
    const results = await this.sendViaChannels(config.channels, eligibleRecipients, {
      title: typeof config.title === 'function' ? config.title(context) : config.title,
      body: typeof config.body === 'function' ? config.body(context) : config.body,
      data: this.interpolateData(config.data, context),
    });

    // Log results
    this.logger.info('notification.sent', { type, results });

    return results;
  }
}
```

**Benefits:**
- Single place to see all notification types
- Consistent handling across all triggers
- Easy to add new types
- Centralized logging

### 2. Add Notification Registry

**Proposal:** Define all notifications in one place with their configurations.

```typescript
// packages/notifications/src/registry.ts

export const NOTIFICATIONS = {
  // Chat notifications
  NEW_MESSAGE: 'new_message',
  MENTION: 'mention',

  // Group notifications
  JOIN_REQUEST_RECEIVED: 'join_request_received',
  JOIN_REQUEST_APPROVED: 'join_request_approved',
  GROUP_CREATION_REQUEST: 'group_creation_request',
  GROUP_CREATION_APPROVED: 'group_creation_approved',

  // Event notifications
  EVENT_CREATED: 'event_created',
  EVENT_UPDATED: 'event_updated',
  MEETING_REMINDER: 'meeting_reminder',

  // Moderation
  CONTENT_FLAGGED: 'content_flagged',
} as const;

export type NotificationType = typeof NOTIFICATIONS[keyof typeof NOTIFICATIONS];
```

### 3. Implement Structured Logging

**Proposal:** Add structured logging for all notification operations.

```typescript
// packages/notifications/src/logger.ts

interface NotificationLogEvent {
  event: 'notification.queued' | 'notification.sent' | 'notification.failed';
  type: NotificationType;
  recipientCount: number;
  channels: string[];
  duration?: number;
  error?: string;
  ticketIds?: string[];
}

class NotificationLogger {
  info(event: string, data: Record<string, unknown>) {
    console.log(JSON.stringify({
      timestamp: new Date().toISOString(),
      level: 'info',
      event,
      ...data,
    }));
  }

  error(event: string, error: Error, data: Record<string, unknown>) {
    console.error(JSON.stringify({
      timestamp: new Date().toISOString(),
      level: 'error',
      event,
      error: error.message,
      stack: error.stack,
      ...data,
    }));
  }
}
```

### 4. Add Notification Queue

**Proposal:** Replace fire-and-forget with a proper queue.

**Resolution:** Implemented using Convex scheduled functions (`ctx.scheduler.runAfter`) which provide:
- Automatic retries via Convex's built-in retry logic
- Visibility into job status via Convex dashboard
- No additional infrastructure required

See `apps/convex/functions/scheduledJobs.ts` and `apps/convex/crons.ts`.

### 5. Per-Type Notification Preferences

**Proposal:** Allow users to configure preferences per notification type.

```sql
CREATE TABLE user_notification_preference (
  user_id BIGINT NOT NULL REFERENCES "user"(id),
  notification_type VARCHAR(50) NOT NULL,
  push_enabled BOOLEAN DEFAULT TRUE,
  email_enabled BOOLEAN DEFAULT TRUE,

  PRIMARY KEY (user_id, notification_type)
);
```

### 6. Add Test Infrastructure

**Proposal:** Create testing utilities for notifications.

```typescript
// packages/notifications/src/testing.ts

class MockNotificationService {
  sentNotifications: SentNotification[] = [];

  async send(type: NotificationType, recipients: string[], context: unknown) {
    this.sentNotifications.push({ type, recipients, context, timestamp: new Date() });
    return { success: true };
  }

  clear() {
    this.sentNotifications = [];
  }

  expectNotification(type: NotificationType, recipient: string) {
    const found = this.sentNotifications.find(
      n => n.type === type && n.recipients.includes(recipient)
    );
    if (!found) throw new Error(`Expected ${type} notification to ${recipient}`);
    return found;
  }
}

// Usage in tests
describe('join request approval', () => {
  it('notifies the user', async () => {
    const mockNotifications = new MockNotificationService();
    // inject mock...

    await admin.pendingRequests.review({ requestId, approved: true });

    mockNotifications.expectNotification('join_request_approved', userId);
  });
});
```

---

## Implementation Roadmap

### Phase 1: Foundation (Low Risk)
1. Create `NotificationOrchestrator` class
2. Create `NOTIFICATION_REGISTRY` with all current types
3. Add structured logging
4. Update existing code to use new service (one trigger at a time)

### Phase 2: Observability (Low Risk)
1. Add Sentry integration for notification errors
2. Add metrics collection (notification counts, delivery rates)
3. Create notification admin dashboard

### Phase 3: Reliability (Medium Risk)
1. Migrate from fire-and-forget to job queue
2. Add retry logic for failed notifications
3. Add dead letter handling for permanently failed notifications

### Phase 4: User Control (Medium Risk)
1. Add per-type notification preferences
2. Update settings UI
3. Add notification history view in app

### Phase 5: Testing (Low Risk, High Value)
1. Add MockNotificationService
2. Write tests for all notification triggers
3. Add integration tests for end-to-end flow

---

## Appendix: File Reference

| File | Purpose |
|------|---------|
| `apps/api-trpc/src/lib/notifications.ts` | High-level functions: `notifyUser()`, `notifyCommunityAdmins()` |
| `apps/api-trpc/src/lib/expo.ts` | Expo SDK wrapper: `sendPushNotification()` |
| `apps/api-trpc/src/routers/notifications.ts` | tRPC routes for token management, preferences |
| `apps/api-trpc/src/webhooks/stream.ts` | Stream Chat webhook handler |
| `apps/api-trpc/src/routers/groups/join-requests.ts` | Join request flow with admin notification |
| `apps/api-trpc/src/routers/groups/creation-requests.ts` | Group creation flow with admin notification |
| `apps/api-trpc/src/routers/admin.ts` | Admin approval flows with user notifications |
| `apps/mobile/providers/NotificationProvider.tsx` | Mobile notification handling |
| `packages/notifications/src/service.ts` | Notification service class |
| `packages/notifications/src/channels/push.ts` | Push channel implementation |
| `packages/notifications/src/channels/email.ts` | Email channel implementation |

---

## Appendix: Environment Quick Reference

| Environment | Bundle ID | Channel Prefix | API URL |
|-------------|-----------|----------------|---------|
| Development | N/A (Expo Go) | `p_` | `localhost:3000` |
| Staging | `life.togather.staging` | `s_` | `api-staging.togather.nyc` |
| Production | `app.gatherful.mobile` | `p_` | `api.togather.nyc` |
