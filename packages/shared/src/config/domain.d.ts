/**
 * Type declarations for domain.js
 */

export const BASE_DOMAIN: string;
export const BRAND_NAME: string;

export const DOMAIN_CONFIG: {
  readonly baseDomain: string;
  readonly brandName: string;
  readonly appUrl: string;
  readonly landingUrl: string;
  readonly emailDomain: string;
  readonly emailFrom: string;
  readonly domainSuffix: string;
  readonly legacyDomain: string;
  eventShareUrl(shortId: string): string;
  groupShareUrl(shortId: string): string;
  communityUrl(subdomain: string): string;
  attendanceConfirmationUrl(token: string): string;
  communityLandingUrl(slug: string): string;
  eventLinkRegex(): RegExp;
  eventLinkRegexSingle(): RegExp;
  groupLinkRegex(): RegExp;
  groupLinkRegexSingle(): RegExp;
  taskShareUrl(shortId: string): string;
  resourceShareUrl(shortId: string): string;
  readonly convexDeployment: string;
  readonly convexHttpUrl: string | null;
  toolShareUrl(shortId: string): string;
  toolLinkRegex(): RegExp;
  toolLinkRegexSingle(): RegExp;
  taskLinkRegex(): RegExp;
  taskLinkRegexSingle(): RegExp;
};
