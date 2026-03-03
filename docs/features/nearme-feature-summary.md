# "Find Groups Near Me" Feature - Implementation Summary

## Overview

This document summarizes the implementation of a public "Find a [group_type] near you" feature that allows users to discover groups in their area via subdomain-based community URLs.

**Target URL Pattern:** `{community_slug}.{your-domain}/nearme?group_type=dinner_party`

---

## What Was Built

### 1. Database Schema Change

**File:** `apps/api-trpc/src/prisma/schema.prisma`

Added a `coordinates` JSON column to the `group` model:
```prisma
coordinates          Json?          // { latitude: number, longitude: number }
```

**Status:** Schema updated, but migration NOT yet applied to database.

---

### 2. Backend API

#### Geocoding Utilities
**File:** `apps/api-trpc/src/lib/geocoding.ts`

- `geocodeAddress(address)` - Calls Mapbox Geocoding API
- `buildAddressString(fields)` - Builds address from group fields
- `geocodeGroupAddress(fields)` - Convenience function for group geocoding

#### Backfill Script
**File:** `apps/api-trpc/src/scripts/geocode-groups.ts`

One-time script to geocode existing groups:
- Fetches groups with zip_code but no coordinates
- Calls Mapbox API for each
- Updates group with `{ latitude, longitude }` JSON
- Rate-limited to avoid API throttling

**Usage:**
```bash
cd apps/api-trpc
MAPBOX_ACCESS_TOKEN=your_token npx tsx src/scripts/geocode-groups.ts
```

#### Public Search Endpoint
**File:** `apps/api-trpc/src/routers/groups/search.ts`

New `groups.publicSearch` procedure:
- **Input:** `communitySubdomain`, `groupTypeSlug?`, `latitude`, `longitude`, `maxDistanceMiles`
- **Returns:** Groups sorted by distance with Haversine calculation in SQL
- **Auth:** Public (no authentication required)

New `groups.publicTypes` procedure:
- Lists group types for a community (for filter dropdown)

#### Auto-Geocode on Mutations
**File:** `apps/api-trpc/src/routers/groups/core.ts`

- `createMutation` - Geocodes address in background after creating group
- `updateMutation` - Re-geocodes when address fields change

---

### 3. Frontend Components

#### Subdomain Community Hook
**File:** `apps/mobile/features/auth/hooks/useSubdomainCommunity.ts`

- Parses subdomain from `window.location.hostname` on web
- Falls back to `?subdomain=` query param for local development
- Skips reserved subdomains: `api`, `www`, `app`, `staging`, `dev`
- Returns `{ community, subdomain, isLoading, error }`

#### User Location Hook
**File:** `apps/mobile/features/location/hooks/useUserLocation.ts`

- `requestDeviceLocation()` - Requests browser/device geolocation
- `setLocationFromZip(zipCode)` - Sets location from zip code using `us-zips` package
- Caches location in AsyncStorage for 30 minutes
- Returns `{ coordinates, isLoading, error, source, requestDeviceLocation, setLocationFromZip }`

#### NearMe Page
**File:** `apps/mobile/app/(landing)/nearme/index.tsx`

Public page with:
- Community header (logo + name from subdomain)
- Location section (use my location OR enter zip)
- Distance filter (5/10/15/25/50 mile pills)
- Group type filter
- List of nearby groups (NearbyGroupCard components)
- Error states for invalid subdomain, no location, no groups found

#### Distance Slider
**File:** `apps/mobile/features/nearme/components/DistanceSlider.tsx`

Preset distance options as selectable pills (5, 10, 15, 25, 50 miles).

#### Nearby Group Card
**File:** `apps/mobile/features/nearme/components/NearbyGroupCard.tsx`

Card showing:
- Group preview image
- Name and type badge
- Distance badge (e.g., "2.3 mi")
- Location (city, state)
- Member count
- "On break" indicator if applicable

#### Join Button Update
**File:** `apps/mobile/features/groups/components/JoinGroupButton.tsx`

Added props:
- `communityName` - If provided, shows community membership message
- `isInCommunity` - Whether user is already in the community

Shows message: "Joining this group will also add you to [Community Name]"

---

## What Was NOT Done (Next Steps)

### 1. Apply Database Migration

The schema change was made but NOT applied to the database.

```bash
cd apps/api-trpc
pnpm db:push
```

Or generate a proper migration:
```bash
npx prisma migrate dev --name add_group_coordinates --schema src/prisma/schema.prisma
```

### 2. Run Geocoding Backfill

After migration, run the backfill script to geocode existing groups:

```bash
cd apps/api-trpc
MAPBOX_ACCESS_TOKEN=pk.xxx npx tsx src/scripts/geocode-groups.ts
```

Note: You need a Mapbox access token. The mobile app already has one in `.env` (`EXPO_PUBLIC_MAPBOX_TOKEN`). You may need to add `MAPBOX_ACCESS_TOKEN` to the API's `.env` file.

### 3. Configure DNS for Subdomains

Add CNAME record at DNS provider:
```
*.{your-domain}  CNAME  origin.expo.app
```

Keep existing records for reserved subdomains (API subdomain, etc.).

### 4. Test the Feature

**Local testing:**
```
http://localhost:8081/nearme?subdomain=demo-community
http://localhost:8081/nearme?subdomain=demo-community&group_type=dinner-party
```

**Production testing (after DNS setup):**
```
https://demo-community.{your-domain}/nearme
https://demo-community.{your-domain}/nearme?group_type=dinner-party
```

### 5. Wire Up Community Membership in Group Detail

The `JoinGroupButton` now accepts `communityName` and `isInCommunity` props, but they need to be passed from the group detail page when a user accesses a group from the nearme page without being authenticated or a community member.

**File to update:** `apps/mobile/features/groups/components/GroupNonMemberView.tsx`

Add logic to:
1. Detect if user came from nearme page (check URL or context)
2. Check if user is authenticated and in the community
3. Pass `communityName` and `isInCommunity` to `JoinGroupButton`

### 6. Handle Authentication Flow

When an unauthenticated user taps "Join" from the nearme page:
1. Redirect to sign-in/sign-up
2. After auth, redirect back to the group
3. Show community join prompt if not in community
4. Then allow group join

This flow may need additional work depending on current auth handling.

### 7. Regenerate Prisma Client

After schema changes are applied:
```bash
cd apps/api-trpc
npx prisma generate --schema src/prisma/schema.prisma
```

---

## Files Changed/Created

### New Files
- `apps/api-trpc/src/lib/geocoding.ts`
- `apps/api-trpc/src/scripts/geocode-groups.ts`
- `apps/mobile/features/auth/hooks/useSubdomainCommunity.ts`
- `apps/mobile/features/location/hooks/useUserLocation.ts`
- `apps/mobile/app/(landing)/nearme/index.tsx`
- `apps/mobile/features/nearme/components/DistanceSlider.tsx`
- `apps/mobile/features/nearme/components/NearbyGroupCard.tsx`

### Modified Files
- `apps/api-trpc/src/prisma/schema.prisma` - Added coordinates column
- `apps/api-trpc/src/routers/groups/search.ts` - Added publicSearch, publicTypes
- `apps/api-trpc/src/routers/groups/index.ts` - Exported new endpoints
- `apps/api-trpc/src/routers/groups/core.ts` - Added auto-geocoding
- `apps/mobile/features/groups/components/JoinGroupButton.tsx` - Added community message

---

## Architecture Decisions

1. **Single JSON column for coordinates** - Simpler than two separate columns, avoids complex migrations
2. **Haversine in SQL** - Efficient distance filtering/sorting at database level
3. **Mapbox for geocoding** - Already used in the app for maps
4. **Preset distance options** - Pills instead of slider to avoid additional package dependency
5. **Subdomain from hostname** - Parses on web, falls back to query param for dev
6. **Background geocoding** - Doesn't block API responses

---

## Testing Credentials

Use the test credentials from the seed script (`npx convex run functions/seed:seedDemoData`). Search for "Demo Community" when testing.

---

## Potential Issues to Watch

1. **Groups without addresses** - Won't appear in nearme results (filtered by `coordinates IS NOT NULL`)
2. **Rate limiting** - Mapbox free tier has limits; backfill script rate-limits to 10 req/sec
3. **Reserved subdomains** - Make sure `api`, `www`, etc. don't break
4. **Haversine edge cases** - Wrapped in LEAST/GREATEST to handle floating point precision

---

## Summary

The core feature is implemented end-to-end:
- Backend: Schema, geocoding, public API with distance calculation
- Frontend: Location detection, distance filter, group list, navigation to group details

Main remaining work:
1. Apply database migration
2. Run backfill script
3. Configure DNS
4. Test thoroughly
5. Potentially enhance auth flow for unauthenticated users
