import { api } from "../api.js";
import { getClient } from "../client.js";
import { requireSession } from "../session.js";

export async function listChannels() {
  const session = requireSession();
  const client = getClient();

  const channels = await client.mutation(api.functions.cli.messaging.getUserChannels, {
    token: session.accessToken,
  });

  if (!channels || channels.length === 0) {
    console.log("No channels found.");
    return;
  }

  console.log(`\nChannels (${channels.length}):\n`);
  for (const ch of channels) {
    const lastMsg = ch.lastMessagePreview
      ? ` — "${ch.lastMessagePreview.slice(0, 50)}"`
      : "";
    console.log(`  ${ch._id}  ${ch.name} [${ch.channelType}]${lastMsg}`);
  }
  console.log(
    "\nUse the channel ID with: togather messages <channel-id>"
  );
}
