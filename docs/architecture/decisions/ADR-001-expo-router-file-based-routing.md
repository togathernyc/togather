# ADR-001: Expo Router File-Based Routing

## Status

Accepted

## Context

The mobile application uses Expo Router for navigation, which provides file-based routing similar to Next.js. This decision affects how routes are organized, how navigation works, and how developers add new screens to the application.

## Decision

We use Expo Router's file-based routing system where:
- Every file in the `app/` directory defines a route
- File structure directly maps to URL structure
- Route files are thin wrappers (3 lines) that import components from features
- Route groups (parentheses) organize routes without affecting URLs
- Dynamic routes use square brackets (`[id]`, `[group_id]`)

## Rationale

### Why Expo Router

1. **File-based routing**: Routes are defined by file structure, making navigation intuitive
2. **Universal deep linking**: Automatic support for deep links based on file structure
3. **Type-safe navigation**: TypeScript support for route parameters
4. **Built on React Navigation**: Leverages the mature React Navigation library
5. **Expo integration**: Seamless integration with Expo SDK

### How File Structure Maps to Navigation

The file structure in `app/` directly maps to URL paths:

```
app/
├── index.tsx                    → /
├── home/
│   └── index.tsx                → /home
├── groups/
│   ├── index.tsx                → /groups
│   └── [group_id]/
│       └── index.tsx            → /groups/123
├── (auth)/
│   ├── signin/
│   │   └── index.tsx            → /signin
│   └── signup/
│       └── index.tsx            → /signup
└── (tabs)/
    ├── index.tsx                → / (default tab)
    ├── groups.tsx               → /groups
    └── chat.tsx                 → /chat
```

### Route Groups vs Explicit Routes

**Route Groups (Parentheses):**
- Use parentheses `(auth)`, `(tabs)`, `(user)` for organization
- Do NOT affect the URL path
- Useful for grouping related routes with shared layouts
- Example: `app/(auth)/signin/index.tsx` → `/signin` (not `/auth/signin`)

**Explicit Routes:**
- Use regular directories for explicit URL paths
- Example: `app/admin/dashboard/index.tsx` → `/admin/dashboard`

### Dynamic Routes

Dynamic routes use square brackets:
- `[id]` → Single dynamic segment
- `[group_id]` → Named dynamic segment
- Example: `app/groups/[group_id]/index.tsx` → `/groups/123`

Access route parameters using `useLocalSearchParams()`:
```typescript
import { useLocalSearchParams } from "expo-router";

export default function GroupDetail() {
  const { group_id } = useLocalSearchParams();
  // group_id is "123" for /groups/123
}
```

### Route File Conventions

**Thin Wrapper Pattern:**
All route files follow a 3-line pattern:
```typescript
import { ComponentName } from "@/features/feature-name/components/ComponentName";
export default ComponentName;
```

This ensures:
- No business logic in route files
- Clear separation between routing and feature code
- Easy to find where components are defined
- Consistent pattern across all routes

**Example:**
```typescript
// app/groups/index.tsx
import { GroupsScreen } from "@/features/groups/components/GroupsScreen";
export default GroupsScreen;
```

### Layout Files

Layout files (`_layout.tsx`) define navigation relationships:
- Root `_layout.tsx`: App-wide providers and error boundaries
- Route group `_layout.tsx`: Stack or tab navigators for that group
- Example: `app/(tabs)/_layout.tsx` defines a tab navigator

## Consequences

### Positive

- **Intuitive navigation**: File structure = URL structure
- **Type safety**: TypeScript support for route parameters
- **Deep linking**: Automatic support for universal links
- **Consistent patterns**: Thin wrapper pattern makes routes easy to understand
- **Separation of concerns**: Routes are separate from feature logic

### Negative

- **Learning curve**: Developers need to understand Expo Router conventions
- **File organization**: Must keep `app/` directory clean (only route files)
- **Migration effort**: Existing routes needed refactoring to thin wrapper pattern

### Examples from Codebase

**Static Route:**
```typescript
// app/home/index.tsx
import { HomeScreen } from "@/features/home/components/HomeScreen";
export default HomeScreen;
```

**Dynamic Route:**
```typescript
// app/groups/[group_id]/index.tsx
import { GroupDetailScreen } from "@/features/groups/components/GroupDetailScreen";
export default GroupDetailScreen;
```

**Route Group:**
```typescript
// app/(auth)/signin/index.tsx
import { SignInScreen } from "@/features/auth/components/SignInScreen";
export default SignInScreen;
```

## References

- [Expo Router Core Concepts](https://docs.expo.dev/router/basics/core-concepts/)
- [Expo Router Notation](https://docs.expo.dev/router/basics/notation/)
- [Expo Router Common Patterns](https://docs.expo.dev/router/basics/common-navigation-patterns/)

