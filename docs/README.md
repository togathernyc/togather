# Documentation Index

## Overview

This directory contains documentation for the Togather monorepo, including architecture decisions, feature documentation, setup guides, and debugging playbooks.

## Current Stack

- **Backend**: Convex (serverless functions + real-time database + messaging)
- **Mobile**: Expo (React Native) with Expo Router
- **Real-time**: Convex reactive queries and messaging
- **Notifications**: Expo Push + Twilio SMS
- **Background Jobs**: Convex Crons (scheduled functions)
- **Storage**: Cloudflare R2 (with Image Transformations)
- **Secrets**: 1Password
- **DNS/CDN**: Cloudflare + Terraform

For architecture diagrams, see the [Main README](../README.md).

---

## Documentation Structure

### Architecture & Design

**[Architecture Decision Records](./architecture/)** - Key architectural decisions

| ADR | Decision |
|-----|----------|
| [ADR-002](./architecture/ADR-002-event-rsvp-chat-integration.md) | Event RSVP with chat integration |
| [ADR-003](./architecture/ADR-003-event-sharing-system.md) | Event sharing system (Partiful-style) |
| [ADR-007](./architecture/ADR-007-notification-system.md) | Notification system architecture |
| [ADR-008](./architecture/ADR-008-community-announcement-groups.md) | Community announcement groups |
| [ADR-009](./architecture/ADR-009-link-preview-system.md) | Link preview system for event sharing |
| [ADR-010](./architecture/ADR-010-primary-admin-role.md) | Primary admin role |
| [ADR-011](./architecture/ADR-011-timezone-handling.md) | Timezone handling for events |
| [ADR-016](./architecture/ADR-016-cloudflare-images-migration.md) | Cloudflare R2 + Image Transformations (implemented) |

**[Frontend Architecture ADRs](./architecture/decisions/)** - Mobile app patterns

| ADR | Decision |
|-----|----------|
| [ADR-001](./architecture/decisions/ADR-001-expo-router-file-based-routing.md) | Expo Router file-based routing |
| [ADR-002](./architecture/decisions/ADR-002-feature-based-organization.md) | Feature-based code organization |
| [ADR-004](./architecture/decisions/ADR-004-dual-react-versions.md) | Dual React versions (temporary) |
| [ADR-006](./architecture/decisions/ADR-006-centralized-prefetch-system.md) | Centralized prefetch system |

**Implementation Guides:**
- [Planning Center Integration](./architecture/ADR-PLANNING-CENTER-INTEGRATION.md) (proposed)
- [Unified Events Page Refactor](./architecture/UNIFIED-EVENTS-PAGE-REFACTOR.md)

---

### Feature Documentation

**[Features Overview](./features/README.md)** - All feature documentation

| Feature | Description |
|---------|-------------|
| [Phone Auth](./features/phone-auth.md) | Phone-based authentication with Twilio |
| [Groups](./features/groups.md) | Group management and RSVP |
| [Leader Tools](./features/leader-tools.md) | Leader dashboard, attendance, events |
| [Home](./features/home.md) | Main dashboard |
| [Profile](./features/profile.md) | User profile |
| [Settings](./features/settings.md) | User settings |
| [Admin](./features/admin.md) | Admin functionality |
| [Near Me](./features/nearme-feature-summary.md) | Location-based features |
| [Primary Admin](./features/PRIMARY-ADMIN-HANDOFF.md) | Primary admin role handoff |

---

### Setup & Configuration

**[Setup Guides](./setup/)** - Installation and configuration

| Guide | Purpose |
|-------|---------|
| [Quick Start](./setup/QUICK_START.md) | Get running quickly |
| [Setup Instructions](./setup/SETUP_INSTRUCTIONS.md) | Detailed setup |
| [Environment Variables](./setup/ENVIRONMENT_VARIABLES.md) | Environment configuration |
| [Testing on Phone](./setup/TESTING_ON_PHONE.md) | Mobile device testing |
| [EAS Builds](./setup/EAS_BUILDS.md) | Expo EAS build configuration |
| [EAS Workflows](./setup/EAS_WORKFLOWS_SETUP.md) | EAS Workflows for CI/CD |
| [iOS Build Credentials](./setup/IOS_BUILD_CREDENTIALS.md) | iOS signing setup |
| [Notification Setup](./setup/NOTIFICATION_SETUP.md) | Push notification configuration |

**Secrets Management:** [secrets.md](./secrets.md) - 1Password integration

---

### Debugging & Troubleshooting

**[Debugging Playbooks](./debugging/README.md)** - Common issues and fixes

| Issue | Solution |
|-------|----------|
| [Metro React Multiple Instances](./debugging/METRO_REACT_MULTIPLE_INSTANCES.md) | "Cannot read properties of null" error |
| [Jest Expo Patch](./debugging/JEST_EXPO_PATCH_ISSUE.md) | React 19 compatibility |

---

### Testing Guides

**[Testing Guides](./guides/)** - Manual testing documentation

- [Manual Testing CUJs](./guides/manual-testing-cujs.md) - Critical user journey testing
- [Navigation CUJ Testing](./guides/navigation-cuj-testing.md) - Navigation flow testing
- [Quick Make Leader](./guides/quick-make-leader.md) - Make a user a leader quickly

**Test Credentials:** See [CLAUDE.md](../CLAUDE.md) for test account credentials.

---

### Technical Debt

**[Tech Debt](./tech-debt/)** - Active technical debt tracking

| Issue | Description |
|-------|-------------|
| [Image Compression Workflow](./tech-debt/image-compression-workflow.md) | Legacy compression implementation (superseded by R2) |

---

### Active Migrations

**[Migrations](./migrations/)** - In-progress migration work

- [Query Keys Consolidation](./migrations/QUERY_KEYS_CONSOLIDATION_PLAN.md) - React Query key consolidation
- [Query Keys Migration Map](./migrations/QUERY_KEYS_MIGRATION_MAP.md) - Key mapping reference

---

## Quick Links

### For New Developers

1. Read [Quick Start](./setup/QUICK_START.md) to get running
2. Review [Feature-Based Organization](./architecture/decisions/ADR-002-feature-based-organization.md) to understand code structure
3. Review the chat feature in `apps/mobile/features/chat/ARCHITECTURE.md` for messaging implementation

### For Frontend Development

- **Routing**: [Expo Router ADR](./architecture/decisions/ADR-001-expo-router-file-based-routing.md)
- **Prefetching**: [Centralized Prefetch System](./architecture/decisions/ADR-006-centralized-prefetch-system.md)
- **Testing**: Run `pnpm test` from `apps/mobile`

### For Backend Development

- Run `pnpm dev` for full-stack development (starts Convex + Expo)
- Backend code is in `apps/convex/`
- Database schema defined in `apps/convex/schema.ts`
- Functions in `apps/convex/functions/`
- Background jobs use Convex crons (see `apps/convex/crons.ts`)

---

## Archived Documentation

Historical documentation is preserved in [`archive/`](./archive/). This includes:

- Legacy Django backend docs
- Swagger/OpenAPI documentation (replaced by Convex functions)
- Completed migration guides
- Chat provider analysis (now using Convex for messaging)

**Warning**: Archived docs are not maintained and may contain outdated information.

---

## Contributing to Documentation

When adding features or making architectural changes:

1. **Create ADRs** for significant decisions in `architecture/`
2. **Update feature docs** in `features/`
3. **Add debugging guides** for new error patterns in `debugging/`
4. **Update this README** if adding new sections
