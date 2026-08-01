---
name: guides-and-link-previews
description: MUST be read when a change touches user-facing app behavior that the public onboarding guides document (community creation/proposals, branding & settings, group types, groups/channels/roles, events & RSVP, prayer) — the guide must be updated in the same PR. Also read when adding a static marketing page, a new route in apps/web, or a dynamic shareable app route needing OG/link-preview metadata (apps/link-preview/cloudflare-worker.js, linkPreviewMeta.ts).
---

# Onboarding Guides & Link Previews (apps/web)

## Onboarding Guides (apps/web)

The public church onboarding guides live in `apps/web/src/pages/guides/` and are
registered in `apps/web/src/guides/registry.ts`. They describe **user-facing app
behavior** (UI labels, flows, and screens), so they go stale whenever a
documented feature changes.

**When a PR changes a documented feature, update its guide in the same PR.** Use
this map to find the guide that covers what you touched:

| If your change touches…                                                                                     | Update this guide                                  |
| ----------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| Community creation / proposals (`apps/convex/functions/ee/proposals.ts`, community switcher / selection)    | `apps/web/src/pages/guides/CreateCommunity.tsx`    |
| Community branding & settings (name, logo, subdomain, primary/secondary color) (`admin/settings.ts`)        | `apps/web/src/pages/guides/Branding.tsx`           |
| Group types (`functions/seed.ts` defaults, `createGroupType`, Explore filtering)                            | `apps/web/src/pages/guides/GroupTypes.tsx`         |
| Groups, channels (general/leaders/announcements), member roles / leaders (`groups/mutations.ts`)            | `apps/web/src/pages/guides/GroupsAndChannels.tsx`  |
| Events & community-wide events (`communityWideEvents.ts`, `meetings/events.ts`, RSVP)                        | `apps/web/src/pages/guides/Events.tsx`             |
| Prayer feature (`functions/prayers.ts`, `churchFeatures.prayerEnabled`)                                     | `apps/web/src/pages/guides/Prayer.tsx`             |

What to update when a guide is affected:

- **Prose & steps** — if a flow, label, or behavior changed.
- **UI mockups** — the in-page mock components (and any quoted in-app strings)
  must match the real screens. If a `<Figure>` uses a real screenshot (`src`),
  recapture it.
- **Deep links** — keep `apps/web/src/guides/appLinks.ts` paths valid.
- **New onboarding-relevant feature?** Add a guide: append an entry to
  `registry.ts`, add a page under `pages/guides/`, and register the route in
  `apps/web/src/main.tsx`.

If you're unsure whether a change is "user-facing enough" to need a guide
update, it probably is — err on the side of updating.

## Link Previews / OG Metadata

**Adding a static marketing page:** Add an entry to `apps/web/src/routes.tsx` with `path`, `element` (JSX component like `<EventsGuide />`), `title`, `description`, and optional `image` and `emoji`. The build script automatically generates OG metadata and images at compile time (satori + resvg for branded cards). Routes are **the only way to add a page** — the router is generated from the registry. For a **new top-level path** (not nested under an existing prefix like `/guides/`), you must also add it to `LANDING_PAGE_PATHS` or `LANDING_PAGE_PREFIXES` in `apps/link-preview/cloudflare-worker.js`, or the Cloudflare worker will misroute it; paths under already-listed prefixes (like `/guides/`) need no worker change.

**Adding a dynamic shareable app route:** Implement a resolver case in `apps/convex/functions/linkPreviewMeta.ts` (typed, unit-tested) to assemble preview metadata (title, description, image fallback chains, timezone formatting, etc.), then add a row to `PREVIEW_ROUTES` in `apps/link-preview/cloudflare-worker.js` to route the pattern. The worker fetches the metadata endpoint and renders the shared HTML template — **no per-type logic in the worker itself.**

See ADR-009 for full architecture.
