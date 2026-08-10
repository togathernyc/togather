/**
 * Presentation helpers for contribution statuses, kinds, risk levels, and the
 * conversation list's "whose turn is it" logic.
 *
 * Friendly, non-technical labels — contributors see "Building" and
 * "Shipped", not the raw pipeline enum. Colors follow the palette already
 * used by the staff BugDetailScreen (features/admin) so the two surfaces
 * stay visually consistent.
 */
import type { Ionicons } from "@expo/vector-icons";
import type {
  Contribution,
  ContributionKind,
  ContributionScope,
  RiskLevel,
} from "../types";

type IoniconName = keyof typeof Ionicons.glyphMap;

/** Shared palette (matches the status chips below). */
export const PALETTE = {
  /** Purple — the contributor needs to act. */
  yourTurn: "#5856D6",
  /** Amber — the AI (or the team) is working. */
  aiWorking: "#FF9500",
  /** Green — shipped. */
  shipped: "#34C759",
  /** Grey — closed without shipping. */
  inactive: "#999999",
} as const;

export interface StatusPresentation {
  label: string;
  color: string;
  icon: IoniconName;
}

/** Unset scope counts as buildable (legacy items predate the field). */
export function isBuildableScope(scope: ContributionScope | undefined): boolean {
  return scope === undefined || scope === "buildable";
}

/**
 * The contributor's product review is pending: there's a spec they haven't
 * signed off, and the item is small enough to actually build.
 */
export function needsSpecApproval(
  contribution: Pick<Contribution, "status" | "spec" | "specApprovedAt" | "scope">,
): boolean {
  return (
    contribution.status === "IN_REVIEW" &&
    !!contribution.spec &&
    !contribution.specApprovedAt &&
    isBuildableScope(contribution.scope)
  );
}

/**
 * The staging deploy for a merged item is actually up. A merge only *triggers*
 * the staging deploy workflows (a few minutes), so "merged" ≠ "live". Legacy
 * merged rows predate deploy observation and carry no `stagingDeploy` — treat
 * them as live (they're long since deployed). A pending or failed deploy is
 * explicitly NOT live, so we never invite a contributor to test something that
 * isn't up.
 */
export function isStagingDeployLive(
  contribution: Pick<Contribution, "stagingDeploy">,
): boolean {
  return (
    contribution.stagingDeploy === undefined ||
    contribution.stagingDeploy.state === "live"
  );
}

/**
 * The contributor should try the change on the staging app: it's flagged for
 * staging verification, not yet verified, merged, AND the staging deploy has
 * actually finished. Nothing reaches staging until the PR merges to `main` and
 * the deploy workflows run, so the try-it window opens once the deploy goes
 * live — never on merge alone. The sign-off then gates the manual production
 * deploy (ADR-029).
 */
export function needsStagingVerify(
  contribution: Pick<
    Contribution,
    "status" | "verifyOnStaging" | "stagingVerifiedAt" | "stagingDeploy"
  >,
): boolean {
  return (
    !!contribution.verifyOnStaging &&
    !contribution.stagingVerifiedAt &&
    contribution.status === "MERGED" &&
    isStagingDeployLive(contribution)
  );
}

/**
 * The AI judged the item too big/architectural to build in one go and is now
 * waiting on the maintainer — to copy a split's slice prompts into new
 * sessions, or to make the design_needed call. There's nothing the pipeline
 * can do until then, so it's the contributor's turn.
 */
export function needsSplitDecision(
  contribution: Pick<Contribution, "status" | "spec" | "scope">,
): boolean {
  return (
    contribution.status === "IN_REVIEW" &&
    !!contribution.spec &&
    !isBuildableScope(contribution.scope)
  );
}

/**
 * An approved buildable item still sitting in IN_REVIEW is a medium/high-risk
 * change waiting on an explicit "Start build" tap (low risk auto-dispatches).
 * That tap is the contributor's, so it's their turn.
 */
export function needsBuildStart(
  contribution: Pick<Contribution, "status" | "specApprovedAt" | "scope">,
): boolean {
  return (
    contribution.status === "IN_REVIEW" &&
    !!contribution.specApprovedAt &&
    isBuildableScope(contribution.scope)
  );
}

/** True when the conversation is waiting on the contributor, not the AI. */
export function isYourTurn(
  contribution: Pick<
    Contribution,
    "status" | "spec" | "specApprovedAt" | "scope" | "verifyOnStaging" | "stagingVerifiedAt" | "stagingDeploy"
  >,
): boolean {
  return (
    needsSpecApproval(contribution) ||
    needsStagingVerify(contribution) ||
    needsSplitDecision(contribution) ||
    needsBuildStart(contribution)
  );
}

/**
 * True when the item is actively being worked on by the AI/pipeline — the
 * contributor "fired it off" and it's moving, not waiting on them and not
 * finished. Powers the "In progress" tab. Rejected/closed items and anything
 * awaiting the contributor (spec approval, staging check) are excluded.
 */
export function isInProgress(
  contribution: Pick<
    Contribution,
    "status" | "spec" | "specApprovedAt" | "scope" | "verifyOnStaging" | "stagingVerifiedAt" | "stagingDeploy"
  >,
): boolean {
  return (
    !isYourTurn(contribution) &&
    contribution.status !== "MERGED" &&
    contribution.status !== "REJECTED"
  );
}

/** Conversation-list dot color: purple = your turn, amber = AI working, green = shipped. */
export function conversationDotColor(
  contribution: Pick<
    Contribution,
    "status" | "spec" | "specApprovedAt" | "scope" | "verifyOnStaging" | "stagingVerifiedAt" | "stagingDeploy"
  >,
): string {
  if (isYourTurn(contribution)) return PALETTE.yourTurn;
  if (contribution.status === "MERGED") return PALETTE.shipped;
  if (contribution.status === "REJECTED") return PALETTE.inactive;
  return PALETTE.aiWorking;
}

/** User-facing labels for a build that's a rerun with the contributor's feedback. */
export const REWORK_LABEL = {
  /** A merged item sent back after the contributor's staging note (redoRounds). */
  stagingRedo: "Reworking from your staging note",
  /** The AI is addressing the code review's requested changes (fixRounds). */
  fixFeedback: "Fixing review feedback",
} as const;

/** Fields needed to tell an *active* rerun apart from a stale counter. */
type RerunInput = Pick<
  Contribution,
  "status" | "fixRounds" | "redoRounds" | "activeRunMode"
>;

/**
 * The `fixRounds`/`redoRounds` counters PERSIST after the run they counted
 * finishes (nothing clears them mid-lifecycle), so a counter alone can't say
 * whether the item is *actively* being reworked. `activeRunMode` — the mode of
 * the most recently dispatched Routine run — is the reliable "what's in flight"
 * signal: a fix run stamps "fix", a redo's rebuild stamps "implement", and the
 * fix→review handoff immediately restamps "review". Gating on it avoids two
 * mislabels: an exhausted fix loop (budget spent, awaiting a human — mode is
 * "review", not "fix") and an item sitting idle after a run reported back.
 */

/** A staging redo whose rebuild run is actually in flight (not just re-queued). */
function isStagingRedoActive(c: RerunInput): boolean {
  // The redo re-queues at READY_FOR_IMPL with activeRunMode cleared; the
  // implement run stamps "implement" once it's building. Once it reports back
  // (CODE_REVIEW onward) the mode moves to "review", so this reads false there
  // and the normal status label takes over.
  return (
    c.status === "IN_PROGRESS" &&
    (c.redoRounds ?? 0) > 0 &&
    c.activeRunMode === "implement"
  );
}

/** A fix run actively addressing the code review's requested changes. */
function isFixingFeedbackActive(c: RerunInput): boolean {
  // Fix runs only dispatch from CODE_REVIEW and stamp "fix". When the budget is
  // exhausted no fix dispatches, so the mode stays "review" and this reads
  // false (no "actively fixing" claim on an item that now needs a human).
  return (
    c.status === "CODE_REVIEW" &&
    (c.fixRounds ?? 0) > 0 &&
    c.activeRunMode === "fix"
  );
}

/**
 * True when the item is *actively* being reworked with the contributor's
 * feedback rather than on a first build — a redo's rebuild is in flight, or a
 * fix run is addressing review feedback. Gated on `activeRunMode` (not just the
 * persisted counters) so a finished/exhausted/idle rerun falls back to the
 * plain status label.
 */
export function isRerun(contribution: RerunInput): boolean {
  return isStagingRedoActive(contribution) || isFixingFeedbackActive(contribution);
}

/** The contributor set this conversation aside (abandoned / not doable). */
export function isArchived(
  contribution: Pick<Contribution, "archivedAt">,
): boolean {
  return !!contribution.archivedAt;
}

/** Conversational display title — the AI's friendly title when it exists. */
export function displayTitle(contribution: Pick<Contribution, "title" | "aiTitle">): string {
  return contribution.aiTitle ?? contribution.title;
}

/**
 * Friendly status chip for a contribution. IN_REVIEW is contextual: it means
 * "we're looking at it" until the AI spec lands, then "your turn to review"
 * (unless the AI judged it too big to build in one go), then "approved,
 * ready to build" once signed off (medium/high risk items wait here for an
 * explicit build start).
 *
 * The build/review states are also rerun-aware: when the item is *actively*
 * being reworked with the contributor's feedback (a redo's rebuild in flight,
 * or a fix run addressing review comments) the generic "Building"/"In code
 * review" copy is replaced with framing that says the feedback is being acted
 * on. Gated on `activeRunMode` (see isRerun), so a first build — or a
 * finished/exhausted/idle rerun — keeps the plain labels.
 */
export function statusPresentation(
  contribution: Pick<
    Contribution,
    | "status"
    | "spec"
    | "specApprovedAt"
    | "scope"
    | "verifyOnStaging"
    | "stagingVerifiedAt"
    | "stagingDeploy"
    | "productionDeploy"
    | "fixRounds"
    | "redoRounds"
    | "activeRunMode"
  >,
): StatusPresentation {
  // Shared amber "AI working" chip for both rerun flavors, with a refresh icon
  // to read as a rerun rather than a first pass.
  const reworkChip = (label: string): StatusPresentation => ({
    label,
    color: PALETTE.aiWorking,
    icon: "refresh-outline",
  });

  switch (contribution.status) {
    case "IN_REVIEW":
      if (!contribution.spec) {
        return { label: "Being reviewed", color: "#FF9500", icon: "hourglass-outline" };
      }
      if (!isBuildableScope(contribution.scope)) {
        return { label: "Too big for one build", color: "#FF9500", icon: "git-branch-outline" };
      }
      if (!contribution.specApprovedAt) {
        return {
          label: "Plan ready for your review",
          color: "#007AFF",
          icon: "reader-outline",
        };
      }
      return { label: "Approved — ready to build", color: "#5856D6", icon: "checkmark-outline" };
    case "READY_FOR_IMPL":
      // A redo re-queues here with no run yet in flight (activeRunMode cleared),
      // so it reads as a plain queue until the rebuild actually starts.
      return { label: "Queued to build", color: "#5856D6", icon: "rocket-outline" };
    case "IN_PROGRESS":
      // Only a redo's rebuild is reworkable here; a first build reads "Building".
      if (isStagingRedoActive(contribution)) return reworkChip(REWORK_LABEL.stagingRedo);
      return { label: "Building", color: "#FF9500", icon: "construct-outline" };
    case "CODE_REVIEW":
      // The PR is still open — nothing is on staging yet. An active fix run
      // reworks the review feedback; an exhausted/idle round reads normally.
      if (isFixingFeedbackActive(contribution)) return reworkChip(REWORK_LABEL.fixFeedback);
      return { label: "In code review", color: "#007AFF", icon: "git-pull-request-outline" };
    case "READY_TO_MERGE":
      // Reviewed and approved, but not merged — still nothing on staging.
      return { label: "Awaiting merge", color: "#FF9500", icon: "git-merge-outline" };
    case "MERGED": {
      // Production deploy state wins once a ship has been triggered — it's the
      // latest truth about where the change is.
      const prod = contribution.productionDeploy;
      if (prod?.state === "live") {
        return { label: "Live in production", color: "#34C759", icon: "checkmark-circle-outline" };
      }
      if (prod?.state === "failed") {
        return { label: "Production deploy failed", color: "#FF3B30", icon: "alert-circle-outline" };
      }
      if (prod?.state === "pending") {
        return { label: "Deploying to production…", color: "#FF9500", icon: "cloud-upload-outline" };
      }
      // A merge only *triggers* the staging deploy — be honest about its real
      // state instead of claiming "live on staging" the instant it merges.
      const staging = contribution.stagingDeploy;
      if (staging?.state === "pending") {
        return { label: "Deploying to staging…", color: "#FF9500", icon: "cloud-upload-outline" };
      }
      if (staging?.state === "failed") {
        return { label: "Staging deploy failed", color: "#FF3B30", icon: "alert-circle-outline" };
      }
      // Deploy is live (or a legacy row with no deploy record). For interactive
      // items the contributor tries it on staging first (their turn), then a
      // maintainer ships to production (ADR-029).
      if (contribution.verifyOnStaging && !contribution.stagingVerifiedAt) {
        return {
          label: "On staging — ready for you to try",
          color: "#5856D6",
          icon: "flask-outline",
        };
      }
      if (contribution.stagingVerifiedAt) {
        return {
          label: "Verified — ready to ship to production",
          color: "#34C759",
          icon: "checkmark-circle-outline",
        };
      }
      return { label: "Live on staging", color: "#34C759", icon: "checkmark-circle-outline" };
    }
    case "REJECTED":
      return { label: "Not planned", color: "#999999", icon: "close-circle-outline" };
    case "DRAFT":
    default:
      return { label: "Submitted", color: "#999999", icon: "document-outline" };
  }
}

export function kindPresentation(kind: ContributionKind | undefined): {
  label: string;
  color: string;
  icon: IoniconName;
} {
  // Legacy chat-originated items have no kind — they were always bugs.
  if (kind === "feature") {
    return { label: "Feature", color: "#5856D6", icon: "bulb-outline" };
  }
  return { label: "Bug", color: "#FF3B30", icon: "bug-outline" };
}

export function riskPresentation(risk: RiskLevel): { label: string; color: string } {
  switch (risk) {
    case "low":
      return { label: "Low risk", color: "#34C759" };
    case "medium":
      return { label: "Medium risk", color: "#FF9500" };
    case "high":
      return { label: "High risk", color: "#FF3B30" };
  }
}

/** True for items that arrived via the chat dev-assistant, not this dashboard. */
export function isFromChat(contribution: Pick<Contribution, "source">): boolean {
  return contribution.source !== "dashboard";
}
