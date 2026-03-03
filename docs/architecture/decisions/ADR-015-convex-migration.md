# ADR-015: Migration to Convex

## Status

Accepted

## Context

Togather currently uses:

- **Database**: Supabase (PostgreSQL)
- **API Layer**: tRPC with Node.js
- **ORM**: Prisma
- **Auth**: Custom phone-based auth with Supabase

This architecture requires maintaining multiple services and has complexity around real-time updates, type safety across the stack, and deployment.

## Decision

We are migrating to **Convex** as our backend platform. Convex provides:

1. **Integrated Backend**: Database, serverless functions, and real-time subscriptions in one platform
2. **Full Type Safety**: End-to-end TypeScript types from database schema to frontend queries
3. **Real-time by Default**: All queries automatically update when data changes
4. **Simplified Deployment**: Single platform to deploy, no separate database/API hosting
5. **Built-in Auth Support**: Integration with Clerk, Auth0, and custom JWT providers

## Migration Strategy

### Phase 1: Setup (Current)

- Install Convex in monorepo
- Define database schema mirroring existing Supabase schema
- Set up basic CRUD functions for each domain

### Phase 2: Parallel Development

- Build new features in Convex while maintaining existing tRPC API
- Gradually migrate existing endpoints to Convex
- Keep Stream Chat integration (Convex will store metadata, Stream handles messaging)

### Phase 3: Mobile Integration

- Update mobile app to use Convex React hooks
- Implement optimistic updates with Convex mutations
- Set up real-time subscriptions for live data

### Phase 4: Auth Migration

- Evaluate auth providers (Clerk recommended for Convex)
- Migrate phone-based auth to new provider
- Implement user migration script

### Phase 5: Cutover

- Migrate production data from Supabase to Convex
- Switch traffic to Convex backend
- Deprecate tRPC API

## Directory Structure

```
convex/
├── _generated/          # Auto-generated types (gitignored except .gitkeep)
├── schema.ts            # Database schema definition
├── auth.ts              # Authentication configuration
├── functions/           # Domain-organized functions
│   ├── users.ts
│   ├── communities.ts
│   ├── groups.ts
│   └── meetings.ts
└── lib/                 # Shared utilities
    ├── utils.ts
    └── validators.ts
```

## Consequences

### Positive

- Simpler architecture with fewer moving parts
- Better developer experience with full type safety
- Real-time updates without additional WebSocket setup
- Reduced infrastructure management

### Negative

- Learning curve for team members new to Convex
- Migration effort for existing features
- Vendor lock-in to Convex platform
- Need to evaluate/change auth provider

### Neutral

- Stream Chat remains as external messaging service
- Mobile app patterns similar (React hooks for data fetching)

## References

- [Convex Documentation](https://docs.convex.dev)
- [Convex + React Native Guide](https://docs.convex.dev/client/react-native)
- [Convex Auth Documentation](https://docs.convex.dev/auth)
