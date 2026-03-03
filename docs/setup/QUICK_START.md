# Quick Start Guide

## Current Development Focus

**We are actively developing both frontend and backend in a full-stack monorepo.**

- **Full-stack development**: Developing new features across mobile and Convex backend
- **Production deployment**: Backend on Convex, mobile distributed via TestFlight (iOS) with EAS OTA updates
- **Local development**: Convex dev server syncs to cloud, mobile connects to Convex
- **Type-safe API**: End-to-end type safety with Convex from database to frontend

## For New Developers

### One-Command Setup (First Time Only)

```bash
pnpm install
```

This will:

- Install all Node.js dependencies
- Set up the workspace (mobile app, Convex backend, shared packages)

**Time:** ~2-5 minutes (mostly waiting for package installation)

**That's it!** No manual file editing required.

---

## Daily Development

### Full-Stack Development (Recommended)

**For most developers:**

```bash
pnpm dev
```

This command:

- Starts **Convex dev server** (syncs functions to cloud)
- Starts **Expo dev server** with hot reload
- Mobile app connects to Convex cloud with real-time updates

### Frontend-Only Development

**If Convex is already running in another terminal:**

```bash
pnpm dev --mobile
```

This command:

- Starts only Expo dev server with hot reload
- Assumes Convex dev server is already running

### Backend-Only Development

**For Convex function development without frontend:**

```bash
pnpm dev --convex
```

This command:

- Starts only Convex dev server
- Syncs functions to Convex cloud on file changes

**That's it!** Check the terminal output for the Expo dev server URL.

---

## What Happens Behind the Scenes

### When You Run `pnpm dev` (Full Stack):

1. **Backend (Convex)**
   - Convex dev server starts and syncs functions to cloud
   - Auto-deploys when TypeScript files in `apps/convex/` change
   - Real-time database with reactive queries

2. **Frontend (Expo)**
   - Starts Expo dev server (Metro bundler)
   - Hot reloads when React/TypeScript files change
   - Connects to Convex cloud with real-time updates

---

## Running on Specific Platforms

Once `pnpm dev` is running:

**In the Expo terminal**, press:

- `i` - Open iOS simulator
- `a` - Open Android emulator
- `w` - Open web browser

Or manually:

```bash
cd apps/mobile
pnpm ios      # iOS
pnpm android  # Android
pnpm web      # Web
```

---

## Troubleshooting

### Convex Won't Start

1. **Check you're logged in to Convex:**

   ```bash
   npx convex login
   ```

2. **Check Convex dashboard:**

   ```bash
   pnpm convex:dashboard
   ```

3. **View Convex logs:**
   ```bash
   pnpm convex:logs
   ```

### Frontend Won't Connect

1. **Check Convex dev server is running** (should show in terminal output)
2. **Check your internet connection** (Convex syncs to cloud)
3. **Clear Expo cache:** `cd apps/mobile && pnpm start --clear`

---

## Complete Commands Reference

```bash
# Setup (first time only)
pnpm install

# Development
pnpm dev              # Convex + Expo dev servers (recommended)
pnpm dev --mobile     # Expo only (if Convex already running)
pnpm dev --convex     # Convex only

# Convex Tools
pnpm convex:dashboard # Open Convex dashboard
pnpm convex:logs      # View Convex logs

# Build
pnpm build            # Build all apps
```

**Command Usage:**
- **`pnpm dev`** - Use this for full-stack development (most common)
- **`pnpm dev --mobile`** - Use this if Convex is already running in another terminal
- **`pnpm dev --convex`** - Use this for backend-only development

---

## Next Steps

1. Run `pnpm install` (one time)
2. Run `pnpm dev` (every day)
3. Press `i` in Expo terminal to open iOS simulator
4. Start coding!

---

## Need More Help?

- **Detailed Setup**: See `SETUP_INSTRUCTIONS.md`
- **Backend Development**: See `apps/convex/` for Convex functions
- **Type Sharing**: Types are automatically inferred from Convex schema

---

## Pro Tips

**Real-time Updates**: Convex provides real-time reactive queries - UI updates automatically when data changes!

**Hot Reload**: Expo auto-reloads on file changes - no manual restart needed!

**Type Safety**: Convex provides end-to-end type safety - types flow from database schema to frontend!

**Reference Codebases**: Check `ios-deprecated/` (App Store app) and `web-deprecated/` (web app) to see how features were implemented!

**Multiple Terminals**: If you prefer separate terminals, use:

- Terminal 1: `pnpm dev --convex`
- Terminal 2: `pnpm dev --mobile`

**Watch Mode**: Convex auto-syncs when you save TypeScript files in `apps/convex/`!
