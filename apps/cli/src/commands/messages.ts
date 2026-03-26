import { api } from "../api.js";
import { getClient } from "../client.js";
import { requireSession } from "../session.js";
import { checkRateLimit } from "../rate-limit.js";

export async function readMessages(
  channelId: string,
  options: { limit?: string; cursor?: string }
) {
  checkRateLimit("read", 10, 60_000);

  const session = requireSession();
  const client = getClient();

  const limit = options.limit ? parseInt(options.limit, 10) : 25;

  const result = await client.query(api.functions.messaging.messages.getMessages, {
    token: session.accessToken,
    channelId,
    limit,
    cursor: options.cursor || undefined,
  });

  if (!result.messages || result.messages.length === 0) {
    console.log("No messages.");
    return;
  }

  for (const msg of result.messages) {
    const time = new Date(msg.createdAt).toLocaleString();
    const sender = msg.senderName || "System";
    const edited = msg.editedAt ? " (edited)" : "";
    console.log(`[${time}] ${sender}${edited}: ${msg.content}`);
    if (msg.attachments?.length) {
      for (const att of msg.attachments) {
        console.log(`  📎 ${att.type}: ${att.name || att.url}`);
      }
    }
  }

  if (result.hasMore && result.cursor) {
    console.log(`\n--- More messages available ---`);
    console.log(
      `Run: togather messages ${channelId} --cursor ${result.cursor}`
    );
  }
}

export async function sendMessage(
  channelId: string,
  message: string
) {
  checkRateLimit("send", 1, 60_000);

  const session = requireSession();
  const client = getClient();

  const messageId = await client.mutation(api.functions.messaging.messages.sendMessage, {
    token: session.accessToken,
    channelId,
    content: message,
  });

  console.log(`Message sent (${messageId})`);
}
