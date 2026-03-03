# ADR-009: Link Preview System for Event Sharing

**Status:** Active
**Created:** 2024-12-25
**Updated:** 2025-01-21 (Added environment-specific routing, complete route table)

## Context

Event links (`togather.nyc/e/[shortId]`) shared in iMessage, Twitter, Slack, etc. did not show rich previews. Users saw generic "Click to Load Preview" instead of event images, titles, and descriptions like Partiful does.

The challenge: Expo Router with static export cannot server-render pages with dynamic meta tags. Crawlers (iMessage, Twitter, etc.) need HTML with Open Graph tags at request time.

## Decision

Implement a link preview system using a single **Cloudflare Worker** that:
1. Intercepts all traffic to `togather.nyc` and `*.togather.nyc`
2. Routes static landing page traffic (/, /android, /download, static assets) to Cloudflare Pages
3. Routes app traffic to EAS Hosting
4. For bots on OG routes (/e/*, /g/*, /nearme, /): Returns HTML with OG meta tags
5. For users: Passes through to appropriate origin (landing page or app)

## Architecture

```
                         DNS (Cloudflare)
                              │
        ┌─────────────────────┴─────────────────────┐
        │                                           │
   CNAME @ → origin.expo.app              CNAME * → origin.expo.app
   (root domain)                          (subdomains)
        │                                           │
        └─────────────────────┬─────────────────────┘
                              │
                    Cloudflare Edge (Proxied)
                              │
                   ┌──────────┴──────────┐
                   │  Cloudflare Worker  │
                   │  togather.nyc/*     │
                   │  *.togather.nyc/*   │
                   └──────────┬──────────┘
                              │
      ┌───────────────────────┼───────────────────────┐
      │                       │                       │
Landing Page Paths       OG Routes            Everything Else
/, /android, /download   /e/*, /g/*, /nearme      (app paths)
/styles.css, /script.js        │                      │
      │                        │                      │
      ↓                   ┌────┴────┐                 ↓
┌─────────────┐        Bot?     User?         ┌─────────────┐
│  Cloudflare │           │         │         │ EAS Hosting │
│    Pages    │           ↓         ↓         │ (Expo App)  │
│  (Landing)  │    OG HTML    Pass to App     │             │
└─────────────┘    with tags                  └─────────────┘
```

## Components

| Component | Location | Purpose |
|-----------|----------|---------|
| Cloudflare Worker | `apps/link-preview/cloudflare-worker.js` | Bot detection, routing, OG HTML generation |
| Wrangler Config | `apps/link-preview/wrangler.toml` | Cloudflare Worker routes |
| Unit Tests | `apps/link-preview/cloudflare-worker.test.js` | Worker behavior tests |
| Deploy Workflow | `.github/workflows/deploy-link-preview.yml` | CI/CD for worker deployment |
| Landing Page | `apps/web/` | Static landing page (deployed to Cloudflare Pages) |

## Environment Configuration

The Cloudflare Worker detects environment based on hostname and routes to the appropriate origins:

| Environment | Domain | App Origin (EAS) | Landing Page |
|-------------|--------|------------------|--------------|
| Production | `togather.nyc`, `app.togather.nyc`, `*.togather.nyc` | `https://togather.expo.app` | `https://togather-landing.pages.dev` |
| Staging | `staging.togather.nyc` | `https://togather--staging.expo.app` | `https://togather-landing.pages.dev` |

**EAS Hosting Aliases:**
- Production: `togather.expo.app` (default alias)
- Staging: `togather--staging.expo.app` (alias: `staging`)

Deploy workflow (`.github/workflows/deploy-web.yml`) updates the appropriate alias on push.

## Routing Logic

| Path | Bot Request | User Request |
|------|-------------|--------------|
| `/` | OG tags HTML | Landing Page |
| `/android`, `/download` | Landing Page | Landing Page |
| `/styles.css`, `/script.js`, etc. | Landing Page | Landing Page |
| `/e/:shortId` | OG tags HTML | App (EAS) |
| `/g/:shortId` | OG tags HTML | App (EAS) |
| `/nearme` | OG tags HTML | App (EAS) |
| `/_expo/*` | App (EAS) | App (EAS) |
| `/.well-known/apple-app-site-association` | Worker (JSON) | Worker (JSON) |
| `/.well-known/assetlinks.json` | Worker (JSON) | Worker (JSON) |
| Everything else | App (EAS) | App (EAS) |

## Complete Route Table (Expo Router)

These are the available routes in the app (EAS Hosting):

| Route | Description |
|-------|-------------|
| `/` | Landing/splash redirect |
| `/signin` | Sign in page |
| `/signup` | Sign up page |
| `/welcome` | Welcome/onboarding |
| `/register-phone` | Phone registration |
| `/select-community` | Community selection |
| `/e/:shortId` | Event detail page |
| `/g/:shortId` | Group detail page |
| `/nearme` | Discover nearby |
| `/inbox/*` | Messaging |
| `/groups/*` | Groups list |

**Note:** Auth routes use Expo Router route groups `(auth)` which don't affect URLs.

## Bot Detection

The Worker identifies crawlers by User-Agent:
- `Twitterbot`, `facebookexternalhit`, `LinkedInBot`
- `WhatsApp`, `Slackbot`, `TelegramBot`, `Discordbot`
- `Googlebot`, `bingbot`, `Applebot`
- Generic: `bot`, `crawl`, `spider`, `preview`

**Note:** `AppleWebKit` was intentionally excluded - it matches all Safari/Chrome browsers.

## OG Tags Generated

```html
<meta property="og:title" content="RSVP to Event Name | Community">
<meta property="og:description" content="Saturday, Dec 27, 2025 at 11:00 PM...">
<meta property="og:image" content="https://...event-cover-image.jpg">
<meta property="og:type" content="website">
<meta name="twitter:card" content="summary_large_image">
```

## DNS Configuration

**Cloudflare DNS records:**
| Type | Name | Value | Proxy |
|------|------|-------|-------|
| CNAME | `@` | `origin.expo.app` | Proxied |
| CNAME | `www` | `origin.expo.app` | Proxied |
| CNAME | `staging` | `origin.expo.app` | Proxied |
| CNAME | `*` | `origin.expo.app` | Proxied |

**Important:** All records must be "Proxied" (orange cloud) for the Cloudflare Worker to intercept requests.

## Convex HTTP Routes

HTTP routes are defined in `convex/http.ts` and exposed at the Convex site URL:

| Route | Method | Purpose |
|-------|--------|---------|
| `/link-preview/event` | GET | Event data for OG tags |
| `/link-preview/group` | GET | Group data for OG tags |
| `/link-preview/community` | GET | Community data for nearme OG tags |

### Event Link Preview Endpoint

```
GET /link-preview/event?shortId=<shortId>
```

**Response:**
```json
{
  "id": "meeting_123",
  "shortId": "abc123",
  "title": "Weekly Meetup",
  "scheduledAt": "2025-01-15T19:00:00.000Z",
  "status": "scheduled",
  "coverImage": "https://...",
  "groupName": "Tech Enthusiasts",
  "communityName": "Demo Community",
  "communityLogo": "https://...",
  "locationOverride": "123 Main St"
}
```

## Deployment

### Cloudflare Worker (CI/CD)
Push to `main` or `staging` branch triggers automatic deployment via GitHub Actions.

### Cloudflare Worker (Manual)
```bash
cd apps/link-preview

# Production
npx wrangler deploy

# Staging
npx wrangler deploy -c wrangler.staging.toml
```

### EAS Hosting (CI/CD)
Push to `main` or `staging` branch triggers automatic deployment via `.github/workflows/deploy-web.yml`.

The workflow:
1. Runs `npx expo export --platform web`
2. Deploys to EAS with `npx eas-cli deploy`
3. Updates the alias (`staging` or production aliases)

### EAS Hosting (Manual)
```bash
cd apps/mobile

# Export
npx expo export --platform web

# Deploy and update alias
npx eas-cli deploy --channel staging  # or production
```

### Landing Page (Cloudflare Pages)
```bash
cd apps/web
npx wrangler pages deploy . --project-name=togather-landing
```

## Environment Variables (Worker)

| Secret | Purpose |
|--------|---------|
| `CONVEX_SITE_URL` | Convex HTTP endpoint URL for fetching event/group data |

Set via:
```bash
cd apps/link-preview
echo "https://your-deployment.convex.site" | npx wrangler secret put CONVEX_SITE_URL
```

## Request Flow Examples

### 1. Bot requests event link preview (iMessage, Twitter, etc.)
```
iMessage crawler → togather.nyc/e/ABC123
  → Cloudflare Worker (bot detected: Applebot)
  → Worker fetches event from Convex HTTP endpoint
  → Worker returns HTML with OG tags
  → iMessage shows rich preview
```

### 2. User opens event link in browser
```
Browser → togather.nyc/e/ABC123
  → Cloudflare Worker (not a bot)
  → Worker passes to EAS Hosting
  → EAS serves Expo app
  → App loads event page
```

### 3. User visits homepage
```
Browser → togather.nyc/
  → Cloudflare Worker (not a bot)
  → Worker passes to Landing Page (Cloudflare Pages)
  → Landing page loads
```

### 4. Bot requests homepage
```
Googlebot → togather.nyc/
  → Cloudflare Worker (bot detected)
  → Worker returns OG HTML with homepage meta tags
  → Google indexes rich preview
```

## Troubleshooting

### Quick Diagnostics

Test routes directly to bypass Cloudflare Worker:
```bash
# Test EAS Hosting staging directly
curl -s -o /dev/null -w "%{http_code}" "https://togather--staging.expo.app/signin"

# Test through Cloudflare Worker
curl -s -o /dev/null -w "%{http_code}" "https://staging.togather.nyc/signin"

# Test bot response
curl -H "User-Agent: Twitterbot" "https://staging.togather.nyc/e/ABC123"
```

### 500 Error on staging links
**Symptom:** `ExpoError: API route GET handler resolved to a non-Response result`

**Cause:** Worker is pointing to wrong EAS origin (production instead of staging)

**Fix:** Check `ENVIRONMENTS.staging.appOrigin` in `cloudflare-worker.js` points to `https://togather--staging.expo.app`

### 404 on valid routes
**Symptom:** Route returns 404 even though it exists in app

**Cause:**
1. Route might not exist (e.g., `/login` vs `/signin`)
2. EAS deployment not updated

**Fix:**
1. Check route exists: `ls apps/mobile/app/`
2. Verify EAS deployment: Check GitHub Actions deploy-web.yml

### Worker routes not triggering
- Ensure DNS records are "Proxied" (orange cloud) not "DNS Only"
- Verify worker is deployed: `npx wrangler whoami` then check dashboard

### OG tags not showing
- Check User-Agent is in the bot list
- Verify Convex HTTP endpoint is responding: `curl https://your.convex.site/link-preview/event?shortId=xxx`
- Use Facebook Debugger or Twitter Card Validator to test

### Landing page not styled
- Verify static assets are routed to landing page (check `isLandingPagePath()`)
- Check Cloudflare Pages deployment status

### Images not showing in preview
- Check S3 object Content-Type is `image/jpeg` not `application/octet-stream`
- Ensure image URLs are publicly accessible
- Verify image dimensions meet platform requirements (1200x630 recommended)

### Universal Links not opening app
See ADR-014 for Universal Links configuration. Check:
1. `/.well-known/apple-app-site-association` returns correct JSON
2. `/.well-known/assetlinks.json` returns correct JSON
3. Bundle ID matches what's in the association file

## Testing

Run worker unit tests:
```bash
cd apps/link-preview
npm test
```

Test bot detection manually:
```bash
# Bot request - should return OG HTML
curl -H "User-Agent: Twitterbot" https://togather.nyc/e/ABC123

# User request - should return app content
curl https://togather.nyc/e/ABC123
```
