import test from "node:test";
import assert from "node:assert/strict";

import worker from "./cloudflare-worker.js";

// Expected origin URLs from the worker
const APP_ORIGIN_URL = "https://togather.expo.app";
const LANDING_PAGE_URL = "https://togather-landing.pages.dev";

test("bot /e/:shortId fetches from Convex and returns OG tags", async () => {
  const calls = [];

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input.url;
    calls.push({ url, init });

    // Convex backend fetch for event data
    if (url.startsWith("https://example.convex.site/link-preview/event")) {
      return new Response(
        JSON.stringify({
          id: "meeting_123",
          shortId: "abc123",
          title: "My Event Name",
          scheduledAt: "2026-01-14T19:00:00.000Z",
          status: "scheduled",
          coverImage: "https://cdn.example.com/event.jpg",
          groupName: "My Group",
          groupImage: "https://cdn.example.com/group.jpg",
          communityName: "My Community",
          communityLogo: "https://cdn.example.com/community.jpg",
          locationOverride: "123 Main St",
          note: null,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }

    // Fallback - should not be reached in this test
    return new Response("unexpected fetch", { status: 500 });
  };

  try {
    const req = new Request("https://togather.nyc/e/abc123", {
      headers: { "User-Agent": "Twitterbot" },
    });

    const res = await worker.fetch(req, {
      CONVEX_SITE_URL: "https://example.convex.site",
    });

    assert.equal(res.status, 200);
    assert.equal(res.headers.get("Content-Type"), "text/html; charset=utf-8");

    const html = await res.text();
    assert.match(html, /property="og:title"/);
    assert.match(html, /RSVP to My Event Name/);
    assert.match(html, /property="og:image"/);
    assert.match(html, /https:\/\/cdn\.example\.com\/event\.jpg/);

    assert.ok(
      calls.some((c) =>
        c.url === "https://example.convex.site/link-preview/event?shortId=abc123"
      ),
      "expected a Convex link-preview fetch"
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("non-bot /e/:shortId passes through to EAS Hosting (app)", async () => {
  const calls = [];

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input.url;
    calls.push({ url, init });
    return new Response("app content", { status: 200, headers: { "Content-Type": "text/html" } });
  };

  try {
    const req = new Request("https://togather.nyc/e/abc123", {
      headers: { "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X)" },
    });

    const res = await worker.fetch(req, {
      CONVEX_SITE_URL: "https://example.convex.site",
    });

    assert.equal(res.status, 200);
    assert.equal(await res.text(), "app content");

    // Should pass through to EAS Hosting origin
    assert.equal(calls.length, 1);
    assert.ok(
      calls[0].url.startsWith(APP_ORIGIN_URL),
      `expected fetch to ${APP_ORIGIN_URL}, got ${calls[0].url}`
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("root path (/) for humans passes through to landing page", async () => {
  const calls = [];

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input.url;
    calls.push({ url, init });
    return new Response("landing page", { status: 200, headers: { "Content-Type": "text/html" } });
  };

  try {
    const req = new Request("https://togather.nyc/", {
      headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)" },
    });

    const res = await worker.fetch(req, {
      CONVEX_SITE_URL: "https://example.convex.site",
    });

    assert.equal(res.status, 200);
    assert.equal(await res.text(), "landing page");

    // Should pass through to landing page
    assert.equal(calls.length, 1);
    assert.ok(
      calls[0].url.startsWith(LANDING_PAGE_URL),
      `expected fetch to ${LANDING_PAGE_URL}, got ${calls[0].url}`
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("root path (/) for bots returns OG tags HTML", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    return new Response("should not be called", { status: 500 });
  };

  try {
    const req = new Request("https://togather.nyc/", {
      headers: { "User-Agent": "facebookexternalhit/1.1" },
    });

    const res = await worker.fetch(req, {
      CONVEX_SITE_URL: "https://example.convex.site",
    });

    assert.equal(res.status, 200);
    assert.equal(res.headers.get("Content-Type"), "text/html; charset=utf-8");

    const html = await res.text();
    assert.match(html, /property="og:title"/);
    assert.match(html, /Togather/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("static assets (css, js) pass through to landing page", async () => {
  const calls = [];

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input.url;
    calls.push({ url, init });
    return new Response("body { color: red; }", {
      status: 200,
      headers: { "Content-Type": "text/css" }
    });
  };

  try {
    const req = new Request("https://togather.nyc/styles.css", {
      headers: { "User-Agent": "Mozilla/5.0" },
    });

    const res = await worker.fetch(req, {
      CONVEX_SITE_URL: "https://example.convex.site",
    });

    assert.equal(res.status, 200);

    // Should pass through to landing page for root-level static assets
    assert.equal(calls.length, 1);
    assert.ok(
      calls[0].url.startsWith(LANDING_PAGE_URL),
      `expected fetch to ${LANDING_PAGE_URL}, got ${calls[0].url}`
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("/_expo/ assets pass through to EAS Hosting (app)", async () => {
  const calls = [];

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input.url;
    calls.push({ url, init });
    return new Response("expo asset", { status: 200 });
  };

  try {
    const req = new Request("https://togather.nyc/_expo/static/js/bundle.js", {
      headers: { "User-Agent": "Mozilla/5.0" },
    });

    const res = await worker.fetch(req, {
      CONVEX_SITE_URL: "https://example.convex.site",
    });

    assert.equal(res.status, 200);

    // Should pass through to EAS Hosting for Expo assets
    assert.equal(calls.length, 1);
    assert.ok(
      calls[0].url.startsWith(APP_ORIGIN_URL),
      `expected fetch to ${APP_ORIGIN_URL}, got ${calls[0].url}`
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("/assets/__node_modules/ (Expo bundled assets) pass through to EAS Hosting (app)", async () => {
  const calls = [];

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input.url;
    calls.push({ url, init });
    return new Response("font data", { status: 200, headers: { "Content-Type": "font/ttf" } });
  };

  try {
    const req = new Request("https://togather.nyc/assets/__node_modules/.pnpm/@expo+vector-icons/Ionicons.ttf", {
      headers: { "User-Agent": "Mozilla/5.0" },
    });

    const res = await worker.fetch(req, {
      CONVEX_SITE_URL: "https://example.convex.site",
    });

    assert.equal(res.status, 200);

    // Should pass through to EAS Hosting for Expo bundled assets (not landing page)
    assert.equal(calls.length, 1);
    assert.ok(
      calls[0].url.startsWith(APP_ORIGIN_URL),
      `expected fetch to ${APP_ORIGIN_URL}, got ${calls[0].url}`
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// Universal Links / App Links tests
test("/.well-known/apple-app-site-association returns correct JSON for production domain", async () => {
  const req = new Request("https://togather.nyc/.well-known/apple-app-site-association");
  const res = await worker.fetch(req, {});

  assert.equal(res.status, 200);
  assert.equal(res.headers.get("Content-Type"), "application/json");

  const json = await res.json();
  assert.ok(json.applinks, "should have applinks");
  assert.ok(Array.isArray(json.applinks.details), "applinks.details should be an array");

  // Production domain should include production app (components format uses appIDs array)
  const appIDs = json.applinks.details.flatMap(d => d.appIDs);
  assert.ok(appIDs.some(id => id.includes("app.gatherful.mobile")), "should include production bundle ID");

  // Check components use exclusion for landing pages and wildcard for app routes
  const components = json.applinks.details[0].components;
  assert.ok(Array.isArray(components), "details[0].components should be an array");
  assert.ok(components.some(c => c["/"] === "*" && !c.exclude), "should include wildcard match for app routes");
  assert.ok(components.some(c => c["/"] === "/" && c.exclude === true), "should exclude root landing page");
  assert.ok(components.some(c => c["/"] === "/android" && c.exclude === true), "should exclude Android download page");
});

test("/.well-known/apple-app-site-association returns correct JSON for staging domain", async () => {
  const req = new Request("https://staging.togather.nyc/.well-known/apple-app-site-association");
  const res = await worker.fetch(req, {});

  assert.equal(res.status, 200);
  assert.equal(res.headers.get("Content-Type"), "application/json");

  const json = await res.json();
  assert.ok(json.applinks, "should have applinks");

  // Staging domain should only include staging app
  const appIDs = json.applinks.details.flatMap(d => d.appIDs);
  assert.ok(appIDs.some(id => id.includes("life.togather.staging")), "should include staging bundle ID");
  assert.ok(!appIDs.some(id => id.includes("app.gatherful.mobile")), "should NOT include production bundle ID");
});

test("/.well-known/assetlinks.json returns correct JSON for production domain", async () => {
  const req = new Request("https://togather.nyc/.well-known/assetlinks.json");
  const res = await worker.fetch(req, {});

  assert.equal(res.status, 200);
  assert.equal(res.headers.get("Content-Type"), "application/json");

  const json = await res.json();
  assert.ok(Array.isArray(json), "should be an array");
  assert.ok(json.length > 0, "should have at least one entry");

  // Production domain should include production app
  const packageNames = json.map(entry => entry.target.package_name);
  assert.ok(packageNames.includes("app.gatherful.mobile"), "should include production package name");

  // Check relation
  assert.ok(
    json[0].relation.includes("delegate_permission/common.handle_all_urls"),
    "should have handle_all_urls permission"
  );
});

test("/.well-known/assetlinks.json returns correct JSON for staging domain", async () => {
  const req = new Request("https://staging.togather.nyc/.well-known/assetlinks.json");
  const res = await worker.fetch(req, {});

  assert.equal(res.status, 200);
  assert.equal(res.headers.get("Content-Type"), "application/json");

  const json = await res.json();
  assert.ok(Array.isArray(json), "should be an array");

  // Staging domain should only include staging app
  const packageNames = json.map(entry => entry.target.package_name);
  assert.ok(packageNames.includes("life.togather.staging"), "should include staging package name");
  assert.ok(!packageNames.includes("app.gatherful.mobile"), "should NOT include production package name");
});

test("staging.togather.nyc/android rewrites to /android-staging landing page", async () => {
  const calls = [];

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input.url;
    calls.push({ url, init });
    return new Response("staging download page", { status: 200, headers: { "Content-Type": "text/html" } });
  };

  try {
    const req = new Request("https://staging.togather.nyc/android", {
      headers: { "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X)" },
    });

    const res = await worker.fetch(req, {});

    assert.equal(res.status, 200);

    // Should rewrite /android to /android-staging for staging domain
    assert.equal(calls.length, 1);
    assert.ok(
      calls[0].url.includes("/android-staging"),
      `expected fetch to include /android-staging, got ${calls[0].url}`
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("staging.togather.nyc/android/ (with trailing slash) rewrites to /android-staging", async () => {
  const calls = [];

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input.url;
    calls.push({ url, init });
    return new Response("staging download page", { status: 200, headers: { "Content-Type": "text/html" } });
  };

  try {
    const req = new Request("https://staging.togather.nyc/android/", {
      headers: { "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X)" },
    });

    const res = await worker.fetch(req, {});

    assert.equal(res.status, 200);

    // Should rewrite /android/ to /android-staging for staging domain
    assert.equal(calls.length, 1);
    assert.ok(
      calls[0].url.includes("/android-staging"),
      `expected fetch to include /android-staging, got ${calls[0].url}`
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("togather.nyc/android goes to /android landing page (not rewritten)", async () => {
  const calls = [];

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input.url;
    calls.push({ url, init });
    return new Response("production download page", { status: 200, headers: { "Content-Type": "text/html" } });
  };

  try {
    const req = new Request("https://togather.nyc/android", {
      headers: { "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X)" },
    });

    const res = await worker.fetch(req, {});

    assert.equal(res.status, 200);

    // Should NOT rewrite /android for production domain
    assert.equal(calls.length, 1);
    assert.ok(
      calls[0].url.includes("/android") && !calls[0].url.includes("/android-staging"),
      `expected fetch to /android (not /android-staging), got ${calls[0].url}`
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("image CDN domain returns 502 (should be handled by R2)", async () => {
  const req = new Request("https://images.togather.nyc/some/path/file.jpg");
  const res = await worker.fetch(req, { IMAGE_CDN_HOSTNAME: "images.togather.nyc" });

  assert.equal(res.status, 502);
  assert.ok((await res.text()).includes("R2 storage domain"), "should indicate R2 domain");
});

test("/legal/privacy passes through to landing page", async () => {
  const calls = [];

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input.url;
    calls.push({ url, init });
    return new Response("privacy policy content", { status: 200, headers: { "Content-Type": "text/html" } });
  };

  try {
    const req = new Request("https://togather.nyc/legal/privacy", {
      headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)" },
    });

    const res = await worker.fetch(req, {});

    assert.equal(res.status, 200);

    // Should pass through to landing page (not app)
    assert.equal(calls.length, 1);
    assert.ok(
      calls[0].url.startsWith(LANDING_PAGE_URL),
      `expected fetch to ${LANDING_PAGE_URL}, got ${calls[0].url}`
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("/legal/terms passes through to landing page", async () => {
  const calls = [];

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input.url;
    calls.push({ url, init });
    return new Response("terms of service content", { status: 200, headers: { "Content-Type": "text/html" } });
  };

  try {
    const req = new Request("https://togather.nyc/legal/terms", {
      headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)" },
    });

    const res = await worker.fetch(req, {});

    assert.equal(res.status, 200);

    // Should pass through to landing page (not app)
    assert.equal(calls.length, 1);
    assert.ok(
      calls[0].url.startsWith(LANDING_PAGE_URL),
      `expected fetch to ${LANDING_PAGE_URL}, got ${calls[0].url}`
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// Channel invite link preview tests (/ch/:shortId)
test("bot /ch/:shortId fetches from Convex and returns OG tags", async () => {
  const calls = [];

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input.url;
    calls.push({ url, init });

    // Convex backend fetch for channel data
    if (url.startsWith("https://example.convex.site/link-preview/channel")) {
      return new Response(
        JSON.stringify({
          channelName: "worship-team",
          channelDescription: "Coordinate worship sets and rehearsals",
          groupName: "Sunday Service",
          groupImage: "https://cdn.example.com/group.jpg",
          communityName: "My Community",
          communityLogo: "https://cdn.example.com/community.jpg",
          memberCount: 12,
          joinMode: "open",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }

    // Fallback - should not be reached in this test
    return new Response("unexpected fetch", { status: 500 });
  };

  try {
    const req = new Request("https://togather.nyc/ch/xyz789", {
      headers: { "User-Agent": "Twitterbot" },
    });

    const res = await worker.fetch(req, {
      CONVEX_SITE_URL: "https://example.convex.site",
    });

    assert.equal(res.status, 200);
    assert.equal(res.headers.get("Content-Type"), "text/html; charset=utf-8");

    const html = await res.text();
    assert.match(html, /property="og:title"/);
    assert.match(html, /Join #worship-team in Sunday Service/);
    assert.match(html, /property="og:description"/);
    assert.match(html, /Coordinate worship sets and rehearsals/);
    assert.match(html, /property="og:image"/);
    assert.match(html, /https:\/\/cdn\.example\.com\/group\.jpg/);
    assert.match(html, /12 members/);

    assert.ok(
      calls.some((c) =>
        c.url === "https://example.convex.site/link-preview/channel?shortId=xyz789"
      ),
      "expected a Convex link-preview fetch"
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("bot /ch/:shortId returns error HTML when channel not found", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = typeof input === "string" ? input : input.url;

    // Convex backend returns 404
    if (url.startsWith("https://example.convex.site/link-preview/channel")) {
      return new Response(
        JSON.stringify({ error: "Channel not found" }),
        { status: 404, headers: { "Content-Type": "application/json" } }
      );
    }

    return new Response("unexpected fetch", { status: 500 });
  };

  try {
    const req = new Request("https://togather.nyc/ch/notfound", {
      headers: { "User-Agent": "Slackbot" },
    });

    const res = await worker.fetch(req, {
      CONVEX_SITE_URL: "https://example.convex.site",
    });

    assert.equal(res.status, 200);
    assert.equal(res.headers.get("Content-Type"), "text/html; charset=utf-8");

    const html = await res.text();
    assert.match(html, /Channel \| Togather/);
    assert.match(html, /Join this channel on Togather/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("non-bot /ch/:shortId passes through to EAS Hosting (app)", async () => {
  const calls = [];

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input.url;
    calls.push({ url, init });
    return new Response("app content", { status: 200, headers: { "Content-Type": "text/html" } });
  };

  try {
    const req = new Request("https://togather.nyc/ch/xyz789", {
      headers: { "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X)" },
    });

    const res = await worker.fetch(req, {
      CONVEX_SITE_URL: "https://example.convex.site",
    });

    assert.equal(res.status, 200);
    assert.equal(await res.text(), "app content");

    // Should pass through to EAS Hosting origin
    assert.equal(calls.length, 1);
    assert.ok(
      calls[0].url.startsWith(APP_ORIGIN_URL),
      `expected fetch to ${APP_ORIGIN_URL}, got ${calls[0].url}`
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("bot /ch/:shortId without description uses generated description", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = typeof input === "string" ? input : input.url;

    if (url.startsWith("https://example.convex.site/link-preview/channel")) {
      return new Response(
        JSON.stringify({
          channelName: "general",
          channelDescription: null,
          groupName: "Youth Group",
          groupImage: null,
          communityName: "My Church",
          communityLogo: null,
          memberCount: 5,
          joinMode: "open",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }

    return new Response("unexpected fetch", { status: 500 });
  };

  try {
    const req = new Request("https://togather.nyc/ch/abc456", {
      headers: { "User-Agent": "Discordbot" },
    });

    const res = await worker.fetch(req, {
      CONVEX_SITE_URL: "https://example.convex.site",
    });

    assert.equal(res.status, 200);

    const html = await res.text();
    assert.match(html, /Join #general in Youth Group/);
    // Should use generated description when channelDescription is null
    assert.match(html, /Join the #general channel in Youth Group on My Church/);
    assert.match(html, /5 members/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
