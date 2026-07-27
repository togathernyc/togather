/**
 * Dev-Assistant config — Togather's mount of `@supa-media/dev-assistant`.
 *
 * The pipeline control plane (status machine, signed Routine callback, per-run-
 * mode callback policy, severity-capped auto-merge, staging-verification loop,
 * GitHub webhooks) now lives in the package (ported verbatim from Togather's
 * own devAssistant, ADR-029). This file supplies ONLY the app-specific seams:
 * auth, the role gate, the notifier (push + chat), the R2 media/upload
 * resolvers, and the repo/GitHub config. Env var names (`CLAUDE_ROUTINES_*`,
 * `DEV_ASSISTANT_CALLBACK_SECRET`, `AUTO_MERGE_ENABLED`, `GH_MIRROR_TOKEN`,
 * `GH_WEBHOOK_SECRET`, `CONVEX_SITE_URL`) are read by the package under the same
 * names Togather always used — the migration is behavior-neutral on the wire
 * (same `x-togather-signature` header, same status machine, same callback
 * contract), so external Claude Routines need no change.
 *
 * `setDevAssistantConfig` runs ONCE at module load (a side effect). Every
 * re-export file (bugs/actions/contributions/maintainers.ts) plus http.ts and
 * crons.ts imports this module first (`import "./config"`) so the config is
 * always set before any handler runs. Re-exports MUST live at exactly
 * `functions/devAssistant/*` (the `functionsPath` contract — see
 * `mount.test.ts` for the mount smoke test).
 */

import { setDevAssistantConfig } from "@supa-media/dev-assistant";
import { requireAuth } from "../../lib/auth";
import { getMediaUrl } from "../../lib/utils";
import { putR2Object } from "../../lib/r2";
import {
  canUseDevAssistant as canUseDevAssistantForUser,
  isDevAssistantSuperAdmin,
} from "./access";
import { togatherNotifier } from "./notifier";

setDevAssistantConfig({
  // MUST match where the returned functions are re-exported (bugs/actions/
  // contributions/maintainers). The package builds internal function references
  // from this string — a mismatch fails silently at runtime (see the smoke test).
  functionsPath: "functions/devAssistant",

  // Back-compat header: Togather's Routines sign with x-togather-signature.
  signatureHeader: "x-togather-signature",

  // Auth: resolve the client token to a userId (throws ConvexError when invalid).
  authenticate: (ctx, token) => requireAuth(ctx as any, token),

  // Role gate: staff/superuser (implicit) or a delegated dev_maintainer.
  canUseDevAssistant: async (ctx, userId) =>
    canUseDevAssistantForUser(await ctx.db.get(userId)),

  // More privileged gate for the maintainer review-screen ops: staff/superuser.
  isSuperAdmin: async (ctx, userId) =>
    isDevAssistantSuperAdmin(await ctx.db.get(userId)),

  // Push + chat side effects (reproduces Togather's exact routing).
  notifier: togatherNotifier,

  // R2 media resolve (r2: path → public URL; passes http(s) through unchanged).
  resolveMediaUrl: (url) => getMediaUrl(url),

  // Attachment guard: left as the package default, which is r2:-only and throws
  // ConvexError("Attachments must be uploaded images") — identical to Togather's
  // old `assertR2Paths`. Passing a custom function would only OPT INTO more
  // (e.g. http(s) URLs); we deliberately keep the safe-by-default r2:-only rule.

  // Routine image upload (POST /dev-assistant/upload) → store to R2.
  uploadImage: async (_ctx, { dataBase64, contentType, fileName }) => {
    const publicBase = process.env.R2_PUBLIC_URL;
    if (!publicBase) {
      console.error("[DevAssistant] R2_PUBLIC_URL not configured");
      throw new Error("Storage not configured");
    }
    // `dataBase64` arrives already base64 (the package strips any data: prefix
    // and enforces the content-type/size limits before calling this).
    const binary = atob(dataBase64);
    const buffer = new ArrayBuffer(binary.length);
    const view = new Uint8Array(buffer);
    for (let i = 0; i < binary.length; i++) view[i] = binary.charCodeAt(i);

    const { key } = await putR2Object({
      folder: "dev-assistant",
      fileName,
      contentType,
      body: buffer,
    });
    return { url: `${publicBase}/${key}` };
  },

  // Domain area tags for triage (informational; surfaced in the spec prompt).
  areas: ["events", "chat", "groups", "prayer", "settings", "other"],

  // Repo / GitHub config (was hard-coded togathernyc/togather).
  repo: {
    owner: "togathernyc",
    name: "togather",
    baseBranch: "main",
    branchPrefix: "claude/devbug-",
    // The two workflows that deploy to STAGING on a push to main — deploy
    // observation waits for every one a merge triggers to succeed.
    stagingDeployWorkflowNames: ["Deploy Convex", "Deploy Mobile Update"],
    productionDeployWorkflowName: "Deploy to Production",
    productionDeployWorkflowFile: "deploy-to-production.yml",
    // `confirm: "deploy"` is the literal string Togather's production workflow
    // gate expects; update_mode is pinned to silent (the in-app button never
    // forces a reload). Dropping confirm would silently no-op the dispatch.
    productionDeployInputs: { confirm: "deploy", update_mode: "silent" },
    issueProvenanceFooter:
      "---\n_Filed via the Togather dev dashboard " +
      "([ADR-029](https://github.com/togathernyc/togather/blob/main/docs/architecture/ADR-029-contributor-dev-dashboard.md))._",
  },
});
