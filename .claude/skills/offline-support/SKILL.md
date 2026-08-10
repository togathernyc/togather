---
name: offline-support
description: MUST be read before adding or changing any data-loading feature in apps/mobile (to decide whether it needs offline support) and before touching offline plumbing — ConnectionProvider/useConnectionStatus, `stores/*Cache.ts` Zustand+AsyncStorage caches, or the chat-send / serving-task write queues.
---

# Offline Support (Togather mobile)

The app has hand-built, **native-only** offline support (there is no Convex-level
offline persistence): a connectivity detector (`providers/ConnectionProvider.tsx`,
`useConnectionStatus()`), Zustand+AsyncStorage stale-while-revalidate caches
(`stores/*Cache.ts`), and narrow write queues (chat sends; serving-task completions).

- **Before adding/changing a data-loading feature, decide if it needs offline
  support** using the rubric in `docs/architecture/decisions/ADR-028-offline-support.md`.
  Rule of thumb: data a user needs to *view* where they predictably lack signal
  (e.g. serving mode at a venue) should be read-cached; actions they must *take*
  offline need a write queue **and** an idempotent mutation.
- Every offline module is native-only — add a `.web.ts` no-op stub, a store test,
  and register new caches in `providers/AuthProvider.tsx` logout cleanup.
- Read the ADR before touching offline plumbing; keep it updated when you do.
