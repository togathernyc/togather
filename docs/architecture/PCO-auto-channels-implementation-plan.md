# PCO Auto Channels - Implementation Plan

This document provides a detailed, parallelizable implementation plan for the PCO Auto Channels feature. Tasks are organized to allow multiple agents to work simultaneously with clear dependencies.

**Key Concept:** An Auto Channel is a custom channel whose membership automatically rotates based on who is scheduled to serve in Planning Center Services. The channel persists, but members are added X days before a service and removed X days after.

## Schema Overview (Implemented)

The implementation uses a generic, extensible schema that supports multiple integration types:

### `autoChannelConfigs` Table
```typescript
// Generic configuration for auto channels from any integration
autoChannelConfigs: defineTable({
  communityId: v.id("communities"),
  channelId: v.id("chatChannels"),
  integrationType: v.string(), // "pco_services" | "elvanto" | "ccb" | etc.

  config: v.object({
    // PCO Services fields
    serviceTypeId: v.optional(v.string()),
    serviceTypeName: v.optional(v.string()),
    syncScope: v.optional(v.string()), // "all_teams" | "single_team" | "multi_team"
    teamIds: v.optional(v.array(v.string())),
    teamNames: v.optional(v.array(v.string())),

    // Generic timing (all integrations use these)
    addMembersDaysBefore: v.number(),
    removeMembersDaysAfter: v.number(),
  }),

  // Sync state
  currentEventId: v.optional(v.string()), // PCO Plan ID, etc.
  currentEventDate: v.optional(v.number()),
  lastSyncAt: v.optional(v.number()),
  lastSyncStatus: v.optional(v.string()), // "success" | "error"
  lastSyncError: v.optional(v.string()),
  isActive: v.boolean(),
  createdAt: v.number(),
  updatedAt: v.number(),
})
```

### Extended `chatChannels.channelType`
```typescript
channelType: v.string(), // "main" | "leaders" | "dm" | "custom" | "pco_services"
```

### Extended `chatChannelMembers`
```typescript
// Auto-sync tracking fields
syncSource: v.optional(v.string()),        // "pco_services" | null (manual)
syncEventId: v.optional(v.string()),       // External event/plan ID
scheduledRemovalAt: v.optional(v.number()), // Unix timestamp ms for auto-removal
```

### User Mapping
Uses existing `userCommunities.externalIds.planningCenterId` for PCO person ID mapping - no separate mapping table needed.

---

## Task Structure

Tasks are organized by:
- **Track**: Independent workstreams that can run in parallel
- **Phase**: Sequential stages within a track
- **Task**: Individual work items with dependencies

## Tracks Overview

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                        IMPLEMENTATION TRACKS                                  │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  TRACK A: Schema & Data Layer ✅ COMPLETED ──────────────────────────────▶  │
│  └─ A1: Schema → A2: Types → A3: Tests                                       │
│                                                                              │
│  TRACK B: PCO Services API ✅ COMPLETED ─────────────────────────────────▶  │
│  └─ B1: API Client → B2: Service Types → B3: Plans & Members → B4: Tests    │
│                                                                              │
│  TRACK C: Membership Rotation Engine ✅ COMPLETED ───────────────────────▶  │
│  └─ C1: Matching → C2: Add/Remove → C3: Scheduler → C4: New User → C5: Tests │
│                                                                              │
│  TRACK D: Webhook Handler ⏳ OPTIONAL (Not needed for MVP) ──────────────▶  │
│  └─ D1: Endpoint → D2: Event Handlers → D3: Tests                           │
│                                                                              │
│  TRACK E: Frontend UI ⏳ NEEDS INTEGRATION ──────────────────────────────▶  │
│  └─ E1: Channel Setup → E2: Status View → E3: Pending Matches → E4: Tests   │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

## Track A: Schema & Data Layer ✅ COMPLETED

### A1: Schema Definition ✅
**Priority**: P0 (Blocks everything)
**Dependencies**: None

- [x] **A1.1** Add `autoChannelConfigs` table to schema.ts
  - Generic config supporting multiple integration types
  - Location: `apps/convex/schema.ts` (lines 602-636)

- [x] **A1.2** User mapping via `userCommunities.externalIds.planningCenterId`
  - Uses existing table, no separate mapping table needed

- [x] **A1.3** Extend `chatChannelMembers` with sync tracking fields
  - `syncSource`, `syncEventId`, `scheduledRemovalAt`
  - Index: `by_scheduled_removal` for efficient cleanup queries

- [x] **A1.4** Extend `chatChannels.channelType` enum
  - Added `"pco_services"` channel type

- [x] **A1.5** Schema compiles and deploys successfully

### A2: Type Definitions ✅
**Priority**: P0
**Dependencies**: A1

- [x] **A2.1** PCO API response types in `apps/convex/lib/pcoServicesApi.ts`
  - `PcoServiceTypesResponse`, `PcoTeamsResponse`, `PcoPlansResponse`
  - `PcoTeamMembersResponse`, `PcoPersonResponse`

- [x] **A2.2** Sync-related types
  - AutoChannelConfig interface in frontend component
  - Type safety via Convex validators

### A3: Data Layer Tests
**Priority**: P0
**Dependencies**: A2

- [ ] **A3.1** Create `apps/convex/__tests__/pco/schema.test.ts`
  - Test autoChannelConfigs CRUD
  - Test chatChannelMembers sync fields

- [ ] **A3.2** Create test fixtures
  ```typescript
  // apps/convex/__tests__/fixtures/pcoFixtures.ts
  export const mockAutoChannelConfig = { ... };
  export const mockPlanPerson = { ... };
  ```

---

## Track B: PCO Services API Integration ✅ COMPLETED

### B1: API Client Foundation ✅
**Priority**: P0
**Dependencies**: None (can start immediately)

- [x] **B1.1** Created `apps/convex/lib/pcoServicesApi.ts`
  ```typescript
  const PCO_SERVICES_BASE = "https://api.planningcenteronline.com/services/v2";
  const PCO_PEOPLE_BASE = "https://api.planningcenteronline.com/people/v2";
  ```

- [x] **B1.2** Implemented `getValidAccessToken` helper (with refresh)
  - Checks token expiry with 5-minute buffer
  - Refreshes via OAuth token endpoint
  - Updates stored credentials

- [x] **B1.3** Rate limiting documented (client-side enforcement for future)
  - PCO limit: 100 requests per 20 seconds
  - Configured for 80 requests per 20 seconds to be conservative

- [x] **B1.4** Implemented error handling
  ```typescript
  export class PcoApiError extends Error {
    constructor(public status: number, message: string, public response?: unknown)
  }
  ```

### B2: Service Types & Teams ✅
**Priority**: P1
**Dependencies**: B1

- [x] **B2.1** Implemented `fetchServiceTypes`
  - GET /services/v2/service_types
  - Filters out deleted service types

- [x] **B2.2** Implemented `fetchTeamsForServiceType`
  - GET /services/v2/service_types/{id}/teams

- [x] **B2.3** Created Convex action `pcoServices.actions.getServiceTypes`

- [x] **B2.4** Created Convex action `pcoServices.actions.getTeamsForServiceType`

### B3: Plans & Team Members ✅
**Priority**: P1
**Dependencies**: B2

- [x] **B3.1** Implemented `fetchUpcomingPlans`
  - GET /services/v2/service_types/{id}/plans?filter=future&order=sort_date

- [x] **B3.2** Implemented `fetchPlanTeamMembers`
  - GET /services/v2/service_types/{id}/plans/{planId}/team_members?include=person,team
  - Supports filtering by team IDs

- [x] **B3.3** Implemented `getPersonContactInfo`
  - GET /people/v2/people/{id}?include=phone_numbers,emails
  - Extracts primary phone and email

- [x] **B3.4** Created Convex action `pcoServices.actions.getUpcomingPlans`

- [x] **B3.5** Created Convex action `pcoServices.actions.getPlanTeamMembers`

### B4: API Integration Tests
**Priority**: P2
**Dependencies**: B3

- [ ] **B4.1** Create `apps/convex/__tests__/pco/api.test.ts`
  - Mock PCO API responses
  - Test error handling
  - Test rate limiting behavior

- [ ] **B4.2** Create manual testing script (optional)

---

## Track C: Membership Rotation Engine ✅ COMPLETED

### C1: Phone/Email Matching ✅
**Priority**: P0
**Dependencies**: A3, B3

- [x] **C1.1** Created `apps/convex/lib/phoneNormalize.ts`
  ```typescript
  export function normalizePhone(phone: string): string
  export function phonesMatch(a: string, b: string): boolean
  export function normalizeEmail(email: string): string
  export function emailsMatch(a: string, b: string): boolean
  ```

- [x] **C1.2** Created `apps/convex/functions/pcoServices/matching.ts`
  - `findTogetherUserByContact()` - finds user by phone/email
  - `findUserByPcoPersonId()` - finds user by existing PCO link

- [x] **C1.3** Implemented `linkUserToPcoPerson`
  - Updates `userCommunities.externalIds.planningCenterId`

- [x] **C1.4** Implemented `matchAndLinkPcoPerson`
  - Checks for existing link first
  - Falls back to phone/email matching
  - Auto-links on successful match

### C2: Add/Remove Channel Membership ✅
**Priority**: P0
**Dependencies**: C1

- [x] **C2.1** Created `apps/convex/functions/pcoServices/rotation.ts`

- [x] **C2.2** Implemented `addChannelMember` (internal mutation)
  - Adds to chatChannelMembers with sync tracking
  - Updates scheduledRemovalAt for multi-service schedules
  - Updates channel memberCount

- [x] **C2.3** Implemented `removeExpiredMembers` (internal mutation)
  - Queries by scheduledRemovalAt <= now
  - Only removes PCO-synced members (syncSource = "pco_services")
  - Updates channel memberCount

- [x] **C2.4** Implemented `syncAutoChannel` (internal action)
  - Full sync for a single auto channel
  - 1. Remove expired members
  - 2. Find next plan in "add window"
  - 3. Fetch team members from PCO
  - 4. Match and add members
  - 5. Update sync status

- [x] **C2.5** Created Convex action `pcoServices.actions.triggerChannelSync`
  - Manual trigger for admins

### C3: Scheduled Rotation Job ✅
**Priority**: P1
**Dependencies**: C2

- [x] **C3.1** Added cron job in `apps/convex/crons.ts`
  ```typescript
  crons.daily(
    "pco-auto-channel-rotation",
    { hourUTC: 5, minuteUTC: 0 }, // ~midnight EST
    internal.functions.pcoServices.rotation.processAllAutoChannels
  );
  ```

- [x] **C3.2** Implemented `processAllAutoChannels` (internal action)
  - Queries all active PCO auto channel configs
  - Runs syncAutoChannel for each
  - Returns results with success/error for each

- [ ] **C3.3** Add timezone handling (enhancement for future)
  - Currently uses UTC-based calculations
  - Could use community timezone for more precise "days before/after"

### C4: New User Auto-Add
**Priority**: P1 (Enhancement for post-MVP)
**Dependencies**: C2

- [ ] **C4.1** Create `checkPcoAutoChannelsForNewUser` function
  - Called when user joins community
  - Check if they match any pending PCO person IDs
  - Add to appropriate auto channels if within rotation window

- [ ] **C4.2** Hook into community join flow

- [ ] **C4.3** Integrate with existing `syncUserToPlanningCenter`

### C5: Rotation Engine Tests
**Priority**: P1
**Dependencies**: C4

- [ ] **C5.1** Create `apps/convex/__tests__/pco/matching.test.ts`
  - Phone normalization tests (US, international, formatting)
  - Email matching tests
  - Edge cases (no phone, multiple phones)

- [ ] **C5.2** Create `apps/convex/__tests__/pco/rotation.test.ts`
  - Add members for plan flow
  - Remove members after plan flow
  - Full rotation cycle test

---

## Track D: Webhook Handler (Optional - Not needed for MVP)

### D1: HTTP Endpoint
**Priority**: P2
**Dependencies**: C2

- [ ] **D1.1** Create webhook endpoint
  ```typescript
  // apps/convex/http.ts
  // POST /webhooks/planning-center
  ```

- [ ] **D1.2** Implement signature verification
  - Verify X-PCO-Webhooks-Authenticity header
  - HMAC-SHA256 signature

- [ ] **D1.3** Implement idempotency handling

### D2: Event Handlers
**Priority**: P2
**Dependencies**: D1

- [ ] **D2.1** Implement `handlePlanPersonCreated`
  - Person added to schedule mid-week
  - Add immediately if within rotation window

- [ ] **D2.2** Implement `handlePlanPersonDestroyed`
  - Person removed from schedule mid-week
  - Remove from channel immediately

- [ ] **D2.3** Implement `handleTeamUpdated`
  - Team renamed - update cached names

### D3: Webhook Tests
**Priority**: P2
**Dependencies**: D2

- [ ] **D3.1** Create `apps/convex/__tests__/pco/webhooks.test.ts`

---

## Track E: Frontend UI ⏳ NEEDS INTEGRATION

### E1: Channel Setup ⏳
**Priority**: P1
**Dependencies**: B2

- [x] **E1.1** Created `apps/mobile/features/channels/components/PcoAutoChannelConfig.tsx`
  - Service type dropdown
  - Team selector (single, multi, or all)
  - Add/remove days inputs
  - Preview of rotation timing

- [ ] **E1.2** Integrate into channel creation flow
  - Update `CreateChannelModal.tsx` to include channel type selection
  - Show PCO config when "pco_services" type is selected
  - Save autoChannelConfigs record on channel creation

- [x] **E1.3** Created hooks via useAction
  - Uses `api.functions.pcoServices.actions.getServiceTypes`
  - Uses `api.functions.pcoServices.actions.getTeamsForServiceType`

### E2: Status View
**Priority**: P1
**Dependencies**: E1

- [ ] **E2.1** Create `apps/mobile/features/channels/components/AutoChannelStatus.tsx`
  - Current service info
  - Sync status
  - Member count (current rotation)
  - Action buttons (Sync Now, Edit Settings)

- [ ] **E2.2** Update channel info/settings screen
  - Show AutoChannelStatus when channel.channelType === "pco_services"

- [ ] **E2.3** Create hook `useAutoChannelStatus`
  - Query autoChannelConfigs for channel
  - Display sync status and current event

- [ ] **E2.4** Add auto channel indicator to channel list
  - Show icon next to auto channels in the list

### E3: Pending Matches View
**Priority**: P2
**Dependencies**: E2

- [ ] **E3.1** Create `apps/mobile/features/channels/components/PendingMatches.tsx`
  - List of PCO members scheduled but not matched in Together
  - Show name and phone (if available)
  - Explain auto-matching behavior

- [ ] **E3.2** Create hook `usePendingMatches`
  - Track unmatched PCO person IDs per channel

### E4: Frontend Tests
**Priority**: P2
**Dependencies**: E3

- [ ] **E4.1** Create component tests for PcoAutoChannelConfig
- [ ] **E4.2** Create component tests for AutoChannelStatus
- [ ] **E4.3** Create integration tests with mock API

---

## Remaining Work Summary

### Immediate (Required for MVP)
1. **E1.2** - Integrate PcoAutoChannelConfig into channel creation flow
2. **E2.1-E2.4** - Auto channel status view in channel settings

### Post-MVP Enhancements
1. **C4** - New user auto-add to relevant channels
2. **C3.3** - Timezone-aware day calculations
3. **D** - Webhook handler for real-time schedule updates
4. **E3** - Pending matches view
5. Test coverage (A3, B4, C5, E4)

---

## Parallel Execution Guide

### For 2 Agents

```
Agent 1: Track E (Frontend integration)
Agent 2: Tests (A3, B4, C5)
```

### For 3 Agents

```
Agent 1: E1.2 (Channel creation integration)
Agent 2: E2 (Status view)
Agent 3: Tests
```

---

## Orchestrator Checklist

### Completed Phases ✅

```
[x] A1: Schema Definition
[x] A2: Type Definitions
[x] B1: API Client Foundation
[x] B2: Service Types & Teams
[x] B3: Plans & Team Members
[x] C1: Phone/Email Matching
[x] C2: Add/Remove Membership
[x] C3: Scheduled Rotation Job
[x] E1.1: PcoAutoChannelConfig component
```

### In Progress

```
[ ] E1.2: Channel creation integration    [Agent: ___] [Status: ___]
[ ] E2: Status View                       [Agent: ___] [Status: ___]
```

### Optional/Post-MVP

```
[ ] A3: Data Layer Tests
[ ] B4: API Integration Tests
[ ] C4: New User Auto-Add
[ ] C5: Rotation Engine Tests
[ ] D1-D3: Webhook Handler
[ ] E3: Pending Matches View
[ ] E4: Frontend Tests
```

---

## Recovery Procedure

If an orchestrator agent fails, the new orchestrator should:

1. **Read this file** to understand the overall plan
2. **Check the task checkboxes** in this document
3. **Read the git log** to see recent commits related to PCO
4. **Check for any in-progress branches** related to PCO auto channels
5. **Resume from the next unchecked task**

---

## Test Commands

```bash
# Run PCO-related tests
npx convex test --pattern "pco"

# Run specific test file
npx convex test apps/convex/__tests__/pco/rotation.test.ts

# Verify schema compiles
npx convex dev --once

# Start dev server (for E2E testing)
pnpm dev
```

---

## Success Criteria

The feature is complete when:

1. [x] Schema and data layer implemented
2. [x] PCO Services API integration working
3. [x] Membership rotation engine with cron job
4. [ ] Frontend UI integrated into channel creation
5. [ ] Manual QA completed:
   - [ ] Can create a channel and configure PCO sync
   - [ ] Can select service type and teams
   - [ ] Can configure add/remove days
   - [ ] Members are added on the correct day
   - [ ] Members are removed on the correct day
   - [ ] Manual sync trigger works
6. [ ] Documentation updated
7. [ ] PR approved and merged
