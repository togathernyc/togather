/**
 * Contribute feature types (ADR-029 Phase 1.5 — conversation-first UI).
 *
 * Mirrors the `devBugs` doc shape and thread messages returned by
 * `api.functions.devAssistant.contributions.*` (the hooks use the generated
 * Convex types directly). Kept as local structural types so components only
 * see the fields this feature actually renders, not the whole doc.
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

/**
 * AI triage verdict on whether the item fits in one build.
 * Unset counts as "buildable"; "split"/"design_needed" block spec approval.
 */
export type ContributionScope = "buildable" | "split" | "design_needed";

/** Who wrote a thread message. */
export type MessageAuthorType = "user" | "assistant" | "system";

/**
 * One buildable slice of a "split" contribution — a short title plus a
 * self-contained prompt a maintainer can paste into a fresh dev session.
 */
export interface SplitSlice {
  title: string;
  prompt: string;
}

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
  /** AI-written conversational title; falls back to the raw title. */
  aiTitle?: string;
  /** App area the AI filed this under (e.g. "chat", "events"). */
  area?: string;
  /** AI scope verdict — unset counts as "buildable". */
  scope?: ContributionScope;
  /**
   * For "split" items: the buildable slices the AI proposed, each with a
   * copy-paste-ready prompt for a fresh dev session (ADR-029).
   */
  splitSlices?: SplitSlice[];
  /** True when the contributor should try the change on staging before merge. */
  verifyOnStaging?: boolean;
  /** Set once the contributor confirmed the change works on staging. */
  stagingVerifiedAt?: number;
  /**
   * Set when a maintainer triggered the production deploy from the app
   * (always a silent OTA); cleared again if the workflow dispatch failed.
   * Acts as a cooldown, not a one-shot (see promoteToProduction).
   */
  productionRequestedAt?: number;
  /**
   * Set while an in-app merge (mergeNow) is in flight; cleared if the merge
   * failed so the merge card can offer a retry.
   */
  mergeRequestedAt?: number;
  /**
   * Count of auto-fix dispatches while the AI addresses code-review feedback
   * (capped at MAX_FIX_ROUNDS=3). >0 means the current build is a rerun
   * reworking the review's requested changes, not a first build.
   */
  fixRounds?: number;
  /**
   * Count of staging-redo dispatches — incremented each time a contributor hit
   * "Something's off in staging" and the merged item was sent back to rebuild.
   * >0 means the current build is a rerun driven by the contributor's staging
   * note.
   */
  redoRounds?: number;
  /** Mode the in-flight Routine run was dispatched in. */
  activeRunMode?: "spec" | "implement" | "review" | "fix";
  /** AI review verdict on the open PR — "approved" unlocks the in-app merge. */
  reviewVerdict?: "approved" | "changes_requested";
  reviewSummary?: string;
  prUrl?: string;
  githubIssueUrl?: string;
  /** User's own report screenshots (set at submit). */
  screenshotUrls?: string[];
  /** AI-generated before/after plan mock (routine callback). */
  planPreviewUrls?: string[];
  /**
   * Display name of whoever started the conversation — attached by both
   * getContribution (detail header) and the list queries ("Everyone" view).
   */
  originatorName?: string;
  /** Set when the contributor set the conversation aside (abandoned/not doable). */
  archivedAt?: number;
  createdAt: number;
  updatedAt: number;
  shippedAt?: number;
}

/**
 * Conversation-list shape: the devBugs doc plus a snippet of the latest
 * thread message (returned by myContributions / listAll).
 */
export interface ContributionListItem extends Contribution {
  lastMessageBody?: string;
  lastMessageAuthorType?: MessageAuthorType;
}

/** One message in a contribution's conversation thread (getThread, ascending). */
export interface ThreadMessage {
  _id: string;
  bugId: Id<"devBugs">;
  authorType: MessageAuthorType;
  userId?: string;
  body: string;
  /** Pictures on a "user" message, resolved to public URLs by getThread. */
  imageUrls?: string[];
  createdAt: number;
}

/** Return shape of api.functions.devAssistant.maintainers.myAccess. */
export interface DevAccess {
  isMaintainer: boolean;
  isSuperAdmin: boolean;
  canUseAssistant: boolean;
}
