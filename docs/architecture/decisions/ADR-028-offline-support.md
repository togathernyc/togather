# ADR-028: Offline Support

## Status

Accepted

## Date

2026-07-04

## Context

Users of the mobile app are routinely offline or on flaky networks in exactly
the moments they most need the app: standing at a venue running a service,
volunteering in a building with no signal, in a dead zone, or on a plane. They
also want instant warm-starts rather than a spinner on every cold launch.

Convex is a real-time, subscription-first backend. It does **not** provide
client-side offline persistence — a `useQuery` returns `undefined` while the
socket is down and never resolves until connectivity returns, and mutations
throw. ADR-006's React Query prefetch system (which had a stale cache) was
removed during the tRPC → Convex migration, leaving no offline story at all.

We need offline support, but we do not need it *everywhere*. Building it
requires a deliberate, hand-rolled approach and a clear rubric for when a
feature should adopt it.

## Decision

Offline support is **hand-built** from three independent pieces layered on top
of Convex, and is **native-only** — every offline module ships a `.web.ts` /
`.web.tsx` no-op stub, because web is always treated as online:

1. A **connectivity detector** that fuses the device radio (NetInfo) with the
   Convex WebSocket state.
2. **Stale-while-revalidate caches** — Zustand stores persisted to
   AsyncStorage — that back specific read screens.
3. **Narrow write queues** for the few actions that must work offline. Every
   other mutation simply fails offline with a surfaced error.

There is intentionally **no global offline cache and no global write queue**.
Each cache and queue is opt-in, per feature.

---

### 1. Connectivity — `apps/mobile/providers/ConnectionProvider.tsx`

(`ConnectionProvider.web.tsx` is a no-op that always reports online.)

Combines two signals:

- **NetInfo** — `isNetworkAvailable`, `isInternetReachable`, connection type,
  cellular generation.
- **Convex WebSocket** — `useConvexConnectionState()` → `isWebSocketConnected`.

Exposes `useConnectionStatus()` returning: `status`, `isNetworkAvailable`,
`isWebSocketConnected`, `isInternetReachable`, `connectionType`,
`cellularGeneration`, and `isEffectivelyOffline`.

**Two distinct notions of "offline" — pick the right one:**

| Notion | Definition | Use it to decide… |
|---|---|---|
| `isEffectivelyOffline` | `!isNetworkAvailable \|\| !isInternetReachable` (can't reach the backend) | "Should I **queue this write** instead of sending?" |
| `isNetworkAvailable` (radio only) | Device has a network interface up | "Should I **fall back to cache** for reads?" |
| `isConnected` (internal) | Also requires the WebSocket; drives the banner state machine | Banner/UI state only |

Guidance: gate **read** cache fallback on `isNetworkAvailable`, not
`isInternetReachable`. The radio signal is stable, whereas Android's
reachability probe is flaky at cold start and can briefly report unreachable
while the socket is still coming up, causing false "saved copy" flashes. Gate
**write** queueing on `isEffectivelyOffline`.

**State machine:** `connecting → connected / disconnected / slow / reconnecting
/ reconnected`, with:

- a **6s cold-start grace** so no false "offline" banner shows while the app is
  still initializing,
- a **2s mid-session disconnect debounce** to ignore transient blips, and
- a **reset to `connecting` on app foreground**, because iOS kills the
  WebSocket while backgrounded.

---

### 2. Caches (stale-while-revalidate) — `apps/mobile/stores/*Cache.ts`

Each cache is a Zustand store wrapped in
`persist(createJSONStorage(() => AsyncStorage))`, ships a `.web.ts` no-op stub,
and has a test under `apps/mobile/stores/__tests__/`.

| Store | Caches | Key | TTL | Stale getter? |
|---|---|---|---|---|
| `inboxCache.ts` | inbox channel list | `communityId` (+ `:serving:planId` variant) | 24h | no (hard-expire) |
| `messageCache.ts` | chat messages (50/channel, 20 channels) | `channelId` | 24h | no |
| `groupCache.ts` | group details + members/leaders | `groupId` | 24h | no |
| `channelsCache.ts` | a group's channel list | `groupId` | 24h | no |
| `runSheetCache.ts` | PCO run sheet + service types (via actions) | `groupId:serviceTypeId` / `groupId` | 4h | **yes** (`getRunSheetStale`) |
| `servingRunSheetCache.ts` | native serving run sheet: plans / event / items | `plans:groupId` / `event:planId` / `items:planId` | 12h | **yes** |
| `servingTasksCache.ts` | serving Tasks tab sections | `section:planId` (section ∈ `mine`/`shared`/`crew`/`allTeams`) | 12h | **yes** |

**Read pattern.** A screen's live Convex `useQuery` returns `undefined` while
loading and *stays* `undefined` with no network. The component falls back to the
cache getter and flags staleness to show a "Showing saved copy" banner:

```typescript
const { isNetworkAvailable } = useConnectionStatus();
const live = useQuery(api.serving.runSheet, { groupId });

// Fall back to cache only when the radio is down (stable signal).
const cached = getRunSheetStale(`${groupId}:${serviceTypeId}`);
const data = live ?? (!isNetworkAvailable ? cached?.value : undefined);
const isStale = live === undefined && !!cached;

// Cache-on-load whenever fresh data arrives.
useEffect(() => {
  if (live) setRunSheet(`${groupId}:${serviceTypeId}`, live);
}, [live]);
```

A cache with a **stale getter** (`getXStale`) returns data past its TTL flagged
as stale, letting the UI show something rather than nothing when offline; a
**hard-expire** cache returns nothing past TTL.

Consumers today: `ChatInboxScreen.tsx` (gated on `isNetworkAvailable` — online
it waits for a complete first paint, offline it uses the cache),
`useMessages.ts`, `ConvexChatRoomScreen.tsx`, `useGroupDetails.ts` /
`useGroupChannels.ts`, `RunSheetScreen.tsx`, and the native serving screens
`ServingRunsheetScreen.tsx` / `NativeRunSheetView.tsx` and
`ServingTasksScreen.tsx`.

**Every cache must be cleared on logout** in
`apps/mobile/providers/AuthProvider.tsx` — both AsyncStorage key removal and the
in-memory `.clearAll()` / `.clear()`. Adding a new cache without registering it
here leaks the previous user's data across accounts.

---

### 3. Write queues

Only two features queue writes offline; everything else fails.

**Chat sends** — `apps/mobile/features/chat/hooks/useConvexSendMessage.ts`

- **In-memory** (`useRef`) queue, **not persisted** (lost on app restart).
- Marks a message `'queued'` when `isEffectivelyOffline`, flushes on reconnect.
- Scoped to the mounted chat screen. Chat sends only.

**Serving task completions** — `apps/mobile/stores/servingTaskQueue.ts`

- **Persisted** to AsyncStorage — a volunteer may close the app between going
  offline and regaining signal.
- **Last-write-wins**, keyed by a stable `completionId`, storing the *desired*
  `completed` boolean per task.
- Flushed on reconnect by `ServingTasksScreen`.
- Safe to replay because the three backing mutations —
  `toggleTaskCompletion`, `togglePersonalTask`, `toggleSharedTeamTask` in
  `apps/convex/functions/scheduling/eventTasks.ts` — each take an **explicit
  `completed: boolean`** and are **idempotent** (guarded insert/delete or
  absolute-timestamp patch, never a blind toggle).

**Everything else:** mutations throw offline and the error surfaces to the user.
There is no global write queue.

---

### 4. Offline UI — `apps/mobile/components/ui/StatusBar.tsx`

Animated bottom banner, priority ladder driven by the connection state machine:

| State | Banner |
|---|---|
| `connecting` | (nothing — cold-start grace) |
| `disconnected` | "No internet connection" |
| no internet | "No internet" |
| `slow` | "Slow connection" |
| `reconnecting` | "Reconnecting…" |
| `reconnected` | "Connected" (auto-dismiss after 3s) |

The chat composer additionally shows "Messages will be sent when you're back
online" when `isEffectivelyOffline`.

---

### 5. Auth offline — `apps/mobile/providers/AuthProvider.tsx` + `components/guards/PrivateRoute.tsx`

An offline returning user must not be bounced to login:

- The user profile is cached to AsyncStorage.
- A **network error keeps the tokens** and restores the cached profile; only a
  **server-confirmed `not_found`** logs the user out.
- `isAuthenticated = !!user || !!token` (token-only auth), so a valid token
  alone is enough while offline.
- `PrivateRoute` shows a **spinner, not a redirect**, when `token && !user`.

---

## Should my feature be offline-ready?

This is a primary reason this ADR exists. Use this rubric before building.

### Offline-READ (add a cache) — when?

Add a cache when the data is something a user needs to **view** at a time they
predictably lack connectivity: at a venue/event (serving run sheet & tasks), in
a dead zone, on a plane, or simply for an instant warm-start.

If yes:

1. Add a Zustand + AsyncStorage cache store — **copy an existing one**.
2. Wire stale-while-revalidate: `live ?? getStale(key)`, gated on
   `!isNetworkAvailable`.
3. Show a stale banner when serving cached data.
4. Cache-on-load whenever fresh data arrives.
5. **Register it in `AuthProvider` logout.**
6. Pick a TTL matching the data's freshness needs (minutes for volatile, hours
   for stable).
7. Add a `.web.ts` no-op stub and a store test.

### Offline-WRITE (add a queue) — when?

Add a queue **only** when the user must be able to **act** while offline **and**
the action can be safely replayed later. Prerequisites:

- The mutation is **idempotent** / takes an **explicit desired state** (not a
  blind toggle or increment).
- Conflicts are tolerable (**last-write-wins acceptable**).

If yes: persisted queue keyed by a stable id, storing the desired state; an
optimistic overlay in the UI; flush-on-reconnect. **If the mutation isn't
idempotent, make it so first, or don't queue it.**

### When offline is NOT worth it

Default to **letting it fail offline with a clear error** for:

- admin / config screens,
- one-off destructive actions,
- anything requiring server validation to be safe (payments, joins with
  capacity limits),
- data that is meaningless when stale.

### Always

- Native-only — add a `.web.ts` no-op stub.
- Add a store test.
- Register new caches in `AuthProvider` logout.

---

## Consequences

### Positive

1. Key screens (chat, groups, serving run sheet & tasks) work offline and
   warm-start instantly.
2. Offline volunteers can complete serving tasks and send messages; work
   survives app restarts (for the persisted serving queue).
3. Offline users stay logged in.
4. Cost is opt-in and localized — no global cache/queue machinery to reason
   about.
5. Web is unaffected (no-op stubs).

### Negative

1. Offline support is **manual and per-feature** — each new offline screen is
   real work (cache store, gating, stale banner, logout registration, test).
2. Duplicated cache boilerplate across `*Cache.ts` stores.
3. Easy to forget the logout registration, leaking data across accounts.
4. The in-memory chat queue loses unsent messages on app restart.
5. Two "offline" notions (`isEffectivelyOffline` vs `isNetworkAvailable`) are a
   footgun if the wrong one is used.

### Neutral

1. Convex remains the single source of truth; caches and queues are strictly
   additive.
2. Adoption is incremental, screen by screen.
3. TTLs are per-cache tuning knobs.

---

## References

- [ADR-026: Native run sheet](../ADR-026-native-run-sheet.md)
- [ADR-020: Convex native messaging](../ADR-020-convex-native-messaging.md)
- [ADR-006: Centralized prefetch system](./ADR-006-centralized-prefetch-system.md) (superseded — its stale cache was removed)
- Source: `apps/mobile/providers/ConnectionProvider.tsx`,
  `apps/mobile/stores/*Cache.ts`, `apps/mobile/stores/servingTaskQueue.ts`,
  `apps/mobile/features/chat/hooks/useConvexSendMessage.ts`,
  `apps/mobile/components/ui/StatusBar.tsx`,
  `apps/mobile/providers/AuthProvider.tsx`,
  `apps/mobile/components/guards/PrivateRoute.tsx`,
  `apps/convex/functions/scheduling/eventTasks.ts`
