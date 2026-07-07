/**
 * Typed accessor for api.functions.devAssistant.contributions.
 *
 * The contributions module is being added to apps/convex in the same release
 * as this feature, so the generated `_generated/api` types may not include it
 * yet when this file typechecks. This is the ONE place that bridges that gap:
 * it declares the agreed backend contract as FunctionReference types and
 * casts the (runtime-correct) api path to it, keeping every hook and screen
 * fully typed.
 *
 * TODO: once `apps/convex/functions/devAssistant/contributions.ts` lands and
 * codegen runs, drop the cast and use `api.functions.devAssistant.contributions`
 * directly.
 */
import type { FunctionReference } from "convex/server";
import { api } from "@services/api/convex";
import type { Id } from "@services/api/convex";
import type {
  Contribution,
  ContributionKind,
  ContributionListItem,
  ThreadMessage,
} from "../types";

interface ContributionsApi {
  /** Create a new bug/feature contribution. Returns the new doc id. */
  submit: FunctionReference<
    "mutation",
    "public",
    {
      token: string;
      kind: ContributionKind;
      title: string;
      body: string;
      repro?: string;
      screenshotUrls?: string[];
    },
    Id<"devBugs">
  >;
  /**
   * Current user's contributions, newest first (includes chat-originated
   * items), each with a latest-thread-message snippet.
   */
  myContributions: FunctionReference<
    "query",
    "public",
    { token: string },
    ContributionListItem[]
  >;
  /** All users' contributions, newest first (maintainer view), with snippets. */
  listAll: FunctionReference<"query", "public", { token: string }, ContributionListItem[]>;
  getContribution: FunctionReference<
    "query",
    "public",
    { token: string; id: Id<"devBugs"> },
    Contribution | null
  >;
  /** Conversation thread for one contribution, ascending by createdAt. */
  getThread: FunctionReference<
    "query",
    "public",
    { token: string; id: Id<"devBugs"> },
    ThreadMessage[]
  >;
  /**
   * Post a user message to the thread. Returns the new message id. Posting
   * while status is DRAFT/IN_REVIEW asks the AI to revise the spec.
   */
  postMessage: FunctionReference<
    "mutation",
    "public",
    { token: string; id: Id<"devBugs">; body: string },
    string
  >;
  /**
   * Contributor sign-off on the AI spec (auto-starts the build for low risk).
   * Rejects items whose scope is "split" or "design_needed".
   */
  approveSpec: FunctionReference<"mutation", "public", { token: string; id: Id<"devBugs"> }, null>;
  /** Explicit build start for approved medium/high-risk items. */
  startBuild: FunctionReference<"mutation", "public", { token: string; id: Id<"devBugs"> }, null>;
  /**
   * Contributor confirms the change works on staging. Valid when
   * verifyOnStaging && !stagingVerifiedAt && status is CODE_REVIEW or
   * READY_TO_MERGE.
   */
  confirmStaging: FunctionReference<
    "mutation",
    "public",
    { token: string; id: Id<"devBugs"> },
    null
  >;
  /** Contributor reports the staging build isn't right (same validity window). */
  reportStagingIssue: FunctionReference<
    "mutation",
    "public",
    { token: string; id: Id<"devBugs">; note: string },
    null
  >;
  /** The caller's GitHub username for co-author credit, or null if unset. */
  getGithubUsername: FunctionReference<"query", "public", { token: string }, string | null>;
  /**
   * Set the caller's GitHub username for co-author credit (pass "" to clear).
   * The backend validates GitHub username rules and throws ConvexError on
   * invalid input.
   */
  setGithubUsername: FunctionReference<
    "mutation",
    "public",
    { token: string; username: string },
    { ok: true }
  >;
}

export const contributionsApi = (
  api.functions.devAssistant as unknown as { contributions: ContributionsApi }
).contributions;
