/**
 * Re-export type helpers — a workaround for an upstream `@supa-media/dev-assistant`
 * typing bug.
 *
 * WHY THIS EXISTS: the package returns its Convex functions from the
 * `createDevAssistant(...)` factory. Accessed through the factory's inferred
 * return type, each function is typed `RegisteredQuery/Mutation/Action<Vis, any,
 * Promise<any>>` (its arg validator type is lost — the package's handlers are
 * `async (ctx: any, args: any)`). Convex's generated-API type filter
 * (`ApiFromModules` → `FunctionReferenceFromExport` → `FilterApi`) then DROPS
 * such functions from the typed `api`/`internal` objects — so re-exporting them
 * plainly (`export const { getBug } = devAssistant.bugs`) makes them vanish from
 * `api.functions.devAssistant.*` / `internal.functions.devAssistant.*` at the
 * TYPE level (they still register + resolve at runtime via string refs, so the
 * pipeline works — but every typed reference, incl. the mobile app's
 * `api.functions.devAssistant.contributions.*` and the tests, fails to compile).
 *
 * Casting each re-export to one of these concrete-but-loose registered-function
 * types restores it on the generated API. Args are `Record<string, any>` and
 * returns are `any` (looser than the real validators, but Convex still enforces
 * the real arg/return validators at RUNTIME — behavior is unchanged). Remove
 * this shim once the upstream package annotates its factory return types.
 */

import type {
  RegisteredQuery,
  RegisteredMutation,
  RegisteredAction,
} from "convex/server";

export type InternalQuery = RegisteredQuery<"internal", Record<string, any>, any>;
export type InternalMutation = RegisteredMutation<
  "internal",
  Record<string, any>,
  any
>;
export type InternalAction = RegisteredAction<
  "internal",
  Record<string, any>,
  any
>;
export type PublicQuery = RegisteredQuery<"public", Record<string, any>, any>;
export type PublicMutation = RegisteredMutation<
  "public",
  Record<string, any>,
  any
>;
