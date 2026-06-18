/**
 * Database access for the HEIC→JPEG conversion pipeline.
 *
 * The conversion itself runs in a Node action (`functions/imageConversion.ts`,
 * `"use node"`), which can't touch the database directly. These internal
 * query/mutation functions run in the normal Convex runtime and are called by
 * that action via `ctx.runQuery` / `ctx.runMutation`.
 */

import { v } from "convex/values";
import { internalQuery, internalMutation } from "../_generated/server";
import { isConvertibleHeicAttachment } from "../lib/heicConversion";

/** Validator mirroring `chatMessages.attachments[]` (see schema.ts). */
const attachmentValidator = v.object({
  type: v.string(),
  url: v.string(),
  name: v.optional(v.string()),
  size: v.optional(v.number()),
  mimeType: v.optional(v.string()),
  thumbnailUrl: v.optional(v.string()),
  waveform: v.optional(v.array(v.number())),
  duration: v.optional(v.number()),
});

/** Read a single message's attachments (null if message gone / no attachments). */
export const getMessageAttachments = internalQuery({
  args: { messageId: v.id("chatMessages") },
  handler: async (ctx, { messageId }) => {
    const message = await ctx.db.get(messageId);
    return message?.attachments ?? null;
  },
});

/** Overwrite a message's attachments with the converted set. */
export const patchMessageAttachments = internalMutation({
  args: {
    messageId: v.id("chatMessages"),
    attachments: v.array(attachmentValidator),
  },
  handler: async (ctx, { messageId, attachments }) => {
    const message = await ctx.db.get(messageId);
    if (!message) return;
    await ctx.db.patch(messageId, { attachments });
  },
});

/**
 * Paginate chatMessages, returning only those that still have a HEIC image
 * attachment. Used by the backfill action. Convex can't index nested array
 * fields, so we page over the table and filter in memory.
 */
export const pageMessagesWithHeic = internalQuery({
  args: { cursor: v.union(v.string(), v.null()), numItems: v.number() },
  handler: async (ctx, { cursor, numItems }) => {
    const result = await ctx.db
      .query("chatMessages")
      .order("desc")
      .paginate({ cursor, numItems });

    const matches = result.page
      .filter(
        (m) =>
          !m.isDeleted &&
          (m.attachments ?? []).some(isConvertibleHeicAttachment)
      )
      .map((m) => ({ _id: m._id, attachments: m.attachments ?? [] }));

    return {
      messages: matches,
      continueCursor: result.continueCursor,
      isDone: result.isDone,
    };
  },
});
