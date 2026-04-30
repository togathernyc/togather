/**
 * Community member type definitions.
 *
 * These types represent the shape of community member data used in the app.
 * Note: The actual data now comes from Convex, but we maintain these types
 * for backward compatibility with existing components.
 */

/**
 * Community member in list view.
 * Used by MemberSearch, PeopleContent, and other member-listing components.
 */
export interface CommunityMember {
  user_id: number | string; // Can be Convex Id<"users"> string or legacy number
  email: string;
  first_name: string;
  last_name: string;
  phone: string | null;
  profile_photo: string | null;
  groups_count: number;
  is_admin: boolean;
  last_login: string | null;
  created_at: string | null;
  /**
   * True when the user has no push tokens for the current environment —
   * UI surfaces overlay a slashed-bell badge on the avatar so admins/leaders
   * know not to expect immediate delivery for any notification-emitting
   * action they take. See `lib/notifications/enabledStatus.ts`.
   */
  notifications_disabled?: boolean;
}

/**
 * Member's group membership info.
 */
export interface MemberGroupInfo {
  group_id: string;
  group_name: string;
  group_type_name: string;
  group_type_slug: string;
  role: string;
  is_active: boolean;
  joined_at: string | null;
  left_at: string | null;
}

/**
 * Member's attendance record.
 */
export interface MemberAttendanceRecord {
  meeting_id: number;
  group_id: string;
  group_name: string;
  meeting_date: string;
  attended: boolean;
  rsvp_status: string | null;
}

/**
 * Detailed community member information.
 */
export interface CommunityMemberDetail {
  user_id: number;
  email: string;
  first_name: string;
  last_name: string;
  phone: string | null;
  profile_photo: string | null;
  last_login: string | null;
  created_at: string | null;
  // Group memberships
  groups: MemberGroupInfo[];
  groups_count: number;
  // Attendance info
  recent_attendance: MemberAttendanceRecord[];
  total_meetings_attended: number;
  attendance_rate: number | null; // Percentage
}

/**
 * Paginated response for community members.
 */
export interface PaginatedCommunityMembers {
  items: CommunityMember[];
  total: number;
  page: number;
  page_size: number;
  has_more: boolean;
}
