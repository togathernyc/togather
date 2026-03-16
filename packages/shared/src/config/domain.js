/**
 * Centralized domain configuration for Togather.
 *
 * This is the SINGLE SOURCE OF TRUTH for domain configuration.
 * To change the app's domain, update BASE_DOMAIN below.
 *
 * Usage:
 * - TypeScript: import { DOMAIN_CONFIG } from '@togather/shared';
 * - JavaScript: const { DOMAIN_CONFIG } = require('@togather/shared/src/config/domain.js');
 *
 * When changing domains, also update these files that require static values:
 * - apps/link-preview/wrangler.toml (Cloudflare route patterns)
 *
 * Documentation files with examples (optional, for accuracy):
 * - README files, .env.example files, docs/*
 */

// ============================================================
// CHANGE THIS VALUE TO UPDATE THE DOMAIN ACROSS THE ENTIRE APP
// ============================================================
const BASE_DOMAIN = "togather.nyc";
// ============================================================

// ============================================================
// CONVEX DEPLOYMENT CONFIGURATION
// Set this to your Convex deployment name from the dashboard
// ============================================================
const CONVEX_DEPLOYMENT = process.env.CONVEX_DEPLOYMENT || "";
// ============================================================

const BRAND_NAME = "Togather";

// Escape domain for use in regex patterns
const ESCAPED_DOMAIN = BASE_DOMAIN.replace(/\./g, '\\.');

// Legacy domain (gatherful.app) for backwards compatibility
const LEGACY_DOMAIN = "gatherful.app";
const ESCAPED_LEGACY_DOMAIN = LEGACY_DOMAIN.replace(/\./g, '\\.');

// Combined pattern that matches both current and legacy domains (with optional app. subdomain)
const COMBINED_DOMAIN_PATTERN = `(?:(?:app\\.)?${ESCAPED_DOMAIN}|(?:app\\.)?${ESCAPED_LEGACY_DOMAIN})`;

const DOMAIN_CONFIG = {
  baseDomain: BASE_DOMAIN,
  brandName: BRAND_NAME,
  landingUrl: `https://${BASE_DOMAIN}`,
  appUrl: `https://${BASE_DOMAIN}`,
  emailDomain: BASE_DOMAIN,
  emailFrom: `${BRAND_NAME} <notifications@${BASE_DOMAIN}>`,
  eventShareUrl: (shortId) => `https://${BASE_DOMAIN}/e/${shortId}`,
  groupShareUrl: (shortId) => `https://${BASE_DOMAIN}/g/${shortId}`,
  communityUrl: (subdomain) => `https://${subdomain}.${BASE_DOMAIN}`,
  attendanceConfirmationUrl: (token) => `https://${BASE_DOMAIN}/confirm-attendance?token=${token}`,
  // Regex helpers for detecting event links in text (matches both togather.nyc and gatherful.app)
  eventLinkRegex: () => new RegExp(`(?:https?:\\/\\/)?${COMBINED_DOMAIN_PATTERN}\\/e\\/([a-zA-Z0-9]+)`, 'g'),
  eventLinkRegexSingle: () => new RegExp(`(?:https?:\\/\\/)?${COMBINED_DOMAIN_PATTERN}\\/e\\/([a-zA-Z0-9]+)`),
  // Regex helpers for detecting group links in text
  groupLinkRegex: () => new RegExp(`(?:https?:\\/\\/)?${COMBINED_DOMAIN_PATTERN}\\/g\\/([a-zA-Z0-9]+)`, 'g'),
  groupLinkRegexSingle: () => new RegExp(`(?:https?:\\/\\/)?${COMBINED_DOMAIN_PATTERN}\\/g\\/([a-zA-Z0-9]+)`),
  // Tool share URLs (Run Sheet, Resources)
  taskShareUrl: (shortId) => `https://${BASE_DOMAIN}/t/${shortId}`,
  // Resource/tool share URLs (Run Sheet, Resources) - canonical path
  resourceShareUrl: (shortId) => `https://${BASE_DOMAIN}/r/${shortId}`,
  // Backwards-compatible alias retained for existing callers
  toolShareUrl: (shortId) => `https://${BASE_DOMAIN}/r/${shortId}`,
  // Regex helpers for detecting canonical tool/resource links in text
  toolLinkRegex: () => new RegExp(`(?:https?:\\/\\/)?${COMBINED_DOMAIN_PATTERN}\\/r\\/([a-zA-Z0-9]+)`, 'g'),
  toolLinkRegexSingle: () => new RegExp(`(?:https?:\\/\\/)?${COMBINED_DOMAIN_PATTERN}\\/r\\/([a-zA-Z0-9]+)`),
  // Regex helpers for detecting task links in text
  taskLinkRegex: () => new RegExp(`(?:https?:\\/\\/)?${COMBINED_DOMAIN_PATTERN}\\/t\\/([a-zA-Z0-9]+)`, 'g'),
  taskLinkRegexSingle: () => new RegExp(`(?:https?:\\/\\/)?${COMBINED_DOMAIN_PATTERN}\\/t\\/([a-zA-Z0-9]+)`),
  // Community landing page URL
  communityLandingUrl: (slug) => `https://${BASE_DOMAIN}/c/${slug}`,
  // Domain suffix for subdomain parsing (with leading dot)
  domainSuffix: `.${BASE_DOMAIN}`,
  // Legacy domain for reference
  legacyDomain: LEGACY_DOMAIN,
  // Convex configuration
  convexDeployment: CONVEX_DEPLOYMENT,
  convexHttpUrl: CONVEX_DEPLOYMENT ? `https://${CONVEX_DEPLOYMENT}.convex.site` : null,
};

module.exports = { BASE_DOMAIN, BRAND_NAME, DOMAIN_CONFIG };
