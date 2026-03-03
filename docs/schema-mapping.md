# Prisma to Convex Schema Mapping

This document describes the mapping between the Prisma/PostgreSQL schema and the Convex schema for the Togather application.

## Overview

The Convex schema is located at `/convex/schema.ts` and was generated from the Prisma schema at `/apps/api-trpc/src/prisma/schema.prisma`.

## General Conversion Rules

### Type Mappings

| Prisma Type | Convex Type | Notes |
|-------------|-------------|-------|
| `String` | `v.string()` | Direct mapping |
| `String?` | `v.optional(v.string())` | Optional fields |
| `Int` | `v.number()` | Convex uses float64 for all numbers |
| `BigInt` | `v.number()` or `v.string()` | Legacy IDs stored as strings |
| `Float` | `v.number()` | Direct mapping |
| `Boolean` | `v.boolean()` | Direct mapping |
| `DateTime` | `v.number()` | Unix timestamp in milliseconds |
| `Json` | `v.any()` or typed object | Depends on known structure |
| `@id @default(uuid())` | Convex `_id` | Auto-generated document ID |

### Naming Conventions

- **Table names**: `snake_case` -> `camelCase` (e.g., `group_member` -> `groupMembers`)
- **Field names**: `snake_case` -> `camelCase` (e.g., `created_at` -> `createdAt`)

### Relations

Prisma relations are converted to Convex ID references:

```prisma
// Prisma
model Group {
  community_id BigInt
  community    Community @relation(fields: [community_id])
}
```

```typescript
// Convex
groups: defineTable({
  communityId: v.id("communities"),
})
```

### Unique Constraints

Prisma's `@@unique` constraints become indexes in Convex. Uniqueness must be enforced in mutation code.

```prisma
// Prisma
@@unique([group_id, user_id])
```

```typescript
// Convex
.index("by_group_user", ["groupId", "userId"])
// Uniqueness enforced in mutations
```

### Legacy IDs

All tables include a `legacyId` field to store the original Prisma/PostgreSQL ID for migration compatibility:

```typescript
legacyId: v.optional(v.string()), // Original ID for migration
```

---

## Table Mappings

### 1. communities (was: `community`)

| Prisma Field | Convex Field | Type | Notes |
|--------------|--------------|------|-------|
| `id` (BigInt) | `legacyId` | `v.optional(v.string())` | Original ID stored for migration |
| `name` | `name` | `v.optional(v.string())` | |
| `logo` | `logo` | `v.optional(v.string())` | |
| `timezone` | `timezone` | `v.optional(v.string())` | |
| `created_at` | `createdAt` | `v.optional(v.number())` | Unix timestamp ms |
| `updated_at` | `updatedAt` | `v.optional(v.number())` | Unix timestamp ms |
| `homepage_url` | `homepageUrl` | `v.optional(v.string())` | |
| `city` | `city` | `v.optional(v.string())` | |
| `state` | `state` | `v.optional(v.string())` | |
| `zip_code` | `zipCode` | `v.optional(v.string())` | |
| `app_icon` | `appIcon` | `v.optional(v.string())` | |
| `address_line1` | `addressLine1` | `v.optional(v.string())` | |
| `address_line2` | `addressLine2` | `v.optional(v.string())` | |
| `subdomain` | `subdomain` | `v.optional(v.string())` | |
| `country` | `country` | `v.optional(v.string())` | |
| `primary_color` | `primaryColor` | `v.optional(v.string())` | Hex color e.g. #1E8449 |
| `secondary_color` | `secondaryColor` | `v.optional(v.string())` | Hex color e.g. #1E8449 |

**Indexes:**
- `by_legacyId` - For migration lookups
- `by_subdomain` - For subdomain-based routing

---

### 2. users (was: `user`)

| Prisma Field | Convex Field | Type | Notes |
|--------------|--------------|------|-------|
| `id` (BigInt) | `legacyId` | `v.optional(v.string())` | Original ID stored for migration |
| `password` | `password` | `v.optional(v.string())` | |
| `last_login` | `lastLogin` | `v.optional(v.number())` | Unix timestamp ms |
| `is_superuser` | `isSuperuser` | `v.optional(v.boolean())` | |
| `username` | `username` | `v.optional(v.string())` | |
| `first_name` | `firstName` | `v.optional(v.string())` | |
| `last_name` | `lastName` | `v.optional(v.string())` | |
| `is_staff` | `isStaff` | `v.optional(v.boolean())` | |
| `is_active` | `isActive` | `v.optional(v.boolean())` | |
| `date_joined` | `dateJoined` | `v.optional(v.number())` | Unix timestamp ms |
| `roles` | `roles` | `v.optional(v.number())` | SmallInt bitmask |
| `profile_photo` | `profilePhoto` | `v.optional(v.string())` | |
| `phone` | `phone` | `v.optional(v.string())` | |
| `email` | `email` | `v.optional(v.string())` | |
| `created_at` | `createdAt` | `v.optional(v.number())` | Unix timestamp ms |
| `updated_at` | `updatedAt` | `v.optional(v.number())` | Unix timestamp ms |
| `date_of_birth` | `dateOfBirth` | `v.optional(v.number())` | Unix timestamp ms (date only) |
| `phone_verified` | `phoneVerified` | `v.optional(v.boolean())` | |
| `associated_emails` | `associatedEmails` | `v.optional(v.array(v.string()))` | Was JSON array |
| `external_ids` | `externalIds` | `v.optional(v.any())` | Was JSON object |
| `timezone` | `timezone` | `v.optional(v.string())` | |
| `active_community_id` | `activeCommunityId` | `v.optional(v.id("communities"))` | Reference to communities |
| `push_notifications_enabled` | `pushNotificationsEnabled` | `v.optional(v.boolean())` | |
| `email_notifications_enabled` | `emailNotificationsEnabled` | `v.optional(v.boolean())` | |
| `sms_notifications_enabled` | `smsNotificationsEnabled` | `v.optional(v.boolean())` | |

**Indexes:**
- `by_legacyId` - For migration lookups
- `by_email` - For email-based auth/lookup
- `by_phone` - For phone-based auth/lookup
- `by_username` - For username-based lookup
- `by_activeCommunity` - For filtering users by community

---

### 3. userCommunities (was: `user_community`)

| Prisma Field | Convex Field | Type | Notes |
|--------------|--------------|------|-------|
| `id` (BigInt) | `legacyId` | `v.optional(v.string())` | Original ID stored for migration |
| `user_id` | `userId` | `v.id("users")` | Reference to users |
| `community_id` | `communityId` | `v.id("communities")` | Reference to communities |
| `roles` | `roles` | `v.optional(v.number())` | SmallInt bitmask |
| `created_at` | `createdAt` | `v.optional(v.number())` | Unix timestamp ms |
| `updated_at` | `updatedAt` | `v.optional(v.number())` | Unix timestamp ms |
| `community_anniversary` | `communityAnniversary` | `v.optional(v.number())` | Unix timestamp ms (date only) |
| `status` | `status` | `v.optional(v.number())` | SmallInt status code |

**Indexes:**
- `by_legacyId` - For migration lookups
- `by_user` - For finding user's communities
- `by_community` - For finding community's users
- `by_user_community` - For checking membership (enforces uniqueness)

---

### 4. groupTypes (was: `group_type`)

| Prisma Field | Convex Field | Type | Notes |
|--------------|--------------|------|-------|
| `id` (Int) | `legacyId` | `v.optional(v.string())` | Original ID stored for migration |
| `community_id` | `communityId` | `v.id("communities")` | Reference to communities |
| `name` | `name` | `v.string()` | Required |
| `slug` | `slug` | `v.string()` | Required |
| `description` | `description` | `v.optional(v.string())` | |
| `icon` | `icon` | `v.optional(v.string())` | |
| `is_active` | `isActive` | `v.boolean()` | Required |
| `created_at` | `createdAt` | `v.number()` | Unix timestamp ms |
| `display_order` | `displayOrder` | `v.number()` | Required |

**Indexes:**
- `by_legacyId` - For migration lookups
- `by_community` - For filtering types by community
- `by_community_slug` - For unique slug per community (enforces uniqueness)
- `by_community_active` - For filtering active types
- `by_slug` - For slug lookup

---

### 5. groups (was: `group`)

| Prisma Field | Convex Field | Type | Notes |
|--------------|--------------|------|-------|
| `id` (UUID) | `legacyId` | `v.optional(v.string())` | Original UUID stored for migration |
| `community_id` | `communityId` | `v.id("communities")` | Reference to communities |
| `group_type_id` | `groupTypeId` | `v.id("groupTypes")` | Reference to groupTypes |
| `name` | `name` | `v.string()` | Required |
| `description` | `description` | `v.optional(v.string())` | |
| `created_at` | `createdAt` | `v.number()` | Unix timestamp ms |
| `updated_at` | `updatedAt` | `v.number()` | Unix timestamp ms |
| `is_archived` | `isArchived` | `v.boolean()` | Required |
| `archived_at` | `archivedAt` | `v.optional(v.number())` | Unix timestamp ms |
| `address_line1` | `addressLine1` | `v.optional(v.string())` | |
| `address_line2` | `addressLine2` | `v.optional(v.string())` | |
| `city` | `city` | `v.optional(v.string())` | |
| `state` | `state` | `v.optional(v.string())` | |
| `zip_code` | `zipCode` | `v.optional(v.string())` | |
| `default_day` | `defaultDay` | `v.optional(v.number())` | 0-6 (Sunday-Saturday) |
| `default_start_time` | `defaultStartTime` | `v.optional(v.string())` | HH:MM format |
| `default_end_time` | `defaultEndTime` | `v.optional(v.string())` | HH:MM format |
| `default_meeting_link` | `defaultMeetingLink` | `v.optional(v.string())` | |
| `default_meeting_type` | `defaultMeetingType` | `v.optional(v.number())` | 1=In-Person, 2=Online |
| `is_on_break` | `isOnBreak` | `v.optional(v.boolean())` | |
| `break_until` | `breakUntil` | `v.optional(v.number())` | Unix timestamp ms (date only) |
| `preview` | `preview` | `v.optional(v.string())` | Image path |
| `external_chat_link` | `externalChatLink` | `v.optional(v.string())` | |
| `is_announcement_group` | `isAnnouncementGroup` | `v.optional(v.boolean())` | |
| `coordinates` | `coordinates` | `v.optional(v.object({...}))` | Structured object |

**Special Handling:**
- `default_start_time` and `default_end_time` were `DateTime @db.Time(6)` in Prisma. Stored as HH:MM strings in Convex.
- `break_until` was `DateTime @db.Date` in Prisma. Stored as Unix timestamp ms.
- `coordinates` was `Json` in Prisma. Now a typed object: `{ latitude: number, longitude: number }`.

**Indexes:**
- `by_legacyId` - For migration lookups
- `by_community` - For filtering groups by community
- `by_groupType` - For filtering by group type
- `by_community_type_archived` - For common query pattern
- `by_createdAt` - For sorting by creation date

---

### 6. groupMembers (was: `group_member`)

| Prisma Field | Convex Field | Type | Notes |
|--------------|--------------|------|-------|
| `id` (Int) | `legacyId` | `v.optional(v.string())` | Original ID stored for migration |
| `group_id` | `groupId` | `v.id("groups")` | Reference to groups |
| `user_id` | `userId` | `v.id("users")` | Reference to users |
| `role` | `role` | `v.string()` | 'leader', 'member', etc. |
| `joined_at` | `joinedAt` | `v.number()` | Unix timestamp ms |
| `left_at` | `leftAt` | `v.optional(v.number())` | Unix timestamp ms |
| `notifications_enabled` | `notificationsEnabled` | `v.boolean()` | Required |
| `request_status` | `requestStatus` | `v.optional(v.string())` | 'pending', 'approved', 'declined' |
| `requested_at` | `requestedAt` | `v.optional(v.number())` | Unix timestamp ms |
| `request_reviewed_at` | `requestReviewedAt` | `v.optional(v.number())` | Unix timestamp ms |
| `request_reviewed_by_id` | `requestReviewedById` | `v.optional(v.id("users"))` | Reference to users |

**Indexes:**
- `by_legacyId` - For migration lookups
- `by_group` - For finding group's members
- `by_user` - For finding user's groups
- `by_group_user` - For checking membership (enforces uniqueness)
- `by_requestStatus` - For filtering by request status
- `by_role` - For filtering by role

---

### 7. meetings (was: `meeting`)

| Prisma Field | Convex Field | Type | Notes |
|--------------|--------------|------|-------|
| `id` (UUID) | `legacyId` | `v.optional(v.string())` | Original UUID stored for migration |
| `group_id` | `groupId` | `v.id("groups")` | Reference to groups |
| `created_by_id` | `createdById` | `v.optional(v.id("users"))` | Reference to users |
| `title` | `title` | `v.optional(v.string())` | |
| `scheduled_at` | `scheduledAt` | `v.number()` | Unix timestamp ms |
| `actual_end` | `actualEnd` | `v.optional(v.number())` | Unix timestamp ms |
| `status` | `status` | `v.string()` | 'scheduled', 'completed', 'cancelled' |
| `cancellation_reason` | `cancellationReason` | `v.optional(v.string())` | |
| `meeting_type` | `meetingType` | `v.number()` | 1=In-Person, 2=Online |
| `meeting_link` | `meetingLink` | `v.optional(v.string())` | |
| `location_override` | `locationOverride` | `v.optional(v.string())` | |
| `note` | `note` | `v.optional(v.string())` | |
| `cover_image` | `coverImage` | `v.optional(v.string())` | |
| `created_at` | `createdAt` | `v.number()` | Unix timestamp ms |
| `rsvp_enabled` | `rsvpEnabled` | `v.optional(v.boolean())` | |
| `rsvp_options` | `rsvpOptions` | `v.optional(v.array(...))` | Typed array of options |
| `visibility` | `visibility` | `v.optional(v.string())` | 'group', 'community', 'public' |
| `public_slug` | `publicSlug` | `v.optional(v.string())` | Unique |
| `short_id` | `shortId` | `v.optional(v.string())` | Unique |
| `reminder_at` | `reminderAt` | `v.optional(v.number())` | Unix timestamp ms |
| `reminder_sent` | `reminderSent` | `v.optional(v.boolean())` | |
| `attendance_confirmation_at` | `attendanceConfirmationAt` | `v.optional(v.number())` | Unix timestamp ms |
| `attendance_confirmation_sent` | `attendanceConfirmationSent` | `v.optional(v.boolean())` | |

**Special Handling:**
- `rsvp_options` was `Json` in Prisma. Now typed as `v.array(v.object({ id: v.number(), label: v.string(), enabled: v.boolean() }))`.

**Indexes:**
- `by_legacyId` - For migration lookups
- `by_group` - For finding group's meetings
- `by_createdBy` - For finding user's created meetings
- `by_group_scheduledAt` - For sorted meeting lists
- `by_group_status` - For filtering by status
- `by_scheduledAt` - For time-based queries
- `by_publicSlug` - For public meeting lookup (unique)
- `by_shortId` - For short URL lookup (unique)
- `by_reminderAt_sent` - For reminder scheduling
- `by_attendanceConfirmation` - For attendance confirmation scheduling

---

### 8. meetingRsvps (was: `meeting_rsvp`)

| Prisma Field | Convex Field | Type | Notes |
|--------------|--------------|------|-------|
| `id` (UUID) | `legacyId` | `v.optional(v.string())` | Original UUID stored for migration |
| `meeting_id` | `meetingId` | `v.id("meetings")` | Reference to meetings |
| `user_id` | `userId` | `v.id("users")` | Reference to users |
| `rsvp_option_id` | `rsvpOptionId` | `v.number()` | References meeting.rsvpOptions.id |
| `created_at` | `createdAt` | `v.number()` | Unix timestamp ms |
| `updated_at` | `updatedAt` | `v.number()` | Unix timestamp ms |

**Indexes:**
- `by_legacyId` - For migration lookups
- `by_meeting` - For finding meeting's RSVPs
- `by_user` - For finding user's RSVPs
- `by_meeting_user` - For checking RSVP (enforces uniqueness)

---

### 9. meetingAttendances (was: `meeting_attendance`)

| Prisma Field | Convex Field | Type | Notes |
|--------------|--------------|------|-------|
| `id` (UUID) | `legacyId` | `v.optional(v.string())` | Original UUID stored for migration |
| `meeting_id` | `meetingId` | `v.id("meetings")` | Reference to meetings |
| `user_id` | `userId` | `v.id("users")` | Reference to users |
| `status` | `status` | `v.number()` | Attendance status code |
| `recorded_at` | `recordedAt` | `v.number()` | Unix timestamp ms |
| `recorded_by_id` | `recordedById` | `v.optional(v.id("users"))` | Reference to users |

**Indexes:**
- `by_legacyId` - For migration lookups
- `by_meeting` - For finding meeting's attendance
- `by_user` - For finding user's attendance records
- `by_meeting_user` - For checking attendance (enforces uniqueness)
- `by_meeting_status` - For filtering by status

---

### 10. meetingGuests (was: `meeting_guest`)

| Prisma Field | Convex Field | Type | Notes |
|--------------|--------------|------|-------|
| `id` (UUID) | `legacyId` | `v.optional(v.string())` | Original UUID stored for migration |
| `meeting_id` | `meetingId` | `v.id("meetings")` | Reference to meetings |
| `user_id` | `userId` | `v.optional(v.id("users"))` | Optional link to users |
| `recorded_by_id` | `recordedById` | `v.optional(v.id("users"))` | Reference to users |
| `first_name` | `firstName` | `v.optional(v.string())` | |
| `last_name` | `lastName` | `v.optional(v.string())` | |
| `phone_number` | `phoneNumber` | `v.optional(v.string())` | |
| `notes` | `notes` | `v.optional(v.string())` | |
| `recorded_at` | `recordedAt` | `v.number()` | Unix timestamp ms |

**Indexes:**
- `by_legacyId` - For migration lookups
- `by_meeting` - For finding meeting's guests
- `by_user` - For finding user's guest records
- `by_phoneNumber` - For phone lookup

---

### 11. notifications (was: `notification`)

| Prisma Field | Convex Field | Type | Notes |
|--------------|--------------|------|-------|
| `id` (UUID) | `legacyId` | `v.optional(v.string())` | Original UUID stored for migration |
| `user_id` | `userId` | `v.id("users")` | Reference to users |
| `community_id` | `communityId` | `v.optional(v.id("communities"))` | Reference to communities |
| `group_id` | `groupId` | `v.optional(v.id("groups"))` | Reference to groups |
| `notification_type` | `notificationType` | `v.string()` | |
| `title` | `title` | `v.string()` | Required |
| `body` | `body` | `v.string()` | Required |
| `data` | `data` | `v.any()` | JSON data |
| `status` | `status` | `v.string()` | 'pending', 'sent', 'failed' |
| `is_read` | `isRead` | `v.boolean()` | Required |
| `read_at` | `readAt` | `v.optional(v.number())` | Unix timestamp ms |
| `created_at` | `createdAt` | `v.number()` | Unix timestamp ms |
| `sent_at` | `sentAt` | `v.optional(v.number())` | Unix timestamp ms |
| `error_message` | `errorMessage` | `v.optional(v.string())` | |

**Indexes:**
- `by_legacyId` - For migration lookups
- `by_user` - For finding user's notifications
- `by_community` - For community-wide notifications
- `by_group` - For group notifications
- `by_user_read_created` - For notification lists with read filtering
- `by_user_type` - For filtering by notification type
- `by_type` - For type-based queries
- `by_createdAt` - For time-based queries

---

### 12. pushTokens (was: `push_token`)

| Prisma Field | Convex Field | Type | Notes |
|--------------|--------------|------|-------|
| `id` (UUID) | `legacyId` | `v.optional(v.string())` | Original UUID stored for migration |
| `user_id` | `userId` | `v.id("users")` | Reference to users |
| `token` | `token` | `v.string()` | Required |
| `platform` | `platform` | `v.string()` | 'ios', 'android', 'web' |
| `device_id` | `deviceId` | `v.optional(v.string())` | |
| `bundle_id` | `bundleId` | `v.optional(v.string())` | |
| `environment` | `environment` | `v.optional(v.string())` | 'development', 'production' |
| `is_active` | `isActive` | `v.boolean()` | Required |
| `created_at` | `createdAt` | `v.number()` | Unix timestamp ms |
| `updated_at` | `updatedAt` | `v.number()` | Unix timestamp ms |
| `last_used_at` | `lastUsedAt` | `v.number()` | Unix timestamp ms |

**Indexes:**
- `by_legacyId` - For migration lookups
- `by_user` - For finding user's tokens
- `by_token` - For token lookup
- `by_token_bundleId` - For unique token per bundle (enforces uniqueness)
- `by_user_active_environment` - For finding active tokens per environment

---

### 13. groupBotConfigs (was: `group_bot_config`)

| Prisma Field | Convex Field | Type | Notes |
|--------------|--------------|------|-------|
| `id` (UUID) | `legacyId` | `v.optional(v.string())` | Original UUID stored for migration |
| `group_id` | `groupId` | `v.id("groups")` | Reference to groups |
| `bot_type` | `botType` | `v.string()` | 'reminder', 'engagement', etc. |
| `enabled` | `enabled` | `v.boolean()` | Required |
| `state` | `state` | `v.any()` | JSON state |
| `config` | `config` | `v.any()` | JSON config |
| `next_scheduled_at` | `nextScheduledAt` | `v.optional(v.number())` | Unix timestamp ms |
| `created_at` | `createdAt` | `v.number()` | Unix timestamp ms |
| `updated_at` | `updatedAt` | `v.number()` | Unix timestamp ms |

**Indexes:**
- `by_legacyId` - For migration lookups
- `by_group` - For finding group's bot configs
- `by_group_botType` - For unique bot per group (enforces uniqueness)
- `by_botType_enabled` - For finding enabled bots by type
- `by_botType_enabled_scheduled` - For scheduling queries

---

### 14. groupCreationRequests (was: `group_creation_request`)

| Prisma Field | Convex Field | Type | Notes |
|--------------|--------------|------|-------|
| `id` (UUID) | `legacyId` | `v.optional(v.string())` | Original UUID stored for migration |
| `community_id` | `communityId` | `v.id("communities")` | Reference to communities |
| `requester_id` | `requesterId` | `v.id("users")` | Reference to users |
| `status` | `status` | `v.string()` | 'pending', 'approved', 'declined' |
| `name` | `name` | `v.string()` | Required |
| `description` | `description` | `v.optional(v.string())` | |
| `group_type_id` | `groupTypeId` | `v.id("groupTypes")` | Reference to groupTypes |
| `proposed_start_day` | `proposedStartDay` | `v.optional(v.number())` | 0-6 (Sunday-Saturday) |
| `max_capacity` | `maxCapacity` | `v.optional(v.number())` | |
| `address_line1` | `addressLine1` | `v.optional(v.string())` | |
| `address_line2` | `addressLine2` | `v.optional(v.string())` | |
| `city` | `city` | `v.optional(v.string())` | |
| `state` | `state` | `v.optional(v.string())` | |
| `zip_code` | `zipCode` | `v.optional(v.string())` | |
| `default_start_time` | `defaultStartTime` | `v.optional(v.string())` | HH:MM format |
| `default_end_time` | `defaultEndTime` | `v.optional(v.string())` | HH:MM format |
| `default_meeting_type` | `defaultMeetingType` | `v.optional(v.number())` | 1=In-Person, 2=Online |
| `default_meeting_link` | `defaultMeetingLink` | `v.optional(v.string())` | |
| `preview` | `preview` | `v.optional(v.string())` | Image path |
| `proposed_leader_ids` | `proposedLeaderIds` | `v.optional(v.array(v.string()))` | Array of user IDs |
| `reviewed_at` | `reviewedAt` | `v.optional(v.number())` | Unix timestamp ms |
| `reviewed_by_id` | `reviewedById` | `v.optional(v.id("users"))` | Reference to users |
| `decline_reason` | `declineReason` | `v.optional(v.string())` | |
| `created_group_id` | `createdGroupId` | `v.optional(v.id("groups"))` | Reference to groups |
| `created_at` | `createdAt` | `v.number()` | Unix timestamp ms |
| `updated_at` | `updatedAt` | `v.number()` | Unix timestamp ms |

**Special Handling:**
- `proposed_leader_ids` was `Json @default("[]")` in Prisma. Now typed as `v.array(v.string())`.

**Indexes:**
- `by_legacyId` - For migration lookups
- `by_community` - For finding community's requests
- `by_requester` - For finding user's requests
- `by_community_status` - For filtering by status within community
- `by_status` - For status-based queries

---

### 15. memberFollowups (was: `member_followup`)

| Prisma Field | Convex Field | Type | Notes |
|--------------|--------------|------|-------|
| `id` (UUID) | `legacyId` | `v.optional(v.string())` | Original UUID stored for migration |
| `group_member_id` | `groupMemberId` | `v.id("groupMembers")` | Reference to groupMembers |
| `created_by_id` | `createdById` | `v.id("users")` | Reference to users |
| `type` | `type` | `v.string()` | 'note', 'call', 'text', 'snooze', 'followed_up' |
| `content` | `content` | `v.optional(v.string())` | |
| `snooze_until` | `snoozeUntil` | `v.optional(v.number())` | Unix timestamp ms |
| `created_at` | `createdAt` | `v.number()` | Unix timestamp ms |

**Indexes:**
- `by_legacyId` - For migration lookups
- `by_groupMember` - For finding member's followups
- `by_groupMember_createdAt` - For sorted followup history
- `by_createdBy` - For finding user's followups
- `by_snoozeUntil` - For snooze scheduling

---

### 16. communityIntegrations (was: `integrations_communityintegration`)

| Prisma Field | Convex Field | Type | Notes |
|--------------|--------------|------|-------|
| `id` (Int) | `legacyId` | `v.optional(v.string())` | Original ID stored for migration |
| `community_id` | `communityId` | `v.id("communities")` | Reference to communities |
| `connected_by_id` | `connectedById` | `v.optional(v.id("users"))` | Reference to users |
| `integration_type` | `integrationType` | `v.string()` | 'planning_center', etc. |
| `credentials` | `credentials` | `v.any()` | Encrypted JSON |
| `config` | `config` | `v.any()` | JSON config |
| `status` | `status` | `v.string()` | 'active', 'inactive', 'error' |
| `last_sync_at` | `lastSyncAt` | `v.optional(v.number())` | Unix timestamp ms |
| `last_error` | `lastError` | `v.optional(v.string())` | |
| `created_at` | `createdAt` | `v.number()` | Unix timestamp ms |
| `updated_at` | `updatedAt` | `v.number()` | Unix timestamp ms |

**Indexes:**
- `by_legacyId` - For migration lookups
- `by_community` - For finding community's integrations
- `by_community_type` - For unique integration per type (enforces uniqueness)
- `by_status` - For status-based queries
- `by_connectedBy` - For finding user's integrations

---

### 17. attendanceConfirmationTokens (was: `attendance_confirmation_token`)

| Prisma Field | Convex Field | Type | Notes |
|--------------|--------------|------|-------|
| `id` (UUID) | `legacyId` | `v.optional(v.string())` | Original UUID stored for migration |
| `token` | `token` | `v.string()` | Required, unique |
| `user_id` | `userId` | `v.id("users")` | Reference to users |
| `meeting_id` | `meetingId` | `v.id("meetings")` | Reference to meetings |
| `expires_at` | `expiresAt` | `v.number()` | Unix timestamp ms |
| `used_at` | `usedAt` | `v.optional(v.number())` | Unix timestamp ms |
| `created_at` | `createdAt` | `v.number()` | Unix timestamp ms |

**Indexes:**
- `by_legacyId` - For migration lookups
- `by_token` - For token lookup (enforces uniqueness)
- `by_user_meeting` - For finding user's token for a meeting

---

### 18. legacyAccountClaims (was: `legacy_account_claim`)

| Prisma Field | Convex Field | Type | Notes |
|--------------|--------------|------|-------|
| `id` (BigInt) | `legacyId` | `v.optional(v.string())` | Original ID stored for migration |
| `name` | `name` | `v.string()` | Required |
| `community_name` | `communityName` | `v.string()` | Required |
| `phone` | `phone` | `v.string()` | Required |
| `possible_emails` | `possibleEmails` | `v.array(v.string())` | Was JSON |
| `status` | `status` | `v.string()` | 'pending', 'resolved', 'rejected' |
| `notes` | `notes` | `v.string()` | Required |
| `resolved_at` | `resolvedAt` | `v.optional(v.number())` | Unix timestamp ms |
| `created_at` | `createdAt` | `v.number()` | Unix timestamp ms |
| `updated_at` | `updatedAt` | `v.number()` | Unix timestamp ms |
| `resolved_by_id` | `resolvedById` | `v.optional(v.id("users"))` | Reference to users |

**Indexes:**
- `by_legacyId` - For migration lookups
- `by_status` - For status-based queries
- `by_resolvedBy` - For finding user's resolved claims

---

## Skipped Tables

The following tables were **not** converted as they are Django legacy infrastructure:

- `django_migrations` - Django migration tracking
- `django_content_type` - Django content type registry
- `django_site` - Django sites framework
- `auth_permission` - Django auth permissions
- `socialaccount_socialaccount` - Django allauth social accounts
- `token_blacklist_blacklistedtoken` - JWT token blacklist
- `token_blacklist_outstandingtoken` - Outstanding JWT tokens
- `integrations_integrationsynclog` - Integration sync logs (can be added if needed)

---

## Migration Notes

### Timestamps

All `DateTime` fields are stored as Unix timestamps in milliseconds (`v.number()`). When migrating data:

```typescript
// PostgreSQL DateTime → Convex number
const convexTimestamp = new Date(prismaDatetime).getTime();
```

### Time-only Fields

Time fields (`default_start_time`, `default_end_time`) are stored as HH:MM strings:

```typescript
// PostgreSQL Time → Convex string
const convexTime = prismaTime.toISOString().slice(11, 16); // "14:30"
```

### Date-only Fields

Date fields (`date_of_birth`, `break_until`, `community_anniversary`) are stored as Unix timestamps at midnight UTC:

```typescript
// PostgreSQL Date → Convex number
const convexDate = new Date(prismaDate + 'T00:00:00Z').getTime();
```

### JSON Fields

JSON fields are typed where possible:
- `coordinates` → `v.object({ latitude: v.number(), longitude: v.number() })`
- `rsvp_options` → `v.array(v.object({ id, label, enabled }))`
- `associated_emails` → `v.array(v.string())`
- `possible_emails` → `v.array(v.string())`
- `proposed_leader_ids` → `v.array(v.string())`

Other JSON fields use `v.any()` for flexibility.

### Unique Constraints

Prisma unique constraints are converted to indexes. Uniqueness must be enforced in Convex mutations:

```typescript
// In mutation code
const existing = await ctx.db
  .query("groupMembers")
  .withIndex("by_group_user", (q) => q.eq("groupId", groupId).eq("userId", userId))
  .first();

if (existing) {
  throw new Error("User is already a member of this group");
}
```

### Cascade Deletes

Prisma's `onDelete: Cascade` behavior must be implemented in Convex mutations. When deleting a parent record, manually delete related child records.
