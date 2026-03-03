# ADR-002: Feature-Based Organization

## Status

Accepted

## Context

The mobile application has grown to include multiple features (authentication, groups, chat, leader tools, etc.). We needed to decide how to organize code to maintain scalability, testability, and developer experience.

## Decision

We organize code by **features** rather than by file type. Each feature is self-contained with its own components, hooks, services, types, and utilities.

## Rationale

### Why Organize by Features

1. **Co-location**: Related code lives together, making it easier to find and understand
2. **Scalability**: Easy to add new features without affecting existing ones
3. **Testability**: Features can be tested in isolation
4. **Team collaboration**: Different teams can work on different features without conflicts
5. **Clear boundaries**: Feature boundaries make dependencies explicit

### How Features Relate to Routes

Features are **independent** of routes. A single feature can be used by multiple routes, and a single route can use multiple features.

**Example:**
- `features/groups/` feature is used by:
  - `/groups` route (list view)
  - `/groups/[group_id]` route (detail view)
  - `/create-group` route (create view)
  - `/home` route (RSVP section)

**Route files** are thin wrappers that import from features:
```typescript
// app/groups/index.tsx
import { GroupsScreen } from "@/features/groups/components/GroupsScreen";
export default GroupsScreen;
```

### Feature Boundaries

**Clear Separation:**
- Features don't import from other features directly
- Shared code goes in `components/ui/` or `utils/`
- Features communicate through:
  - Shared state (React Query cache)
  - Events (if needed)
  - Navigation (route params)

**Example:**
```typescript
// ❌ BAD: Feature importing from another feature
import { useGroups } from "@/features/groups/hooks/useGroups";
import { GroupCard } from "@/features/groups/components/GroupCard";

// ✅ GOOD: Feature using shared components
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
```

### Feature Module Structure

Each feature follows this structure:

```
features/[feature-name]/
├── components/           # Feature-specific components
│   ├── ComponentName.tsx
│   └── index.ts         # Barrel export
├── hooks/                # Feature-specific hooks
│   ├── useFeature.ts
│   └── index.ts
├── services/             # Feature-specific API calls
│   ├── feature.api.ts
│   └── index.ts
├── utils/                # Feature-specific utilities
│   ├── utility.ts
│   └── index.ts
├── types.ts              # Feature-specific types
└── index.ts              # Barrel export (re-exports all)
```

**Example:**
```
features/groups/
├── components/
│   ├── GroupsScreen.tsx
│   ├── GroupCard.tsx
│   └── index.ts
├── hooks/
│   ├── useGroups.ts
│   ├── useGroupDetails.ts
│   └── index.ts
├── services/
│   ├── groups.api.ts
│   └── index.ts
├── utils/
│   ├── formatNextMeeting.ts
│   └── index.ts
├── types.ts
└── index.ts
```

### Barrel Exports

Each feature has an `index.ts` that re-exports everything:

```typescript
// features/groups/index.ts
export * from "./components";
export * from "./hooks";
export * from "./services";
export * from "./utils";
export * from "./types";
```

**Usage:**
```typescript
// In route file or other features
import { GroupsScreen, useGroups, groupsFeatureApi } from "@/features/groups";
```

### Shared Code Organization

**Shared UI Components:**
- Location: `components/ui/`
- Examples: `Button`, `Input`, `Modal`, `Card`
- Used across multiple features

**Shared Utilities:**
- Location: `utils/`
- Examples: `storage.ts`, `styles.ts`
- Used across multiple features

**Shared Types:**
- Location: `types/`
- Examples: `api.ts` (global API types)
- Used across multiple features

### Feature Communication Patterns

**1. Shared State (React Query):**
```typescript
// Feature A invalidates query
queryClient.invalidateQueries({ queryKey: ["userGroups"] });

// Feature B automatically refetches
const { data } = useQuery({ queryKey: ["userGroups"] });
```

**2. Navigation (Route Params):**
```typescript
// Feature A navigates with params
router.push(`/groups/${group.id}`);

// Feature B reads params
const { group_id } = useLocalSearchParams();
```

**3. Events (if needed):**
```typescript
// Feature A emits event
EventEmitter.emit("groupUpdated", groupId);

// Feature B listens
EventEmitter.on("groupUpdated", handleUpdate);
```

## Consequences

### Positive

- **Maintainability**: Easy to find and modify feature code
- **Testability**: Features can be tested in isolation
- **Scalability**: Easy to add new features
- **Team collaboration**: Multiple developers can work on different features
- **Clear dependencies**: Feature boundaries make dependencies explicit

### Negative

- **Initial setup**: More structure to set up for new features
- **Learning curve**: Developers need to understand feature boundaries
- **Potential duplication**: Some utilities might be duplicated (though shared code minimizes this)

### Examples from Codebase

**Complete Feature Example:**
```
features/auth/
├── components/
│   ├── SignInScreen.tsx
│   ├── SignInForm.tsx
│   ├── ChurchSearch.tsx
│   └── index.ts
├── hooks/
│   ├── useSignIn.ts
│   ├── useChurchSearch.ts
│   └── index.ts
├── services/
│   ├── auth.api.ts
│   └── index.ts
├── utils/
│   ├── formatAuthError.ts
│   ├── churchStorage.ts
│   └── index.ts
├── types.ts
└── index.ts
```

**Route Using Feature:**
```typescript
// app/(auth)/signin/index.tsx
import { SignInScreen } from "@/features/auth/components/SignInScreen";
export default SignInScreen;
```

## References

- [Feature-Based Architecture](https://kentcdodds.com/blog/colocation)
- [Barrel Exports Pattern](https://basarat.gitbook.io/typescript/main-1/barrel)

