// Leader Tools feature types
// Types specific to the leader-tools feature

export interface MeetingSummary {
  id?: number;
  meeting_id?: string; // UUID of the meeting (preferred for attendance lookup)
  short_id?: string | null; // Short ID for event sharing links
  date: string; // Date of the meeting (ISO format)
  name?: string; // Meeting name/title
  group_type_name?: string; // Group type name for fallback
  attendee_count?: number;
  cover_image_url?: string | null;
  dinner?: number;
  // Stats from the meeting dates API
  attendance_count?: number;
  rsvp_count?: number;
  // Legacy stats object (from older API endpoints)
  stats?: {
    id: number;
    totalUserCount: number;
    completionCount: number;
    presentCount?: number;
  };
  logDetails?: Array<{
    id: number;
    updatedBy: {
      first_name: string;
      last_name: string;
    };
    attendance: number;
    createdAt: string;
  }>;
}

export interface AttendanceStats {
  id: number;
  date: string;
  presentCount: number;
  totalCount: number;
}

// Page types
export enum LeaderToolsPage {
  DEFAULT = "default",
  MEMBERS = "members",
  CUSTOMIZE = "customize",
  EVENTS = "events",
  EVENT_STATS = "event_stats",
  ATTENDANCE_DETAILS = "attendance_details",
  NOTIFICATIONS = "notifications",
  NOTIFICATION_DETAIL = "notification_detail",
}

// Bottom bar types
export enum BottomBarType {
  HOME = "home",
  ATTENDANCE = "attendance",
  CUSTOMIZE = "customize",
}

// Event schedule types matching iOS app
export enum EventScheduleType {
  REMOVE_EVENT = 1,
  RESCHEDULE_EVENT = 2,
  ADD_EVENT = 3,
}
