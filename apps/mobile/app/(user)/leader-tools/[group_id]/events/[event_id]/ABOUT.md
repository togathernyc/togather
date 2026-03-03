# Event Details Page

## Functionality

The Event Details page displays comprehensive information about a specific scheduled event, including RSVP statistics and provides options to edit the event or navigate to the group's chat.

## Features

- **Event Information**: Displays the event date and time in a readable format
- **RSVP Statistics**: Shows three key metrics:
  - Going: Number of members who RSVP'd as attending
  - Not Going: Number of members who RSVP'd as not attending
  - Not Answered: Number of members who haven't responded yet
- **Edit Functionality**: Allows leaders to edit the event date/time through the EventSchedule modal
- **Group Chat Navigation**: Provides a button to navigate directly to the group's chat in the inbox
- **Past Event Handling**: Displays appropriate status for events that have already occurred

## Test Coverage

### Component Tests (`features/leader-tools/components/__tests__/EventDetails.test.tsx`)

- Renders event details with RSVP stats
- Displays loading state while fetching RSVP stats
- Handles back button press
- Opens event schedule modal when edit button is pressed
- Calls onGroupChat when group chat button is pressed
- Shows past event status for past events
- Handles zero RSVP stats
- Handles API errors gracefully

### Page Tests (`features/leader-tools/__tests__/event-details-page.test.tsx`)

- Renders event details page
- Handles back navigation
- Handles group chat navigation
- Handles event schedule mutation
- Navigates back after successful event schedule
- Handles missing event_date parameter
- Handles router.canGoBack() returning false
- Handles event schedule mutation error

## Key Components

- **EventDetails**: Main component that displays event information and RSVP statistics
- **EventSchedule**: Modal component for editing event details

## Data Flow

1. Page receives `group_id` and `event_date` from route parameters
2. Event date is decoded from URL encoding
3. RSVP stats are fetched using `api.getRSVPStats(groupId, eventDate)`
4. Event details are displayed with RSVP statistics
5. User can:
   - Edit event: Opens EventSchedule modal, which calls `onScheduleEvent` handler
   - Navigate to group chat: Calls `onGroupChat` handler, which navigates to inbox with group query params
   - Go back: Calls `onBack` handler, which navigates back or to events list

## API Integration

- **GET** `/dinner/rsvp/{dinner_id}/stats/?date={date}` - Fetches RSVP statistics for a specific event date
- **POST** `/dinner/group-schedule/create-exceptions/` - Creates/edits/removes event schedule

## Navigation

- **From**: `/leader-tools/[group_id]/events` (Events list page)
- **To**:
  - `/leader-tools/[group_id]/events` (Back to events list)
  - `/inbox?dp_id=[group_id]&dp_name=[encoded_group_name]` (Group chat in inbox)
  - Same page (After editing event, if successful)

## Route Parameters

- `group_id`: The ID of the dinner party/group
- `event_id`: The event identifier in one of two formats:
  - `id-{id}|{encoded-date}`: For events with an attendance record ID (e.g., `id-123|2025-11-26T10%3A00%3A00Z`)
  - `date-{encoded-date}`: For future scheduled events without an ID (e.g., `date-2025-11-26T10%3A00%3A00Z`)
  
  The identifier ensures uniqueness even when multiple events occur on the same day, by using the event ID when available or the full date-time string when not.

