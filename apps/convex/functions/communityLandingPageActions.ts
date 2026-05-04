/**
 * Community Landing Page — Actions
 *
 * The submitForm action orchestrates user creation, community join,
 * and follow-up data setup. Queries and mutations live in communityLandingPage.ts.
 */

import { v } from "convex/values";
import { action, internalAction, type ActionCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import { Id } from "../_generated/dataModel";

/**
 * Submit the landing page form.
 *
 * 1. Find or create user by phone
 * 2. Join community + announcement group
 * 3. Set custom field values on announcement group follow-up record
 * 4. Generate notes summary (if enabled)
 * 5. Run automation rules
 */
export const submitForm = action({
  args: {
    slug: v.string(),
    firstName: v.string(),
    lastName: v.string(),
    phone: v.string(),
    email: v.optional(v.string()),
    zipCode: v.optional(v.string()),
    dateOfBirth: v.optional(v.string()),
    customFields: v.optional(
      v.array(
        v.object({
          slot: v.optional(v.string()),
          label: v.string(),
          value: v.any(),
          includeInNotes: v.optional(v.boolean()),
        })
      )
    ),
  },
  returns: v.object({
    success: v.boolean(),
    user: v.object({
      id: v.string(),
      firstName: v.string(),
      lastName: v.string(),
    }),
  }),
  handler: async (ctx, args) => {
    // Server-side input validation
    const trimmedFirstName = args.firstName.trim();
    const trimmedLastName = args.lastName.trim();
    const trimmedPhone = args.phone.trim();

    if (!trimmedFirstName) {
      throw new Error("First name is required");
    }
    if (!trimmedLastName) {
      throw new Error("Last name is required");
    }

    // Validate phone has at least some digits
    const phoneDigits = trimmedPhone.replace(/\D/g, "");
    if (phoneDigits.length < 10) {
      throw new Error("Please enter a valid phone number");
    }

    // Rate limit by phone number (5 attempts per hour)
    await ctx.runMutation(
      internal.functions.communityLandingPage.checkFormRateLimit,
      { phone: trimmedPhone }
    );

    // 1. Look up community + landing page config
    const result = await ctx.runQuery(
      internal.functions.communityLandingPage.getConfigBySlugInternal,
      { slug: args.slug }
    );

    if (!result) {
      throw new Error("Landing page not found or not enabled");
    }

    const { community, landingPage } = result;

    // Enforce required fields from landing page config
    if (landingPage.requireZipCode && !args.zipCode?.trim()) {
      throw new Error("ZIP code is required");
    }
    if (landingPage.requireBirthday && !args.dateOfBirth?.trim()) {
      throw new Error("Birthday is required");
    }

    // Server-side format validation for optional fields (when provided)
    if (args.zipCode?.trim()) {
      const zip = args.zipCode.trim();
      if (!/^\d{5}(-\d{4})?$/.test(zip)) {
        throw new Error("Please enter a valid ZIP code");
      }
    }

    // 2. Find or create user by phone
    const userId: string = await ctx.runMutation(
      internal.functions.communityLandingPage.findOrCreateUser,
      {
        phone: trimmedPhone,
        firstName: trimmedFirstName,
        lastName: trimmedLastName,
        email: args.email,
        zipCode: args.zipCode,
        dateOfBirth: args.dateOfBirth,
      }
    );

    // 3. Join community + announcement group
    await ctx.runMutation(
      internal.functions.communityLandingPage.joinCommunityInternal,
      {
        communityId: community._id as Id<"communities">,
        userId: userId as Id<"users">,
      }
    );

    // 4. Set custom field values + notes + automation
    // Always call even without custom fields — ensures followup record, notes, and automation rules run
    const { smsSnippets, followupNoteId } = await ctx.runMutation(
      internal.functions.communityLandingPage.setCustomFieldsAndNotes,
      {
        communityId: community._id as Id<"communities">,
        userId: userId as Id<"users">,
        customFields: args.customFields ?? [],
        zipCode: args.zipCode,
        dateOfBirth: args.dateOfBirth,
        generateNoteSummary: landingPage.generateNoteSummary ?? true,
        automationRules: landingPage.automationRules,
      }
    );

    // 5. Auto-reply SMS — best-effort, never fails the submission.
    // Wrap so any internal-mutation/scheduler error here cannot reject the
    // action after the user, membership, and follow-up records are written.
    try {
      await maybeSendAutoReplySms(ctx, {
        autoReplySms: landingPage.autoReplySms ?? null,
        phone: trimmedPhone,
        firstName: trimmedFirstName,
        smsSnippets,
        followupNoteId,
      });
    } catch (err) {
      console.error(
        `[landing-page] Auto-reply SMS dispatch failed for ${trimmedPhone}:`,
        err,
      );
    }

    return {
      success: true,
      user: {
        id: userId,
        firstName: trimmedFirstName,
        lastName: trimmedLastName,
      },
    };
  },
});

// ============================================================================
// Auto-reply SMS helpers
// ============================================================================

// Twilio's hard cap. sendSMS truncates as a backstop, but we want our own
// bound so what staff see in admin matches what gets sent.
const SMS_BODY_MAX = 1600;

/**
 * Truncate at most `max` UTF-16 code units without splitting a surrogate
 * pair. Naive `String.prototype.slice` can leave a lone high surrogate at
 * the boundary, producing an invalid string that downstream JSON
 * serialization or the Twilio HTTP layer may reject.
 */
function truncateSmsBody(body: string, max: number): string {
  if (body.length <= max) return body;
  const sliced = body.slice(0, max);
  const lastCode = sliced.charCodeAt(sliced.length - 1);
  // High surrogate (0xD800–0xDBFF): drop it so we don't leave half a pair
  if (lastCode >= 0xd800 && lastCode <= 0xdbff) {
    return sliced.slice(0, -1);
  }
  return sliced;
}

/**
 * Substitute {firstName} placeholders. Falls back to "there" so an unset
 * first name doesn't leave a literal "{firstName}" in the message body.
 */
function renderTemplate(template: string, firstName: string): string {
  const safeName = firstName.trim() || "there";
  return template.replace(/\{firstName\}/g, safeName);
}

/**
 * Compose an auto-reply SMS body from the saved intro/outro and the
 * snippets collected from matching automation rules.
 */
function composeAutoReplyBody(args: {
  intro: string;
  outro: string;
  snippets: string[];
  firstName: string;
}): string {
  const parts: string[] = [];
  const intro = renderTemplate(args.intro, args.firstName).trim();
  const outro = renderTemplate(args.outro, args.firstName).trim();
  if (intro) parts.push(intro);
  if (args.snippets.length > 0) {
    parts.push(args.snippets.map((s) => renderTemplate(s, args.firstName)).join("\n"));
  }
  if (outro) parts.push(outro);
  const body = parts.join("\n\n");
  return truncateSmsBody(body, SMS_BODY_MAX);
}

async function maybeSendAutoReplySms(
  ctx: ActionCtx,
  params: {
    autoReplySms:
      | {
          enabled: boolean;
          intro: string;
          outro: string;
          sendIfNoSnippetsMatch: boolean;
        }
      | null
      | undefined;
    phone: string;
    firstName: string;
    smsSnippets: string[];
    followupNoteId: Id<"memberFollowups"> | null;
  },
): Promise<void> {
  const cfg = params.autoReplySms;
  if (!cfg || !cfg.enabled) return;

  const hasSnippets = params.smsSnippets.length > 0;
  if (!hasSnippets && !cfg.sendIfNoSnippetsMatch) return;

  const body = composeAutoReplyBody({
    intro: cfg.intro,
    outro: cfg.outro,
    snippets: params.smsSnippets,
    firstName: params.firstName,
  });
  if (!body) return;

  // Atomic check-cap-and-schedule — Twilio is invoked from the scheduled
  // sendAutoReplySmsAndAudit action, so Twilio outages can't fail this form
  // submission AND the actual sent/failed outcome lands in the audit note.
  const outcome = await ctx.runMutation(
    internal.functions.communityLandingPage.dispatchAutoReplySmsIfAllowed,
    {
      phone: params.phone,
      message: body,
      followupNoteId: params.followupNoteId,
    },
  );

  if (outcome === "suppressed_cap") {
    console.warn(
      `[landing-page] Auto-reply SMS suppressed for ${params.phone}: daily cap reached`,
    );
    if (params.followupNoteId) {
      await ctx.runMutation(
        internal.functions.communityLandingPage.recordSmsAuditOnNote,
        {
          noteId: params.followupNoteId,
          outcome: "suppressed_cap",
        },
      );
    }
  }
  // outcome === "scheduled": the dispatched action will write the audit
  // (either "sent" or "send_failed") once Twilio resolves.
}

/**
 * Dispatch a queued landing-page auto-reply SMS, then record the outcome
 * (sent vs. failed) on the submission note. Scheduled by
 * dispatchAutoReplySmsIfAllowed so Twilio errors land in the staff-visible
 * note instead of bubbling into the form submission.
 */
export const sendAutoReplySmsAndAudit = internalAction({
  args: {
    phone: v.string(),
    message: v.string(),
    followupNoteId: v.union(v.id("memberFollowups"), v.null()),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    let outcome: "sent" | "send_failed" = "sent";
    let errorMessage: string | undefined;
    try {
      const result = await ctx.runAction(
        internal.functions.auth.phoneOtp.sendSMS,
        { phone: args.phone, message: args.message },
      );
      // sendSMS returns { success: false } when Twilio env vars are missing
      if (!result.success) {
        outcome = "send_failed";
        errorMessage = "Twilio credentials not configured";
      }
    } catch (err: unknown) {
      outcome = "send_failed";
      errorMessage =
        err instanceof Error ? err.message : String(err ?? "unknown error");
      console.error(
        `[landing-page] Auto-reply SMS dispatch failed for ${args.phone}:`,
        err,
      );
    }

    if (args.followupNoteId) {
      await ctx.runMutation(
        internal.functions.communityLandingPage.recordSmsAuditOnNote,
        {
          noteId: args.followupNoteId,
          outcome,
          body: args.message,
          error: errorMessage,
        },
      );
    }
    return null;
  },
});
