/**
 * Dev-Assistant notifier seam — Togather's push + chat side effects.
 *
 * `@supa-media/dev-assistant` no longer branches on `channelId` inline; instead
 * it emits typed `DevAssistantEvent`s at each notification point and delegates
 * to this notifier. This file reproduces Togather's EXACT pre-package behavior
 * (see the old `actions.ts` `handleRoutineCallback` / `contributions.ts`
 * `notifyOriginatorUnlessSelf` / `bugs.ts` `handleWorkflowRunEvent` &
 * `applyCallback`):
 *
 *  - **Dashboard items** (`!bug.channelId`) get a push to the originator on the
 *    transitions they care about (spec ready, spec revised, PR opened, staging
 *    live, fix-rounds exhausted). This is the actual gate — `!channelId`, NOT
 *    `source !== "chat"`.
 *  - **Chat-originated items** (`bug.channelId` present) get a bot message posted
 *    into the originating thread, keyed by the per-round `sourceKey` for
 *    idempotency, with an `@mention` of the originator on `READY_TO_MERGE`. No
 *    push (the channel message already notifies).
 *  - **Contributor dashboard actions** (build started, staging verified, staging
 *    redo) push the originator UNLESS they took the action themselves
 *    (`actorUserId === originatorUserId`), with NO `channelId` gate — matching
 *    the old `notifyOriginatorUnlessSelf`.
 *
 * Pushes are scheduled via `ctx.scheduler.runAfter(0, …)` so they work from both
 * the mutation contexts (applyCallback / handleWorkflowRunEvent / contributions)
 * and the action context (handleRoutineCallback) the package calls this from.
 */

import { internal } from "../../_generated/api";
import type { Id } from "../../_generated/dataModel";
import type {
  DevAssistantNotifier,
  DevAssistantEvent,
  NotifierCtx,
  DevBugDoc,
} from "@supa-media/dev-assistant";

/** Fix-round budget quoted in the escalation push (matches cfg.maxFixRounds). */
const MAX_FIX_ROUNDS = 3;

/** Schedule the originator push (works from mutation + action ctx alike). */
function schedulePush(
  ctx: NotifierCtx,
  userId: Id<"users">,
  push: { title: string; body: string },
  data: Record<string, unknown>,
): Promise<unknown> {
  return ctx.scheduler.runAfter(
    0,
    internal.functions.notifications.actions.sendPushNotification,
    {
      userId,
      title: push.title,
      body: push.body,
      notificationType: "dev_contribution_update",
      data,
    },
  );
}

/**
 * "try it on staging" copy fired when the staging deploy actually goes live.
 * Interactive items get a "confirm it works" ask; non-interactive items get an
 * honest "it's live" note. (Old `bugs.ts` `stagingLivePush`.)
 */
function stagingLivePush(bug: DevBugDoc): { title: string; body: string } {
  if (bug.verifyOnStaging) {
    return {
      title: "Ready to test on staging",
      body: `"${bug.title}" is live on staging — try it and confirm it works.`,
    };
  }
  return {
    title: "Your contribution is live on staging",
    body: `"${bug.title}" is now live on the staging app.`,
  };
}

/** "First Last" for a push body, with a contributor-appropriate fallback. */
async function displayName(
  ctx: NotifierCtx,
  userId: Id<"users">,
): Promise<string> {
  const db = (ctx as { db?: { get: (id: Id<"users">) => Promise<any> } }).db;
  const user = db ? await db.get(userId) : null;
  return (
    `${user?.firstName ?? ""} ${user?.lastName ?? ""}`.trim() || "A contributor"
  );
}

export const togatherNotifier: DevAssistantNotifier = {
  async notify(ctx: NotifierCtx, event: DevAssistantEvent): Promise<void> {
    const bug = event.bug;
    const originatorUserId = bug.originatorUserId as Id<"users">;
    const channelId = bug.channelId as Id<"chatChannels"> | undefined;
    const baseData = (extra?: Record<string, unknown>): Record<string, unknown> => ({
      bugId: bug._id,
      status: bug.status,
      ...(extra ?? {}),
    });

    switch (event.type) {
      // ---- Dashboard pushes (gate on !channelId) ----
      case "specReady": {
        if (channelId) return;
        const noun = bug.kind === "feature" ? "feature idea" : "bug report";
        await schedulePush(
          ctx,
          originatorUserId,
          {
            title: "Spec ready for review",
            body: `The plan for your ${noun} "${bug.title}" is ready — review and approve it.`,
          },
          baseData(bug.prUrl ? { prUrl: bug.prUrl } : undefined),
        );
        return;
      }
      case "specRevised": {
        if (channelId) return;
        await schedulePush(
          ctx,
          originatorUserId,
          {
            title: "Updated plan ready",
            body: `The updated plan for "${bug.aiTitle ?? bug.title}" is ready — review and approve it.`,
          },
          baseData(),
        );
        return;
      }
      case "prOpened": {
        if (channelId) return;
        await schedulePush(
          ctx,
          originatorUserId,
          {
            title: "Your contribution is in code review",
            body: `A pull request is open for "${bug.title}".`,
          },
          baseData(bug.prUrl ? { prUrl: bug.prUrl } : undefined),
        );
        return;
      }
      case "stagingLive": {
        if (channelId) return;
        await schedulePush(
          ctx,
          originatorUserId,
          stagingLivePush(bug),
          baseData(),
        );
        return;
      }
      case "fixRoundsExhausted": {
        if (channelId) return;
        await schedulePush(
          ctx,
          originatorUserId,
          {
            title: "Code review needs a human",
            body: `"${bug.title}" is still failing code review after ${MAX_FIX_ROUNDS} fix rounds.`,
          },
          baseData(),
        );
        return;
      }

      // ---- Contributor-dashboard action pushes (gate on actor !== originator) ----
      case "buildStarted": {
        if (event.actorUserId && event.actorUserId === bug.originatorUserId) {
          return;
        }
        await schedulePush(
          ctx,
          originatorUserId,
          {
            title: "Build started",
            body: `Implementation has started for "${bug.title}".`,
          },
          { bugId: bug._id, status: "READY_FOR_IMPL" },
        );
        return;
      }
      case "stagingVerified": {
        if (event.actorUserId === bug.originatorUserId) return;
        const name = await displayName(ctx, event.actorUserId as Id<"users">);
        await schedulePush(
          ctx,
          originatorUserId,
          {
            title: "Verified on staging 🎉",
            body: `${name} confirmed "${bug.title}" works on staging — a maintainer will ship it to production.`,
          },
          baseData(),
        );
        return;
      }
      case "stagingRedo": {
        if (event.actorUserId === bug.originatorUserId) return;
        await schedulePush(
          ctx,
          originatorUserId,
          {
            title: "Back to the shop",
            body: `"${bug.title}" didn't pass the staging check — the AI is working on a fix.`,
          },
          { bugId: bug._id, status: "READY_FOR_IMPL" },
        );
        return;
      }

      // ---- Chat mirror (gate on channelId present) ----
      case "chatStatusUpdate": {
        if (!channelId) return;
        const mentionedUserIds: Id<"users">[] | undefined =
          event.effectiveStatus === "READY_TO_MERGE"
            ? [originatorUserId]
            : undefined;
        const args = {
          channelId,
          content: event.message,
          botType: "dev_assistant" as const,
          contentType: "bot" as const,
          bugId: bug._id as Id<"devBugs">,
          parentMessageId: bug.threadRootMessageId as
            | Id<"chatMessages">
            | undefined,
          mentionedUserIds,
          sourceKey: event.sourceKey,
        };
        if (ctx.runMutation) {
          await ctx.runMutation(
            internal.functions.scheduledJobs.insertBotMessage,
            args,
          );
        } else {
          await ctx.scheduler.runAfter(
            0,
            internal.functions.scheduledJobs.insertBotMessage,
            args,
          );
        }
        return;
      }

      // buildStarted handled above; readyToMerge / merged push nothing (the
      // staging-live notice fires later from handleWorkflowRunEvent).
      default:
        return;
    }
  },
};
