/**
 * Notification types for Convex
 *
 * Ported from packages/notifications/src/registry/types.ts
 * with Convex-specific adaptations (e.g., Id types, HTML instead of React elements)
 */

import { Id } from "../../_generated/dataModel";

// Channel types
export type NotificationChannel = "push" | "email" | "sms" | "chat";

// Send modes
export type SendMode = "cascade" | "multi";

// Push notification output
export interface PushOutput {
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

// Email notification output (HTML string instead of React element for Convex compatibility)
export interface EmailOutput {
  subject: string;
  htmlBody: string;
}

// SMS notification output
export interface SmsOutput {
  body: string;
}

// Chat notification output
export interface ChatOutput {
  message: string;
  // Optional: target channel (if different from data.channelId)
  channelId?: string;
  // Optional: sender ID
  senderId?: string;
}

// Chat context for building channel IDs
export interface ChatChannelContext {
  // Option 1: Direct channel ID
  channelId?: string;
  // Option 2: Build from parts
  groupId?: string;
  communityId?: string | number;
  chatType?: "main" | "leaders";
  // Sender
  senderId?: string;
}

// User info loaded from database
export interface UserInfo {
  name?: string;
  email?: string;
  phone?: string;
  pushEnabled?: boolean;
  emailEnabled?: boolean;
}

// Formatter context passed to formatters
export interface FormatterContext<TData = Record<string, unknown>> {
  data: TData;
  userId: string;
  // User info (loaded from DB)
  user?: UserInfo;
}

// Channel formatters
export interface ChannelFormatters<TData = Record<string, unknown>> {
  push?: (ctx: FormatterContext<TData>) => PushOutput;
  email?: (ctx: FormatterContext<TData>) => EmailOutput;
  sms?: (ctx: FormatterContext<TData>) => SmsOutput;
  chat?: (ctx: FormatterContext<TData>) => ChatOutput;
}

// Notification definition
export interface NotificationDefinition<TData = Record<string, unknown>> {
  type: string;
  description: string;
  formatters: ChannelFormatters<TData>;
  // Default channels if not specified in send options
  defaultChannels: NotificationChannel[];
  // Default mode (cascade or multi)
  defaultMode?: SendMode;
}

// Send options for single user (Convex version uses Id types)
export interface SendOptions<TData = Record<string, unknown>> {
  type: string;
  userId: Id<"users">;
  data: TData;
  mode?: SendMode;
  channels?: NotificationChannel[];
  // Optional: community and group for notification record
  communityId?: Id<"communities">;
  groupId?: Id<"groups">;
}

// Batch send options
export interface BatchSendOptions<TData = Record<string, unknown>> {
  type: string;
  userIds: Id<"users">[];
  data: TData;
  mode?: SendMode;
  channels?: NotificationChannel[];
  communityId?: Id<"communities">;
  groupId?: Id<"groups">;
}

// Community admin send options
export interface CommunityAdminSendOptions<TData = Record<string, unknown>> {
  communityId: Id<"communities">;
  type: string;
  data: TData;
  mode?: SendMode;
  channels?: NotificationChannel[];
}

// Group notification options (for bots)
export interface GroupNotifyOptions<TData = Record<string, unknown>> {
  groupId: Id<"groups">;
  type: string;
  data: TData;
  mode?: SendMode;
  channels?: NotificationChannel[];
  // Which members to notify (default: all)
  filter?: "all" | "leaders";
}

// Send result
export interface SendResult {
  success: boolean;
  channelsAttempted: NotificationChannel[];
  channelsSucceeded: NotificationChannel[];
  errors: Array<{
    channel: NotificationChannel;
    error: string;
  }>;
}

// Channel send result (internal)
export interface ChannelSendResult {
  success: boolean;
  error?: string;
}

// Registry type
export type NotificationRegistry = Map<string, NotificationDefinition<unknown>>;

// Helper type for extracting data type from definition
export type ExtractNotificationData<T> =
  T extends NotificationDefinition<infer D> ? D : never;
