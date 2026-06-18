"use node";

/**
 * HEIC→JPEG conversion (runs in the Node runtime so it can decode HEIF).
 *
 * Why: iPhone photos upload as HEIC. Cloudflare's image transform mishandles
 * the HEIF orientation boxes (irot/imir) and serves chat thumbnails flipped,
 * while the original renders fine. Re-encoding to an upright JPEG server-side
 * fixes it for every client (iOS/Android/web) without a mobile native dep.
 *
 * - `convertMessageHeicAttachments` is scheduled by `sendMessage` right after a
 *   message with a HEIC image is inserted (async — adds no latency to the send).
 * - `backfillHeicChatAttachments` converts images already stored in R2.
 */

import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import convert from "heic-convert";
import { getR2Object, putR2Object, r2KeyFromPath } from "../lib/r2";
import {
  isConvertibleHeicAttachment,
  jpegFileName,
  type ConvertibleAttachment,
} from "../lib/heicConversion";

type Attachment = ConvertibleAttachment & Record<string, unknown>;

/** Normalize heic-convert output (Buffer/Uint8Array/ArrayBuffer) to ArrayBuffer. */
function toArrayBuffer(out: ArrayBuffer | Uint8Array): ArrayBuffer {
  if (out instanceof ArrayBuffer) return out;
  return out.buffer.slice(
    out.byteOffset,
    out.byteOffset + out.byteLength
  ) as ArrayBuffer;
}

/**
 * Convert a single attachment's HEIC bytes to an upright JPEG stored in R2.
 * Returns the rewritten attachment, or the original unchanged if it isn't a
 * convertible HEIC or conversion fails (we never drop the message's image).
 */
async function convertAttachment(att: Attachment): Promise<Attachment> {
  if (!isConvertibleHeicAttachment(att)) return att;

  const key = r2KeyFromPath(att.url);
  if (!key) return att; // external/legacy URL we can't read from R2

  try {
    const { body } = await getR2Object(key);
    const out = await convert({
      buffer: Buffer.from(body),
      format: "JPEG",
      quality: 0.9,
    });
    const fileName = jpegFileName(att, key);
    const { storagePath } = await putR2Object({
      folder: "chat",
      fileName,
      contentType: "image/jpeg",
      body: toArrayBuffer(out),
    });
    return { ...att, url: storagePath, mimeType: "image/jpeg", name: fileName };
  } catch (err) {
    console.error(`[imageConversion] failed to convert ${key}:`, err);
    return att;
  }
}

/** Convert every HEIC attachment in the list; returns the new list + count. */
async function convertAll(
  attachments: Attachment[]
): Promise<{ attachments: Attachment[]; converted: number }> {
  let converted = 0;
  const updated: Attachment[] = [];
  for (const att of attachments) {
    const next = await convertAttachment(att);
    if (next !== att) converted += 1;
    updated.push(next);
  }
  return { attachments: updated, converted };
}

/**
 * Convert the HEIC image attachments of a single just-sent message, then patch
 * the message with the upright JPEG URLs. Scheduled from `sendMessage`.
 */
export const convertMessageHeicAttachments = internalAction({
  args: { messageId: v.id("chatMessages") },
  handler: async (ctx, { messageId }) => {
    const attachments = await ctx.runQuery(
      internal.functions.imageConversionData.getMessageAttachments,
      { messageId }
    );
    if (!attachments || attachments.length === 0) return;

    const { attachments: updated, converted } = await convertAll(
      attachments as Attachment[]
    );
    if (converted > 0) {
      await ctx.runMutation(
        internal.functions.imageConversionData.patchMessageAttachments,
        { messageId, attachments: updated as Attachment[] }
      );
    }
  },
});

/**
 * One-time backfill: walk chatMessages and convert HEIC image attachments
 * already stored in R2. Idempotent (already-converted JPEGs are skipped) and
 * self-paginating via the scheduler. Run with:
 *   npx convex run functions/imageConversion:backfillHeicChatAttachments '{"dryRun":true}'
 */
export const backfillHeicChatAttachments = internalAction({
  args: {
    cursor: v.optional(v.union(v.string(), v.null())),
    dryRun: v.optional(v.boolean()),
    batchSize: v.optional(v.number()),
    processed: v.optional(v.number()),
    convertedTotal: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const batchSize = args.batchSize ?? 5;
    const dryRun = args.dryRun ?? false;

    const { messages, continueCursor, isDone } = await ctx.runQuery(
      internal.functions.imageConversionData.pageMessagesWithHeic,
      { cursor: args.cursor ?? null, numItems: batchSize }
    );

    let convertedTotal = args.convertedTotal ?? 0;
    let processed = args.processed ?? 0;

    for (const message of messages) {
      processed += 1;
      const { attachments: updated, converted } = await convertAll(
        message.attachments as Attachment[]
      );
      if (converted > 0) {
        convertedTotal += converted;
        if (!dryRun) {
          await ctx.runMutation(
            internal.functions.imageConversionData.patchMessageAttachments,
            { messageId: message._id, attachments: updated as Attachment[] }
          );
        }
      }
    }

    console.log(
      `[imageConversion] backfill batch: ${messages.length} msgs scanned, ` +
        `${convertedTotal} attachments converted so far (dryRun=${dryRun})`
    );

    if (!isDone) {
      await ctx.scheduler.runAfter(
        0,
        internal.functions.imageConversion.backfillHeicChatAttachments,
        { cursor: continueCursor, dryRun, batchSize, processed, convertedTotal }
      );
    } else {
      console.log(
        `[imageConversion] backfill complete: ${processed} HEIC messages ` +
          `processed, ${convertedTotal} attachments converted (dryRun=${dryRun})`
      );
    }
  },
});
