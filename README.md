# Togather

A community management platform that helps organizations build and manage groups, events, messaging, and member engagement -- all in one place.

## What is Togather?

Togather is an open-source, full-stack community management platform built for organizations that want to:

- **Manage groups** -- Create and organize groups with leaders, members, and meeting schedules
- **Coordinate events** -- Schedule, RSVP, and track attendance for community events
- **Communicate** -- Real-time group messaging with channels and leader-only hubs
- **Discover** -- Help members find and join groups near them with map-based search
- **Administrate** -- Approve join requests, manage roles, and oversee community health

## Tech Stack

### Backend
- **Convex** -- Serverless functions, real-time database, and messaging
- **Twilio** -- SMS notifications and OTP verification
- **Cloudflare R2** -- File storage with image transformations

### Frontend
- **React Native + Expo** -- Cross-platform mobile app (iOS, Android, Web)
- **Expo Router** -- File-based routing
- **Convex React hooks** -- Real-time data subscriptions
- **Mapbox** -- Maps and location services

### Infrastructure
- **pnpm workspaces + Turborepo** -- Monorepo management
- **EAS** -- Mobile builds, OTA updates, and web hosting
- **GitHub Actions** -- CI/CD pipeline

## Project Structure

```
togather/
├── apps/
│   ├── convex/           # Convex backend (serverless functions + database)
│   ├── mobile/           # Expo app (iOS, Android, Web)
│   ├── web/              # Landing page
│   └── link-preview/     # Link preview service (Cloudflare Workers)
├── packages/
│   ├── shared/           # Shared TypeScript types and utilities
│   └── notifications/    # Notification templates and utilities
├── docs/                 # Architecture docs and ADRs
├── scripts/              # Development and deployment scripts
├── ee/                   # Enterprise edition (BSL-licensed, see ee/README.md)
└── package.json          # Root workspace configuration
```

## Getting Started

### Prerequisites

| Tool | Version | Installation |
|------|---------|--------------|
| **Node.js** | 20+ | [nodejs.org](https://nodejs.org) or use nvm |
| **pnpm** | 8+ | `npm install -g pnpm` |
| **Git** | Latest | `brew install git` (macOS) |

### Quick Setup

```bash
# Clone the repository
git clone https://github.com/your-org/togather.git
cd togather

# Install dependencies
pnpm install

# Set up environment variables (see docs/secrets.md)
cp .env.example .env.local
# Edit .env.local with your values

# Create your personal Convex dev deployment
npx convex dev
# Follow browser prompts to create a new project

# Seed test data (in a new terminal)
npx convex run functions/seed:seedDemoData

# Start development
pnpm dev
```

### Development Commands

| Command | What it does |
|---------|--------------|
| `pnpm dev` | Run Convex dev + Expo together |
| `pnpm dev --mobile` | Run only Expo (if Convex is already running) |
| `pnpm dev --convex` | Run only Convex dev |
| `pnpm test` | Run tests across all packages |
| `pnpm lint` | Lint all packages |
| `pnpm build` | Build all apps |

### Test Credentials

After seeding demo data, use these credentials to test:

| Field | Value |
|-------|-------|
| **Phone** | `2025550123` |
| **OTP Code** | `000000` (dev bypass code) |
| **Community** | Search for "Demo Community" |

## Documentation

- **[Architecture Decisions](./docs/architecture/)** -- ADRs and design documents
- **[Feature Documentation](./docs/features/)** -- Feature specs and guides
- **[Setup Guides](./docs/setup/)** -- Installation and configuration
- **[Developer Guides](./docs/guides/)** -- Testing and development workflows

## Contributing

We welcome contributions! Here's how to get started:

### Workflow

1. **Fork the repository** and clone your fork
2. **Create a feature branch** from `main`:
   ```bash
   git checkout -b feature/my-feature
   ```
3. **Make your changes**, committing frequently with descriptive messages
4. **Run tests** to verify nothing is broken:
   ```bash
   pnpm test
   pnpm lint
   ```
5. **Push your branch** and open a Pull Request against `main`
6. **Address review feedback** -- all CI checks must pass and conversations must be resolved

### Code Style

- **TypeScript** throughout the codebase
- **Prefer simplicity** -- readable code over clever abstractions
- **Use framework features** -- prefer built-in Expo/Convex patterns over custom solutions
- **Write tests** -- especially for backend logic
- **Document complexity** -- if code needs explanation, add comments explaining "why"

### Branch Protection

- Direct pushes to `main` are blocked
- PRs require passing CI checks
- All review conversations must be resolved before merge

## License

This project is licensed under the [GNU Affero General Public License v3.0 (AGPL-3.0)](./LICENSE).

The `/ee` directory contains enterprise features licensed under the [Elastic License 2.0](./ee/LICENSE). See [ee/README.md](./ee/README.md) for details.
