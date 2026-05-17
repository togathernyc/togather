/**
 * Starter role suggestions
 *
 * When a channel is first marked as a serving team, Togather offers a
 * suggested set of roles inferred from the channel name (ADR-023). This is
 * pure setup convenience — the set is fully editable and dismissable, and no
 * behavior depends on it.
 *
 * Kept as a plain function (no Convex context) so it is trivially unit
 * testable and reusable by both the query and tests.
 */

/** A suggested role, mirroring the editable shape of a `teamRoles` row. */
export interface StarterRole {
  name: string;
  /** Default slot count a new event seeds for this role. */
  defaultNeeded: number;
}

/** Default suggestion when a channel name matches no known keyword. */
export const DEFAULT_STARTER_ROLES: StarterRole[] = [
  { name: "Team Lead", defaultNeeded: 1 },
  { name: "Volunteer", defaultNeeded: 2 },
];

/**
 * Keyword → role-set map. The first matching keyword wins; keywords are
 * matched as case-insensitive substrings of the channel name.
 */
const KEYWORD_ROLE_SETS: Array<{ keywords: string[]; roles: StarterRole[] }> = [
  {
    keywords: ["worship", "band", "music"],
    roles: [
      { name: "Vocals", defaultNeeded: 3 },
      { name: "Drums", defaultNeeded: 1 },
      { name: "Keys", defaultNeeded: 1 },
      { name: "Guitar", defaultNeeded: 1 },
      { name: "Bass", defaultNeeded: 1 },
    ],
  },
  {
    keywords: ["tech", "production", "media", "av"],
    roles: [
      { name: "Sound", defaultNeeded: 1 },
      { name: "Lights", defaultNeeded: 1 },
      { name: "ProPresenter", defaultNeeded: 1 },
      { name: "Camera", defaultNeeded: 1 },
    ],
  },
  {
    keywords: ["usher", "host", "greet", "welcome", "hospitality"],
    roles: [
      { name: "Greeter", defaultNeeded: 2 },
      { name: "Usher", defaultNeeded: 2 },
    ],
  },
  {
    keywords: ["kids", "children", "youth", "nursery"],
    roles: [
      { name: "Check-in", defaultNeeded: 1 },
      { name: "Classroom Lead", defaultNeeded: 1 },
      { name: "Helper", defaultNeeded: 2 },
    ],
  },
];

/**
 * Suggest a starter role set for a channel based on its name.
 * Returns `DEFAULT_STARTER_ROLES` when no keyword matches.
 *
 * @param channelName - The team channel's display name.
 */
export function suggestStarterRolesForName(channelName: string): StarterRole[] {
  const haystack = channelName.toLowerCase();
  for (const entry of KEYWORD_ROLE_SETS) {
    if (entry.keywords.some((keyword) => haystack.includes(keyword))) {
      return entry.roles;
    }
  }
  return DEFAULT_STARTER_ROLES;
}
