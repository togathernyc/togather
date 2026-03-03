/**
 * Types for the events feature
 *
 * These types correspond to the API responses from the Convex backend
 * endpoints for event access and display.
 *
 * Backend endpoints (Convex):
 * - api.functions.meetings.index.getByShortId (public event access)
 * - api.functions.meetings.index.getById (authenticated access)
 *
 * The getByShortId endpoint handles public/community/group visibility
 * and access control.
 */

export interface AccessPrompt {
  type: "sign_in" | "join_community" | "request_group";
  message: string;
  communityId?: string;
  groupId?: string;
}

export interface RsvpOption {
  id: number;
  label: string;
  enabled: boolean;
}

/**
 * Response from getByShortId endpoint
 *
 * Contains event preview data that's always returned, plus
 * hasAccess flag and conditional full details.
 *
 * Backend endpoint: api.functions.meetings.index.getByShortId
 */
export interface EventByShortIdResponse {
  // Always present - basic preview info
  id: string;
  shortId: string;
  title: string | null;
  scheduledAt: string;
  coverImage: string | null;
  visibility: "public" | "community" | "group";
  groupName: string;
  communityId: string;
  communityName: string;
  communityLogo: string | null;
  hasAccess: boolean;
  status: "scheduled" | "confirmed" | "cancelled" | "completed";
  cancellationReason?: string | null;

  // Present when hasAccess is false
  accessPrompt?: AccessPrompt;

  // Only present when hasAccess is true
  locationOverride?: string | null;
  meetingLink?: string | null;
  meetingType?: number;
  note?: string | null;
  rsvpEnabled?: boolean;
  rsvpOptions?: RsvpOption[];
  groupId?: string;
}
