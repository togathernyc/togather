/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as __mocks____generated_api from "../__mocks__/_generated/api.js";
import type * as __mocks____generated_server from "../__mocks__/_generated/server.js";
import type * as __mocks___auth from "../__mocks__/auth.js";
import type * as __tests___pco_fixtures from "../__tests__/pco/fixtures.js";
import type * as auth from "../auth.js";
import type * as crons from "../crons.js";
import type * as functions_admin_auth from "../functions/admin/auth.js";
import type * as functions_admin_cleanup from "../functions/admin/cleanup.js";
import type * as functions_admin_duplicates from "../functions/admin/duplicates.js";
import type * as functions_admin_featureFlags from "../functions/admin/featureFlags.js";
import type * as functions_admin_index from "../functions/admin/index.js";
import type * as functions_admin_members from "../functions/admin/members.js";
import type * as functions_admin_migrations from "../functions/admin/migrations.js";
import type * as functions_admin_requests from "../functions/admin/requests.js";
import type * as functions_admin_settings from "../functions/admin/settings.js";
import type * as functions_admin_stats from "../functions/admin/stats.js";
import type * as functions_adminBroadcasts from "../functions/adminBroadcasts.js";
import type * as functions_auth_accountClaim from "../functions/auth/accountClaim.js";
import type * as functions_auth_emailOtp from "../functions/auth/emailOtp.js";
import type * as functions_auth_helpers from "../functions/auth/helpers.js";
import type * as functions_auth_index from "../functions/auth/index.js";
import type * as functions_auth_login from "../functions/auth/login.js";
import type * as functions_auth_phoneOtp from "../functions/auth/phoneOtp.js";
import type * as functions_auth_registration from "../functions/auth/registration.js";
import type * as functions_auth_tokens from "../functions/auth/tokens.js";
import type * as functions_authInternal from "../functions/authInternal.js";
import type * as functions_billing from "../functions/billing.js";
import type * as functions_cli_messaging from "../functions/cli/messaging.js";
import type * as functions_communities from "../functions/communities.js";
import type * as functions_communityLandingPage from "../functions/communityLandingPage.js";
import type * as functions_communityLandingPageActions from "../functions/communityLandingPageActions.js";
import type * as functions_communityPeople from "../functions/communityPeople.js";
import type * as functions_communityScoreComputation from "../functions/communityScoreComputation.js";
import type * as functions_communityWideEvents from "../functions/communityWideEvents.js";
import type * as functions_ee_billing from "../functions/ee/billing.js";
import type * as functions_ee_notifications_proposalNotifications from "../functions/ee/notifications/proposalNotifications.js";
import type * as functions_ee_proposals from "../functions/ee/proposals.js";
import type * as functions_eventBlasts from "../functions/eventBlasts.js";
import type * as functions_eventSeries from "../functions/eventSeries.js";
import type * as functions_followupScoreComputation from "../functions/followupScoreComputation.js";
import type * as functions_followupScoring from "../functions/followupScoring.js";
import type * as functions_groupBots from "../functions/groupBots.js";
import type * as functions_groupCreationRequests from "../functions/groupCreationRequests.js";
import type * as functions_groupMembers from "../functions/groupMembers.js";
import type * as functions_groupResources_index from "../functions/groupResources/index.js";
import type * as functions_groupSearch from "../functions/groupSearch.js";
import type * as functions_groups_index from "../functions/groups/index.js";
import type * as functions_groups_internal from "../functions/groups/internal.js";
import type * as functions_groups_members from "../functions/groups/members.js";
import type * as functions_groups_mutations from "../functions/groups/mutations.js";
import type * as functions_groups_queries from "../functions/groups/queries.js";
import type * as functions_integrations from "../functions/integrations.js";
import type * as functions_linkPreview from "../functions/linkPreview.js";
import type * as functions_meetingRsvps from "../functions/meetingRsvps.js";
import type * as functions_meetings_attendance from "../functions/meetings/attendance.js";
import type * as functions_meetings_communityEvents from "../functions/meetings/communityEvents.js";
import type * as functions_meetings_events from "../functions/meetings/events.js";
import type * as functions_meetings_explore from "../functions/meetings/explore.js";
import type * as functions_meetings_index from "../functions/meetings/index.js";
import type * as functions_meetings_migrations from "../functions/meetings/migrations.js";
import type * as functions_meetings_myEvents from "../functions/meetings/myEvents.js";
import type * as functions_meetings_queries from "../functions/meetings/queries.js";
import type * as functions_meetings_reports from "../functions/meetings/reports.js";
import type * as functions_memberFollowups from "../functions/memberFollowups.js";
import type * as functions_messaging_blocking from "../functions/messaging/blocking.js";
import type * as functions_messaging_channelInvites from "../functions/messaging/channelInvites.js";
import type * as functions_messaging_channels from "../functions/messaging/channels.js";
import type * as functions_messaging_directMessages from "../functions/messaging/directMessages.js";
import type * as functions_messaging_eventChat from "../functions/messaging/eventChat.js";
import type * as functions_messaging_events from "../functions/messaging/events.js";
import type * as functions_messaging_flagging from "../functions/messaging/flagging.js";
import type * as functions_messaging_helpers from "../functions/messaging/helpers.js";
import type * as functions_messaging_index from "../functions/messaging/index.js";
import type * as functions_messaging_messages from "../functions/messaging/messages.js";
import type * as functions_messaging_reachOut from "../functions/messaging/reachOut.js";
import type * as functions_messaging_reactions from "../functions/messaging/reactions.js";
import type * as functions_messaging_readState from "../functions/messaging/readState.js";
import type * as functions_messaging_sharedChannels from "../functions/messaging/sharedChannels.js";
import type * as functions_messaging_typing from "../functions/messaging/typing.js";
import type * as functions_migrations from "../functions/migrations.js";
import type * as functions_migrations_migrateToCommunityPeople from "../functions/migrations/migrateToCommunityPeople.js";
import type * as functions_notifications_actions from "../functions/notifications/actions.js";
import type * as functions_notifications_debug from "../functions/notifications/debug.js";
import type * as functions_notifications_index from "../functions/notifications/index.js";
import type * as functions_notifications_internal from "../functions/notifications/internal.js";
import type * as functions_notifications_migrations from "../functions/notifications/migrations.js";
import type * as functions_notifications_moderation from "../functions/notifications/moderation.js";
import type * as functions_notifications_mutations from "../functions/notifications/mutations.js";
import type * as functions_notifications_preferences from "../functions/notifications/preferences.js";
import type * as functions_notifications_proposalNotifications from "../functions/notifications/proposalNotifications.js";
import type * as functions_notifications_queries from "../functions/notifications/queries.js";
import type * as functions_notifications_rollup from "../functions/notifications/rollup.js";
import type * as functions_notifications_senders from "../functions/notifications/senders.js";
import type * as functions_notifications_tokens from "../functions/notifications/tokens.js";
import type * as functions_pcoServices_actions from "../functions/pcoServices/actions.js";
import type * as functions_pcoServices_displayHelpers from "../functions/pcoServices/displayHelpers.js";
import type * as functions_pcoServices_filterHelpers from "../functions/pcoServices/filterHelpers.js";
import type * as functions_pcoServices_index from "../functions/pcoServices/index.js";
import type * as functions_pcoServices_matching from "../functions/pcoServices/matching.js";
import type * as functions_pcoServices_queries from "../functions/pcoServices/queries.js";
import type * as functions_pcoServices_rotation from "../functions/pcoServices/rotation.js";
import type * as functions_pcoServices_runSheet from "../functions/pcoServices/runSheet.js";
import type * as functions_pcoServices_servingHistory from "../functions/pcoServices/servingHistory.js";
import type * as functions_peopleSavedViews from "../functions/peopleSavedViews.js";
import type * as functions_posters from "../functions/posters.js";
import type * as functions_proposals from "../functions/proposals.js";
import type * as functions_resources from "../functions/resources.js";
import type * as functions_scheduledJobs from "../functions/scheduledJobs.js";
import type * as functions_seed from "../functions/seed.js";
import type * as functions_slackServiceBot_actions from "../functions/slackServiceBot/actions.js";
import type * as functions_slackServiceBot_adminMutations from "../functions/slackServiceBot/adminMutations.js";
import type * as functions_slackServiceBot_adminQueries from "../functions/slackServiceBot/adminQueries.js";
import type * as functions_slackServiceBot_agent from "../functions/slackServiceBot/agent.js";
import type * as functions_slackServiceBot_ai from "../functions/slackServiceBot/ai.js";
import type * as functions_slackServiceBot_config from "../functions/slackServiceBot/config.js";
import type * as functions_slackServiceBot_configDb from "../functions/slackServiceBot/configDb.js";
import type * as functions_slackServiceBot_configHelpers from "../functions/slackServiceBot/configHelpers.js";
import type * as functions_slackServiceBot_index from "../functions/slackServiceBot/index.js";
import type * as functions_slackServiceBot_pcoSync from "../functions/slackServiceBot/pcoSync.js";
import type * as functions_slackServiceBot_prompts from "../functions/slackServiceBot/prompts.js";
import type * as functions_slackServiceBot_seedConfig from "../functions/slackServiceBot/seedConfig.js";
import type * as functions_slackServiceBot_slack from "../functions/slackServiceBot/slack.js";
import type * as functions_slackServiceBot_tools from "../functions/slackServiceBot/tools.js";
import type * as functions_sync_memberships from "../functions/sync/memberships.js";
import type * as functions_syncHelpers from "../functions/syncHelpers.js";
import type * as functions_systemScoring from "../functions/systemScoring.js";
import type * as functions_taskTemplates_index from "../functions/taskTemplates/index.js";
import type * as functions_tasks_index from "../functions/tasks/index.js";
import type * as functions_toolShortLinks_index from "../functions/toolShortLinks/index.js";
import type * as functions_uploads from "../functions/uploads.js";
import type * as functions_userProfiles from "../functions/userProfiles.js";
import type * as functions_users from "../functions/users.js";
import type * as http from "../http.js";
import type * as lib_auth from "../lib/auth.js";
import type * as lib_ee_emailTemplates from "../lib/ee/emailTemplates.js";
import type * as lib_email_templates_BaseLayout from "../lib/email/templates/BaseLayout.js";
import type * as lib_email_templates_VerificationCode from "../lib/email/templates/VerificationCode.js";
import type * as lib_followupConstants from "../lib/followupConstants.js";
import type * as lib_helpers from "../lib/helpers.js";
import type * as lib_meetingConfig from "../lib/meetingConfig.js";
import type * as lib_meetingPermissions from "../lib/meetingPermissions.js";
import type * as lib_meetingSearchText from "../lib/meetingSearchText.js";
import type * as lib_memberSearch from "../lib/memberSearch.js";
import type * as lib_membership from "../lib/membership.js";
import type * as lib_notifications_definitions from "../lib/notifications/definitions.js";
import type * as lib_notifications_emailTemplates from "../lib/notifications/emailTemplates.js";
import type * as lib_notifications_index from "../lib/notifications/index.js";
import type * as lib_notifications_registry from "../lib/notifications/registry.js";
import type * as lib_notifications_send from "../lib/notifications/send.js";
import type * as lib_notifications_types from "../lib/notifications/types.js";
import type * as lib_pcoServicesApi from "../lib/pcoServicesApi.js";
import type * as lib_permissions from "../lib/permissions.js";
import type * as lib_phoneNormalize from "../lib/phoneNormalize.js";
import type * as lib_posthog from "../lib/posthog.js";
import type * as lib_rateLimit from "../lib/rateLimit.js";
import type * as lib_rsvpGuests from "../lib/rsvpGuests.js";
import type * as lib_scheduling from "../lib/scheduling.js";
import type * as lib_slugs from "../lib/slugs.js";
import type * as lib_twilio from "../lib/twilio.js";
import type * as lib_utils from "../lib/utils.js";
import type * as lib_validation from "../lib/validation.js";
import type * as lib_validators from "../lib/validators.js";
import type * as migrations_addChannelSlugs from "../migrations/addChannelSlugs.js";
import type * as migrations_backfillLastActivityAt from "../migrations/backfillLastActivityAt.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  "__mocks__/_generated/api": typeof __mocks____generated_api;
  "__mocks__/_generated/server": typeof __mocks____generated_server;
  "__mocks__/auth": typeof __mocks___auth;
  "__tests__/pco/fixtures": typeof __tests___pco_fixtures;
  auth: typeof auth;
  crons: typeof crons;
  "functions/admin/auth": typeof functions_admin_auth;
  "functions/admin/cleanup": typeof functions_admin_cleanup;
  "functions/admin/duplicates": typeof functions_admin_duplicates;
  "functions/admin/featureFlags": typeof functions_admin_featureFlags;
  "functions/admin/index": typeof functions_admin_index;
  "functions/admin/members": typeof functions_admin_members;
  "functions/admin/migrations": typeof functions_admin_migrations;
  "functions/admin/requests": typeof functions_admin_requests;
  "functions/admin/settings": typeof functions_admin_settings;
  "functions/admin/stats": typeof functions_admin_stats;
  "functions/adminBroadcasts": typeof functions_adminBroadcasts;
  "functions/auth/accountClaim": typeof functions_auth_accountClaim;
  "functions/auth/emailOtp": typeof functions_auth_emailOtp;
  "functions/auth/helpers": typeof functions_auth_helpers;
  "functions/auth/index": typeof functions_auth_index;
  "functions/auth/login": typeof functions_auth_login;
  "functions/auth/phoneOtp": typeof functions_auth_phoneOtp;
  "functions/auth/registration": typeof functions_auth_registration;
  "functions/auth/tokens": typeof functions_auth_tokens;
  "functions/authInternal": typeof functions_authInternal;
  "functions/billing": typeof functions_billing;
  "functions/cli/messaging": typeof functions_cli_messaging;
  "functions/communities": typeof functions_communities;
  "functions/communityLandingPage": typeof functions_communityLandingPage;
  "functions/communityLandingPageActions": typeof functions_communityLandingPageActions;
  "functions/communityPeople": typeof functions_communityPeople;
  "functions/communityScoreComputation": typeof functions_communityScoreComputation;
  "functions/communityWideEvents": typeof functions_communityWideEvents;
  "functions/ee/billing": typeof functions_ee_billing;
  "functions/ee/notifications/proposalNotifications": typeof functions_ee_notifications_proposalNotifications;
  "functions/ee/proposals": typeof functions_ee_proposals;
  "functions/eventBlasts": typeof functions_eventBlasts;
  "functions/eventSeries": typeof functions_eventSeries;
  "functions/followupScoreComputation": typeof functions_followupScoreComputation;
  "functions/followupScoring": typeof functions_followupScoring;
  "functions/groupBots": typeof functions_groupBots;
  "functions/groupCreationRequests": typeof functions_groupCreationRequests;
  "functions/groupMembers": typeof functions_groupMembers;
  "functions/groupResources/index": typeof functions_groupResources_index;
  "functions/groupSearch": typeof functions_groupSearch;
  "functions/groups/index": typeof functions_groups_index;
  "functions/groups/internal": typeof functions_groups_internal;
  "functions/groups/members": typeof functions_groups_members;
  "functions/groups/mutations": typeof functions_groups_mutations;
  "functions/groups/queries": typeof functions_groups_queries;
  "functions/integrations": typeof functions_integrations;
  "functions/linkPreview": typeof functions_linkPreview;
  "functions/meetingRsvps": typeof functions_meetingRsvps;
  "functions/meetings/attendance": typeof functions_meetings_attendance;
  "functions/meetings/communityEvents": typeof functions_meetings_communityEvents;
  "functions/meetings/events": typeof functions_meetings_events;
  "functions/meetings/explore": typeof functions_meetings_explore;
  "functions/meetings/index": typeof functions_meetings_index;
  "functions/meetings/migrations": typeof functions_meetings_migrations;
  "functions/meetings/myEvents": typeof functions_meetings_myEvents;
  "functions/meetings/queries": typeof functions_meetings_queries;
  "functions/meetings/reports": typeof functions_meetings_reports;
  "functions/memberFollowups": typeof functions_memberFollowups;
  "functions/messaging/blocking": typeof functions_messaging_blocking;
  "functions/messaging/channelInvites": typeof functions_messaging_channelInvites;
  "functions/messaging/channels": typeof functions_messaging_channels;
  "functions/messaging/directMessages": typeof functions_messaging_directMessages;
  "functions/messaging/eventChat": typeof functions_messaging_eventChat;
  "functions/messaging/events": typeof functions_messaging_events;
  "functions/messaging/flagging": typeof functions_messaging_flagging;
  "functions/messaging/helpers": typeof functions_messaging_helpers;
  "functions/messaging/index": typeof functions_messaging_index;
  "functions/messaging/messages": typeof functions_messaging_messages;
  "functions/messaging/reachOut": typeof functions_messaging_reachOut;
  "functions/messaging/reactions": typeof functions_messaging_reactions;
  "functions/messaging/readState": typeof functions_messaging_readState;
  "functions/messaging/sharedChannels": typeof functions_messaging_sharedChannels;
  "functions/messaging/typing": typeof functions_messaging_typing;
  "functions/migrations": typeof functions_migrations;
  "functions/migrations/migrateToCommunityPeople": typeof functions_migrations_migrateToCommunityPeople;
  "functions/notifications/actions": typeof functions_notifications_actions;
  "functions/notifications/debug": typeof functions_notifications_debug;
  "functions/notifications/index": typeof functions_notifications_index;
  "functions/notifications/internal": typeof functions_notifications_internal;
  "functions/notifications/migrations": typeof functions_notifications_migrations;
  "functions/notifications/moderation": typeof functions_notifications_moderation;
  "functions/notifications/mutations": typeof functions_notifications_mutations;
  "functions/notifications/preferences": typeof functions_notifications_preferences;
  "functions/notifications/proposalNotifications": typeof functions_notifications_proposalNotifications;
  "functions/notifications/queries": typeof functions_notifications_queries;
  "functions/notifications/rollup": typeof functions_notifications_rollup;
  "functions/notifications/senders": typeof functions_notifications_senders;
  "functions/notifications/tokens": typeof functions_notifications_tokens;
  "functions/pcoServices/actions": typeof functions_pcoServices_actions;
  "functions/pcoServices/displayHelpers": typeof functions_pcoServices_displayHelpers;
  "functions/pcoServices/filterHelpers": typeof functions_pcoServices_filterHelpers;
  "functions/pcoServices/index": typeof functions_pcoServices_index;
  "functions/pcoServices/matching": typeof functions_pcoServices_matching;
  "functions/pcoServices/queries": typeof functions_pcoServices_queries;
  "functions/pcoServices/rotation": typeof functions_pcoServices_rotation;
  "functions/pcoServices/runSheet": typeof functions_pcoServices_runSheet;
  "functions/pcoServices/servingHistory": typeof functions_pcoServices_servingHistory;
  "functions/peopleSavedViews": typeof functions_peopleSavedViews;
  "functions/posters": typeof functions_posters;
  "functions/proposals": typeof functions_proposals;
  "functions/resources": typeof functions_resources;
  "functions/scheduledJobs": typeof functions_scheduledJobs;
  "functions/seed": typeof functions_seed;
  "functions/slackServiceBot/actions": typeof functions_slackServiceBot_actions;
  "functions/slackServiceBot/adminMutations": typeof functions_slackServiceBot_adminMutations;
  "functions/slackServiceBot/adminQueries": typeof functions_slackServiceBot_adminQueries;
  "functions/slackServiceBot/agent": typeof functions_slackServiceBot_agent;
  "functions/slackServiceBot/ai": typeof functions_slackServiceBot_ai;
  "functions/slackServiceBot/config": typeof functions_slackServiceBot_config;
  "functions/slackServiceBot/configDb": typeof functions_slackServiceBot_configDb;
  "functions/slackServiceBot/configHelpers": typeof functions_slackServiceBot_configHelpers;
  "functions/slackServiceBot/index": typeof functions_slackServiceBot_index;
  "functions/slackServiceBot/pcoSync": typeof functions_slackServiceBot_pcoSync;
  "functions/slackServiceBot/prompts": typeof functions_slackServiceBot_prompts;
  "functions/slackServiceBot/seedConfig": typeof functions_slackServiceBot_seedConfig;
  "functions/slackServiceBot/slack": typeof functions_slackServiceBot_slack;
  "functions/slackServiceBot/tools": typeof functions_slackServiceBot_tools;
  "functions/sync/memberships": typeof functions_sync_memberships;
  "functions/syncHelpers": typeof functions_syncHelpers;
  "functions/systemScoring": typeof functions_systemScoring;
  "functions/taskTemplates/index": typeof functions_taskTemplates_index;
  "functions/tasks/index": typeof functions_tasks_index;
  "functions/toolShortLinks/index": typeof functions_toolShortLinks_index;
  "functions/uploads": typeof functions_uploads;
  "functions/userProfiles": typeof functions_userProfiles;
  "functions/users": typeof functions_users;
  http: typeof http;
  "lib/auth": typeof lib_auth;
  "lib/ee/emailTemplates": typeof lib_ee_emailTemplates;
  "lib/email/templates/BaseLayout": typeof lib_email_templates_BaseLayout;
  "lib/email/templates/VerificationCode": typeof lib_email_templates_VerificationCode;
  "lib/followupConstants": typeof lib_followupConstants;
  "lib/helpers": typeof lib_helpers;
  "lib/meetingConfig": typeof lib_meetingConfig;
  "lib/meetingPermissions": typeof lib_meetingPermissions;
  "lib/meetingSearchText": typeof lib_meetingSearchText;
  "lib/memberSearch": typeof lib_memberSearch;
  "lib/membership": typeof lib_membership;
  "lib/notifications/definitions": typeof lib_notifications_definitions;
  "lib/notifications/emailTemplates": typeof lib_notifications_emailTemplates;
  "lib/notifications/index": typeof lib_notifications_index;
  "lib/notifications/registry": typeof lib_notifications_registry;
  "lib/notifications/send": typeof lib_notifications_send;
  "lib/notifications/types": typeof lib_notifications_types;
  "lib/pcoServicesApi": typeof lib_pcoServicesApi;
  "lib/permissions": typeof lib_permissions;
  "lib/phoneNormalize": typeof lib_phoneNormalize;
  "lib/posthog": typeof lib_posthog;
  "lib/rateLimit": typeof lib_rateLimit;
  "lib/rsvpGuests": typeof lib_rsvpGuests;
  "lib/scheduling": typeof lib_scheduling;
  "lib/slugs": typeof lib_slugs;
  "lib/twilio": typeof lib_twilio;
  "lib/utils": typeof lib_utils;
  "lib/validation": typeof lib_validation;
  "lib/validators": typeof lib_validators;
  "migrations/addChannelSlugs": typeof migrations_addChannelSlugs;
  "migrations/backfillLastActivityAt": typeof migrations_backfillLastActivityAt;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
