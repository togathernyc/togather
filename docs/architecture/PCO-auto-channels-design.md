# Planning Center Services Auto Channels - Design Document

## Overview

This document describes the design for PCO-synced "Auto Channels" within Together groups. An Auto Channel is a custom channel whose **membership automatically rotates** based on who is scheduled to serve in Planning Center Services for the next upcoming service.

**Key Concept:** The channel itself is persistent, but members are added/removed on a rolling basis based on the PCO schedule.

## Background

### Current State

**What exists:**
1. **PCO OAuth Integration** (`apps/convex/functions/integrations.ts`)
   - OAuth flow with all scopes including `services`
   - Token refresh handling
   - People sync when users join Together

2. **Channel System** (`apps/convex/functions/messaging/channels.ts`)
   - Auto channels: `main` (General) and `leaders`
   - Custom channels with manual membership
   - Membership sync with group membership

3. **User Matching** (`apps/convex/functions/integrations.ts:836-968`)
   - Phone number matching via PCO phone_numbers endpoint
   - Email matching via PCO emails endpoint

**What's missing:**
- PCO Services API integration (teams, schedules, plan_people)
- Auto Channel configuration and management
- Scheduled membership rotation based on service dates
- Webhook handling for real-time schedule changes

### Terminology

| Term | Description |
|------|-------------|
| **Service Type** | Organizational unit in PCO (e.g., "Sunday Morning", "Youth Service") |
| **Team** | A team within a service type (e.g., "Production", "Worship", "Hospitality") |
| **Plan** | A specific service/event date (e.g., "January 26, 2025 Sunday") |
| **Plan Person** | Someone scheduled to serve on a specific plan |
| **Auto Channel** | A custom channel with PCO-synced rotating membership |
| **Rotation Window** | The days before/after a service when members are in the channel |

## Requirements

### Functional Requirements

1. **Auto Channel Setup**
   - Any custom channel can be converted to an Auto Channel
   - Leader selects PCO sync configuration:
     - **Service Type**: Which service (e.g., "Sunday Morning")
     - **Team Scope**:
       - All teams in the service
       - Single specific team
       - Multiple selected teams
   - Leader configures rotation timing:
     - **Add members X days before** service (default: 5 = Tuesday for Sunday)
     - **Remove members X days after** service (default: 1 = Monday after)

2. **Membership Rotation**
   - Channel membership automatically updates based on PCO schedule
   - Example weekly cycle for Sunday service with 5-day add / 1-day remove:
     ```
     Tuesday:  Add people scheduled for upcoming Sunday
     Sunday:   Service happens (people are in channel)
     Monday:   Remove those people
     Tuesday:  Add people scheduled for NEXT Sunday
     ```
   - PCO is the **source of truth** - if someone is unscheduled in PCO, they're removed

3. **Phone Number Matching**
   - Members matched via phone number between PCO and Together
   - If a PCO-scheduled person isn't in Together yet:
     - Store as "pending match"
     - Auto-add them when they join Together
   - Matching is per-community (same phone in different communities = different mappings)

4. **Real-time Updates**
   - Webhook-based sync for schedule changes in PCO
   - If someone is added/removed from PCO schedule mid-week, update channel immediately
   - Polling-based reconciliation as backup

### Non-Functional Requirements

1. **Data Integrity**: PCO is source of truth, but Together maintains local state for offline resilience
2. **Performance**: Support channels with 100+ rotating members
3. **Reliability**: Graceful degradation if PCO API is unavailable
4. **Auditability**: Log all membership changes for debugging

## Architecture

### Data Model Changes

```typescript
// New table: pcoAutoChannelConfigs
// Stores the PCO sync configuration for auto channels
pcoAutoChannelConfigs: defineTable({
  communityId: v.id("communities"),
  channelId: v.id("chatChannels"),      // The channel this config belongs to

  // PCO References
  pcoServiceTypeId: v.string(),         // PCO Service Type ID
  pcoServiceTypeName: v.string(),       // Cached name for display

  // Sync scope configuration
  syncScope: v.string(),                // "all_teams" | "single_team" | "multi_team"
  pcoTeamIds: v.optional(v.array(v.string())),   // For single/multi team modes
  pcoTeamNames: v.optional(v.array(v.string())), // Cached names for display

  // Rotation timing (membership add/remove)
  addMembersDaysBefore: v.number(),     // Days before service to ADD members (default: 5)
  removeMembersDaysAfter: v.number(),   // Days after service to REMOVE members (default: 1)

  // Current service tracking
  currentPlanId: v.optional(v.string()),     // The PCO plan currently active
  currentPlanDate: v.optional(v.number()),   // Date of current plan (Unix timestamp)
  nextPlanId: v.optional(v.string()),        // Next upcoming plan
  nextPlanDate: v.optional(v.number()),      // Date of next plan

  // Sync state
  lastSyncAt: v.optional(v.number()),
  lastSyncStatus: v.optional(v.string()),    // "success" | "error"
  lastSyncError: v.optional(v.string()),
  currentMemberCount: v.optional(v.number()), // How many are currently in channel via PCO

  // Metadata
  createdById: v.id("users"),
  createdAt: v.number(),
  updatedAt: v.number(),
  isActive: v.boolean(),
})
  .index("by_community", ["communityId"])
  .index("by_channel", ["channelId"])
  .index("by_pco_service_type", ["communityId", "pcoServiceTypeId"])
  .index("by_active", ["isActive"])
  .index("by_next_plan_date", ["nextPlanDate"]);

// New table: pcoMemberMappings
// Cache of PCO person ID to Together user ID mappings (per community)
pcoMemberMappings: defineTable({
  communityId: v.id("communities"),
  pcoPersonId: v.string(),              // Planning Center person ID
  userId: v.optional(v.id("users")),    // Together user ID (null if not yet in Together)

  // Cached PCO data for matching
  pcoPhone: v.optional(v.string()),     // Normalized phone from PCO
  pcoEmail: v.optional(v.string()),     // Normalized email from PCO
  pcoFirstName: v.optional(v.string()),
  pcoLastName: v.optional(v.string()),

  // Match state
  matchStatus: v.string(),              // "matched" | "pending" | "no_contact_info"
  matchedAt: v.optional(v.number()),
  matchedBy: v.optional(v.string()),    // "phone" | "email" | "manual"

  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_community", ["communityId"])
  .index("by_pco_person", ["communityId", "pcoPersonId"])
  .index("by_user", ["userId"])
  .index("by_pco_phone", ["communityId", "pcoPhone"])
  .index("by_pco_email", ["communityId", "pcoEmail"])
  .index("by_match_status", ["communityId", "matchStatus"]);

// New table: pcoChannelMemberships
// Tracks which channel members were added via PCO sync (vs manually)
pcoChannelMemberships: defineTable({
  channelId: v.id("chatChannels"),
  userId: v.id("users"),

  // PCO source tracking
  pcoPersonId: v.string(),              // The PCO person ID
  pcoPlanId: v.string(),                // Which plan they were scheduled for
  pcoPlanDate: v.number(),              // The service date

  // Timing
  addedAt: v.number(),                  // When they were added to channel
  scheduledRemovalAt: v.number(),       // When they should be removed
  removedAt: v.optional(v.number()),    // When they were actually removed (null if still active)

  // State
  isActive: v.boolean(),                // Currently in the channel
})
  .index("by_channel", ["channelId"])
  .index("by_channel_user", ["channelId", "userId"])
  .index("by_channel_active", ["channelId", "isActive"])
  .index("by_scheduled_removal", ["scheduledRemovalAt", "isActive"])
  .index("by_pco_plan", ["pcoPlanId"]);

// Extend chatChannels with auto channel flag
chatChannels: {
  // ... existing fields ...

  // Auto channel configuration (new fields)
  isAutoChannel: v.optional(v.boolean()),     // True if this is a PCO-synced auto channel
  autoChannelType: v.optional(v.string()),    // "pco_services" (future: other types)
}
```

### API Endpoints

```typescript
// PCO Services Discovery
pcoServices.getServiceTypes(token, communityId)
  → { serviceTypes: [{ id, name }] }

pcoServices.getTeamsForServiceType(token, communityId, serviceTypeId)
  → { teams: [{ id, name, positions: [...] }] }

pcoServices.getUpcomingPlans(token, communityId, serviceTypeId, limit?)
  → { plans: [{ id, title, date }] }

pcoServices.getPlanTeamMembers(token, communityId, serviceTypeId, planId, teamIds?)
  → { members: [{ pcoPersonId, name, phone, email, teamId }] }

// Auto Channel Configuration
pcoServices.createAutoChannelConfig(token, {
  channelId,
  pcoServiceTypeId,
  syncScope,           // "all_teams" | "single_team" | "multi_team"
  pcoTeamIds?,         // Required if syncScope != "all_teams"
  addMembersDaysBefore,
  removeMembersDaysAfter,
})

pcoServices.updateAutoChannelConfig(token, channelId, updates)

pcoServices.removeAutoChannelConfig(token, channelId)
  → Converts back to manual channel

pcoServices.getAutoChannelConfig(token, channelId)
  → { config, currentPlan, pendingMatches }

// Sync Operations
pcoServices.triggerChannelSync(token, channelId)
  → Manually trigger membership sync

pcoServices.getChannelSyncStatus(token, channelId)
  → { lastSyncAt, status, memberCount, pendingMatches }

// Webhook Handler (HTTP endpoint)
POST /api/webhooks/planning-center
  → Process PCO webhook events for schedule changes
```

### Sync Flows

#### Flow 1: Auto Channel Setup

```
┌─────────────────────────────────────────────────────────────────────┐
│                     AUTO CHANNEL SETUP FLOW                          │
└─────────────────────────────────────────────────────────────────────┘

1. Leader creates a custom channel (e.g., "Manhattan Sunday")
   OR opens settings on an existing custom channel
                    │
                    ▼
2. Leader clicks "Make this an Auto Channel"
                    │
                    ▼
3. Fetch PCO Service Types
   GET /services/v2/service_types
                    │
                    ▼
4. Leader selects Service Type (e.g., "Sunday Morning")
                    │
                    ▼
5. Fetch Teams for Service Type
   GET /services/v2/service_types/{id}/teams
                    │
                    ▼
6. Leader chooses sync scope:
   ┌─────────────────────────────────────────────────────┐
   │ ○ All teams in this service                         │
   │ ○ Single Team: [Dropdown to select]                 │
   │ ○ Multiple Teams: [Checkboxes to select]            │
   └─────────────────────────────────────────────────────┘
                    │
                    ▼
7. Leader configures rotation timing:
   ┌─────────────────────────────────────────────────────┐
   │ Add members: [ 5 ] days before service              │
   │ Remove members: [ 1 ] day after service             │
   │                                                     │
   │ Example: For Sunday service, members will be added  │
   │ on Tuesday and removed on Monday.                   │
   └─────────────────────────────────────────────────────┘
                    │
                    ▼
8. Save pcoAutoChannelConfig record
   Update chatChannel: isAutoChannel=true, autoChannelType="pco_services"
                    │
                    ▼
9. Trigger initial sync (background action)
   ┌─────────────────────────────────────────────────────┐
   │ a. Fetch upcoming plans from PCO                    │
   │ b. Find the next plan within "add days before"      │
   │ c. Fetch team members scheduled for that plan       │
   │ d. Match members to Together users (phone/email)    │
   │ e. Add matched users to channel                     │
   │ f. Store unmatched as "pending" in pcoMemberMappings│
   │ g. Create pcoChannelMemberships for tracking        │
   └─────────────────────────────────────────────────────┘
```

#### Flow 2: Membership Rotation (Scheduled Job)

```
┌─────────────────────────────────────────────────────────────────────┐
│                  MEMBERSHIP ROTATION FLOW                            │
│                 (Runs daily, e.g., midnight)                         │
└─────────────────────────────────────────────────────────────────────┘

For each active pcoAutoChannelConfig:

1. REMOVE phase: Check for members to remove
   ┌─────────────────────────────────────────────────────┐
   │ Query pcoChannelMemberships WHERE:                  │
   │   - channelId = this channel                        │
   │   - isActive = true                                 │
   │   - scheduledRemovalAt <= now                       │
   │                                                     │
   │ For each member to remove:                          │
   │   a. Remove from chatChannelMembers                 │
   │   b. Update pcoChannelMemberships:                  │
   │      isActive=false, removedAt=now                  │
   │   c. (Optional) Post "Thanks for serving!"          │
   └─────────────────────────────────────────────────────┘
                    │
                    ▼
2. ADD phase: Check for new service to populate
   ┌─────────────────────────────────────────────────────┐
   │ Calculate: shouldAddForDate = now + addDaysBefore   │
   │                                                     │
   │ Fetch next plan from PCO:                           │
   │   GET /services/v2/service_types/{id}/plans?future  │
   │   Find plan where: plan.date <= shouldAddForDate    │
   │                    AND plan.id != currentPlanId     │
   │                                                     │
   │ If new plan found:                                  │
   │   a. Fetch team members for this plan               │
   │   b. For each scheduled team member:                │
   │      - Match to Together user (phone/email)         │
   │      - If matched AND not already in channel:       │
   │        → Add to chatChannelMembers                  │
   │        → Create pcoChannelMemberships record        │
   │      - If not matched:                              │
   │        → Store in pcoMemberMappings as "pending"    │
   │   c. Update config: currentPlanId, currentPlanDate  │
   └─────────────────────────────────────────────────────┘
                    │
                    ▼
3. Update sync status
   ┌─────────────────────────────────────────────────────┐
   │ Update pcoAutoChannelConfig:                        │
   │   - lastSyncAt = now                                │
   │   - lastSyncStatus = "success" | "error"            │
   │   - currentMemberCount = count of active members    │
   └─────────────────────────────────────────────────────┘

EXAMPLE TIMELINE (Sunday service, 5-day add, 1-day remove):
┌────────────────────────────────────────────────────────┐
│ Week 1:                                                │
│ Tue Jan 21: ADD members scheduled for Jan 26 service   │
│ Sun Jan 26: Service happens                            │
│ Mon Jan 27: REMOVE Jan 26 members                      │
│                                                        │
│ Week 2:                                                │
│ Tue Jan 28: ADD members scheduled for Feb 2 service    │
│ Sun Feb 2:  Service happens                            │
│ Mon Feb 3:  REMOVE Feb 2 members                       │
└────────────────────────────────────────────────────────┘
```

#### Flow 3: New User Joins Together

```
┌─────────────────────────────────────────────────────────────────────┐
│              NEW USER JOINS TOGETHER FLOW                            │
└─────────────────────────────────────────────────────────────────────┘

Trigger: User joins community

1. User registers/joins community with phone number
                    │
                    ▼
2. Check pcoMemberMappings for this phone/email
   SELECT * FROM pcoMemberMappings
   WHERE communityId = ?
     AND (pcoPhone = ? OR pcoEmail = ?)
     AND matchStatus = 'pending'
                    │
           ┌───────┴───────┐
           ▼               ▼
       [Found]        [Not Found]
           │               │
           ▼               ▼
3a. Update mapping        Done (user not
    with userId           scheduled in PCO)
    matchStatus='matched'
           │
           ▼
4. Find all active pcoAutoChannelConfigs where this
   PCO person is scheduled for the current plan
           │
           ▼
5. For each matching auto channel:
   ┌─────────────────────────────────────────────────────┐
   │ a. Check if within current rotation window          │
   │ b. If yes:                                          │
   │    - Add user to chatChannelMembers                 │
   │    - Create pcoChannelMemberships record            │
   │    - Set scheduledRemovalAt based on plan date      │
   └─────────────────────────────────────────────────────┘
```

#### Flow 4: Webhook - Schedule Change in PCO

```
┌─────────────────────────────────────────────────────────────────────┐
│              PCO SCHEDULE CHANGE WEBHOOK                             │
└─────────────────────────────────────────────────────────────────────┘

Trigger: Webhook from PCO (plan_person.created/destroyed)

1. Receive webhook payload
   ┌─────────────────────────────────────────────────────┐
   │ {                                                   │
   │   "data": { "type": "PlanPerson", ... },            │
   │   "meta": { "event": "plan_person.created" }        │
   │ }                                                   │
   └─────────────────────────────────────────────────────┘
                    │
                    ▼
2. Find affected auto channels
   ┌─────────────────────────────────────────────────────┐
   │ Query pcoAutoChannelConfigs WHERE:                  │
   │   - pcoServiceTypeId matches webhook's service type │
   │   - Team matches (if scope is single/multi team)    │
   │   - currentPlanId matches webhook's plan ID         │
   └─────────────────────────────────────────────────────┘
                    │
                    ▼
3. Process based on event type:

   plan_person.created (someone scheduled):
   ┌─────────────────────────────────────────────────────┐
   │ a. Match PCO person to Together user                │
   │ b. If matched AND within rotation window:           │
   │    - Add to channel immediately                     │
   │    - Create pcoChannelMemberships record            │
   │ c. If not matched:                                  │
   │    - Store as "pending" in pcoMemberMappings        │
   └─────────────────────────────────────────────────────┘

   plan_person.destroyed (someone unscheduled):
   ┌─────────────────────────────────────────────────────┐
   │ a. Find pcoChannelMemberships for this person/plan  │
   │ b. Remove from channel immediately                  │
   │ c. Update record: isActive=false, removedAt=now     │
   └─────────────────────────────────────────────────────┘
```

### Webhook Integration

```
┌─────────────────────────────────────────────────────────────────────┐
│                    WEBHOOK HANDLING                                  │
└─────────────────────────────────────────────────────────────────────┘

Endpoint: POST /api/webhooks/planning-center

Subscribed Events:
- services.v2.events.plan_person.created    → Schedule add
- services.v2.events.plan_person.updated    → Status change (C/U/D)
- services.v2.events.plan_person.destroyed  → Schedule remove
- services.v2.events.team.created           → New team
- services.v2.events.team.updated           → Team rename
- services.v2.events.team.destroyed         → Team deleted

Handler:
1. Verify webhook signature (PCO-provided)
2. Parse event type and payload
3. Find affected pcoServiceConfig(s)
4. Process based on event type:

   plan_person.created:
   ┌─────────────────────────────────────────────────────┐
   │ a. Get person details (phone, email)               │
   │ b. Match to Together user                           │
   │ c. If matched: Add to service channel               │
   │ d. If not: Store in pcoMemberMappings as pending    │
   └─────────────────────────────────────────────────────┘

   plan_person.destroyed:
   ┌─────────────────────────────────────────────────────┐
   │ a. Find the service channel for this plan          │
   │ b. Remove user from channel                         │
   │ c. (Only remove from group if removed from ALL     │
   │     teams, not just this plan)                      │
   └─────────────────────────────────────────────────────┘
```

## UI/UX Design

### Creating an Auto Channel

When creating a new custom channel OR editing an existing custom channel:

```
┌─────────────────────────────────────────────────────────────────────┐
│  Create Channel                                               [X]   │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  CHANNEL NAME                                                       │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │ Manhattan Sunday                                             │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  CHANNEL TYPE                                                       │
│                                                                     │
│  ○ Manual                                                           │
│    You control who is in this channel                               │
│                                                                     │
│  ● Auto (Planning Center)                                           │
│    Members automatically rotate based on PCO schedule               │
│                                                                     │
│  ─────────────────────────────────────────────────────────────────  │
│                                                                     │
│  PCO SYNC SETTINGS                                                  │
│                                                                     │
│  SERVICE TYPE                                                       │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │ Sunday Morning                                            ▼ │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  TEAMS TO INCLUDE                                                   │
│                                                                     │
│  ○ All teams in this service                                        │
│                                                                     │
│  ● Select specific teams                                            │
│    ┌─────────────────────────────────────────────────────────────┐ │
│    │ ☑ Production                                                │ │
│    │ ☐ Worship                                                   │ │
│    │ ☐ Hospitality                                               │ │
│    │ ☐ Kids Ministry                                             │ │
│    └─────────────────────────────────────────────────────────────┘ │
│                                                                     │
│  ROTATION TIMING                                                    │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │ Add members: [ 5 ] days before service                       │   │
│  │ Remove members: [ 1 ] day after service                      │   │
│  │                                                              │   │
│  │ ℹ For Sunday services, this means members are added          │   │
│  │   Tuesday and removed Monday.                                │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                      Create Channel                          │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### Channel Info - Auto Channel Status

When viewing an auto channel's info/settings:

```
┌─────────────────────────────────────────────────────────────────────┐
│  Manhattan Sunday                                             [X]   │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  🔄 AUTO CHANNEL                                                    │
│  Membership synced with Planning Center Services                    │
│                                                                     │
│  ─────────────────────────────────────────────────────────────────  │
│                                                                     │
│  CURRENT SERVICE                                                    │
│  Sunday, January 26, 2025                                           │
│                                                                     │
│  SYNC STATUS                                                        │
│  ✓ Synced 2 hours ago                                               │
│                                                                     │
│  MEMBERS THIS WEEK                                                  │
│  12 members (3 pending)                                             │
│                                                                     │
│  [Sync Now]  [Edit Settings]                                        │
│                                                                     │
│  ─────────────────────────────────────────────────────────────────  │
│                                                                     │
│  CONFIGURATION                                                      │
│  Service: Sunday Morning                                            │
│  Teams: Production                                                  │
│  Add: 5 days before  •  Remove: 1 day after                         │
│                                                                     │
│  ─────────────────────────────────────────────────────────────────  │
│                                                                     │
│  PENDING MATCHES                                                    │
│  These people are scheduled but not in Together yet:                │
│                                                                     │
│  • John Smith (555-1234)                                            │
│  • Jane Doe (no phone on file)                                      │
│                                                                     │
│  They'll be added automatically when they join.                     │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### Channel List - Auto Channel Indicator

In the group's channel list, auto channels show an indicator:

```
┌─────────────────────────────────────────────────────────────────────┐
│  CHANNELS                                                           │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  # General                                            12 members    │
│  # Leaders                                  🔒         3 members    │
│  # Manhattan Sunday                         🔄        12 members    │
│  # Brooklyn Sunday                          🔄         8 members    │
│  # Director Chat                                       5 members    │
│                                                                     │
│  + Add Channel                                                      │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘

🔄 = Auto channel (PCO synced)
🔒 = Leaders only
```

## Implementation Plan

### Phase 1: Schema & Data Model
- [ ] Add `pcoAutoChannelConfigs` table to schema.ts
- [ ] Add `pcoMemberMappings` table to schema.ts
- [ ] Add `pcoChannelMemberships` table to schema.ts
- [ ] Extend `chatChannels` with `isAutoChannel` and `autoChannelType` fields
- [ ] Add required indexes
- [ ] Write unit tests for data model

### Phase 2: PCO Services API Integration
- [ ] Create `apps/convex/lib/pcoServicesApi.ts` with API helpers
- [ ] Implement service type fetching
- [ ] Implement team fetching for a service type
- [ ] Implement upcoming plans fetching
- [ ] Implement plan team members fetching
- [ ] Get person contact info (phone/email) for matching
- [ ] Add rate limiting and retry logic
- [ ] Write integration tests

### Phase 3: Auto Channel Configuration
- [ ] Create `apps/convex/functions/pcoServices/` directory
- [ ] Implement `createAutoChannelConfig` mutation
- [ ] Implement `updateAutoChannelConfig` mutation
- [ ] Implement `removeAutoChannelConfig` mutation
- [ ] Implement `getAutoChannelConfig` query
- [ ] Update channel creation flow to support auto channel option
- [ ] Write unit tests

### Phase 4: Phone/Email Matching
- [ ] Create phone normalization utility
- [ ] Implement `findTogetherUserByPcoPerson` function
- [ ] Implement `createOrUpdateMemberMapping` function
- [ ] Implement `getPendingMappingsForChannel` query
- [ ] Write unit tests for various phone formats

### Phase 5: Membership Rotation Engine
- [ ] Implement `addMembersForPlan` function
- [ ] Implement `removeMembersAfterPlan` function
- [ ] Create daily scheduled job for rotation
- [ ] Implement `triggerChannelSync` manual action
- [ ] Handle edge cases (member in multiple plans, etc.)
- [ ] Write unit tests

### Phase 6: New User Auto-Add
- [ ] Hook into community join flow
- [ ] Check `pcoMemberMappings` for pending matches
- [ ] Add matched user to appropriate auto channels
- [ ] Write integration tests

### Phase 7: Webhook Handler
- [ ] Create HTTP endpoint for PCO webhooks
- [ ] Implement signature verification
- [ ] Handle `plan_person.created` events
- [ ] Handle `plan_person.destroyed` events
- [ ] Add idempotency handling
- [ ] Write integration tests

### Phase 8: Frontend UI
- [ ] Update channel creation modal with auto channel option
- [ ] Create service type/team selector components
- [ ] Create auto channel status view
- [ ] Add pending matches section
- [ ] Add sync trigger button
- [ ] Show auto channel indicator in channel list
- [ ] Write component tests

### Phase 9: Testing & QA
- [ ] End-to-end testing of full rotation cycle
- [ ] Load testing (100+ members rotating)
- [ ] Edge case testing (no phone, mid-week schedule changes)
- [ ] Documentation updates

## Risk Mitigation

| Risk | Mitigation |
|------|------------|
| PCO API rate limits (100 req/20s) | Implement request queuing, batch operations |
| Phone number format mismatches | Normalize all phones to digits-only, support multiple formats |
| User not in Together yet | Store as "pending", auto-match on join |
| Webhook delivery failures | Polling-based reconciliation as backup |
| Stale data | Daily full sync reconciliation |
| Large teams (100+) | Pagination, background processing |

## Design Decisions

1. **Manual additions to auto channels**: Leaders CAN manually add members to auto channels.
   - Manual members stay until manually removed (not affected by rotation)
   - PCO-synced members are tracked separately via `pcoChannelMemberships`

2. **Member overlap**: Keep it simple - **remove and re-add**.
   - On removal day: remove everyone who was added for the previous service
   - On add day: add everyone scheduled for the upcoming service
   - If someone is in both services, they'll briefly leave and rejoin - that's fine
   - No special logic needed to check for overlap

3. **Position-based filtering**: Defer to v2 - keep initial scope to team-level

4. **Multiple services per week**: Configure based on primary service day
   - One rotation window per auto channel
   - If needed, create separate auto channels for different service days

5. **Channel conversion**: Existing manual custom channels can be converted to auto
   - Existing manual members stay (not tracked as PCO-managed)
   - New PCO-synced members tracked via `pcoChannelMemberships`

## Appendix

### PCO Services API Reference

Key endpoints used:

```
GET /services/v2/service_types
GET /services/v2/service_types/{id}/teams
GET /services/v2/service_types/{id}/teams/{team_id}/person_team_position_assignments?include=person
GET /services/v2/service_types/{id}/plans?filter=future&order=sort_date
GET /services/v2/service_types/{id}/plans/{plan_id}/team_members?include=person,team
```

### Phone Number Normalization

```typescript
function normalizePhone(phone: string): string {
  // Remove all non-digits
  const digits = phone.replace(/\D/g, "");

  // If 10 digits, assume US and add country code
  if (digits.length === 10) {
    return "1" + digits;
  }

  // If 11 digits starting with 1, it's already normalized
  if (digits.length === 11 && digits.startsWith("1")) {
    return digits;
  }

  // Return as-is for international numbers
  return digits;
}
```

### Webhook Event Payloads

```json
// services.v2.events.plan_person.created
{
  "data": {
    "type": "PlanPerson",
    "id": "123456",
    "attributes": {
      "status": "C",
      "name": "John Doe"
    },
    "relationships": {
      "person": { "data": { "type": "Person", "id": "789" } },
      "plan": { "data": { "type": "Plan", "id": "456" } },
      "team": { "data": { "type": "Team", "id": "321" } }
    }
  },
  "meta": {
    "event": "services.v2.events.plan_person.created"
  }
}
```
