# Architecture Documentation

This folder contains Architecture Decision Records (ADRs) and implementation guides for the Togather platform.

## ADRs by Feature Area

### Chat & Messaging

| ADR | Status | Description |
|-----|--------|-------------|
| [ADR-008](./ADR-008-community-announcement-groups.md) | Proposed | Community announcement groups |
| [ADR-020](./ADR-020-convex-native-messaging.md) | Implemented | Convex native messaging |

### Events & RSVPs

| ADR | Status | Description |
|-----|--------|-------------|
| [ADR-002](./ADR-002-event-rsvp-chat-integration.md) | In Progress | Event RSVP with chat integration |
| [ADR-003](./ADR-003-event-sharing-system.md) | Complete | Partiful-style event sharing with short IDs |
| [ADR-009](./ADR-009-link-preview-system.md) | Complete | Cloudflare Worker link previews for events |
| [ADR-011](./ADR-011-timezone-handling.md) | Implemented | Timezone handling for events |

### User Management

| ADR | Status | Description |
|-----|--------|-------------|
| [ADR-010](./ADR-010-primary-admin-role.md) | Implemented | Primary admin role hierarchy |

---

## Frontend Architecture Decisions

Located in [`decisions/`](./decisions/) - patterns for the mobile app.

| ADR | Status | Description |
|-----|--------|-------------|
| [ADR-001](./decisions/ADR-001-expo-router-file-based-routing.md) | Accepted | File-based routing with Expo Router |
| [ADR-002](./decisions/ADR-002-feature-based-organization.md) | Accepted | Feature-based code organization |
| [ADR-004](./decisions/ADR-004-dual-react-versions.md) | Accepted | React 18 (web) + React 19 (mobile) - temporary |
| [ADR-006](./decisions/ADR-006-centralized-prefetch-system.md) | Accepted | Query prefetching for performance |

---

## Implementation Guides

Active implementation guides and refactoring documentation.

| Guide | Status | Description |
|-------|--------|-------------|
| [Events Refactor](./UNIFIED-EVENTS-PAGE-REFACTOR.md) | In Progress | Unified events page refactoring |
| [Events Refactor Status](./UNIFIED-EVENTS-REFACTOR-STATUS.md) | In Progress | Bug tracking for events refactor |
| [Events Testing](./UNIFIED-EVENTS-TESTING-GUIDE.md) | In Progress | CUJ testing for events |
| [Events UI Improvements](./EVENTS-UI-IMPROVEMENTS.md) | In Progress | UI improvements tracking |
| [Tasks PRD](./TASKS-PRD.md) | Proposed | Unified leader task system replacing reminder/reach-out overlap |

### Future/Proposed

| Guide | Status | Description |
|-------|--------|-------------|
| [Map Migration](./MAP_MIGRATION.md) | Proposed | react-native-maps → @rnmapbox/maps |
| [Location Deprecation](./LOCATION_COORDINATES_DEPRECATION.md) | Complete | Deprecating stored coordinates |

---

## Status Legend

- **Implemented/Complete**: Fully implemented and in production
- **In Progress**: Actively being worked on
- **Accepted**: Decision made, implementation follows the pattern
- **Proposed**: Under consideration, not yet implemented

---

## Archived

Legacy ADRs written for the Django backend have been moved to [`/docs/archive/architecture-deprecated/`](../archive/architecture-deprecated/).
