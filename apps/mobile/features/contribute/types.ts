/**
 * Contribute feature types (ADR-029 Phase 1).
 *
 * Mirrors the `devBugs` doc shape returned by
 * `api.functions.devAssistant.contributions.*`. Kept as a local structural
 * type so the feature compiles against the backend contract even while the
 * generated Convex types for the new module are catching up.
 */
import type { Id } from "@services/api/convex";

/** devBugs status machine (see apps/convex/schema.ts). */
export type ContributionStatus =
  | "DRAFT"
  | "IN_REVIEW"
  | "READY_FOR_IMPL"
  | "IN_PROGRESS"
  | "CODE_REVIEW"
  | "READY_TO_MERGE"
  | "MERGED"
  | "REJECTED";

export type ContributionKind = "bug" | "feature";

export type ContributionSource = "chat" | "dashboard";

export type RiskLevel = "low" | "medium" | "high";

/** A devBugs doc as returned by the contributions queries. */
export interface Contribution {
  _id: Id<"devBugs">;
  _creationTime: number;
  title: string;
  body: string;
  repro?: string;
  status: ContributionStatus;
  /** Defaults to "bug" for legacy chat-originated items. */
  kind?: ContributionKind;
  /** Absent on legacy items — anything !== "dashboard" originated in chat. */
  source?: ContributionSource;
  riskLevel?: RiskLevel;
  /** AI-drafted spec, markdown. */
  spec?: string;
  /** Contributor sign-off timestamp. */
  specApprovedAt?: number;
  prUrl?: string;
  githubIssueUrl?: string;
  screenshotUrls?: string[];
  createdAt: number;
  updatedAt: number;
  shippedAt?: number;
}

/** Return shape of api.functions.devAssistant.maintainers.myAccess. */
export interface DevAccess {
  isMaintainer: boolean;
  isSuperAdmin: boolean;
  canUseAssistant: boolean;
}
