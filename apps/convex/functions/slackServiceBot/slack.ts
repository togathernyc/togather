/**
 * FOUNT Service Planning Bot - Slack API Helpers
 *
 * Thin wrappers around Slack Web API endpoints.
 * All functions use fetch() directly (no SDK dependency).
 *
 * NOTE: These functions make external API calls and should only be called
 * from internalAction handlers (not from queries, mutations, or httpActions).
 */

// ============================================================================
// Types
// ============================================================================

export interface SlackMessage {
  user?: string;
  bot_id?: string;
  text: string;
  ts: string;
  thread_ts?: string;
  subtype?: string;
}

interface SlackPostMessageResponse {
  ok: boolean;
  error?: string;
  ts?: string;
  channel?: string;
}

interface SlackConversationsRepliesResponse {
  ok: boolean;
  error?: string;
  messages?: SlackMessage[];
  has_more?: boolean;
  response_metadata?: { next_cursor?: string };
}

interface SlackReactionResponse {
  ok: boolean;
  error?: string;
}

// ============================================================================
// Core API Functions
// ============================================================================

/**
 * Post a message to a Slack channel or thread.
 * Returns the message timestamp (ts) on success.
 */
export async function postMessage(
  token: string,
  channel: string,
  text: string,
  threadTs?: string
): Promise<string> {
  const body: Record<string, string> = { channel, text };
  if (threadTs) {
    body.thread_ts = threadTs;
  }

  const response = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const data: SlackPostMessageResponse = await response.json();
  if (!data.ok) {
    throw new Error(`Slack postMessage error: ${data.error}`);
  }

  return data.ts!;
}

/**
 * Get all replies in a thread.
 * Handles pagination automatically.
 */
export async function getThreadReplies(
  token: string,
  channel: string,
  threadTs: string
): Promise<SlackMessage[]> {
  const allMessages: SlackMessage[] = [];
  let cursor: string | undefined;

  do {
    const params = new URLSearchParams({
      channel,
      ts: threadTs,
      limit: "200",
    });
    if (cursor) {
      params.set("cursor", cursor);
    }

    const response = await fetch(
      `https://slack.com/api/conversations.replies?${params}`,
      {
        headers: { Authorization: `Bearer ${token}` },
      }
    );

    const data: SlackConversationsRepliesResponse = await response.json();
    if (!data.ok) {
      throw new Error(`Slack conversations.replies error: ${data.error}`);
    }

    if (data.messages) {
      allMessages.push(...data.messages);
    }

    cursor = data.response_metadata?.next_cursor || undefined;
  } while (cursor);

  return allMessages;
}

/**
 * Add a reaction emoji to a message.
 */
export async function addReaction(
  token: string,
  channel: string,
  timestamp: string,
  emoji: string
): Promise<void> {
  const response = await fetch("https://slack.com/api/reactions.add", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      channel,
      timestamp,
      name: emoji,
    }),
  });

  const data: SlackReactionResponse = await response.json();
  // Ignore "already_reacted" errors
  if (!data.ok && data.error !== "already_reacted") {
    throw new Error(`Slack reactions.add error: ${data.error}`);
  }
}

// ============================================================================
// Workspace Members
// ============================================================================

export interface SlackWorkspaceMember {
  id: string;
  name: string;
  realName: string;
  displayName: string;
  image: string;
  isBot: boolean;
}

/**
 * List all human (non-bot, non-deleted) workspace members.
 * Handles pagination automatically.
 */
export async function listWorkspaceMembers(
  token: string,
): Promise<SlackWorkspaceMember[]> {
  const members: SlackWorkspaceMember[] = [];
  let cursor: string | undefined;

  do {
    const params = new URLSearchParams({ limit: "200" });
    if (cursor) params.set("cursor", cursor);

    const response = await fetch(
      `https://slack.com/api/users.list?${params}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );

    const data = await response.json() as {
      ok: boolean;
      error?: string;
      members?: Array<{
        id: string;
        name: string;
        deleted: boolean;
        is_bot: boolean;
        is_app_user: boolean;
        profile: {
          real_name?: string;
          display_name?: string;
          image_48?: string;
        };
      }>;
      response_metadata?: { next_cursor?: string };
    };

    if (!data.ok) throw new Error(`Slack users.list error: ${data.error}`);

    for (const m of data.members ?? []) {
      if (m.deleted || m.is_bot || m.is_app_user || m.id === "USLACKBOT") continue;
      members.push({
        id: m.id,
        name: m.name,
        realName: m.profile.real_name || m.name,
        displayName: m.profile.display_name || m.profile.real_name || m.name,
        image: m.profile.image_48 || "",
        isBot: false,
      });
    }

    cursor = data.response_metadata?.next_cursor || undefined;
  } while (cursor);

  return members.sort((a, b) => a.realName.localeCompare(b.realName));
}

// ============================================================================
// Workspace Channels
// ============================================================================

export interface SlackChannel {
  id: string;
  name: string;
  isMember: boolean;
}

/**
 * List all public channels the bot is a member of (or all visible channels).
 * Handles pagination automatically.
 */
export async function listWorkspaceChannels(
  token: string,
): Promise<SlackChannel[]> {
  const channels: SlackChannel[] = [];
  let cursor: string | undefined;

  do {
    const params = new URLSearchParams({
      types: "public_channel",
      exclude_archived: "true",
      limit: "200",
    });
    if (cursor) params.set("cursor", cursor);

    const response = await fetch(
      `https://slack.com/api/conversations.list?${params}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );

    const data = await response.json() as {
      ok: boolean;
      error?: string;
      channels?: Array<{
        id: string;
        name: string;
        is_member: boolean;
      }>;
      response_metadata?: { next_cursor?: string };
    };

    if (!data.ok) throw new Error(`Slack conversations.list error: ${data.error}`);

    for (const ch of data.channels ?? []) {
      channels.push({
        id: ch.id,
        name: ch.name,
        isMember: ch.is_member,
      });
    }

    cursor = data.response_metadata?.next_cursor || undefined;
  } while (cursor);

  return channels.sort((a, b) => a.name.localeCompare(b.name));
}

// ============================================================================
// Formatting Helpers
// ============================================================================

/**
 * Format a Slack user mention.
 */
export function formatMention(slackUserId: string): string {
  return `<@${slackUserId}>`;
}

// ============================================================================
// Signature Verification (Web Crypto API - works in all Convex runtimes)
// ============================================================================

/**
 * Verify a Slack request signature using HMAC-SHA256.
 * Uses Web Crypto API (SubtleCrypto) for compatibility with Convex's runtime.
 *
 * @see https://api.slack.com/authentication/verifying-requests-from-slack
 */
export async function verifySlackSignature(
  signingSecret: string,
  signature: string,
  timestamp: string,
  body: string
): Promise<boolean> {
  // Reject requests older than 5 minutes to prevent replay attacks
  const fiveMinutesAgo = Math.floor(Date.now() / 1000) - 60 * 5;
  if (parseInt(timestamp) < fiveMinutesAgo) {
    return false;
  }

  const sigBasestring = `v0:${timestamp}:${body}`;

  // Use Web Crypto API for HMAC-SHA256
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(signingSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signatureBuffer = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(sigBasestring)
  );

  // Convert to hex string
  const hashArray = Array.from(new Uint8Array(signatureBuffer));
  const hashHex = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
  const mySignature = `v0=${hashHex}`;

  // Constant-time comparison
  if (mySignature.length !== signature.length) {
    return false;
  }

  let result = 0;
  for (let i = 0; i < mySignature.length; i++) {
    result |= mySignature.charCodeAt(i) ^ signature.charCodeAt(i);
  }
  return result === 0;
}
