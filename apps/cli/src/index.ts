#!/usr/bin/env node

import { Command } from "commander";
import { sendOtp, verify, logout } from "./commands/login.js";
import { listChannels } from "./commands/channels.js";
import { readMessages, sendMessage } from "./commands/messages.js";
import { loadSession } from "./session.js";
import { checkForUpdates } from "./update.js";

await checkForUpdates();

const program = new Command();

program
  .name("togather")
  .description("CLI for Togather messaging")
  .version("0.1.0");

program
  .command("send-otp <phone>")
  .description("Send OTP to a phone number")
  .action(sendOtp);

program
  .command("verify <phone> <code>")
  .description("Verify OTP and create session")
  .option("--community <index>", "Community index (1-based) if multiple")
  .action(verify);

program
  .command("logout")
  .description("Clear stored session")
  .action(logout);

program
  .command("whoami")
  .description("Show current session info")
  .action(() => {
    const session = loadSession();
    if (!session) {
      console.log("Not logged in. Run: togather send-otp <phone>");
      return;
    }
    console.log(`User:      ${session.userName || "unknown"}`);
    console.log(`Community: ${session.communityName || "none"}`);
    console.log(`Phone:     ${session.phone || "unknown"}`);
    console.log(
      `Expires:   ${new Date(session.expiresAt).toLocaleDateString()}`
    );
  });

program
  .command("channels")
  .description("List channels you are a member of")
  .action(listChannels);

program
  .command("messages <channelId>")
  .description("Read messages from a channel")
  .option("-n, --limit <count>", "Number of messages (default: 25)")
  .option("--cursor <cursor>", "Pagination cursor for older messages")
  .action(readMessages);

program
  .command("send <channelId> <message>")
  .description("Send a message to a channel (rate limited: 1/min)")
  .action(sendMessage);

program.parse();
