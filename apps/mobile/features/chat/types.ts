// Chat-specific types
import type { ChatRoom } from "@/types/shared";

// Re-export ChatRoom for convenience
export type { ChatRoom };

export interface Prayer {
  id: number;
  title?: string;
  description?: string;
  type?: string; // 'prayer_request' | 'praise_report'
  added_by?: {
    id: number;
    first_name?: string;
    last_name?: string;
    profile_photo?: string;
  };
}

export interface HostedVideo {
  id: number;
  video_url?: string;
}

export interface RsvpOption {
  id: number;
  label: string;
  enabled: boolean;
}

export interface EventData {
  meeting_id: string;
  group_id: string;
  short_id: string; // All events have a short_id for sharing/fetching
  title?: string | null;
  scheduled_at?: string;
  cover_image?: string | null;
  location_override?: string | null;
  meeting_link?: string | null;
  meeting_type?: number; // 1 = in-person, 2 = online
  rsvp_options?: RsvpOption[];
}

export interface Message {
  id: number;
  key?: string;
  text?: string;
  chat_room?: number;
  chatRoomId?: number;
  sender?: {
    id: number;
    first_name?: string;
    last_name?: string;
    profile_photo?: string;
    avatar?: string;
  };
  sender_id?: number;
  senderId?: number;
  sender_name?: string;
  sender_avatar?: string;
  created_at?: string;
  created_at_time?: string;
  images?: MessageAttachment[];
  link?: string;
  message_type?: number; // 1 = REGULAR, 2 = CHATROOM_LEFT, 3 = CHATROOM_JOIN, 4 = PRAYER, 5 = PRAYER_RESHARED, 6 = EVENT
  prayer?: Prayer; // Prayer object for message_type === 4
  hosted_video?: HostedVideo; // Hosted video object for video messages
  event?: EventData; // Event object for message_type === 6
}

export interface MessageAttachment {
  file_path: string;
  image_url: string;
  full_quality_url?: string;
  url?: string;
}

export interface ChatRoomResponse {
  data: ChatRoom[];
  page_info?: {
    cursor?: string;
    has_next?: boolean;
  };
  errors?: string[];
}

export interface MessagesResponse {
  data: Message[];
  page_info?: {
    cursor?: string;
    has_next?: boolean;
  };
  errors?: string[];
}

// Message type constants
export const MESSAGE_TYPE = {
  REGULAR: 1,
  CHATROOM_LEFT: 2,
  CHATROOM_JOIN: 3,
  PRAYER: 4,
  PRAYER_RESHARED: 5,
  EVENT: 6,
} as const;

