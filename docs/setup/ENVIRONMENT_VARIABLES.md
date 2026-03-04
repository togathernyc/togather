# Environment Configuration

## Overview

The backend uses **Convex** (serverless functions + real-time database). There is no local backend server to run -- Convex dev mode syncs your functions to Convex cloud automatically.

Environment variables and secrets are managed via **1Password** for team members, or can be configured manually for open source contributors.

## Development

```bash
# Start full-stack development (Convex + Expo)
pnpm dev

# Start only mobile (if Convex already running)
pnpm dev --mobile

# Start only Convex
pnpm dev --convex
```

When you run `pnpm dev`, the Convex dev server syncs your local functions to the cloud. The mobile app connects to the Convex cloud URL automatically.

## Secrets Management

### With 1Password (team members)

```bash
op account list  # Check if already signed in
op signin       # Sign in if needed
```

The dev script will auto-sync secrets from 1Password to your Convex deployment.

### Without 1Password (open source contributors)

1. Copy `.env.example` to `.env.local` and fill in your values
2. Create `apps/mobile/.env` with `EXPO_PUBLIC_*` variables
3. Set Convex env vars via `npx convex env set KEY=value`

See [secrets.md](../secrets.md) for required variables and what each one does.

## Convex Configuration

The mobile app connects to the Convex deployment URL configured in your environment. In development, `pnpm dev` handles this automatically.

## Finding Your Local IP (for Mobile Device Testing)

If you need to test on a physical device, your phone and computer must be on the same WiFi network:

**Mac/Linux:**
```bash
ifconfig | grep "inet " | grep -v 127.0.0.1
```

**Windows:**
```bash
ipconfig | findstr IPv4
```

Look for an IP address like `192.168.x.x` or `10.x.x.x` -- that's your local network IP.
