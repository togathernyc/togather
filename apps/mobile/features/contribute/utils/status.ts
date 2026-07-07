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
 * staging verification, not yet verified, and far enough along to test.
 */
export function needsStagingVerify(
  contribution: Pick<Contribution, "status" | "verifyOnStaging" | "stagingVerifiedAt">,
): boolean {
  return (
    !!contribution.verifyOnStaging &&
    !contribution.stagingVerifiedAt &&
    (contribution.status === "CODE_REVIEW" || contribution.status === "READY_TO_MERGE")
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
 */
export function statusPresentation(
  contribution: Pick<Contribution, "status" | "spec" | "specApprovedAt" | "scope">,
): StatusPresentation {
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
      return { label: "Queued to build", color: "#5856D6", icon: "rocket-outline" };
    case "IN_PROGRESS":
      return { label: "Building", color: "#FF9500", icon: "construct-outline" };
    case "CODE_REVIEW":
      return { label: "In code review", color: "#007AFF", icon: "git-pull-request-outline" };
    case "READY_TO_MERGE":
      return { label: "Awaiting merge", color: "#34C759", icon: "git-merge-outline" };
    case "MERGED":
      return { label: "Shipped", color: "#34C759", icon: "checkmark-circle-outline" };
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
