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
import type { Contribution, ContributionKind } from "../types";

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
  /** Current user's contributions, newest first (includes chat-originated items). */
  myContributions: FunctionReference<"query", "public", { token: string }, Contribution[]>;
  /** All users' contributions, newest first (maintainer view). */
  listAll: FunctionReference<"query", "public", { token: string }, Contribution[]>;
  getContribution: FunctionReference<
    "query",
    "public",
    { token: string; id: Id<"devBugs"> },
    Contribution | null
  >;
  /** Contributor sign-off on the AI spec (auto-starts the build for low risk). */
  approveSpec: FunctionReference<"mutation", "public", { token: string; id: Id<"devBugs"> }, null>;
  /** Explicit build start for approved medium/high-risk items. */
  startBuild: FunctionReference<"mutation", "public", { token: string; id: Id<"devBugs"> }, null>;
}

export const contributionsApi = (
  api.functions.devAssistant as unknown as { contributions: ContributionsApi }
).contributions;
