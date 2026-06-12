/**
 * DEMO: render the REAL mobile-app events list on the web with mock data and no
 * backend. Uses the shared demo harness (see vite.config.ts aliases).
 *
 * The screen rendered here is the real `EventsListView` (the map-free list half
 * of the Events tab) wired up with the real `EventCard`. `EventsListView` is a
 * prop-driven presentational component, so the demo owns the search state and
 * feeds it a fixture array of upcoming community events — titles, dates, group,
 * location, and an RSVP-going summary — exactly the shape the backend query
 * `api.functions.meetings.events.listForEventsTab` returns (see
 * features/events/hooks/useCommunityEvents.ts `CommunityEvent`).
 *
 * The list groups events into Today / Tomorrow / This Week / Coming Up by their
 * `scheduledAt`, so the fixtures use ISO timestamps relative to "now".
 */
import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { View } from "react-native";
import { ThemeProvider } from "../../mobile/providers/ThemeProvider";
import { AuthProvider } from "./harness/AuthProvider";
import { registerFixtures } from "./harness/convex";
import { EventsListView } from "../../mobile/features/events/components/EventsListView";
import type { CommunityEvent } from "../../mobile/features/events/hooks/useCommunityEvents";

// Relative-to-now helpers so the list always has fresh "upcoming" events.
const HOUR = 1000 * 60 * 60;
const DAY = HOUR * 24;
const at = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();

const guest = (id: string, firstName: string) => ({
  id,
  firstName,
  profileImage: null as string | null,
});

const events: CommunityEvent[] = [
  {
    id: "e1",
    shortId: "e1",
    title: "Tuesday Dinner & Study",
    // Later today.
    scheduledAt: at(6 * HOUR),
    status: "active",
    visibility: "community",
    coverImage: null,
    locationOverride: "114 Grace Ave · Apt 3",
    meetingType: 1, // in-person
    rsvpEnabled: true,
    communityWideEventId: null,
    group: {
      id: "g1",
      name: "Downtown Small Group",
      image: null,
      groupTypeName: "Small Groups",
      addressLine1: null,
      addressLine2: null,
      city: null,
      state: null,
      zipCode: null,
    },
    rsvpSummary: {
      totalGoing: 12,
      topGoingGuests: [
        guest("u1", "Jordan"),
        guest("u2", "Maya"),
        guest("u3", "Riley"),
        guest("u4", "Sam"),
      ],
    },
    hideRsvpCount: false,
    createdById: "demo-user",
    viewerIsLeader: true,
  },
  {
    id: "e2",
    shortId: "e2",
    title: "Morning Prayer & Coffee",
    // Tomorrow.
    scheduledAt: at(DAY + 2 * HOUR),
    status: "active",
    visibility: "community",
    coverImage: null,
    locationOverride: "Fellowship Hall",
    meetingType: 1,
    rsvpEnabled: true,
    communityWideEventId: null,
    group: {
      id: "g2",
      name: "Sunrise Group",
      image: null,
      groupTypeName: "Small Groups",
      addressLine1: null,
      addressLine2: null,
      city: null,
      state: null,
      zipCode: null,
    },
    rsvpSummary: {
      totalGoing: 5,
      topGoingGuests: [guest("u5", "Alex"), guest("u6", "Chris"), guest("u7", "Pat")],
    },
    hideRsvpCount: false,
    createdById: "u9",
    viewerIsLeader: false,
  },
  {
    id: "e3",
    shortId: "e3",
    title: "Church-wide Study Night",
    // Later this week.
    scheduledAt: at(3 * DAY + 3 * HOUR),
    status: "active",
    visibility: "community",
    coverImage: null,
    locationOverride: null,
    meetingType: 2, // online
    rsvpEnabled: true,
    communityWideEventId: "cwe1", // shows the community-wide badge
    group: {
      id: "g3",
      name: "Eastside Group",
      image: null,
      groupTypeName: "Small Groups",
      addressLine1: null,
      addressLine2: null,
      city: null,
      state: null,
      zipCode: null,
    },
    rsvpSummary: {
      totalGoing: 8,
      topGoingGuests: [guest("u8", "Taylor"), guest("u9", "Morgan")],
    },
    hideRsvpCount: false,
    createdById: "u9",
    viewerIsLeader: false,
  },
  {
    id: "e4",
    shortId: "e4",
    title: "Serve Day at the Food Bank",
    // Next week.
    scheduledAt: at(8 * DAY + 4 * HOUR),
    status: "active",
    visibility: "community",
    coverImage: null,
    locationOverride: "Community Food Bank · 22 Mill St",
    meetingType: 1,
    rsvpEnabled: true,
    communityWideEventId: null,
    group: {
      id: "g4",
      name: "Outreach Team",
      image: null,
      groupTypeName: "Serve Teams",
      addressLine1: null,
      addressLine2: null,
      city: null,
      state: null,
      zipCode: null,
    },
    rsvpSummary: {
      totalGoing: 19,
      topGoingGuests: [
        guest("u10", "Jamie"),
        guest("u11", "Casey"),
        guest("u12", "Drew"),
        guest("u13", "Avery"),
      ],
    },
    hideRsvpCount: false,
    createdById: "demo-user",
    viewerIsLeader: true,
  },
];

// Register a fixture so the no-backend client has something keyed for the
// events-tab query, even though EventsListView is driven by props here.
registerFixtures({
  "functions.meetings.events.listForEventsTab": {
    myEvents: [],
    nextUp: [],
    thisWeek: [],
  },
});

function EventsDemo() {
  const [searchQuery, setSearchQuery] = useState("");
  return (
    <View style={{ flex: 1, backgroundColor: "#fff", paddingHorizontal: 16 }}>
      <EventsListView
        events={events}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
      />
    </View>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider>
      <AuthProvider>
        <EventsDemo />
      </AuthProvider>
    </ThemeProvider>
  </StrictMode>,
);
