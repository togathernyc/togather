// Groups feature types
// Types specific to the groups feature

import type { ChatRoom } from "@/types/shared";

// Re-export ChatRoom for convenience
export type { ChatRoom };

export type RSVPStatus = 0 | 1 | 2 | null; // 0: Going, 1: Maybe, 2: Not Going, null: Not Set

export enum GroupType {
  DINNER_PARTY = 1,
  TEAM = 2,
  PUBLIC_GROUP = 3,
  TABLE = 4,
}

export interface GroupTypeColors {
  bg: string;
  color: string;
}

export interface GroupScheduleDetails {
  id?: number;
  first_meeting_date?: string;
  repeat_period?: number;
  repeat_value?: number;
  status?: number;
  created_at?: string;
  updated_at?: string;
}

export interface GroupHighlight {
  id: number;
  image_url?: string;
  width?: number;
  height?: number;
  created_at?: string;
}

export interface Group {
  _id: string; // Convex document ID (primary identifier for navigation)
  id?: number | string; // Legacy field - DEPRECATED, use _id
  uuid?: string | null; // Legacy field - DEPRECATED, use _id
  shortId?: string | null; // Short ID for shareable links (e.g., /g/abc123)
  title?: string | null;
  name?: string | null;
  type?: number | null; // Legacy field - prefer group_type
  group_type?: number | null; // The actual group type ID from GroupType model
  group_type_name?: string | null; // The group type name from backend
  date?: string | null;
  next_meeting_date?: string | null;
  next_meeting_date_created_at?: string | null;
  preview?: string | null;
  image_url?: string | null;
  description?: string | null;
  table_description?: string | null;
  location?: string | null;
  members_count?: number | null;
  is_new?: boolean | null;
  status?: number | null;
  rsvp?: RSVPStatus;
  rsvp_mode?: RSVPStatus;
  members?: GroupMember[];
  leaders?: GroupMember[];
  highlights?: GroupHighlight[];
  group_schedule_details?: GroupScheduleDetails;
  group_schedule?: GroupScheduleDetails;
  // Legacy API format (from /api/community/{id})
  day?: number | null;
  start_time?: string | null;
  // New API format (from /api/groups/{id})
  default_day?: number | null;
  default_start_time?: string | null;
  default_end_time?: string | null;
  default_meeting_type?: number | null;
  default_meeting_link?: string | null;
  // Location fields (for map display)
  latitude?: number | null;
  longitude?: number | null;
  city?: string | null;
  state?: string | null;
  full_address?: string | null;
  address_line1?: string | null;
  address_line2?: string | null;
  zip_code?: string | null;
  meeting_type?: number | null; // 1 = IN_PERSON, 2 = ONLINE
  max_capacity?: number | null; // Maximum number of members
  // Join request tracking (from /api/community/{id})
  user_request_status?: string | null; // 'pending', 'accepted', 'declined', or null
  user_role?: string | null; // 'member', 'leader', or 'admin'
  // Membership status from explore search (from groupSearch.searchGroupsWithMembership)
  is_member?: boolean | null;
  has_pending_request?: boolean | null;
  // Announcement group flag
  is_announcement_group?: boolean | null;
}

export interface GroupMember {
  id: string; // Convex user ID
  first_name: string;
  last_name: string;
  email?: string;
  profile_photo?: string;
  // Request tracking fields
  request_status?: string | null;
  requested_at?: string | null;
  request_reviewed_at?: string | null;
  request_reviewed_by_id?: string | null;
}

export interface GroupMembership {
  id: number;
  group: Group;
  rsvpMode: number; // 0: Not Going, 1: Going, 2: Maybe/Not Set
}

/**
 * Data for updating a group.
 * Matches backend GroupUpdateSchema.
 * @see Backend schema: GroupUpdateSchema
 * @see File: apps/backend/src/servers/togather_api/routers/groups.py:159
 *
 * Note: The backend does not currently support updating the preview/cover image
 * through this endpoint. Image upload would require a separate endpoint or
 * backend schema update.
 */
export interface GroupUpdateData {
  name?: string;
  description?: string;
  max_capacity?: number;
  default_day?: number; // 0=Sunday, 1=Monday, ..., 6=Saturday
  default_start_time?: string; // HH:MM format
  default_end_time?: string; // HH:MM format
  default_meeting_type?: number; // 1=IN_PERSON, 2=ONLINE
  default_meeting_link?: string;
  address_line1?: string;
  address_line2?: string;
  city?: string;
  state?: string;
  zip_code?: string;
  latitude?: number;
  longitude?: number;
  is_on_break?: boolean;
  break_until?: string;
  preview?: string; // Set to empty string to remove preview image
  external_chat_link?: string; // External chat platform link (WhatsApp, Slack, etc.)
}

