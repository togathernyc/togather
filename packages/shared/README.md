# @togather/shared

Shared TypeScript types, utilities, and API client for the Togather monorepo. This package provides common code used by both the mobile app and backend.

## Installation

This package is automatically available in the monorepo via pnpm workspaces:

```typescript
import { storage, queryKeys } from '@togather/shared'
import type { User, Group, Community } from '@togather/shared/types'
```

## What's Included

### Types (`/types`)

TypeScript interfaces shared between frontend and backend:

- **`User`** - User entity with ID, email, profile info
- **`Community`** - Community metadata (id, name, subdomain, logo)
- **`Group`** - Group definitions with type mappings
- **`GroupType`** - Group type definitions

```typescript
import type { User, Group, Community } from '@togather/shared/types'
```

### Utilities (`/utils`)

#### Storage

Cross-platform storage abstraction that works on both web and mobile:

```typescript
import { storage } from '@togather/shared/utils/storage'

// Works on web (localStorage) and mobile (SecureStore/AsyncStorage)
await storage.setItem('key', 'value')
const value = await storage.getItem('key')
await storage.removeItem('key')
```

#### Query Keys

Centralized TanStack Query key factory with 40+ query key patterns for cache management:

```typescript
import { queryKeys } from '@togather/shared/utils/query-keys'

// Use in React Query hooks
const { data } = useQuery({
  queryKey: queryKeys.groups.list(),
  queryFn: () => fetchGroups(),
})

// Invalidate queries
queryClient.invalidateQueries({ queryKey: queryKeys.groups.all })
```

#### API Response Helpers

Utilities for handling inconsistent backend response structures:

```typescript
import { extractApiData, extractApiError } from '@togather/shared/utils/api-response'

// Normalize nested responses: {data: {data: X}} → X
const data = extractApiData(response)

// Extract error messages from complex error objects
const errorMessage = extractApiError(error)
```

### API Client (`/api`)

Legacy REST API client (primarily used before tRPC migration):

```typescript
import { initializeApiClient, getClient } from '@togather/shared/api'
import { groupsApi, authApi } from '@togather/shared/api/services'
```

> **Note**: With tRPC, most API calls now go through the tRPC client. The legacy API client is maintained for backward compatibility.

## Project Structure

```
packages/shared/
├── src/
│   ├── index.ts                 # Main entry point
│   ├── api/
│   │   ├── client.ts           # ApiClient class (axios wrapper)
│   │   ├── contracts.ts        # API endpoint documentation
│   │   ├── instance.ts         # Global client singleton
│   │   └── services/           # Feature-specific API modules
│   │       ├── auth.ts
│   │       ├── groups.ts
│   │       ├── members.ts
│   │       ├── chat.ts
│   │       ├── admin.ts
│   │       ├── resources.ts
│   │       └── notes.ts
│   ├── types/
│   │   ├── user.ts
│   │   ├── community.ts
│   │   ├── groups.ts
│   │   └── reports.ts
│   └── utils/
│       ├── storage.ts          # Cross-platform storage
│       ├── api-response.ts     # Response/error extraction
│       └── query-keys.ts       # Query key factory
└── tests/                       # Jest unit tests
```

## Development

### Running Tests

```bash
pnpm test
```

Tests use Jest with TypeScript support and MSW for API mocking.

### Building

```bash
pnpm build
```

## Exports

The package uses fine-grained exports for tree-shaking:

| Import Path | Contents |
|-------------|----------|
| `@togather/shared` | Main exports (storage, queryKeys, types) |
| `@togather/shared/api` | API client and services |
| `@togather/shared/api/services` | Individual API service modules |
| `@togather/shared/types` | TypeScript type definitions |
| `@togather/shared/utils/storage` | Storage abstraction |
| `@togather/shared/utils/query-keys` | Query key factory |
| `@togather/shared/utils/api-response` | Response helpers |
