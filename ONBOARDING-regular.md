# Developer Onboarding Guide

Complete documentation for getting started with the Togather codebase.

---

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Getting the Repository](#getting-the-repository)
3. [Environment Setup](#environment-setup)
4. [Setting Up Your Personal Dev Deployment](#setting-up-your-personal-dev-deployment)
5. [Running the App](#running-the-app)
6. [Git Workflow](#git-workflow)
7. [Architecture Overview](#architecture-overview)
8. [CI/CD Pipeline](#cicd-pipeline)
9. [Test-Driven Development](#test-driven-development)
10. [Quick Reference](#quick-reference)

---

## Prerequisites

### Required Software

| Tool | Version | Installation |
|------|---------|--------------|
| **Node.js** | 20+ | `brew install node` or [nodejs.org](https://nodejs.org) |
| **pnpm** | 8+ | `npm install -g pnpm` |
| **Git** | Latest | `brew install git` |
| **Xcode** | Latest | [Mac App Store](https://apps.apple.com/us/app/xcode/id497799835) (for iOS development) |

### Xcode & iOS Simulator Setup (Optional -- for iOS development)

1. **Install Xcode** from the Mac App Store (~12GB download)

2. **Accept Xcode license**:
   ```bash
   sudo xcodebuild -license accept
   ```

3. **Install Command Line Tools**:
   ```bash
   xcode-select --install
   ```

4. **Install iOS Simulator runtime**:
   - Open Xcode -> Settings -> Platforms
   - Download the latest iOS Simulator runtime

5. **Verify**:
   ```bash
   xcrun simctl list devices
   ```

---

## Getting the Repository

Each developer gets their own Convex dev deployment. This prevents conflicts when multiple developers work on backend changes simultaneously.

```bash
git clone <repository-url>
cd togather
pnpm install
```

---

## Environment Setup

### 1. Configure Environment Variables

Copy the example environment file and fill in the required values:

```bash
cp .env.example .env.local
```

See `docs/secrets.md` for a full list of required and optional environment variables.

### Environments

| Environment | Usage |
|-------------|-------|
| `dev` | Local development (default) |
| `staging` | Pre-production |
| `prod` | Production |

---

## Setting Up Your Personal Dev Deployment

Each developer gets their own Convex backend for development. This ensures your changes don't affect other developers.

### Create Your Deployment

1. Run `npx convex dev` in the project root
2. When prompted, log in to Convex (browser will open)
3. Select "Create a new project" when asked
4. Name it something like "togather-yourname-dev"
5. Keep this terminal running -- it syncs your code to your deployment

### Seed Test Data

Your new deployment is empty. Populate it with test data:

```bash
# In a new terminal
npx convex run functions/seed:seedDemoData
```

This creates:
- Demo Community
- Sample groups (Young Adults, Small Groups, etc.)
- Test users including the bypass phone number
- Sample meetings and data

### Test Credentials

After seeding, use the test phone number and OTP bypass code from the seed data to log in. Search for "Demo Community" to find the seeded community.

---

## Running the App

### Start Development

```bash
pnpm dev
```

- Expo dev server: `http://localhost:8081`
- Connects to your personal Convex deployment
- Hot reloads on changes

### Run in Browser

```bash
# Press 'w' in Expo terminal, or:
cd apps/mobile && pnpm web
```

### Run on iOS Simulator

```bash
# Press 'i' in Expo terminal, or:
cd apps/mobile && pnpm ios
```

### Run on Android

```bash
# Press 'a' in Expo terminal, or:
cd apps/mobile && pnpm android
```

### Full-Stack Development

```bash
pnpm dev             # Expo + Convex dev servers
pnpm dev --mobile    # Expo only (if Convex already running)
pnpm dev --convex    # Convex only (backend development)
```

- `pnpm dev` runs both Expo and keeps your Convex deployment synced
- Your mobile app connects to YOUR personal dev deployment via the URL in `.env.local`
- Convex dev server syncs functions to your cloud deployment
- Frontend connects to Convex with real-time updates

---

## Git Workflow

We use **trunk-based development** with a single protected `main` branch.

### Branch Strategy

```
main <- PRs merged here -> auto-deploy staging -> manual trigger -> production
  |
  +-- feature/* <- Your work happens here
```

### Protected Branches

**Direct pushes to `main` are blocked** by a Husky pre-push hook.

### Developer Workflow

1. **Create feature branch from main:**
   ```bash
   git checkout main && git pull
   git checkout -b feature/my-feature
   ```

2. **Work on your feature**, commit frequently:
   ```bash
   git add .
   git commit -m "feat: add new feature"
   ```

3. **Push your feature branch:**
   ```bash
   git push -u origin feature/my-feature
   ```

4. **Create PR against `main`:**
   ```bash
   gh pr create --base main --title "feat: my feature"
   ```

5. **Merge to main** -> Automatically deploys to staging environment

6. **Test in staging** (install the staging app build)

7. **When ready for production**, trigger "Deploy to Production" workflow in GitHub Actions

### Feature Flags

For incomplete or risky features, use PostHog feature flags:

```tsx
const showNewFeature = useFeatureFlag("feature-new-checkout");
if (showNewFeature) return <NewCheckoutFlow />;
```

**Flag naming:**
- `feature-{name}` - Feature gates
- `experiment-{name}` - A/B tests
- `rollout-{name}` - Gradual rollouts

### Personal Dev vs Shared Deployments

| Environment | Scope | Purpose |
|-------------|-------|---------|
| Personal dev | Your machine only | Local development with your own data |
| Staging | Shared by team | Testing before production (auto-deployed on merge to main) |
| Production | Live users | The real app (deployed via manual workflow) |

**Important:**
- Your personal dev deployment is for local development only
- When you merge to `main`, CI automatically deploys to the **shared staging** environment
- Test in staging, then trigger production deploy when ready
- Never share your personal dev deployment URL with others

---

## Architecture Overview

### Monorepo Structure

```
togather/
├── apps/
│   ├── convex/           # Convex backend (functions, schema, crons)
│   ├── mobile/           # Expo app (iOS, Android, Web)
│   ├── web/              # Landing page
│   └── link-preview/     # Link preview worker
├── packages/
│   ├── shared/           # Shared types & utilities
│   └── notifications/    # Notification templates
├── docs/                 # Documentation
└── scripts/              # Dev scripts
```

Background jobs (birthday bot, task reminders, meeting reminders, etc.) run as Convex cron jobs and scheduled functions -- see `apps/convex/crons.ts` and `apps/convex/functions/scheduledJobs.ts`.

### Tech Stack

**Backend (`apps/convex/`)**
- Convex (serverless functions + database + messaging)
- Twilio, Cloudflare R2

**Frontend (`apps/mobile/`)**
- Expo SDK 54 + React 19
- Expo Router (file-based routing)
- Convex React hooks
- Zustand, Mapbox

**Landing Page (`apps/web/`)**
- Static HTML/CSS/JS
- Cloudflare Pages

### External Services

| Service | Purpose |
|---------|---------|
| Convex | Serverless backend + real-time database + messaging |
| Cloudflare | Landing page, workers |
| Twilio | SMS |
| Cloudflare R2 | Storage |
| Mapbox | Maps |
| Expo EAS | Mobile builds |

---

## CI/CD Pipeline

### Automated Checks (Every PR)

| Job | Checks |
|-----|--------|
| `test-shared` | Shared package tests |
| `test-mobile` | Mobile tests + fingerprint |
| `test-convex` | Convex types + functions |

### Deployments (Trunk-Based)

We use trunk-based development: all PRs merge to `main`, which auto-deploys to staging. Production deploys via manual workflow trigger.

### PR Requirements

- All tests pass
- Type checks pass
- Fingerprint check passes

### Run Locally

```bash
pnpm test                        # All tests
cd apps/mobile && pnpm test      # Mobile tests
cd apps/convex && pnpm type-check  # Convex types
```

---

## Test-Driven Development

### Workflow

1. **Write failing test** - Define behavior
2. **Implement** - Make it pass
3. **Refactor** - Clean up
4. **Verify visually** - Playwright

### Commands

```bash
pnpm test                          # All
cd apps/mobile && pnpm test        # Mobile
cd apps/mobile && pnpm test --watch  # Watch mode
```

### Structure

```
apps/mobile/
├── __tests__/               # Integration
├── features/*/components/__tests__/  # Component
├── features/*/hooks/__tests__/       # Hook
└── components/ui/*.test.tsx          # UI
```

---

## Quick Reference

### Daily Commands

```bash
pnpm dev                  # Expo + Convex dev servers
pnpm dev --mobile         # Expo only (if Convex running)
pnpm dev --convex         # Convex only
pnpm test                 # Run tests
```

### Platform Commands

```bash
cd apps/mobile
pnpm web      # Browser
pnpm ios      # iOS Simulator
pnpm android  # Android
```

### Key Files

| File | Purpose |
|------|---------|
| `CLAUDE.md` | Agent instructions |
| `docs/README.md` | Doc index |
| `docs/secrets.md` | Environment variable reference |

### Links

| Resource | URL |
|----------|-----|
| Expo | `http://localhost:8081` |
| Convex Dashboard | Run `pnpm convex:dashboard` |

---

## Checklist

- [ ] Prerequisites installed
- [ ] Repository cloned
- [ ] Environment variables configured
- [ ] `pnpm install` completed
- [ ] Personal Convex deployment created (`npx convex dev`)
- [ ] Seed data populated (`npx convex run functions/seed:seedDemoData`)
- [ ] `pnpm dev` runs successfully
- [ ] Logged in with test credentials
- [ ] Read `CLAUDE.md`

Welcome to the project!
