# ADR-009: Link Preview System for Event Sharing

**Status:** Active
**Created:** 2024-12-25
**Updated:** 2026-07-19 (Refactored: static pages now pre-built with OG metadata; dynamic routes unified under single `/link-preview/meta` endpoint)

## Context

Event links (`togather.nyc/e/[shortId]`) shared in iMessage, Twitter, Slack, etc. did not show rich previews. Users saw generic "Click to Load Preview" instead of event images, titles, and descriptions like Partiful does.

The challenge: Expo Router with static export cannot server-render pages with dynamic meta tags. Crawlers (iMessage, Twitter, etc.) need HTML with Open Graph tags at request time. Meanwhile, static marketing pages (guides, homepage variants) need per-page OG metadata without server infrastructure.

## Amendment (2026-07-19)

**Refactored to separate static and dynamic routes:**
- **Static pages**: Now pre-built at deploy time with OG metadata baked into HTML (satori + resvg for auto-generated cards)
- **Dynamic routes**: Consolidated from five per-type endpoints to a single `/link-preview/meta` endpoint with typed, unit-tested resolver
- **Worker**: Simplified to thin routing layer using a PREVIEW_ROUTES table (table-driven, minimal changes needed for new preview types)
- **Result**: No runtime OG tag generation; better performance, reduced worker complexity, clearer separation of concerns

See "Static Page Registration & OG Metadata" and "Convex HTTP Routes" sections for implementation details.

## Decision

Two-tier link preview system:

1. **Static marketing pages** (apps/web, Vite SPA on Cloudflare Pages): Every page is registered in a site-wide route registry (`apps/web/src/routes.tsx`) with preview metadata (title, description, image, emoji). A post-build script (`apps/web/scripts/generate-static-pages.tsx`) writes dist/<path>/index.html with OG meta tags baked in. For pages without a bespoke image, it generates branded 1200x630 PNG cards (satori + resvg). Cloudflare Pages serves these static files before the SPA fallback, so bots and humans get correct per-page meta with no runtime infrastructure.

2. **Dynamic app routes** (/e/, /g/, /t/, /ch/, /nearme, /:slug): One Convex HTTP endpoint (`GET /link-preview/meta?url=<full request URL>`) returns typed preview metadata. A single resolver in Convex (apps/convex/functions/linkPreviewMeta) handles ALL preview assembly (title formats, rich descriptions, timezone formatting, image fallback chains). The Cloudflare Worker is now a thin, table-driven layer: it keeps existing jobs (site-vs-app routing, Universal/App Links, bot detection) but for bot requests on dynamic routes it fetches this metadata endpoint and pours the result into a shared HTML template.

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
      ┌───────────┬───────────┼───────────┬───────────┐
      │           │           │           │           │
  Static Routes  Dynamic     App Paths   Dynamic      Everything
  (prebuilt OG)  Routes      (/signin)   Routes       Else
  /, /guides/*   (/e/*, etc) (users)     (/e/*, etc)
  /download                              (bots)
      │           │           │           │           │
      ↓           ↓           ↓           ↓           ↓
 ┌──────────┐    │        ┌─────────┐    │      ┌─────────┐
 │Cloudflare│    │        │   EAS   │    └─────→│Cloudflare
 │  Pages   │    │        │ Hosting │            │ Worker
 │(prebuilt)│    │        │(Expo)   │            │(fetch meta)
 └──────────┘    │        └─────────┘            │        │
                 │                               ↓        │
                 │                          ┌──────────┐  │
                 └──────────────────────→  │ Convex   │  │
                                           │/link-    │  │
                                           │preview/  │  │
                                           │meta      │  │
                                           └─────────┬┘  │
                                                     │    │
                                                     └────┘
                                                      │
                                                      ↓
                                                  ┌────────┐
                                                  │Shared  │
                                                  │Template│
                                                  └────────┘
```

## Components

| Component | Location | Purpose |
|-----------|----------|---------|
| Route Registry | `apps/web/src/routes.tsx` | Site-wide routes with preview metadata (title, description, image, emoji) |
| Build Script | `apps/web/scripts/generate-static-pages.tsx` | Generates prebuilt HTML + OG image cards at build time (satori + resvg) |
| Web App | `apps/web/` | Vite SPA deployed to Cloudflare Pages; routes come from registry |
| Link Preview Resolver | `apps/convex/functions/linkPreviewMeta.ts` | Typed resolver: all preview assembly logic (title formats, descriptions, fallback chains) |
| Cloudflare Worker | `apps/link-preview/cloudflare-worker.js` | Thin layer: bot detection, routing, PREVIEW_ROUTES table, fetches meta endpoint, renders shared template |
| HTML Template | `apps/link-preview/templates/preview.html` | Shared template for dynamic preview OG HTML |
| Wrangler Config | `apps/link-preview/wrangler.toml` | Worker routes and environment config |
| Unit Tests | `apps/link-preview/cloudflare-worker.test.js` | Worker behavior tests |
| Deploy Workflow | `.github/workflows/deploy-link-preview.yml` | CI/CD for worker deployment |

## Environment Configuration

The Cloudflare Worker detects environment based on hostname and routes to the appropriate origins:

| Environment | Domain | App Origin (EAS) | Marketing Pages (Cloudflare Pages) |
|-------------|--------|------------------|------------------------------------|
| Production | `togather.nyc`, `app.togather.nyc`, `*.togather.nyc` | `https://togather.expo.app` | `https://togather-web.pages.dev` (built & deployed via `pnpm build` + `wrangler pages deploy`) |
| Staging | `staging.togather.nyc` | `https://togather--staging.expo.app` | `https://togather-web-staging.pages.dev` |

**EAS Hosting Aliases:**
- Production: `togather.expo.app` (default alias)
- Staging: `togather--staging.expo.app` (alias: `staging`)

**Deploy workflows:**
- App: `.github/workflows/deploy-web.yml` updates EAS alias on push to `main` or `staging`
- Marketing pages: `.github/workflows/deploy-web.yml` also runs `pnpm build` in `apps/web/` and deploys to Cloudflare Pages (with per-build static HTML and OG images)

## Routing Logic

| Path | Bot Request | User Request |
|------|-------------|--------------|
| `/`, `/guides/*`, `/download`, etc. (static routes in registry) | Prebuilt HTML from Cloudflare Pages (OG meta baked in) | Cloudflare Pages (SPA) |
| `/e/:shortId`, `/g/:shortId`, `/t/:toolId`, etc. (dynamic app routes) | Worker → fetch `/link-preview/meta` → render shared template | EAS Hosting (Expo App) |
| `/nearme`, `/:slug` (community, channel routes) | Worker → fetch `/link-preview/meta` → render shared template | EAS Hosting (Expo App) |
| `/_expo/*` | EAS Hosting | EAS Hosting |
| `/.well-known/apple-app-site-association` | Worker (JSON) | Worker (JSON) |
| `/.well-known/assetlinks.json` | Worker (JSON) | Worker (JSON) |
| Everything else | EAS Hosting | EAS Hosting |

## Static Page Registration & OG Metadata

All static marketing pages (guides, homepage, etc.) are registered in a central route registry:

**File:** `apps/web/src/routes.tsx`

**Example entry:**
```typescript
export const routes: RouteEntry[] = [
  {
    path: '/guides/events',
    component: EventsGuide,
    title: 'Event Management Guide | Togather',
    description: 'Learn how to create, schedule, and manage events...',
    image: 'https://cdn.example.com/events-guide.png', // optional; auto-generated if omitted
    emoji: '📅',
  },
  // ...
];
```

**Build process** (`apps/web/scripts/generate-static-pages.tsx`):
1. Runs after `vite build` during `pnpm build`
2. For each route in registry:
   - Writes `dist/<path>/index.html` with page's `<title>` and meta tags (og:title, og:description, twitter:card, etc.)
   - If route has no `image` entry, generates branded 1200x630 PNG using satori + resvg (brand color #D4A574, Plus Jakarta Sans font)
   - Saves generated images to `dist/og/<slug>.png`
3. Cloudflare Pages deployment includes all prebuilt HTML files and images

**Why this approach:**
- Bots get correct meta tags instantly from static HTML (no runtime rendering needed)
- Users still get the full Vite SPA experience (React routing, client-side navigation)
- Scales to unlimited pages without additional server resources
- Automatic OG image generation keeps visual consistency across guides

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

The link preview system uses a single unified HTTP endpoint defined in `convex/http.ts`:

### Link Preview Metadata Endpoint

```
GET /link-preview/meta?url=<full request URL>
```

**Response:**
```json
{
  "title": "RSVP to Weekly Meetup | Demo Community",
  "description": "Saturday, Jan 15, 2025 at 7:00 PM · Tech Enthusiasts · 123 Main St",
  "image": "https://...",
  "url": "https://togather.nyc/e/abc123",
  "siteName": "Togather",
  "imageAlt": "Weekly Meetup event cover"
}
```

**Resolver Logic** (`apps/convex/functions/linkPreviewMeta.ts`):
- Parses request URL to determine resource type (event, group, tool, channel, community, etc.)
- Loads resource from database with all related data
- Formats title with type-specific pattern (e.g. "RSVP to [title] | [community]" for events)
- Assembles rich description (date, time, location for events; member count for groups; etc.)
- Applies image fallback chain (resource cover → related resource image → community logo)
- Returns fully typed metadata object

**Old endpoints removed:** `/link-preview/event`, `/link-preview/group`, `/link-preview/community`, `/link-preview/channel`, `/link-preview/tool`. All preview logic now routes through the single `/link-preview/meta` endpoint.

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

### 1. Bot requests static guide page (Googlebot, Facebook crawler, etc.)
```
Googlebot → togather.nyc/guides/events
  → Cloudflare Worker (bot detected)
  → Worker passes to Cloudflare Pages
  → Cloudflare Pages serves prebuilt dist/guides/events/index.html
  → HTML includes og:title, og:description, og:image baked in by build script
  → Google indexes rich preview (no runtime work needed)
```

### 2. Bot requests dynamic app link (iMessage, Twitter, etc.)
```
iMessage crawler → togather.nyc/e/ABC123
  → Cloudflare Worker (bot detected: Applebot)
  → Worker matches /e/ABC123 against PREVIEW_ROUTES table
  → Worker fetches GET /link-preview/meta?url=https://togather.nyc/e/ABC123
  → Convex resolver assembles metadata (title, description, image, etc.)
  → Worker renders shared template with metadata
  → Worker returns HTML with OG tags
  → iMessage shows rich preview
```

### 3. User visits static guide page
```
Browser → togather.nyc/guides/events
  → Cloudflare Worker (not a bot)
  → Worker passes to Cloudflare Pages
  → Cloudflare Pages loads Vite SPA (index.html fallback)
  → React router mounts guides/events component
```

### 4. User opens event link in browser
```
Browser → togather.nyc/e/ABC123
  → Cloudflare Worker (not a bot)
  → Worker passes to EAS Hosting
  → EAS serves Expo app
  → App loads event detail page
```

## Troubleshooting

### Quick Diagnostics

Test the link preview metadata endpoint:
```bash
# Test metadata endpoint directly
curl "https://your.convex.site/link-preview/meta?url=https://togather.nyc/e/ABC123"

# Test bot response through worker
curl -H "User-Agent: Twitterbot" "https://togather.nyc/e/ABC123"

# Verify Cloudflare Pages is serving static route
curl -I "https://togather.nyc/guides/events"
```

### Prebuilt static page not showing OG tags
**Symptom:** og:title/og:description/og:image missing on a static route

**Cause:** 
1. Page not registered in `apps/web/src/routes.tsx`
2. Build script not run (or failed silently)
3. Cloudflare Pages serving old cache

**Fix:**
1. Verify page entry exists in `routes.tsx` with title, description, image fields
2. Run `pnpm build` in `apps/web/` and check `dist/<path>/index.html` for meta tags
3. Purge Cloudflare Pages cache or wait for next deployment

### Dynamic app link preview not showing
**Symptom:** og:title/og:description/og:image missing on /e/, /g/, etc.

**Cause:**
1. Route not in PREVIEW_ROUTES table in worker
2. Resolver not handling this route type
3. Metadata endpoint returning error

**Fix:**
1. Check `PREVIEW_ROUTES` in `apps/link-preview/cloudflare-worker.js` includes the route pattern
2. Verify `apps/convex/functions/linkPreviewMeta.ts` handles the resource type
3. Test endpoint: `curl "https://your.convex.site/link-preview/meta?url=https://togather.nyc/e/ABC123"`
4. Use Facebook Debugger or Twitter Card Validator to test final output

### Worker not routing to correct Cloudflare Pages
**Symptom:** Static routes return app 404 instead of static page

**Cause:** isStaticPath() doesn't match the route pattern

**Fix:** Check `isStaticPath()` in `cloudflare-worker.js` includes your route

### Build script not generating OG images
**Symptom:** Pages have og:title/og:description but no og:image

**Cause:** 
1. Route entry missing `image` field
2. satori/resvg build failed silently

**Fix:**
1. Run build with verbose logging: check `dist/og/` directory for generated images
2. Verify route entry in `routes.tsx` omits `image` field (auto-generated) or specifies a URL
3. Check build script stderr for satori errors

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
