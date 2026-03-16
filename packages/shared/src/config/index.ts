// Config exports
// Using require + re-export pattern for CommonJS module
const domain = require("./domain.js");
export const BASE_DOMAIN: string = domain.BASE_DOMAIN;
export const BRAND_NAME: string = domain.BRAND_NAME;

// Type definition for DOMAIN_CONFIG (must match domain.js)
export interface DomainConfig {
  readonly baseDomain: string;
  readonly brandName: string;
  readonly landingUrl: string;
  readonly appUrl: string;
  readonly emailDomain: string;
  readonly emailFrom: string;
  readonly domainSuffix: string;
  readonly legacyDomain: string;
  readonly convexDeployment: string;
  readonly convexHttpUrl: string | null;
  eventShareUrl(shortId: string): string;
  groupShareUrl(shortId: string): string;
  communityUrl(subdomain: string): string;
  communityLandingUrl(slug: string): string;
  attendanceConfirmationUrl(token: string): string;
  eventLinkRegex(): RegExp;
  eventLinkRegexSingle(): RegExp;
  groupLinkRegex(): RegExp;
  groupLinkRegexSingle(): RegExp;
  taskShareUrl(shortId: string): string;
  resourceShareUrl(shortId: string): string;
  toolShareUrl(shortId: string): string;
  toolLinkRegex(): RegExp;
  toolLinkRegexSingle(): RegExp;
  taskLinkRegex(): RegExp;
  taskLinkRegexSingle(): RegExp;
}

export const DOMAIN_CONFIG: DomainConfig = domain.DOMAIN_CONFIG;
