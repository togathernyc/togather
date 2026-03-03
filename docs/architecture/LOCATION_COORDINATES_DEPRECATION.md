# Location Coordinates Deprecation

## Overview

We've deprecated stored latitude/longitude coordinates for groups in favor of computing them on-the-fly from addresses and zip codes. This makes it much easier for users to add location data without needing to find coordinates manually.

## Changes Made

### Frontend

1. **New Geocoding Utility** (`apps/mobile/features/groups/utils/geocodeLocation.ts`)
   - `geocodeZipCode()` - Converts zip codes to coordinates using the `us-zips` database
   - `geocodeAddress()` - Converts full addresses to coordinates (currently uses zip code lookup)
   - `getGroupCoordinates()` - Gets coordinates for a group using priority:
     1. Stored coordinates (if available and valid)
     2. Zip code geocoding
     3. Full address geocoding
     4. Legacy location field parsing

2. **Updated ExploreScreen** (`apps/mobile/features/explore/components/ExploreScreen.tsx`)
   - Now uses `getGroupCoordinates()` to compute coordinates on-the-fly
   - No longer requires stored coordinates - geocodes from address/zip code

### Backend

1. **API Schemas Updated** (`apps/backend/src/servers/togather_api/routers/groups.py`)
   - `GroupOutSchema`: Added deprecation comments for `latitude`/`longitude`
   - `GroupCreateSchema`: Marked coordinates as deprecated
   - `GroupUpdateSchema`: Marked coordinates as deprecated
   - Coordinates remain optional for backward compatibility but are not required

## How It Works

1. **User Input**: Users enter address fields (`address_line1`, `address_line2`, `city`, `state`, `zip_code`) or just a zip code
2. **Geocoding**: When displaying groups on the map, the frontend automatically geocodes addresses/zip codes to coordinates
3. **Map Display**: Map components receive groups with computed coordinates attached

## Benefits

- ✅ **Easier for users**: No need to manually find coordinates
- ✅ **More reliable**: Zip code lookup is fast and accurate
- ✅ **Backward compatible**: Existing groups with stored coordinates still work
- ✅ **Future-proof**: Can easily add full address geocoding API later

## Migration Path

### For Existing Groups
- Groups with stored coordinates: Continue to work (coordinates are used first)
- Groups without coordinates: Automatically geocoded from zip code or address
- No migration needed - works automatically

### For New Groups
- Just enter address fields or zip code
- Coordinates are computed automatically when needed
- No need to store coordinates in the database

## Future Enhancements

1. **Full Address Geocoding**: Add API integration (Google Maps, Mapbox, etc.) for more accurate geocoding
2. **Caching**: Cache geocoded coordinates to reduce computation
3. **Backend Geocoding**: Optionally move geocoding to backend for consistency

## Technical Details

### Zip Code Lookup
- Uses `us-zips` npm package for fast zip code to coordinate lookup
- Covers all US zip codes
- Very fast (in-memory lookup)

### Coordinate Priority
1. Stored coordinates (if valid)
2. Zip code geocoding
3. Full address geocoding (when implemented)
4. Legacy location field parsing

### Performance
- Zip code lookup is instant (in-memory)
- No API calls needed for zip codes
- Full address geocoding would require API calls (not yet implemented)

