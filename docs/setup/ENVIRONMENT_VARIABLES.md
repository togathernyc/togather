# Environment Configuration

## Overview

The backend uses **Convex** (serverless functions + real-time database). There is no local backend server to run -- Convex dev mode syncs your functions to Convex cloud automatically.

Environment variables and secrets are managed via **Infisical**.

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

Secrets are stored in Infisical. Make sure you're logged in:

```bash
infisical login
```

See [secrets.md](../secrets.md) for detailed Infisical integration instructions.

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
