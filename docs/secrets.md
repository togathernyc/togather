# Secrets & Environment Variables

This document describes all secrets and environment variables used in Togather and how to manage them.

## Quick Start

```bash
# 1. Copy the example env file
cp .env.example .env.local

# 2. Fill in the required values (see tables below)

# 3. Start developing!
pnpm dev
```

---

## Agent Backend Selection Policy

- Allowed backend names: `togather-agent-1`, `togather-agent-2`.
- Required launcher command: `pnpm dev:backend --backend=<choice>`.
- Startup fails fast if `CONVEX_DEPLOYMENT` or `EXPO_PUBLIC_CONVEX_URL` conflicts with the selected backend mapping.

---

## Environment Overview

| Environment | Use Case |
|-------------|----------|
| `dev` | Local development |
| `staging` | Pre-production testing |
| `prod` | Live application |

---

## All Secrets Reference

### Database (Required)

| Secret | Description |
|--------|-------------|
| `DATABASE_URL` | PostgreSQL connection string (if using legacy database) |

### Authentication (Required)

| Secret | Description |
|--------|-------------|
| `JWT_SECRET` | Secret for signing JWT tokens |

### Cloudflare R2 (Required for Image Storage)

| Secret | Description | Degradation |
|--------|-------------|-------------|
| `R2_ACCESS_KEY_ID` | R2 access key | Image uploads fail |
| `R2_SECRET_ACCESS_KEY` | R2 secret key | Image uploads fail |
| `R2_BUCKET_NAME` | R2 bucket name | Image uploads fail |
| `R2_PUBLIC_URL` | Public URL for images | Images not displayed |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account identifier | Image uploads fail |

### Twilio SMS (Required for production, optional for local dev)

| Secret | Description | Degradation |
|--------|-------------|-------------|
| `TWILIO_ACCOUNT_SID` | Account identifier | Use bypass OTP code in dev |
| `TWILIO_AUTH_TOKEN` | Auth token | Use bypass OTP code in dev |
| `TWILIO_PHONE_NUMBER` | Sender phone | Use bypass OTP code in dev |
| `TWILIO_VERIFY_SERVICE_SID` | Verify service ID | Use bypass OTP code in dev |

### Expo Push (Optional)

| Secret | Description | Degradation |
|--------|-------------|-------------|
| `EXPO_TOKEN` | Push notification token | Notifications don't send |
| `DISABLE_NOTIFICATION` | Set `true` to mock | - |

### Mapbox (Optional)

| Secret | Description | Degradation |
|--------|-------------|-------------|
| `MAPBOX_ACCESS_TOKEN` | Server geocoding token | Geocoding fails |

### Planning Center (Optional)

| Secret | Description | Degradation |
|--------|-------------|-------------|
| `PLANNING_CENTER_CLIENT_ID` | OAuth client ID | Integration disabled |
| `PLANNING_CENTER_CLIENT_SECRET` | OAuth secret | Integration disabled |

### Development Settings

| Secret | Description |
|--------|-------------|
| `DEBUG` | Enable bypass OTP code for any phone |
| `OTP_TEST_PHONE_NUMBERS` | Phones that accept bypass code |

---

### Mobile Secrets (EXPO_PUBLIC_* only)

| Secret | Description |
|--------|-------------|
| `EXPO_PUBLIC_MAPBOX_TOKEN` | Mapbox public token (pk.*) |
| `EXPO_PUBLIC_PROJECT_ID` | Expo project ID for push notifications |

**Note**: Mobile secrets are `EXPO_PUBLIC_*` prefixed, meaning they're bundled into the app. Never put sensitive secrets here!

---

## EAS Environment Sync (CI/CD)

### Why EAS Sync is Required

When building or updating the mobile app via EAS (Expo Application Services), `app.config.js` runs on EAS servers, not locally. This means:

1. **Local `.env` files are not available** during EAS builds
2. **`eas.json` env vars only work for native builds**, not OTA updates
3. **EAS environment variables** must be synced for OTA updates (`eas update`)

### Native Builds vs OTA Updates

| Build Type | Where `app.config.js` Runs | Secret Source |
|------------|---------------------------|---------------|
| Native Build (`eas build`) | EAS cloud | `eas.json` env vars |
| OTA Update (`eas update`) | EAS cloud | EAS environment vars (must sync!) |
| Local Dev (`expo start`) | Your machine | `.env` file |

### Adding a New EXPO_PUBLIC_* Variable

When adding a new `EXPO_PUBLIC_*` environment variable:

1. **Add to your secrets manager** (if it varies per environment)
2. **Update all mobile CI workflows** to sync it to EAS
3. **Update this document** (add to the tables above)
4. **Test locally** with your `.env.local`

---

## CI/CD Integration

### GitHub Secrets

Store service tokens as GitHub repository secrets for use in CI workflows. Example secrets:

| Secret | Description | Used By |
|--------|-------------|---------|
| `EXPO_TOKEN` | Expo/EAS authentication | Build and deploy workflows |
| `CLOUDFLARE_API_TOKEN` | Cloudflare Workers deployment | Landing page and worker deployments |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account identifier | Worker deployments |

---

## Access Control

### Requesting Access

1. Ask a project maintainer to add you to the secrets management system
2. Set up your local `.env.local` file with the required values
3. For CI/CD secrets, ensure they are configured in GitHub repository settings

### Access Levels

| Role | dev | staging | prod |
|------|-----|---------|------|
| Contributor | Read/Write | Read | No Access |
| Maintainer | Read/Write | Read/Write | Read/Write |

---

## Test Credentials

For testing the app (Playwright, iOS Simulator, manual testing), use the credentials from the seed script:

```bash
npx convex run functions/seed:seedDemoData
```

The seed script creates test users with bypass OTP codes for local development.

---

## Troubleshooting

### "OTP not sending"

Expected without Twilio configured. Use the bypass OTP code with the test phone number from the seed data.

### "Permission denied"

Contact a project maintainer to grant access to the environment.

---

## Security Best Practices

1. **Never commit `.env` files** -- They're in `.gitignore`
2. **Never share secrets via Slack/email** -- Use your secrets manager
3. **Use environment-appropriate secrets** -- Don't use prod secrets locally
4. **Rotate secrets when team members leave**

---

## Adding a New Service

When integrating a new service that requires secrets:

1. **Add secrets** for all environments (dev, staging, prod)
2. **Update `.env.example`** with documentation
3. **Update this document** with the new secrets
4. **Implement graceful degradation** if the secret is optional
5. **Notify the team** to update their `.env.local` files
