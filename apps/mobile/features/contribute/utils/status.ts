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
 * The contributor should try the change on the staging app: it's flagged for
 * staging verification, not yet verified, and merged. Nothing reaches staging
 * until the PR merges to `main` (deploys auto-run on merge), so the try-it
 * window opens at MERGED — never while the PR is still open. The sign-off then
 * gates the manual production deploy (ADR-029).
 */
export function needsStagingVerify(
  contribution: Pick<Contribution, "status" | "verifyOnStaging" | "stagingVerifiedAt">,
): boolean {
  return (
    !!contribution.verifyOnStaging &&
    !contribution.stagingVerifiedAt &&
    contribution.status === "MERGED"
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
    "status" | "spec" | "specApprovedAt" | "scope" | "verifyOnStaging" | "stagingVerifiedAt"
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
    "status" | "spec" | "specApprovedAt" | "scope" | "verifyOnStaging" | "stagingVerifiedAt"
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
    "status" | "spec" | "specApprovedAt" | "scope" | "verifyOnStaging" | "stagingVerifiedAt"
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

/**
 * True when the current build is a rerun acting on the contributor's
 * feedback rather than a first build — either the AI is addressing code-review
 * feedback (`fixRounds`) or a merged item was sent back to rebuild after a
 * failed staging check (`redoRounds`). Only meaningful while the item is
 * actively moving through the build/review states; the counters persist on the
 * doc afterwards (e.g. on a MERGED item) but no longer describe live work.
 */
export function isRerun(
  contribution: Pick<Contribution, "status" | "fixRounds" | "redoRounds">,
): boolean {
  const { status } = contribution;
  // redoRounds can apply from the moment it's re-queued; fixRounds only occurs
  // once the build/review is under way.
  if (status === "READY_FOR_IMPL") return (contribution.redoRounds ?? 0) > 0;
  if (status === "IN_PROGRESS" || status === "CODE_REVIEW") {
    return (contribution.redoRounds ?? 0) > 0 || (contribution.fixRounds ?? 0) > 0;
  }
  return false;
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
 * The build/review states are also rerun-aware: when the item is being
 * reworked with the contributor's feedback (a staging redo, or the AI fixing
 * review comments) the generic "Building"/"In code review" copy is replaced
 * with framing that says the feedback is being acted on. A first build keeps
 * the plain labels.
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
    | "fixRounds"
    | "redoRounds"
  >,
): StatusPresentation {
  // Staging redo takes precedence over a fix round: it's the more specific
  // "your staging note sent this back" story (a redo also resets fixRounds).
  const isStagingRedo = (contribution.redoRounds ?? 0) > 0;
  const isFixingFeedback = (contribution.fixRounds ?? 0) > 0;
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
      // A redo can re-queue the item before the build restarts; a plain
      // first-time queue keeps the generic copy.
      if (isStagingRedo) return reworkChip(REWORK_LABEL.stagingRedo);
      return { label: "Queued to build", color: "#5856D6", icon: "rocket-outline" };
    case "IN_PROGRESS":
      if (isStagingRedo) return reworkChip(REWORK_LABEL.stagingRedo);
      if (isFixingFeedback) return reworkChip(REWORK_LABEL.fixFeedback);
      return { label: "Building", color: "#FF9500", icon: "construct-outline" };
    case "CODE_REVIEW":
      // The PR is still open — nothing is on staging yet.
      if (isStagingRedo) return reworkChip(REWORK_LABEL.stagingRedo);
      if (isFixingFeedback) return reworkChip(REWORK_LABEL.fixFeedback);
      return { label: "In code review", color: "#007AFF", icon: "git-pull-request-outline" };
    case "READY_TO_MERGE":
      // Reviewed and approved, but not merged — still nothing on staging.
      return { label: "Awaiting merge", color: "#FF9500", icon: "git-merge-outline" };
    case "MERGED":
      // A merge auto-deploys to staging; production is a separate manual step.
      // For interactive items the contributor tries it on staging first (their
      // turn), then a maintainer ships to production (ADR-029).
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
      return { label: "Merged — live on staging", color: "#34C759", icon: "checkmark-circle-outline" };
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
