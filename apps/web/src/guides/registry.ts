/**
 * Registry of guide posts.
 *
 * This is the single source of truth for the /guides hub, the per-post header
 * metadata, and the "previous / next in series" navigation. Add a new post by
 * appending an entry here and creating the matching page component + route.
 *
 * Order in this array == order in the series.
 */
export type Guide = {
  /** URL slug: /guides/<slug> */
  slug: string;
  /** Short title shown in cards and the page header. */
  title: string;
  /** One-line summary for the hub cards and meta description. */
  summary: string;
  /** Grouping label shown on the hub (e.g. "Church onboarding"). */
  series: string;
  /** Estimated read time, minutes. */
  readMinutes: number;
  /** Emoji used as a lightweight icon on cards. */
  emoji: string;
};

export const CHURCH_ONBOARDING_SERIES = "Church onboarding";

export const guides: Guide[] = [
  {
    slug: "create-your-community",
    title: "Create your community",
    summary:
      "Request a community from the switcher, what fair pricing means, how our admins review requests — and what happens if you're turned down.",
    series: CHURCH_ONBOARDING_SERIES,
    readMinutes: 6,
    emoji: "⛪️",
  },
  {
    slug: "branding",
    title: "Set up your name, logo & brand colors",
    summary:
      "Make Togather feel like your church: community name, logo, app icon, and primary/secondary brand colors.",
    series: CHURCH_ONBOARDING_SERIES,
    readMinutes: 5,
    emoji: "🎨",
  },
  {
    slug: "group-types",
    title: "Group types and why they matter",
    summary:
      "Group types are the backbone of your community. How to create them, and how they power community-wide events and Explore filtering.",
    series: CHURCH_ONBOARDING_SERIES,
    readMinutes: 7,
    emoji: "🗂️",
  },
  {
    slug: "groups-and-channels",
    title: "Groups, channels & leaders",
    summary:
      "Set up groups for your teams and campuses. Understand the automatic general and leaders channels, how to make people leaders, and when larger churches should switch to an announcement channel.",
    series: CHURCH_ONBOARDING_SERIES,
    readMinutes: 9,
    emoji: "💬",
  },
  {
    slug: "events",
    title: "Events, series & community-wide events",
    summary:
      "Schedule events with invitations and RSVPs, repeat them as a series, or roll out a community-wide event that spawns a meeting for every group of a type at once.",
    series: CHURCH_ONBOARDING_SERIES,
    readMinutes: 7,
    emoji: "📅",
  },
  {
    slug: "event-plans",
    title: "Event plans: teams, rostering & run sheets",
    summary:
      "Plan services the way you would in Planning Center: define teams and roles, collect availability, schedule volunteers in a roster grid, and run the day from a shared run sheet.",
    series: CHURCH_ONBOARDING_SERIES,
    readMinutes: 9,
    emoji: "📋",
  },
  {
    slug: "check-in",
    title: "Check-ins & follow-up",
    summary:
      "Make sure every member gets cared for: follow-up scores that surface who needs attention, assigning people to leaders, and logging every reach-out.",
    series: CHURCH_ONBOARDING_SERIES,
    readMinutes: 6,
    emoji: "🤝",
  },
  {
    slug: "prayer",
    title: "Enable the prayer feature",
    summary:
      "Turn on prayer for your community so members can share requests, pray for one another, and post praise reports.",
    series: CHURCH_ONBOARDING_SERIES,
    readMinutes: 5,
    emoji: "🙏",
  },
];

export function getGuide(slug: string): Guide | undefined {
  return guides.find((g) => g.slug === slug);
}

/** Previous / next post in the series for footer navigation. */
export function getGuideNeighbors(slug: string): {
  prev: Guide | null;
  next: Guide | null;
} {
  const i = guides.findIndex((g) => g.slug === slug);
  if (i === -1) return { prev: null, next: null };
  return {
    prev: i > 0 ? guides[i - 1] : null,
    next: i < guides.length - 1 ? guides[i + 1] : null,
  };
}
