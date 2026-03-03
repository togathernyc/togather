# ADR-006: Centralized Prefetch System

## Status

Superseded (2025-01-22)

> **Note:** This ADR is obsolete. The prefetch system was removed as part of the tRPC to Convex migration. Convex provides real-time subscriptions that automatically keep data fresh, making prefetching unnecessary. The `apps/mobile/lib/prefetch/` directory has been deleted.

## Date

2025-12-24

## Context

The mobile app had several performance issues related to slow navigation:

- **Inbox tab**: ~2 second load time due to `staleTime: 0` causing refetch on every focus
- **Chat rooms**: ~1-2 second delay when opening from inbox
- **Admin tab**: All three segments (Requests, People, Integrations) loaded on-demand with no prefetching
- **Chat menu items**: Members, Events, Attendance, Follow-up screens each had ~1 second load times
- **General ↔ Leaders tab switching**: Noticeable lag when switching between chat tabs

The existing prefetch pattern in `(tabs)/_layout.tsx` was:

- Manual query key construction (error-prone)
- Hardcoded staleTime values (scattered across codebase)
- No type safety on query inputs
- No support for conditional prefetching (e.g., admin-only queries)
- Not reusable across different screens

## Decision

We will implement a **centralized prefetch system** with the following components:

### 1. Core Infrastructure (`/apps/mobile/lib/prefetch/`)

| File           | Purpose                                                   |
| -------------- | --------------------------------------------------------- |
| `types.ts`     | Type definitions for prefetch requirements and conditions |
| `config.ts`    | Centralized staleTime configuration for all queries       |
| `queryKeys.ts` | tRPC-compatible query key builders                        |
| `utils.ts`     | Core prefetch functions using `trpcVanilla`               |
| `hooks.ts`     | React hooks for mount, focus, and manual prefetching      |
| `registry.ts`  | Route pattern matching for auto-discovery                 |
| `presets.ts`   | Pre-configured prefetch sets (app startup, groups, etc.)  |

### 2. Screen-Level Declarations

Each screen exports its data requirements as a named export:

```typescript
// apps/mobile/app/(user)/leader-tools/[group_id]/members.tsx
import type { ScreenPrefetchFn } from '@lib/prefetch';

export const prefetch: ScreenPrefetchFn<{ group_id: string }> = (params) => [
  { path: ['groups', 'byId'], input: { groupId: params.group_id } },
  { path: ['groups', 'members', 'list'], input: { groupId: params.group_id } },
];

export default function MembersScreen() { ... }
```

### 3. Navigation Wrapper

Auto-prefetches registered routes on navigation intent:

```typescript
const { navigate, prefetchRoute } = usePrefetchingNavigate();

<Pressable
  onPressIn={() => prefetchRoute(`/inbox/${room.groupId}`)}  // Start on touch
  onPress={() => navigate(`/inbox/${room.groupId}`)}         // Navigate on release
>
```

### 4. Centralized staleTime Configuration

All staleTime values in one place (`config.ts`):

| Query                         | staleTime | Rationale                             |
| ----------------------------- | --------- | ------------------------------------- |
| `chat.getAllRooms`            | 30s       | Show stale, update in background      |
| `groups.mine`                 | 2 min     | Group memberships change infrequently |
| `groups.byId`                 | 1 min     | Group details are relatively stable   |
| `groups.types`                | 10 min    | Rarely changes                        |
| `admin.pendingRequests.list`  | 1 min     | Time-sensitive                        |
| `admin.communityMembers.list` | 2 min     | Member list changes infrequently      |

## Consequences

### Positive

1. **Instant perceived navigation**: Cached data shown immediately, updates in background
2. **Type-safe prefetching**: Full TypeScript inference from tRPC router
3. **Single source of truth**: All staleTime values in `config.ts`
4. **Condition-based prefetching**: Admin queries only prefetch for admins
5. **Co-located declarations**: Prefetch logic lives next to the screen it serves
6. **Graceful degradation**: If prefetch fails, navigation still works
7. **Touch-based prefetch**: ~200ms head start from onPressIn → onPress

### Negative

1. **Additional complexity**: New abstraction layer to understand
2. **Registry maintenance**: Screen registry needs updating when routes change
3. **Memory usage**: More cached data in React Query

### Neutral

1. **Uses existing infrastructure**: Leverages `trpcVanilla` and React Query
2. **Incremental adoption**: Can be adopted screen-by-screen

## Implementation

### Files Created

```
apps/mobile/lib/prefetch/
├── index.ts              # Main exports
├── types.ts              # Type definitions
├── config.ts             # staleTime configuration
├── queryKeys.ts          # tRPC query key builders
├── utils.ts              # Core prefetch functions
├── hooks.ts              # React hooks
├── registry.ts           # Route pattern matching
├── presets.ts            # Prefetch presets
└── screenRegistry.ts     # Screen prefetch declarations
```

### Files Modified

- `apps/mobile/app/(tabs)/_layout.tsx` - Use `usePrefetchOnMount(APP_STARTUP_PREFETCH)`
- `apps/mobile/features/chat/hooks/useChatRooms.ts` - Use `getStaleTime('chat.getAllRooms')`
- `apps/mobile/features/groups/hooks/useGroups.ts` - Use `getStaleTime('groups.mine')`
- Various screen files - Add `prefetch` export declarations

## Usage Examples

### App Startup Prefetch

```typescript
// In TabsLayout
import { usePrefetchOnMount, APP_STARTUP_PREFETCH } from "@lib/prefetch";

export default function TabsLayout() {
  usePrefetchOnMount(APP_STARTUP_PREFETCH);
  return <Tabs>...</Tabs>;
}
```

### Manual Prefetch

```typescript
import { usePrefetch, getGroupPrefetchRequirements } from "@lib/prefetch";

function GroupCard({ groupId }) {
  const prefetch = usePrefetch();

  return (
    <Pressable
      onPressIn={() => prefetch(getGroupPrefetchRequirements(groupId))}
    >
      ...
    </Pressable>
  );
}
```

### Using Centralized staleTime

```typescript
import { getStaleTime } from "@lib/prefetch";

const query = trpc.groups.mine.useQuery(undefined, {
  staleTime: getStaleTime("groups.mine"), // Returns 2 * 60 * 1000
});
```

## Performance Expectations

| Screen            | Before   | After                          |
| ----------------- | -------- | ------------------------------ |
| Inbox tab         | ~2s      | <100ms (cached)                |
| Opening chat      | ~1-2s    | <100ms (prefetched on touch)   |
| General ↔ Leaders | ~1s      | <100ms (prefetched with chat)  |
| Admin tab         | ~1-2s    | <200ms (prefetched on startup) |
| Chat menu items   | ~1s each | <100ms (prefetched with chat)  |

## References

- React Query Prefetching: https://tanstack.com/query/latest/docs/react/guides/prefetching
- tRPC Query Keys: https://trpc.io/docs/client/react/useUtils
- Expo Router Navigation: https://docs.expo.dev/router/navigating-pages/
