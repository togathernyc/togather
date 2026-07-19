import { describe, expect, test } from "vitest";
import {
  buildChannelMeta,
  buildCommunityMeta,
  buildEventMeta,
  buildGroupMeta,
  buildNearmeMeta,
  buildToolMeta,
  formatDate,
  parseLinkPreviewTarget,
} from "../functions/linkPreviewMeta";

describe("parseLinkPreviewTarget", () => {
  test("dispatches /e/:shortId to event", () => {
    expect(parseLinkPreviewTarget("https://togather.nyc/e/abc123")).toEqual({
      type: "event",
      shortId: "abc123",
    });
  });

  test("dispatches /g/:shortId to group", () => {
    expect(parseLinkPreviewTarget("https://togather.nyc/g/xYz789")).toEqual({
      type: "group",
      shortId: "xYz789",
    });
  });

  test("dispatches /t/:shortId to tool", () => {
    expect(parseLinkPreviewTarget("https://togather.nyc/t/tool1")).toEqual({
      type: "tool",
      shortId: "tool1",
    });
  });

  test("dispatches /ch/:shortId to channel", () => {
    expect(parseLinkPreviewTarget("https://togather.nyc/ch/chan1")).toEqual({
      type: "channel",
      shortId: "chan1",
    });
  });

  test("handles trailing slash on shortId routes", () => {
    expect(parseLinkPreviewTarget("https://togather.nyc/e/abc123/")).toEqual({
      type: "event",
      shortId: "abc123",
    });
  });

  test("rejects shortIds with invalid characters", () => {
    expect(parseLinkPreviewTarget("https://togather.nyc/e/abc-123")).toEqual({
      type: "unknown",
    });
  });

  test("dispatches /nearme with subdomain from hostname and type query param", () => {
    expect(
      parseLinkPreviewTarget("https://fount.togather.nyc/nearme?type=dinner-parties")
    ).toEqual({
      type: "nearme",
      subdomain: "fount",
      groupTypeSlug: "dinner-parties",
    });
  });

  test("dispatches /nearme with no group type when query param absent", () => {
    expect(parseLinkPreviewTarget("https://fount.togather.nyc/nearme")).toEqual({
      type: "nearme",
      subdomain: "fount",
      groupTypeSlug: undefined,
    });
  });

  test("/nearme with no subdomain (root domain) has null subdomain", () => {
    expect(parseLinkPreviewTarget("https://togather.nyc/nearme")).toEqual({
      type: "nearme",
      subdomain: null,
      groupTypeSlug: undefined,
    });
  });

  test("dispatches single-segment slug to community", () => {
    expect(parseLinkPreviewTarget("https://togather.nyc/fount")).toEqual({
      type: "community",
      slug: "fount",
    });
  });

  test("dispatches single-segment slug with hyphens/digits to community", () => {
    expect(parseLinkPreviewTarget("https://togather.nyc/first-baptist-2")).toEqual({
      type: "community",
      slug: "first-baptist-2",
    });
  });

  test("rejects slug starting with a hyphen or digit-only invalid leading char", () => {
    // Leading char must be [a-z0-9] - a leading hyphen is invalid per the slug regex.
    expect(parseLinkPreviewTarget("https://togather.nyc/-fount")).toEqual({
      type: "unknown",
    });
  });

  test("rejects uppercase single-segment paths (not a valid slug)", () => {
    expect(parseLinkPreviewTarget("https://togather.nyc/Fount")).toEqual({
      type: "unknown",
    });
  });

  test("multi-segment unknown paths return unknown", () => {
    expect(parseLinkPreviewTarget("https://togather.nyc/some/other/path")).toEqual({
      type: "unknown",
    });
  });

  test("root path returns unknown", () => {
    expect(parseLinkPreviewTarget("https://togather.nyc/")).toEqual({
      type: "unknown",
    });
  });

  test("malformed url returns unknown instead of throwing", () => {
    expect(parseLinkPreviewTarget("not-a-url")).toEqual({ type: "unknown" });
  });

  test("a percent-encoded reserved char in the query string survives a single decode", () => {
    // The worker single-encodes the target URL when building `?url=...` for
    // http.ts, and `url.searchParams.get("url")` in http.ts decodes it back
    // exactly once. A `%26` in the *target's* query string (a literal "&" in
    // `type=r&b`) must come through as-is here, not be decoded a second time
    // (which would split the query string into `type=r` and a bogus `b` param).
    expect(
      parseLinkPreviewTarget("https://fount.togather.nyc/nearme?type=r%26b")
    ).toEqual({
      type: "nearme",
      subdomain: "fount",
      groupTypeSlug: "r&b",
    });
  });
});

describe("formatDate", () => {
  test("returns empty string for missing date", () => {
    expect(formatDate(null, "America/New_York")).toBe("");
    expect(formatDate(undefined, "America/New_York")).toBe("");
  });

  test("formats a known UTC instant in the given IANA timezone", () => {
    // 2026-01-15T19:00:00Z is 2:00 PM EST (America/New_York, UTC-5 in January).
    const result = formatDate("2026-01-15T19:00:00.000Z", "America/New_York");
    expect(result).toBe("Thursday, January 15, 2026 at 2:00 PM EST");
  });

  test("falls back to America/New_York when timezone is missing", () => {
    const result = formatDate("2026-01-15T19:00:00.000Z", null);
    expect(result).toBe("Thursday, January 15, 2026 at 2:00 PM EST");
  });

  test("falls back to America/New_York when timezone is malformed", () => {
    const result = formatDate("2026-01-15T19:00:00.000Z", "Eastern Time (US & Canada)");
    expect(result).toBe("Thursday, January 15, 2026 at 2:00 PM EST");
  });

  test("respects a different valid IANA timezone", () => {
    // 2026-01-15T19:00:00Z is 11:00 AM PST (America/Los_Angeles, UTC-8 in January).
    const result = formatDate("2026-01-15T19:00:00.000Z", "America/Los_Angeles");
    expect(result).toBe("Thursday, January 15, 2026 at 11:00 AM PST");
  });
});

describe("buildEventMeta", () => {
  const opts = { shortId: "abc123", origin: "https://togather.nyc" };

  test("applies the full image fallback chain: cover -> group -> community logo", () => {
    const noCover = buildEventMeta(
      {
        title: "Weekly Meetup",
        communityName: "Demo Community",
        groupImage: "https://img/group.jpg",
        communityLogo: "https://img/logo.jpg",
      },
      opts
    );
    expect(noCover.image).toBe("https://img/group.jpg");

    const onlyLogo = buildEventMeta(
      { title: "Weekly Meetup", communityLogo: "https://img/logo.jpg" },
      opts
    );
    expect(onlyLogo.image).toBe("https://img/logo.jpg");

    const noImages = buildEventMeta({ title: "Weekly Meetup" }, opts);
    expect(noImages.image).toBeNull();

    const withCover = buildEventMeta(
      {
        title: "Weekly Meetup",
        coverImage: "https://img/cover.jpg",
        groupImage: "https://img/group.jpg",
        communityLogo: "https://img/logo.jpg",
      },
      opts
    );
    expect(withCover.image).toBe("https://img/cover.jpg");
  });

  test("builds title with RSVP prefix and community suffix", () => {
    const meta = buildEventMeta(
      { title: "Weekly Meetup", communityName: "Demo Community" },
      opts
    );
    expect(meta.title).toBe("RSVP to Weekly Meetup | Demo Community");
  });

  test("falls back to Togather brand name when community is missing", () => {
    const meta = buildEventMeta({ title: "Weekly Meetup" }, opts);
    expect(meta.title).toBe("RSVP to Weekly Meetup | Togather");
    expect(meta.siteName).toBe("Togather");
  });

  test("assembles rich description from date, location, and note", () => {
    const meta = buildEventMeta(
      {
        title: "Weekly Meetup",
        scheduledAt: "2026-01-15T19:00:00.000Z",
        timezone: "America/New_York",
        locationOverride: "123 Main St",
        note: "Bring a friend!",
      },
      opts
    );
    expect(meta.description).toBe(
      "Thursday, January 15, 2026 at 2:00 PM EST - 123 Main St\n\nBring a friend!"
    );
  });

  test("falls back to a generic join message when nothing else is available", () => {
    const meta = buildEventMeta({ title: "Weekly Meetup", groupName: "Tech Enthusiasts" }, opts);
    expect(meta.description).toBe("Join Tech Enthusiasts for this event");
  });

  test("truncates description to 300 characters", () => {
    const meta = buildEventMeta(
      { title: "Weekly Meetup", note: "x".repeat(500) },
      opts
    );
    expect(meta.description.length).toBeLessThanOrEqual(300);
  });

  test("builds the canonical event url from origin + shortId", () => {
    const meta = buildEventMeta({ title: "Weekly Meetup" }, opts);
    expect(meta.url).toBe("https://togather.nyc/e/abc123");
  });

  test("sets imageAlt to the event title", () => {
    const meta = buildEventMeta({ title: "Weekly Meetup" }, opts);
    expect(meta.imageAlt).toBe("Weekly Meetup");
  });
});

describe("buildGroupMeta", () => {
  const opts = { shortId: "g1", origin: "https://togather.nyc" };

  test("image fallback: preview -> community logo -> null", () => {
    expect(
      buildGroupMeta({ name: "Group", preview: "https://img/p.jpg" }, opts).image
    ).toBe("https://img/p.jpg");
    expect(
      buildGroupMeta({ name: "Group", communityLogo: "https://img/logo.jpg" }, opts).image
    ).toBe("https://img/logo.jpg");
    expect(buildGroupMeta({ name: "Group" }, opts).image).toBeNull();
  });

  test("assembles description from type, location, members, and description", () => {
    const meta = buildGroupMeta(
      {
        name: "Tech Enthusiasts",
        groupTypeName: "Dinner Party",
        city: "New York",
        state: "NY",
        memberCount: 12,
        description: "We meet weekly.",
      },
      opts
    );
    expect(meta.description).toBe(
      "Dinner Party - New York, NY - 12 members\n\nWe meet weekly."
    );
  });

  test("builds title with Join prefix and community suffix", () => {
    const meta = buildGroupMeta({ name: "Tech Enthusiasts", communityName: "Demo Community" }, opts);
    expect(meta.title).toBe("Join Tech Enthusiasts | Demo Community");
  });

  test("builds the canonical group url", () => {
    expect(buildGroupMeta({ name: "Group" }, opts).url).toBe("https://togather.nyc/g/g1");
  });
});

describe("buildToolMeta", () => {
  const opts = { shortId: "t1", origin: "https://togather.nyc" };

  test("runsheet tool builds run-sheet title and falls back through group image", () => {
    const meta = buildToolMeta(
      {
        toolType: "runsheet",
        groupName: "Production Team",
        communityName: "Demo Community",
        groupImage: "https://img/group.jpg",
      },
      opts
    );
    expect(meta.title).toBe("Production Team - Run Sheet | Demo Community");
    expect(meta.description).toBe("View the run sheet for Production Team");
    expect(meta.image).toBe("https://img/group.jpg");
  });

  test("resource tool prefers resource image over group image over community logo", () => {
    const meta = buildToolMeta(
      {
        toolType: "resource",
        groupName: "Production Team",
        resourceTitle: "Sound Check Guide",
        resourceImage: "https://img/resource.jpg",
        groupImage: "https://img/group.jpg",
        communityLogo: "https://img/logo.jpg",
      },
      opts
    );
    expect(meta.title).toBe("Production Team - Sound Check Guide | Togather");
    expect(meta.image).toBe("https://img/resource.jpg");
  });

  test("unknown tool type falls back to generic tool title", () => {
    const meta = buildToolMeta({ groupName: "Production Team" }, opts);
    expect(meta.title).toBe("Production Team - Tool | Togather");
  });
});

describe("buildChannelMeta", () => {
  const opts = { shortId: "c1", origin: "https://togather.nyc" };

  test("builds join title and uses custom channel description when present", () => {
    const meta = buildChannelMeta(
      {
        channelName: "prayer-requests",
        groupName: "Small Group",
        communityName: "Demo Community",
        channelDescription: "Share and pray together.",
        groupImage: "https://img/group.jpg",
      },
      opts
    );
    expect(meta.title).toBe("Join #prayer-requests in Small Group | Demo Community");
    expect(meta.description).toBe("Share and pray together.");
    expect(meta.image).toBe("https://img/group.jpg");
  });

  test("falls back to a generated description when channelDescription is absent", () => {
    const meta = buildChannelMeta(
      { channelName: "general", groupName: "Small Group", communityName: "Demo Community" },
      opts
    );
    expect(meta.description).toBe(
      "Join the #general channel in Small Group on Demo Community"
    );
  });

  test("image fallback: group image -> community logo -> null", () => {
    expect(
      buildChannelMeta({ communityLogo: "https://img/logo.jpg" }, opts).image
    ).toBe("https://img/logo.jpg");
    expect(buildChannelMeta({}, opts).image).toBeNull();
  });
});

describe("buildNearmeMeta", () => {
  test("includes group type name in title/description when present", () => {
    const meta = buildNearmeMeta(
      {
        community: { name: "Demo Community", logo: "https://img/logo.jpg" },
        groupType: { name: "Dinner Party" },
      },
      { canonicalUrl: "https://fount.togather.nyc/nearme?type=dinner-parties" }
    );
    expect(meta.title).toBe("Find a Dinner Party Near You | Demo Community");
    expect(meta.description).toBe("Discover Dinner Party groups in Demo Community");
    expect(meta.image).toBe("https://img/logo.jpg");
    expect(meta.url).toBe("https://fount.togather.nyc/nearme?type=dinner-parties");
  });

  test("falls back to generic group copy when no group type given", () => {
    const meta = buildNearmeMeta(
      { community: { name: "Demo Community" }, groupType: null },
      { canonicalUrl: "https://fount.togather.nyc/nearme" }
    );
    expect(meta.title).toBe("Find a Group Near You | Demo Community");
    expect(meta.description).toBe("Discover groups near you in Demo Community");
    expect(meta.image).toBeNull();
  });

  test("the canonical url is the request url as-is (no /c/ rewrite)", () => {
    const meta = buildNearmeMeta(
      { community: { name: "Demo Community" }, groupType: null },
      { canonicalUrl: "https://fount.togather.nyc/nearme" }
    );
    expect(meta.url).toBe("https://fount.togather.nyc/nearme");
  });
});

describe("buildCommunityMeta", () => {
  test("canonicalizes the bare slug path to /c/:slug", () => {
    const meta = buildCommunityMeta(
      { community: { name: "The Fount", logo: "https://img/logo.jpg" } },
      { slug: "fount", origin: "https://togather.nyc" }
    );
    expect(meta.url).toBe("https://togather.nyc/c/fount");
  });

  test("builds title and description around the community name", () => {
    const meta = buildCommunityMeta(
      { community: { name: "The Fount" } },
      { slug: "fount", origin: "https://togather.nyc" }
    );
    expect(meta.title).toBe("The Fount | Togather");
    expect(meta.description).toBe("Join The Fount on Togather");
    expect(meta.siteName).toBe("The Fount");
  });

  test("falls back to generic community name when missing", () => {
    const meta = buildCommunityMeta(
      { community: {} },
      { slug: "fount", origin: "https://togather.nyc" }
    );
    expect(meta.title).toBe("Community | Togather");
  });
});
