# ADR-014: Staging and Production Environment Architecture

## Status

Accepted

## Context

The Togather platform requires isolated staging and production environments to enable safe testing of changes before they reach users. This document describes the current architecture, including which services are shared vs isolated, and how the CI/CD pipeline manages deployments.

## Decision

We use a two-environment strategy with **staging** for testing/validation and **production** for live users. Some services are fully isolated while others share infrastructure with logical separation.

---

## Environment Overview

| Environment | Branch | Purpose |
|-------------|--------|---------|
| **Staging** | `staging` | Testing, QA, internal validation |
| **Production** | `main` | Live users, App Store/Play Store releases |

### Branch Strategy

```
main              ← Production (updated only by promote workflow)
  └─ staging      ← Development happens here
```

---

## Infrastructure Services

### Fully Isolated Services

| Service | Staging | Production | Isolation Method |
|---------|---------|------------|------------------|
| **Convex Database** | `<your-convex-deployment>` | `<your-convex-deployment>` | Environment detection |
| **Convex Backend** | `<your-convex-deployment>` (staging env) | `<your-convex-deployment>` (prod env) | Environment detection |
| **S3 Buckets** | Staging bucket | `togather-production-bucket` | Separate buckets |
| **Expo OTA Channel** | `staging` channel | `production` channel | Same project, separate channels |
| **iOS App** | `life.togather.staging` (TestFlight) | `app.gatherful.mobile` (App Store) | Different bundle IDs |
| **1Password Secrets** | `staging` environment | `prod` environment | Separate vaults |
| **EAS Hosting (Web)** | staging environment | production environment | Separate environments |
| **Convex Crons (Jobs)** | Part of Convex staging deployment | Part of Convex prod deployment | Deployed with Convex functions |

### Shared Services with Logical Isolation

| Service | Isolation Method | Details |
|---------|------------------|---------|
| **Expo Project** | Update channels | Same project ID, different channels |

### Shared Services (No Isolation Needed)

| Service | Reason |
|---------|--------|
| **Mapbox** | Read-only map tiles, no user data |
| **Twilio** | Stateless SMS, same phone number |
| **Resend** | Stateless email delivery |

---

## Database Architecture

### Convex Database

Convex provides a built-in real-time database with automatic sync between staging and production environments.

| Environment | Convex Project | Detection |
|-------------|----------------|-----------|
| **Production** | `<your-convex-deployment>` | `APP_ENV=production` or prod bundle ID |
| **Staging** | `<your-convex-deployment>` | `APP_ENV=staging` or staging bundle ID |

**Key Features:**
- Real-time subscriptions built-in
- Automatic schema migrations via `npx convex deploy`
- Type-safe queries and mutations

### Background Jobs

Background jobs now run as Convex crons and scheduled functions (see `apps/convex/crons.ts` and `apps/convex/functions/scheduledJobs.ts`). No separate jobs app is needed.

---

## Backend Deployment (Convex)

### Convex Configuration

Convex provides serverless functions and a real-time database. Both staging and production use the same Convex project with environment detection.

| Aspect | Staging | Production |
|--------|---------|------------|
| Project | `<your-convex-deployment>` | `<your-convex-deployment>` |
| Detection | `APP_ENV=staging` or bundle ID | `APP_ENV=production` or bundle ID |
| Deployment | Auto on push to `staging` | Manual via promote workflow |

### Environment Detection

The environment is detected via:
1. `APP_ENV` environment variable (backend/jobs)
2. iOS bundle ID: `life.togather.staging` vs `app.gatherful.mobile`
3. Expo config `extra.isStaging` flag

### Environment Variables

Loaded from 1Password and synced to Convex dashboard:
- `JWT_SECRET`
- `AWS_*` (S3 credentials and bucket names)
- `TWILIO_*` (SMS and OTP)
- `MAPBOX_ACCESS_TOKEN`
- `TRIGGER_SECRET_KEY`

---

## Mobile Deployment

### EAS Build Profiles (`eas.json`)

| Aspect | Staging | Production |
|--------|---------|------------|
| Profile | `staging` | `production` |
| Channel | `staging` | `production` |
| iOS Bundle ID | `life.togather.staging` | `app.gatherful.mobile` |
| iOS ASC App ID | `6757364952` | `6756286011` |
| iOS Distribution | TestFlight | App Store |
| Android Build | APK | App Bundle |

### OTA Updates

Both environments share the same Expo project (see `EAS_PROJECT_ID` in 1Password) but use different update channels:

```
Expo Project
├── staging channel    ← Staging OTA updates
└── production channel ← Production OTA updates
```

### Native vs OTA Detection

The `.fingerprint` file tracks native code changes:
- **Fingerprint changed** → Native build required
- **Fingerprint unchanged** → OTA update safe

---

## CI/CD Workflows

### Staging Workflows (Auto-triggered on push to `staging`)

| Workflow | Trigger Paths | Action |
|----------|---------------|--------|
| `deploy-convex.yml` | `apps/convex/**` | Deploy Convex functions to staging |
| `deploy-mobile-update.yml` | `apps/mobile/**`, `packages/**` (excl. native) | Publish OTA to staging |
| `build-mobile-native.yml` | `.fingerprint` changes | Build iOS, submit to TestFlight |
| `deploy-web.yml` | `apps/mobile/**`, `packages/shared/**` | Deploy to EAS Hosting staging |

### Production Workflows

| Workflow | Trigger | Action |
|----------|---------|--------|
| `promote-to-production.yml` | Manual dispatch (type "promote") | Deploys API, mobile, OTA based on changes |
| `deploy-landing.yml` | Push to `main` (`apps/web/**`) | Deploy to Cloudflare Pages |
| `deploy-link-preview.yml` | Push to `main` (`apps/link-preview/**`) | Deploy Cloudflare Worker |

### Promotion Flow

```
┌─────────────────────────────────────────────────────────────┐
│                   STAGING BRANCH                            │
│            (Auto-deploys on every push)                     │
└─────────────────────────────────────────────────────────────┘
         │
         ▼
    [Test in Staging]
    - Real data synced daily
    - TestFlight for iOS
    - Staging API endpoint
         │
         ▼
┌──────────────────────────┐
│ Manual: Promote to Prod  │
│ (User confirms "promote")│
└──────────────────────────┘
         │
         ├── Detects what changed:
         │   • API changes?
         │   • Native changes?
         │   • JS-only changes?
         │
         ▼
┌─────────┬─────────┬─────────┐
│ API     │ Native  │ OTA     │
│ Deploy  │ Build   │ Publish │
│(if changed)       │(if JS only)
└────┬────┴────┬────┴────┬────┘
     │         │         │
     └─────────┼─────────┘
               ▼
     ┌──────────────────┐
     │ Merge staging→main│
     │ (if all succeed) │
     └──────────────────┘
```

### Change Detection

The promote workflow compares `origin/main...origin/staging`:

```
Convex changed:        apps/convex/**
Mobile native changed: apps/mobile/ios/**, android/**, .fingerprint
Mobile JS changed:     apps/mobile/** or packages/** (no native)
Web changed:           apps/mobile/** or packages/shared/**
```

### Safety Features

1. **Confirmation required:** Must type `"promote"` to trigger
2. **Conditional execution:** Only deploys components that changed
3. **Migration validation:** Production fails if migrations fail
4. **Version validation:** Native builds verify app.config.js matches app.json
5. **Fingerprint check:** OTA only runs if no native changes
6. **Auto-merge:** Only merges `staging→main` if all deployments succeed

---

## Secrets Management

### 1Password Structure

```
1Password Vault: Togather
├── dev      ← Local development
├── staging  ← Staging environment
└── prod     ← Production environment
```

### Loading Secrets in CI

All workflows use `.github/actions/load-secrets`:
1. Authenticate with 1Password using `OP_SERVICE_ACCOUNT_TOKEN`
2. Load environment-specific variables
3. Export as GitHub Actions environment variables

### EAS Environment Sync

Before mobile builds, secrets are synced to EAS for environment-specific configuration (Mapbox tokens, etc.).

---

## URLs Reference

### Backend (Convex)

| Environment | URL |
|-------------|-----|
| Production | `https://<your-convex-deployment>.convex.cloud` |
| Staging | `https://<your-convex-deployment>.convex.cloud` (same project, env detection) |
| Local | Convex dev server syncs to cloud |

### Web App

| Environment | URLs |
|-------------|------|
| Production | `https://app.togather.nyc`, `https://fount.togather.nyc`, `https://demo-community.togather.nyc` |
| Staging | `https://staging.togather.nyc` |
| Local | `http://localhost:8081` |

### Mobile

| Environment | Distribution |
|-------------|--------------|
| Production | App Store, Play Store |
| Staging | TestFlight (iOS only currently) |
| Local | Expo Go or dev client |

---

## Testing Credentials

Use the test credentials from the seed script (`npx convex run functions/seed:seedDemoData`). The seed data creates test users with bypass OTP codes for local development.

Search for "Demo Community" when testing.

---

## Consequences

### Benefits

1. **Safe testing:** Changes validated in staging before production
2. **Data isolation:** Convex environment detection keeps data separate
3. **Automated staging:** Fast iteration with auto-deploys
4. **Controlled production:** Manual promotion with safety checks

### Trade-offs

1. **Shared Twilio/Mapbox:** No isolation, but stateless services
2. **Manual promotion:** Slower to production, but safer
3. **Daily data sync:** Staging data can be stale between syncs

---

## Related Documents

- [ADR-013: Mobile Versioning and OTA Updates](./ADR-013-mobile-versioning-and-ota-updates.md)
