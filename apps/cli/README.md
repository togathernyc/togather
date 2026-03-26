# Togather CLI

Command-line interface for Togather messaging. Built for both humans and AI agents.

## Install

```bash
npm install -g https://images.togather.nyc/cli/togather-cli-0.1.0.tgz
```

The CLI auto-updates — it checks for new versions hourly and installs them automatically.

## Authentication

Authentication uses phone OTP, the same flow as the Togather app. This is a two-step process:

```bash
# Step 1: Request a verification code
togather send-otp "+15551234567"

# Step 2: Verify the code you received
togather verify "+15551234567" "123456"
```

If your account belongs to multiple communities, you'll be prompted to select one:

```bash
togather verify "+15551234567" "123456" --community 1
```

Your session is stored at `~/.togather/session.json` and lasts 30 days.

```bash
# Check your current session
togather whoami

# Clear your session
togather logout
```

## Commands

### List channels

```bash
togather channels
```

Returns all channels you're a member of, with IDs, names, types, and last message previews.

### Read messages

```bash
togather messages <channelId>
togather messages <channelId> --limit 50
togather messages <channelId> --cursor <cursor>
```

Messages are returned in chronological order. Use `--cursor` with the cursor from the previous response to paginate through older messages.

### Send a message

```bash
togather send <channelId> "Your message here"
```

## Rate Limits

| Action  | Limit          |
|---------|----------------|
| Send    | 1 per minute   |
| Read    | 10 per minute  |

Rate limits are enforced client-side. If you hit a limit, the CLI tells you how long to wait.

## Agent Integration

The CLI is designed for non-interactive use. Every command accepts all inputs as arguments — no prompts or interactive flows.

### Example: Claude Code / Cursor / Copilot

```bash
# Authenticate (two separate commands)
togather send-otp "+15551234567"
# Wait for user to provide the OTP code
togather verify "+15551234567" "123456"

# List available channels
togather channels

# Read recent messages from a channel
togather messages nd74qeb1tdkccerqzgjcbbej5s7z9136

# Send a message
togather send nd74qeb1tdkccerqzgjcbbej5s7z9136 "Hello from my agent"
```

### Example: Shell script

```bash
#!/bin/bash
CHANNEL="nd74qeb1tdkccerqzgjcbbej5s7z9136"

# Read latest messages
togather messages "$CHANNEL" --limit 5

# Send a reply
togather send "$CHANNEL" "Automated status update: all systems operational"
```

### Environment Variables

| Variable | Description |
|----------|-------------|
| `TOGATHER_CONVEX_URL` | Override the Convex backend URL (for development/staging) |

### Session file

The session is stored as JSON at `~/.togather/session.json`:

```json
{
  "accessToken": "...",
  "refreshToken": "...",
  "expiresAt": 1234567890000,
  "communityId": "...",
  "communityName": "FOUNT",
  "userId": "...",
  "userName": "Seyi Olujide",
  "phone": "+15551234567"
}
```

Agents can read this file to check auth status without running `togather whoami`.

## Development

```bash
# Run locally (from repo root)
pnpm --filter @supamedia/togather-cli exec tsx src/index.ts <command>

# Build
CLI_ENV=staging pnpm --filter @supamedia/togather-cli build
CLI_ENV=production pnpm --filter @supamedia/togather-cli build
```
