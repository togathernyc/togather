import type { Id } from "@services/api/convex";

/**
 * Channel member data structure returned by the backend
 */
export interface ChannelMember {
  id: string;
  userId: Id<"users">;
  displayName: string;
  profilePhoto?: string;
  /** Channel-scoped role: "owner" or "member". */
  role: string;
  /**
   * Group-scoped role: "leader" | "admin" | "member" (or undefined if not a
   * group member — possible for synced PCO rows). Distinct from `role` so
   * UI can show channel ownership and group leadership independently.
   */
  groupRole?: string;
  /**
   * True when the user has no push tokens for the current environment.
   * UI surfaces overlay a slashed-bell badge on the avatar so senders
   * know not to expect immediate delivery. Source: `pushTokens` (see
   * `lib/notifications/enabledStatus.ts` on the server).
   */
  notificationsDisabled?: boolean;
  syncSource?: string;
  syncMetadata?: {
    serviceTypeName?: string;
    teamName?: string;
    position?: string;
    serviceDate?: number;
    serviceName?: string;
  };
}

/**
 * Unsynced PCO person - someone scheduled in PCO but not matched to a user
 */
export interface UnsyncedPerson {
  pcoPersonId: string;
  pcoName: string;
  pcoPhone?: string;
  pcoEmail?: string;
  serviceTypeName?: string;
  teamName?: string;
  position?: string;
  reason: string;
}

/**
 * Returns human-readable text explaining why a PCO person couldn't be synced
 */
export function getDebugReasonText(reason: string, person: UnsyncedPerson): string {
  switch (reason) {
    case "not_in_group":
      return "In community but not in this group";
    case "not_in_community":
      return "Not in this community";
    case "no_contact_info":
      return "No contact info in PCO";
    case "phone_mismatch":
      return `Phone ${person.pcoPhone || "unknown"} not found`;
    case "email_mismatch":
      return `Email ${person.pcoEmail || "unknown"} not found`;
    default:
      return "Unknown issue";
  }
}
