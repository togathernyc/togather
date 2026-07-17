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

import "./config"; // side-effect: sets config before any handler here runs

// Genuine builder-output consts re-exported directly from the package, so the
// mobile client's `api.functions.devAssistant.contributions.*` references keep
// compiling with no cast (see bugs.ts for why). Runtime is the package's real
// functions.
export {
  getGithubUsername,
  setGithubUsername,
  submit,
  approveSpec,
  startBuild,
  archive,
  unarchive,
  postMessage,
  confirmStaging,
  reportStagingIssue,
  mergeNow,
  promoteToProduction,
  getThread,
  myContributions,
  listAll,
  getContribution,
} from "@supa-media/dev-assistant/functions/contributions";
