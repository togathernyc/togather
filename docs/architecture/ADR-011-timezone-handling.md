# ADR-011: Timezone Handling for Events and Meetings

## Status
Implemented

## Context
Events and meetings need proper timezone handling to ensure users across different regions can correctly understand when events occur. Currently:

1. **Events are stored as UTC** - PostgreSQL `Timestamptz` columns correctly preserve timezone info
2. **No timezone display** - Times shown without timezone indicators (EST, PST, etc.)
3. **No user timezone preference** - Users can't set their preferred timezone
4. **Community timezone exists but unused** - `community.timezone` field exists in schema but isn't leveraged
5. **Event creation ambiguity** - Users don't know what timezone they're creating events in

### Problems This Causes
- Users in different timezones see different local times with no indication of the original timezone
- Event creators don't know if the time they enter is interpreted as local or UTC
- No way to display "7:00 PM EST" style formatting

## Decision
Implement comprehensive timezone handling with the following rules:

### Event Creation
- **Times are interpreted in the community's timezone**
- UI clearly shows which timezone is being used (e.g., "Times are in EST")
- Community timezone is set in community settings (existing field)

### Event Display
- **Times are displayed in the user's personal timezone**
- All times include timezone abbreviation (e.g., "7:00 PM EST")
- User timezone is set in personal settings (new field)

### User Timezone Setting
- **Manual selection in settings only** (no auto-detection initially)
- IANA timezone strings (e.g., `America/New_York`)
- Required field - users must set it (default to UTC if not set)

## Schema Changes

### User Table
Add `timezone` field:
```prisma
model user {
  // ... existing fields
  timezone String? @default("America/New_York")
}
```

### Community Table (Existing)
```prisma
model community {
  // ... existing fields
  timezone String? // Already exists, will be used for event creation
}
```

## Implementation

### Backend

#### User Settings Endpoints
- `user.getSettings()` - includes `timezone`
- `user.updateSettings()` - accepts `timezone` (validated as IANA string)

#### Meeting/Event Responses
- Include `communityTimezone` in event responses for display context

### Frontend

#### New Dependencies
- `date-fns-tz` - timezone conversion and formatting

#### Timezone Utilities (`packages/shared/src/utils/timezone.ts`)
```typescript
// Format time in user's timezone with abbreviation
formatTimeWithTimezone(date: Date, timezone: string): string
// e.g., "7:00 PM EST"

// Format date and time with timezone
formatDateTimeWithTimezone(date: Date, timezone: string): string
// e.g., "Dec 25, 2024 at 7:00 PM EST"

// Get timezone abbreviation
getTimezoneAbbreviation(timezone: string, date: Date): string
// e.g., "EST", "ACST"

// Common timezone list for picker
COMMON_TIMEZONES: { value: string; label: string }[]
```

#### Settings Screen
- Add "Timezone" picker below existing settings
- Display current timezone
- Full list of IANA timezones with search

#### Event Display Components
- `EventCard` - shows time with timezone abbreviation
- `EventDetails` - shows full datetime with timezone
- `MeetingListItem` - shows time with timezone

#### Event Creation
- `EventSchedule` modal - shows "Times are in [Community Timezone]" header
- Clear indication that times entered are in community's timezone

## Consequences

### Positive
- Clear timezone handling throughout the app
- Users always know what timezone times are displayed in
- Event creators know exactly what timezone they're creating events for
- Foundation for future auto-detection feature

### Negative
- Users must manually set timezone (until auto-detection is added)
- Additional complexity in date formatting throughout the app
- Migration needed to add default timezone to existing users

## Future Considerations
- **Auto-detection**: Detect device timezone and prompt user to confirm
- **Change detection**: Alert users when their device timezone doesn't match their setting
- **Travel mode**: Temporarily show times in a different timezone

## Affected Files

### Backend
- `prisma/schema.prisma` - Add `timezone` to user table
- `apps/api-trpc/src/routers/user.ts` - Settings endpoints
- `apps/api-trpc/src/routers/groups/meetings.ts` - Include community timezone

### Frontend
- `packages/shared/src/utils/timezone.ts` - New timezone utilities
- `apps/mobile/features/settings/screens/SettingsScreen.tsx` - Timezone picker
- `apps/mobile/features/explore/components/EventCard.tsx` - Timezone display
- `apps/mobile/features/explore/components/EventDetails.tsx` - Timezone display
- `apps/mobile/features/leader-tools/components/modals/EventSchedule.tsx` - Community TZ indicator

## Related
- ADR-001: Stream Chat Channel Naming (events use Stream for RSVPs)
- ADR-002: Event RSVP Chat Integration
