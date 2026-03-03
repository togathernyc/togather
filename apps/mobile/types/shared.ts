/**
 * Shared types used across multiple features
 * If a type is used by 2+ features, it belongs here
 */

/**
 * ChatRoom - Represents a chat room/conversation
 * Used by: chat, home, groups features
 */
export interface ChatRoom {
  id: number;
  name?: string;
  title?: string;
  room_name?: string;
  type: number;
  last_message_at?: string;
  last_message_text?: string;
  last_sender?: {
    id?: number;
    first_name?: string;
    last_name?: string;
  };
  users?: Array<{
    id: number;
    first_name?: string;
    last_name?: string;
    profile_photo?: string;
  }>;
  is_read?: boolean;
  unread_count?: number;
  dinner?: {
    id: number;
    type?: number; // Group type: 1 = Dinner Party, 2 = Team, 4 = Table
    title?: string;
    name?: string;
    [key: string]: any;
  };
  dinner_details?: {
    id: number;
    type?: number; // Group type: 1 = Dinner Party, 2 = Team, 4 = Table
    title?: string;
    name?: string;
    [key: string]: any;
  };
}

/**
 * User - Represents a user in the system
 * Used by: auth, profile, and throughout the app
 *
 * NOTE: `id` is the Convex document ID (string).
 * `legacyId` is the old numeric ID from PostgreSQL, kept for reference.
 */
export interface User {
  id: string; // Convex _id
  legacyId?: number; // Old numeric ID from PostgreSQL
  email: string;
  first_name?: string;
  last_name?: string;
  phone?: string;
  profile_photo?: string;
  is_admin?: boolean;
  is_primary_admin?: boolean;
  phone_verified?: boolean;
  associated_emails?: string[];
  timezone?: string;
  [key: string]: any; // Allow additional user properties
}

/**
 * Community - Represents a community/organization
 * Used by: auth, home, and throughout the app
 *
 * NOTE: `id` is the Convex document ID (string).
 * `legacyId` is the old numeric ID from PostgreSQL, kept for reference.
 */
export interface Community {
  id: string; // Convex _id
  legacyId?: number; // Old numeric ID from PostgreSQL
  name?: string;
  subdomain?: string;
  logo?: string; // Community logo URL (S3 URL or relative path)
  [key: string]: any; // Allow additional community properties
}
