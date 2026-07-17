/**
 * Dev-Assistant — contributions module (`functions/devAssistant/contributions`).
 *
 * The whole contributor dev-dashboard surface (ADR-029) — submit, spec approval,
 * risk-gated build dispatch, the conversation thread, staging confirm/redo,
 * in-app merge, production promote, and GitHub-username attribution — now lives
 * in `@supa-media/dev-assistant`. Re-exported here at exactly
 * `functions/devAssistant/contributions` so the app's public API paths
 * (`api.functions.devAssistant.contributions.*`) are unchanged for the mobile
 * client, and so the package's internal references resolve (`functionsPath`).
 */

import { devAssistant } from "./_instance";
import type { PublicQuery, PublicMutation } from "./_reexportTypes";

// Direct-const re-exports with explicit registered-function types so the mobile
// client's `api.functions.devAssistant.contributions.*` references keep
// compiling (a destructured re-export is dropped from the generated api — see
// _reexportTypes.ts). Runtime is the package's real functions.
export const getGithubUsername: PublicQuery = devAssistant.contributions.getGithubUsername as any;
export const setGithubUsername: PublicMutation = devAssistant.contributions.setGithubUsername as any;
export const submit: PublicMutation = devAssistant.contributions.submit as any;
export const approveSpec: PublicMutation = devAssistant.contributions.approveSpec as any;
export const startBuild: PublicMutation = devAssistant.contributions.startBuild as any;
export const archive: PublicMutation = devAssistant.contributions.archive as any;
export const unarchive: PublicMutation = devAssistant.contributions.unarchive as any;
export const postMessage: PublicMutation = devAssistant.contributions.postMessage as any;
export const confirmStaging: PublicMutation = devAssistant.contributions.confirmStaging as any;
export const reportStagingIssue: PublicMutation = devAssistant.contributions.reportStagingIssue as any;
export const mergeNow: PublicMutation = devAssistant.contributions.mergeNow as any;
export const promoteToProduction: PublicMutation = devAssistant.contributions.promoteToProduction as any;
export const getThread: PublicQuery = devAssistant.contributions.getThread as any;
export const myContributions: PublicQuery = devAssistant.contributions.myContributions as any;
export const listAll: PublicQuery = devAssistant.contributions.listAll as any;
export const getContribution: PublicQuery = devAssistant.contributions.getContribution as any;
