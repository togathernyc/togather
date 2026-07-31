---
name: onboarding-new-dev
description: Read when a developer asks for help getting started, setting up the repo locally, creating their own Convex deployment, seeding demo data, or troubleshooting an empty app / "Demo Community not found" / Convex auth failure. Also covers the dev commands table, local app URLs, and the seeded test credentials used for Playwright and iOS Simulator testing.
---

# Onboarding a New Developer (Togather)

When a new developer asks for help getting started, guide them through these steps.

## Prerequisites Check

First, verify they have:
- Node.js v20+ (`node --version`)
- pnpm v8+ (`pnpm --version`)

If missing, point them to:
- Node: https://nodejs.org or use nvm
- pnpm: `npm install -g pnpm`

## Access Requirements

They need:
1. **Environment variables** - See `docs/secrets.md` for required variables
2. **Convex account** - Free at https://convex.dev (they'll create during setup)

## Step-by-Step Setup

1. **Install dependencies:**
   ```bash
   pnpm install
   ```

2. **Set up environment variables:**
   ```bash
   cp .env.example .env.local
   # Edit .env.local with your values (see docs/secrets.md)
   ```

3. **Create personal Convex deployment:**
   ```bash
   npx convex dev
   ```
   - This opens browser for Convex login
   - Select "Create a new project"
   - Name it "togather-[their-name]-dev"
   - Keep this terminal running

4. **Seed test data (new terminal):**
   ```bash
   npx convex run functions/seed:seedDemoData
   ```

5. **Start development:**
   ```bash
   pnpm dev
   ```

6. **Test the app:**
   - Open iOS Simulator or Expo Go
   - Login with the seeded test phone number and OTP bypass code
   - Search for "Demo Community"

## Troubleshooting

- **Convex auth fails** - Run `npx convex logout` then `npx convex dev` again
- **Empty app / no data** - They forgot to run the seed script
- **"Demo Community not found"** - Run `npx convex run functions/seed:seedDemoData`

## Testing

When testing the app (Playwright, iOS Simulator, etc.), use the seeded test credentials from the seed script. The test phone number and OTP bypass code are configured in the seed data.

> **Note:** If "Demo Community" doesn't exist, run the seed script first:
> ```bash
> npx convex run functions/seed:seedDemoData
> ```

**Development Commands:**

| Command             | What it does                                      |
| ------------------- | ------------------------------------------------- |
| `pnpm dev`          | Run Convex dev + Expo together                    |
| `pnpm dev --mobile` | Run only Expo (if Convex is already running)      |
| `pnpm dev --convex` | Run only Convex dev                               |

**App URLs:**

- Expo/Metro: http://localhost:8081
- Convex Dashboard: Run `pnpm convex:dashboard`
- Convex Logs: Run `pnpm convex:logs`

Note for open-source contributors: the "Agent Backend Selection" rules (see the
`secrets-and-backends` skill) apply **only** to maintainer CI agents. You create
your own personal Convex deployment via `npx convex dev` as described above.
