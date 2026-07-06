/**
 * Presentation helpers for contribution statuses, kinds, and risk levels.
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
  ContributionStatus,
  RiskLevel,
} from "../types";

type IoniconName = keyof typeof Ionicons.glyphMap;

export interface StatusPresentation {
  label: string;
  color: string;
  icon: IoniconName;
}

/**
 * Friendly status chip for a contribution. IN_REVIEW is contextual: it means
 * "we're looking at it" until the AI spec lands, then "your turn to review",
 * then "approved, ready to build" once signed off (medium/high risk items
 * wait here for an explicit build start).
 */
export function statusPresentation(
  contribution: Pick<Contribution, "status" | "spec" | "specApprovedAt">,
): StatusPresentation {
  switch (contribution.status) {
    case "IN_REVIEW":
      if (!contribution.spec) {
        return { label: "Being reviewed", color: "#FF9500", icon: "hourglass-outline" };
      }
      if (!contribution.specApprovedAt) {
        return {
          label: "Spec ready for your review",
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

/**
 * The happy-path pipeline, in order, for the detail screen's timeline.
 * REJECTED is not a step — it renders as a terminal state instead.
 */
export const PIPELINE_STEPS: {
  status: ContributionStatus;
  label: string;
  description: string;
}[] = [
  {
    status: "DRAFT",
    label: "Submitted",
    description: "We received your report.",
  },
  {
    status: "IN_REVIEW",
    label: "Spec & your review",
    description: "The AI drafts a plan; you confirm it's what you meant.",
  },
  {
    status: "READY_FOR_IMPL",
    label: "Queued to build",
    description: "Approved and waiting for a build slot.",
  },
  {
    status: "IN_PROGRESS",
    label: "Building",
    description: "The AI is making the change.",
  },
  {
    status: "CODE_REVIEW",
    label: "Code review",
    description: "A maintainer checks the code.",
  },
  {
    status: "READY_TO_MERGE",
    label: "Awaiting merge",
    description: "Approved code, waiting to go in.",
  },
  {
    status: "MERGED",
    label: "Shipped",
    description: "Your change is in the app.",
  },
];

/** Index of a status within the happy-path pipeline (-1 for REJECTED). */
export function pipelineIndex(status: ContributionStatus): number {
  return PIPELINE_STEPS.findIndex((step) => step.status === status);
}
