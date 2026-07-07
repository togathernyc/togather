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

## Agent Backend Selection Policy (Maintainer CI Agents Only)

> **Open-source contributors**: This section does not apply to you. Create your own personal Convex deployment via `npx convex dev` — see `CLAUDE.md` for setup instructions.

- Allowed backend names are defined in `config/allowed-backends.json`.
- Required launcher command: `pnpm dev:backend --backend=<choice>`.
- Startup fails fast if `CONVEX_DEPLOYMENT` or `EXPO_PUBLIC_CONVEX_URL` conflicts with the selected backend mapping.
- Each concurrent agent must use a different backend to avoid data conflicts.

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

### Google Maps (Required for Android)

| Secret | Description | Degradation |
|--------|-------------|-------------|
| `GOOGLE_MAPS_API_KEY` | Google Maps SDK for Android API key | Android explore map crashes |

### Planning Center (Optional)

| Secret | Description | Degradation |
|--------|-------------|-------------|
| `PLANNING_CENTER_CLIENT_ID` | OAuth client ID | Integration disabled |
| `PLANNING_CENTER_CLIENT_SECRET` | OAuth secret | Integration disabled |

### Stripe (Billing)

| Secret | Description | Degradation |
|--------|-------------|-------------|
| `STRIPE_SECRET_KEY` | Stripe API secret key (starts with `sk_test_` or `sk_live_`) | Billing disabled |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook signing secret (starts with `whsec_`) | Billing disabled |
| `STRIPE_PRODUCT_ID` | Stripe Product ID for "Togather Community Hosting" (optional — auto-created if not set) | Auto-created on first use |

> **Note**: These variables are configured in the Convex deployment dashboard. The webhook URL should be registered as `https://<convex-deployment>.convex.site/stripe-webhook`.

### KLIPY GIF API (Optional)

| Secret | Description | Degradation |
|--------|-------------|-------------|
| `EXPO_PUBLIC_KLIPY_API_KEY` | KLIPY API key (from partner.klipy.com) | GIF picker hidden |

### Prayer-request moderation (Church Prayer feature)

| Secret | Description | Degradation |
|--------|-------------|-------------|
| `OPENAI_SECRET_KEY` | OpenAI API key (already used by poster keywording). The prayer moderator calls `gpt-4o-mini` in JSON mode. | Moderator fails open — every prayer is accepted without LLM screening. |
| `OLLAMA_API_KEY` | **Escape hatch only.** Used if you flip `PROVIDER` to `"ollama"` in `apps/convex/lib/moderation/prayer.ts` (e.g. if OpenAI spend gets too high). See https://ollama.com/pricing. | Same fail-open behavior when unset. |

### Dev-Assistant Bot (@Togather pipeline, staff-only)

Gated behind the `dev-assistant-bot` feature flag. Reuses `OPENAI_SECRET_KEY`
(`gpt-4o` for vision) — no new LLM key. These wire the Claude Code Routine seam:

| Secret | Description | Degradation |
|--------|-------------|-------------|
| `CLAUDE_ROUTINES_TRIGGER_URL` | Outbound POST target. When a bug is marked `READY_FOR_IMPL`, we POST `{ bugId, routineRunId, title, body, repro, screenshotUrls, callbackUrl }` here to kick off the routine. Also the shared fallback for all per-mode trigger URLs below (single-Routine setup). | Dispatch fails; bug stays `IN_PROGRESS` with `lastError`. Use the "Retry dispatch" action once configured. |
| `CLAUDE_ROUTINES_TOKEN` | Bearer token sent as `Authorization: Bearer <token>` on the outbound POST. Shared fallback for the per-mode tokens below. | Same as above. |
| `CLAUDE_ROUTINES_TRIGGER_URL_SPEC` / `CLAUDE_ROUTINES_TOKEN_SPEC` | Per-mode trigger for the **spec-drafting** Routine (dashboard contributions, read-only repo access). Optional — falls back to the legacy pair above. See `docs/dev-assistant/ROUTINE-PROMPT.md`. | Spec dispatches use the legacy single Routine. |
| `CLAUDE_ROUTINES_TRIGGER_URL_IMPL` / `CLAUDE_ROUTINES_TOKEN_IMPL` | Per-mode trigger for the **implementation** Routine (read + push; also used for fix-mode runs, which need push access). Optional — falls back to the legacy pair. | Implementation/fix dispatches use the legacy single Routine. |
| `CLAUDE_ROUTINES_TRIGGER_URL_REVIEW` / `CLAUDE_ROUTINES_TOKEN_REVIEW` | Per-mode trigger for the **PR review** Routine (read-only; posts findings as PR comments from a non-author identity). Optional — falls back to the legacy pair. | Review dispatches use the legacy single Routine. |
| `DEV_ASSISTANT_CALLBACK_SECRET` | HMAC-SHA256 key for inbound callbacks. The routine signs the raw callback body and sends the hex digest in `x-togather-signature`; we recompute and constant-time compare. Callback endpoint: `POST https://<deployment>.convex.site/dev-assistant/callback`. | Callbacks rejected with 401; bug never advances past `IN_PROGRESS`. |
| `GITHUB_WEBHOOK_SECRET` | HMAC-SHA256 secret for the inbound GitHub webhook (`POST https://<deployment>.convex.site/github/webhook`, `pull_request` closed events; `X-Hub-Signature-256`). Falls back to `DEV_ASSISTANT_CALLBACK_SECRET` so one shared secret can serve both inbound channels — set this to split them without a code change. | With neither set, webhook returns 503: merges done directly on GitHub don't flip items to `MERGED` (auto-merge still applies its own merges; otherwise use `markBugMerged` from the review screen). |
| `GH_MIRROR_TOKEN` | GitHub PAT used to mirror dashboard items as tracking issues (Issues read/write) and for Phase 3 auto-merge (also needs **Contents read/write**). `GITHUB_MIRROR_TOKEN` is the legacy fallback name. | Issue mirroring silently skipped; auto-merge blocked with a thread message. |
| `AUTO_MERGE_ENABLED` | Master safety switch for Phase 3 policy auto-merge. Must be exactly `"true"` — anything else (including unset) means the feature is off. Merges only low-risk, review-approved, staging-verified-when-required PRs. | Auto-merge never runs; maintainers merge manually. |
| `AUTO_MERGE_METHOD` | GitHub merge method for auto-merge: `squash` (default), `merge`, or `rebase`. A 405 method-not-allowed retries once with plain `merge`. | Defaults to `squash`. |

One-time per deployment (any environment), create the sentinel bot user so
`@Togather` mentions resolve — idempotent, independent of the demo seed:

```bash
npx convex run migrations/ensureDevAssistantBotUser:ensureDevAssistantBotUser
```

> **Use in staff-only channels.** `@Togather` is staff/superuser-gated at the
> originator and the bug-review card is staff-gated, but its status posts (PR
> links, "Code's up", merge link) are normal bot messages visible to — and
> push to — all channel members. Only mention `@Togather` in channels where
> every member is staff. (Accepted MVP limitation; the full fix is to gate the
> bot to all-staff channels or route status through a staff-gated surface.)

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
