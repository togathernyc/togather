# Domain Change Guide

This guide explains how to change the domain for the Togather app (e.g., from the current domain to `togather.nyc` or `togather.life`).

## Overview

The domain configuration is centralized in a single file:
```
packages/shared/src/config/domain.js
```

Most of the codebase reads from this config, but some static configuration files require manual updates.

---

## Step-by-Step Instructions

### Step 1: Update the Central Config

Edit `packages/shared/src/config/domain.js`:

```javascript
// ============================================================
// CHANGE THIS VALUE TO UPDATE THE DOMAIN ACROSS THE ENTIRE APP
// ============================================================
const BASE_DOMAIN = "togather.nyc";  // Change this line
// ============================================================
```

This single change will automatically update:
- API URLs (`https://api.togather.nyc`)
- Event share links (`https://togather.nyc/e/{shortId}`)
- Email sender addresses (`Togather <togather@supa.media>`)
- Community subdomain URLs (`https://{community}.togather.nyc`)
- All regex patterns for event link detection

### Step 2: Update Static Configuration Files

These files cannot dynamically read from JavaScript and require manual updates:

#### 2a. Cloudflare Worker Routes (`apps/link-preview/wrangler.toml`)

Update the route patterns:

```toml
routes = [
  { pattern = "togather.nyc/e/*", zone_name = "togather.nyc" },
  { pattern = "*.togather.nyc/e/*", zone_name = "togather.nyc" }
]
```

### Step 3: Rebuild Packages

Rebuild the notifications package to update compiled output:

```bash
pnpm --filter notifications build
```

### Step 4: Update DNS Records

Configure DNS for your new domain:

| Type | Name | Value | Purpose |
|------|------|-------|---------|
| A | @ | Your server IP | Main app |
| A | api | API server IP | API endpoints |
| CNAME | * | @ | Community subdomains |

If using Cloudflare:
- Enable proxy (orange cloud) for DDoS protection
- Configure SSL/TLS to "Full (strict)"

### Step 5: Update External Services

#### Cloudflare Workers
1. Go to Cloudflare Dashboard → Workers
2. Update the worker routes to match new domain patterns
3. **Update API Token permissions** for the new zone:
   - Go to [Cloudflare API Tokens](https://dash.cloudflare.com/<your-account-id>/api-tokens)
   - Edit the `CLOUDFLARE_API_TOKEN` used by GitHub Actions
   - Add the new domain's zone to the token's permissions:
     - Zone → Zone → Edit (for the new zone)
     - Zone → Workers Routes → Edit (for the new zone)
   - If using Infisical, the token is stored there and used by CI/CD
4. Deploy the updated worker: `cd apps/link-preview && wrangler deploy`

#### Resend (Email)
1. Add the new domain in Resend dashboard
2. Configure DNS records (SPF, DKIM, DMARC)
3. Verify domain ownership
4. Update `RESEND_FROM_EMAIL` environment variable if using custom format

#### Expo/EAS
1. Add the new domain to your EAS project settings
2. Configure custom domain aliases for community subdomains

#### SSL Certificates
- If self-managed: Generate new certificates for the domain
- If using Cloudflare: Automatic (ensure SSL mode is correct)

### Step 6: Update App Store Listings (if applicable)

- Update marketing URLs in App Store Connect / Google Play Console
- Update privacy policy and terms of service URLs
- Update support URLs

---

## Configuration Reference

### What's Automatically Updated (via DOMAIN_CONFIG)

| Property | Example Value | Used By |
|----------|---------------|---------|
| `baseDomain` | `togather.nyc` | Subdomain parsing |
| `apiDomain` | `api.togather.nyc` | API requests |
| `apiBaseUrl` | `https://api.togather.nyc` | Backend calls |
| `appUrl` | `https://togather.nyc` | App links |
| `emailFrom` | `Togather <togather@supa.media>` | Email sender |
| `eventShareUrl(id)` | `https://togather.nyc/e/{id}` | Event sharing |
| `communityUrl(sub)` | `https://{sub}.togather.nyc` | Community URLs |
| `domainSuffix` | `.togather.nyc` | Subdomain parsing |
| `eventLinkRegex()` | Dynamic regex | Event link detection |

### Files Using DOMAIN_CONFIG

**Mobile App:**
- `apps/mobile/app.config.js` - Expo config
- `apps/mobile/config/env.ts` - Environment config
- `apps/mobile/features/*/components/*.tsx` - Various components
- `apps/mobile/features/auth/hooks/*.ts` - Auth hooks

**Backend:**
- `apps/convex/functions/` - Convex functions referencing domain
- `packages/notifications/src/channels/email.ts`

**Link Preview Worker:**
- `apps/link-preview/cloudflare-worker.js`

**Scripts:**
- `scripts/dev.js`
- `apps/mobile/scripts/dev-wrapper.js`
- `apps/mobile/scripts/deploy-web-all.sh`

---

## Troubleshooting

### Event links not being detected in chat
- Rebuild the mobile app after changing the domain
- Check that `eventLinkRegex()` returns correct pattern:
  ```js
  node -e "const { DOMAIN_CONFIG } = require('./packages/shared/src/config/domain.js'); console.log(DOMAIN_CONFIG.eventLinkRegex());"
  ```

### Emails not sending
- Verify the new domain is configured in Resend
- Check DNS records (SPF, DKIM) are properly set
- Verify `emailFrom` format matches Resend's verified sender

### API requests failing
- Ensure DNS is propagated (`dig api.yourdomain.com`)
- Check SSL certificate is valid for the new domain
- Verify CORS settings include the new domain

### Subdomain routing not working
- Check wildcard DNS record exists (`*.yourdomain.com`)
- Verify `domainSuffix` includes the leading dot (`.togather.nyc`)

### Build failures
- Run `pnpm install` to ensure dependencies are updated
- Rebuild packages: `pnpm --filter notifications build`
- Clear Expo cache: `npx expo start --clear`

---

## Quick Reference Checklist

- [ ] Update `BASE_DOMAIN` in `packages/shared/src/config/domain.js`
- [ ] Update `apps/link-preview/wrangler.toml`
- [ ] Run `pnpm --filter notifications build`
- [ ] Configure DNS records
- [ ] Update Cloudflare API token with new zone permissions
- [ ] Update Cloudflare worker routes
- [ ] Verify Resend domain settings
- [ ] Test event sharing links
- [ ] Test email sending
- [ ] Test community subdomains
