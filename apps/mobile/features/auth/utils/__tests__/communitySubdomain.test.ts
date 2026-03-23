import { DOMAIN_CONFIG } from "@togather/shared";
import {
  parseSubdomainFromHostname,
  parseSubdomainFromLinkUrl,
} from "../communitySubdomain";

describe("parseSubdomainFromHostname", () => {
  it("extracts subdomain from production host", () => {
    expect(parseSubdomainFromHostname(`fount${DOMAIN_CONFIG.domainSuffix}`)).toBe(
      "fount"
    );
  });

  it("returns null for apex domain", () => {
    expect(parseSubdomainFromHostname(DOMAIN_CONFIG.baseDomain)).toBeNull();
  });

  it("returns null for reserved subdomains", () => {
    expect(parseSubdomainFromHostname(`www${DOMAIN_CONFIG.domainSuffix}`)).toBeNull();
  });

  it("parses localhost-style dev host", () => {
    expect(parseSubdomainFromHostname("fount.localhost")).toBe("fount");
  });
});

describe("parseSubdomainFromLinkUrl", () => {
  it("parses full https universal link", () => {
    expect(
      parseSubdomainFromLinkUrl(
        `https://fount.${DOMAIN_CONFIG.baseDomain}/nearme?type=dinner_parties`
      )
    ).toBe("fount");
  });

  it("returns null for invalid URL", () => {
    expect(parseSubdomainFromLinkUrl("not a url")).toBeNull();
  });

  it("returns null for null", () => {
    expect(parseSubdomainFromLinkUrl(null)).toBeNull();
  });
});
