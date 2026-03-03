# Setup Instructions for Togather Monorepo

## Current Development Focus

**We are actively developing both frontend and backend in a full-stack monorepo.**

- **Full-stack development**: Developing new features across mobile and Convex backend
- **Production deployment**: Backend on Convex cloud, mobile via Expo EAS
- **Local development**: Convex dev server syncs to cloud, mobile connects to Convex

## Prerequisites

1. **Install PNPM** (if not already installed):

   ```bash
   npm install -g pnpm
   ```

2. **Node.js 18+** (required)

3. **Infisical CLI** (for environment variables):

   ```bash
   brew install infisical/get-cli/infisical
   infisical login
   ```

## Step 1: Install Dependencies

```bash
# From the root directory
pnpm install
```

This will install dependencies for all workspaces (mobile app, Convex backend, shared packages).

## Step 2: Start Development

### Full-Stack Development (Recommended)

```bash
# From root directory
pnpm dev
```

This starts:
- **Convex dev server** - syncs functions to Convex cloud
- **Expo dev server** - hot reloads when files change
- Mobile app connects to Convex with real-time updates

### Frontend-Only Development

If Convex is already running in another terminal:

```bash
pnpm dev --mobile
```

### Backend-Only Development

For Convex function development without frontend:

```bash
pnpm dev --convex
```

## Step 3: Run Mobile App on Platforms

```bash
cd apps/mobile

# iOS Simulator
pnpm ios

# Android Emulator
pnpm android

# Web Browser
pnpm web
```

## Architecture Overview

```
togather/
├── apps/
│   ├── convex/               # Convex backend (serverless functions + database)
│   │   ├── functions/        # Convex functions (queries, mutations, actions)
│   │   ├── schema.ts         # Database schema
│   │   └── _generated/       # Auto-generated types
│   │
│   ├── mobile/               # Expo app
│   │   ├── app/              # Expo Router routes
│   │   │   ├── (auth)/       # Auth screens
│   │   │   ├── (tabs)/       # Main app tabs
│   │   │   └── _layout.tsx
│   │   ├── services/         # API client (Convex hooks)
│   │   ├── providers/        # React providers
│   │   └── package.json
│   │
│   ├── web/                  # Landing page (togather.nyc)
│   └── link-preview/         # Link preview service (Cloudflare Workers)
│
├── packages/
│   └── shared/               # Shared code (types, utilities)
│       └── src/
│
├── ios-deprecated/           # Legacy iOS app - REFERENCE ONLY
├── web-deprecated/           # Legacy web app - REFERENCE ONLY
│
├── package.json              # Root workspace
├── pnpm-workspace.yaml
└── turbo.json
```

## Configuration

### Environment Variables

Environment variables are managed via Infisical. Make sure you're logged in:

```bash
infisical login
```

### Convex Configuration

The mobile app connects to Convex cloud:

- **Convex Cloud**: `https://<your-convex-deployment>.convex.cloud`
- Production and staging share the same Convex deployment with environment detection
- Real-time database with reactive queries
- Serverless functions (queries, mutations, actions)

## First Run Checklist

- [ ] PNPM installed
- [ ] Node.js 18+ installed
- [ ] Infisical CLI installed and logged in
- [ ] All dependencies installed (`pnpm install`)
- [ ] Dev servers start successfully (`pnpm dev`)
- [ ] Mobile app connects to Convex

## Troubleshooting

### PNPM Not Found

```bash
npm install -g pnpm
```

### Convex Issues

- Make sure you're logged in: `npx convex login`
- Check Convex dashboard: `pnpm convex:dashboard`
- View Convex logs: `pnpm convex:logs`
- Check your internet connection (Convex syncs to cloud)

### Mobile App Issues

- Clear Expo cache: `cd apps/mobile && pnpm start --clear`
- Reinstall dependencies: `rm -rf node_modules && pnpm install`
- Check that Convex dev server is running

### Test Issues

- If tests fail with `Object.defineProperty called on non-object`, the jest-expo patch may not be applied
- Run `pnpm install` to ensure the patch is applied (runs automatically via postinstall script)
- See `apps/mobile/scripts/README-PATCHES.md` for troubleshooting

### Workspace Issues

- Make sure you're in the root directory when running `pnpm` commands
- Verify `pnpm-workspace.yaml` is present
- Try deleting `node_modules` in root and running `pnpm install` again

## Next Steps

1. **Test Authentication**: Try logging in with the mobile app
2. **Add Features**: Start building out more screens and functionality
3. **Explore Convex**: Check out `apps/convex/functions/` for backend logic
4. **Real-time Updates**: Use `useQuery` hooks for reactive data
5. **Testing**: Set up unit and integration tests

## Commands Reference

```bash
# Root level
pnpm install              # Install all dependencies

# Development
pnpm dev                  # Convex + Expo dev servers (recommended)
pnpm dev --mobile         # Expo only (if Convex running)
pnpm dev --convex         # Convex only

# Convex Tools
pnpm convex:dashboard     # Open Convex dashboard
pnpm convex:logs          # View Convex logs

# Build & Test
pnpm build                # Build all apps
pnpm test                 # Run all tests
pnpm lint                 # Lint all packages

# Mobile
cd apps/mobile
pnpm start                # Start Expo dev server
pnpm ios                  # Run on iOS
pnpm android              # Run on Android
pnpm web                  # Run on Web
```

**Command Usage:**

- **`pnpm dev`** - Use this for full-stack development (most common)
- **`pnpm dev --mobile`** - Use this if Convex is already running in another terminal
- **`pnpm dev --convex`** - Use this for backend-only development

## Documentation

- **[Architecture Decisions](../architecture/decisions/)** - ADRs for major decisions
- **[Feature Documentation](../features/)** - Feature-specific docs
- **[Developer Guides](../development/)** - Development best practices

## Need Help?

- Check the Convex dashboard: `pnpm convex:dashboard`
- View Convex logs: `pnpm convex:logs`
- See the main README.md for architecture overview

Happy coding!
