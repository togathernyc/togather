# PCO Unified Filter-Based Auto Channels Design

## Problem Statement

Currently, PCO auto-channels require choosing a specific sync mode (all teams, single team, multi-team) within a single service type. This creates a rigid UI that doesn't scale well as users want more flexibility:
- Sync by positions/roles across teams
- Sync across multiple service types
- Filter by locations/campuses
- Combine filters in various ways

**Goal**: Treat PCO as one unified data source and apply progressive filters to narrow down who gets synced.

---

## Design Philosophy: Filter-Based Approach

Instead of "sync modes", we use a **composable filter model**:

```
┌─────────────────────────────────────────────────────────┐
│  PCO Services (all scheduled people)                    │
├─────────────────────────────────────────────────────────┤
│  Filter: Service Types    [All] or [Sunday, Wednesday]  │
├─────────────────────────────────────────────────────────┤
│  Filter: Teams            [All] or [Worship, Tech]      │
├─────────────────────────────────────────────────────────┤
│  Filter: Positions        [All] or [Director, Staff]    │
├─────────────────────────────────────────────────────────┤
│  Filter: Schedule Status  [All] or [Confirmed only]     │
├─────────────────────────────────────────────────────────┤
│  → Result: 23 people matched                            │
└─────────────────────────────────────────────────────────┘
```

Each filter is **optional** - empty means "include all". Filters stack to narrow results.

---

## Schema Design

### New Config Structure

```typescript
config: v.object({
  // ============================================
  // FILTERS (all optional - empty = include all)
  // ============================================
  filters: v.optional(v.object({
    // Service Type filter
    serviceTypeIds: v.optional(v.array(v.string())),
    serviceTypeNames: v.optional(v.array(v.string())), // For display

    // Team filter (within selected service types)
    teamIds: v.optional(v.array(v.string())),
    teamNames: v.optional(v.array(v.string())), // For display

    // Position filter (fuzzy match on position names)
    positions: v.optional(v.array(v.string())), // e.g., ["Director", "Staff"]

    // Schedule status filter
    statuses: v.optional(v.array(v.string())), // "C" (confirmed), "U" (unconfirmed), etc.
  })),

  // ============================================
  // TIMING (when to add/remove members)
  // ============================================
  addMembersDaysBefore: v.number(),
  removeMembersDaysAfter: v.number(),

  // ============================================
  // LEGACY FIELDS (for backward compatibility)
  // ============================================
  // These are read during migration but new configs use `filters`
  serviceTypeId: v.optional(v.string()),
  serviceTypeName: v.optional(v.string()),
  syncScope: v.optional(v.string()),
  teamIds: v.optional(v.array(v.string())),
  teamNames: v.optional(v.array(v.string())),
}),
```

### Why This Structure?

1. **Composable**: Add new filter types without changing the model
2. **Backward Compatible**: Legacy fields still work, new configs use `filters`
3. **Explicit**: Empty filter = include all, vs having to check multiple fields
4. **Extensible**: Easy to add `campusIds`, `tagIds`, etc. later

---

## UI Flow

### Step 1: Start with PCO Services

```
┌─────────────────────────────────────────────┐
│  Sync from Planning Center Services         │
│                                             │
│  This will sync people who are scheduled    │
│  for upcoming services.                     │
│                                             │
│  [Continue →]                               │
└─────────────────────────────────────────────┘
```

### Step 2: Filter by Service Types (Optional)

```
┌─────────────────────────────────────────────┐
│  Which services?                            │
│                                             │
│  ○ All service types                        │
│  ● Specific service types:                  │
│    ☑ Sunday Morning Service                 │
│    ☑ Wednesday Evening Service              │
│    ☐ Youth Service                          │
│    ☐ Special Events                         │
│                                             │
│  [← Back]              [Continue →]         │
└─────────────────────────────────────────────┘
```

### Step 3: Filter by Teams (Optional)

```
┌─────────────────────────────────────────────┐
│  Which teams?                               │
│                                             │
│  ○ All teams                                │
│  ● Specific teams:                          │
│    ☑ Worship Band                           │
│    ☑ Production                             │
│    ☐ Hospitality                            │
│    ☐ Kids Ministry                          │
│                                             │
│  [← Back]              [Continue →]         │
└─────────────────────────────────────────────┘
```

### Step 4: Filter by Positions (Optional)

```
┌─────────────────────────────────────────────┐
│  Which positions?                           │
│                                             │
│  ○ All positions                            │
│  ● Specific positions:                      │
│    ☑ Director (matches: Music Director,    │
│       Tech Director, Youth Director)        │
│    ☑ Staff                                  │
│    ☐ Volunteer                              │
│    ☐ Lead Vocals                            │
│                                             │
│  [← Back]              [Continue →]         │
└─────────────────────────────────────────────┘
```

### Step 5: Timing

```
┌─────────────────────────────────────────────┐
│  When to sync?                              │
│                                             │
│  Add members: [5] days before service       │
│  Remove members: [1] day after service      │
│                                             │
│  Preview:                                   │
│  • 23 people match your filters             │
│  • Next sync: Feb 2 (Sunday Morning)        │
│                                             │
│  [← Back]              [Create Channel]     │
└─────────────────────────────────────────────┘
```

---

## Rotation Logic

### Updated Sync Flow

```typescript
async function syncAutoChannel(configId) {
  const config = await getConfig(configId);
  const filters = config.filters || migrateFromLegacy(config);

  // Step 1: Get service types to process
  const serviceTypeIds = filters.serviceTypeIds?.length
    ? filters.serviceTypeIds
    : await getAllServiceTypeIds(accessToken);

  // Step 2: For each service type, find plans in the add window
  const allMembers = [];
  for (const serviceTypeId of serviceTypeIds) {
    const plans = await fetchUpcomingPlans(accessToken, serviceTypeId);
    const targetPlan = findPlanInAddWindow(plans, config.addMembersDaysBefore);

    if (targetPlan) {
      const members = await fetchPlanTeamMembers(
        accessToken,
        serviceTypeId,
        targetPlan.id
      );
      allMembers.push(...members.map(m => ({
        ...m,
        serviceTypeId,
        planId: targetPlan.id,
        planDate: targetPlan.date,
      })));
    }
  }

  // Step 3: Apply filters
  let filtered = allMembers;

  // Team filter
  if (filters.teamIds?.length) {
    filtered = filtered.filter(m => filters.teamIds.includes(m.teamId));
  }

  // Position filter (fuzzy match)
  if (filters.positions?.length) {
    const patterns = filters.positions.map(p => p.toLowerCase());
    filtered = filtered.filter(m => {
      const pos = (m.position || "").toLowerCase();
      return patterns.some(p => pos.includes(p) || p.includes(pos));
    });
  }

  // Status filter
  if (filters.statuses?.length) {
    filtered = filtered.filter(m => filters.statuses.includes(m.status));
  }

  // Step 4: Deduplicate by pcoPersonId
  const uniqueMembers = deduplicateByPersonId(filtered);

  // Step 5: Sync to channel
  for (const member of uniqueMembers) {
    await addChannelMember(channelId, member);
  }
}
```

### Deduplication Strategy

When the same person appears in multiple services:
- Use the **earliest** add date (so they're added for their first service)
- Use the **latest** removal date (so they're not removed until after their last service)

```typescript
function deduplicateByPersonId(members) {
  const byPerson = new Map();

  for (const member of members) {
    const existing = byPerson.get(member.pcoPersonId);
    if (!existing) {
      byPerson.set(member.pcoPersonId, member);
    } else {
      // Keep the one with the latest scheduled removal
      if (member.scheduledRemovalAt > existing.scheduledRemovalAt) {
        byPerson.set(member.pcoPersonId, {
          ...member,
          // Preserve earliest add date info if needed
        });
      }
    }
  }

  return Array.from(byPerson.values());
}
```

---

## API Additions

### Get Available Positions

Fetch unique positions from recent plans to populate the filter UI:

```typescript
export const getAvailablePositions = action({
  args: {
    token: v.string(),
    communityId: v.id("communities"),
    serviceTypeIds: v.optional(v.array(v.string())), // Scope to specific services
  },
  handler: async (ctx, args) => {
    // Fetch from recent plans to get real, in-use positions
    const positions = new Map<string, number>(); // name -> count

    for (const serviceTypeId of serviceTypeIds) {
      const plans = await fetchUpcomingPlans(accessToken, serviceTypeId, 3);
      for (const plan of plans) {
        const members = await fetchPlanTeamMembers(accessToken, serviceTypeId, plan.id);
        for (const member of members) {
          if (member.position) {
            positions.set(member.position, (positions.get(member.position) || 0) + 1);
          }
        }
      }
    }

    return Array.from(positions.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);
  },
});
```

### Preview Filter Results

Let users see who matches their filters before creating:

```typescript
export const previewFilterResults = action({
  args: {
    token: v.string(),
    communityId: v.id("communities"),
    filters: v.object({
      serviceTypeIds: v.optional(v.array(v.string())),
      teamIds: v.optional(v.array(v.string())),
      positions: v.optional(v.array(v.string())),
      statuses: v.optional(v.array(v.string())),
    }),
  },
  handler: async (ctx, args) => {
    // Run the filter logic and return a preview
    const matched = await applyFilters(accessToken, args.filters);

    return {
      totalCount: matched.length,
      sample: matched.slice(0, 10).map(m => ({
        name: m.name,
        position: m.position,
        team: m.teamName,
        service: m.serviceTypeName,
      })),
    };
  },
});
```

---

## Migration Strategy

### Backward Compatibility

Existing configs use:
```typescript
{
  serviceTypeId: "123",
  syncScope: "multi_team",
  teamIds: ["a", "b"],
}
```

New filter-based configs use:
```typescript
{
  filters: {
    serviceTypeIds: ["123"],
    teamIds: ["a", "b"],
  },
}
```

### Migration Function

```typescript
function migrateToFilterConfig(legacyConfig) {
  // If already using new format, return as-is
  if (legacyConfig.filters) {
    return legacyConfig.filters;
  }

  // Migrate from legacy format
  return {
    serviceTypeIds: legacyConfig.serviceTypeId
      ? [legacyConfig.serviceTypeId]
      : undefined,
    serviceTypeNames: legacyConfig.serviceTypeName
      ? [legacyConfig.serviceTypeName]
      : undefined,
    teamIds: legacyConfig.syncScope !== "all_teams"
      ? legacyConfig.teamIds
      : undefined,
    teamNames: legacyConfig.teamNames,
    // No position filter in legacy configs
    positions: undefined,
    statuses: undefined,
  };
}
```

---

## Future Filter Extensions

The filter model easily extends to support:

### Campus/Location Filter
```typescript
filters: {
  campusIds: ["main", "north"],
}
```

### Tag Filter (PCO People tags)
```typescript
filters: {
  tagIds: ["volunteer", "leader"],
}
```

### Time-Based Filter
```typescript
filters: {
  daysOfWeek: ["sunday", "wednesday"], // Only sync for specific days
}
```

### Negative Filters
```typescript
filters: {
  excludeTeamIds: ["kids-ministry"], // Exclude specific teams
  excludePositions: ["Volunteer"],    // Exclude specific positions
}
```

---

## Implementation Plan

### Phase 1: Foundation (Week 1)
1. Update schema with `filters` object
2. Add migration function for legacy configs
3. Update rotation logic to use filter-based approach
4. Existing configs continue to work unchanged

### Phase 2: Multi-Service-Type Support (Week 1-2)
1. Update rotation to iterate over multiple service types
2. Implement deduplication by pcoPersonId
3. Track multiple "current events" in sync results

### Phase 3: Position Filter (Week 2)
1. Add `getAvailablePositions` API
2. Implement fuzzy position matching in rotation
3. Update frontend with position filter step

### Phase 4: UI Overhaul (Week 2-3)
1. Redesign config UI as step-by-step filter wizard
2. Add preview functionality
3. Show filter summary on channel settings

### Phase 5: Polish
1. Add filter result preview before save
2. Improve position matching (synonyms, normalization)
3. Add "quick configs" for common patterns (e.g., "All Directors")

---

## Open Questions

1. **Filter Order**: Does the order of applying filters matter for performance?
   - Recommendation: Apply most restrictive filter first (usually service type)

2. **Position Matching**: How fuzzy should matching be?
   - "Director" matches "Music Director"? → Yes
   - "Dir" matches "Director"? → Probably not (too short)
   - Recommendation: Contains match, minimum 4 characters

3. **Empty vs Explicit "All"**: Should we distinguish between "user didn't touch this filter" vs "user explicitly chose all"?
   - Recommendation: Treat both as "include all" for simplicity

4. **Filter Validation**: What if filters result in 0 people?
   - Recommendation: Warn in UI preview, but allow creation
