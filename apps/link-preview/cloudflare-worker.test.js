import test from "node:test";
import assert from "node:assert/strict";

import worker from "./cloudflare-worker.js";

// Expected origin URLs from the worker
const APP_ORIGIN_URL = "https://togather.expo.app";
const LANDING_PAGE_URL = "https://togather-landing.pages.dev";

/**
 * Build a mock `/link-preview/meta` response. All fields are already
 * final/rendered per the Convex contract — the worker does no per-type
 * logic of its own, it just lays this out in the shared OG template.
 */
function mockMeta(overrides = {}) {
  return {
    title: "RSVP to My Event Name",
    description: "Monday, January 19, 2026 - 123 Main St",
    image: "https://cdn.example.com/event.jpg",
    url: "https://togather.nyc/e/abc123",
    siteName: "My Community",
    imageAlt: "My Event Name",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Bot preview routes: content is delegated to the Convex `/link-preview/meta`
// endpoint. These tests mock global fetch for that endpoint and assert the
// worker renders the shared OG template (success) or the shared error
// template (404 / network failure).
// ---------------------------------------------------------------------------

test("bot /e/:shortId fetches meta from Convex and returns OG tags", async () => {
  const calls = [];

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input.url;
    calls.push({ url, init });

    if (url.startsWith("https://example.convex.site/link-preview/meta")) {
      return new Response(JSON.stringify(mockMeta()), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
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
    assert.match(html, /property="og:image:width" content="1200"/);
    assert.match(html, /property="og:image:height" content="630"/);
    assert.match(html, /name="twitter:card" content="summary_large_image"/);
    assert.match(html, /http-equiv="refresh" content="0;url=https:\/\/togather\.nyc\/e\/abc123"/);

    const expectedMetaUrl =
      "https://example.convex.site/link-preview/meta?url=" +
      encodeURIComponent("https://togather.nyc/e/abc123");
    assert.ok(
      calls.some((c) => c.url === expectedMetaUrl),
      "expected a Convex link-preview meta fetch with the full request URL"
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("bot preview route without an image uses twitter:card summary (no image tags)", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = typeof input === "string" ? input : input.url;
    if (url.startsWith("https://example.convex.site/link-preview/meta")) {
      return new Response(
        JSON.stringify(mockMeta({ image: null, imageAlt: undefined })),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
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
    const html = await res.text();
    assert.doesNotMatch(html, /property="og:image"/);
    assert.match(html, /name="twitter:card" content="summary"/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("twitter:image:alt escapes the raw title fallback exactly once (not the already-escaped title)", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = typeof input === "string" ? input : input.url;
    if (url.startsWith("https://example.convex.site/link-preview/meta")) {
      return new Response(
        JSON.stringify(mockMeta({ title: "Sam & Dean's Meetup", imageAlt: undefined })),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    return new Response("unexpected fetch", { status: 500 });
  };

  try {
    const req = new Request("https://togather.nyc/e/abc123", {
      headers: { "User-Agent": "Twitterbot" },
    });

    const res = await worker.fetch(req, {
      CONVEX_SITE_URL: "https://example.convex.site",
    });

    const html = await res.text();
    const [, altAttr] = html.match(/name="twitter:image:alt" content="([^"]*)"/);
    assert.equal(altAttr, "Sam &amp; Dean&#039;s Meetup");
    // Guard against double-escaping ("&amp;amp;") which would occur if the
    // fallback re-escaped the already-escaped title.
    assert.doesNotMatch(html, /&amp;amp;/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("og:image:width/height use meta.imageWidth/imageHeight when provided (400x400 community-logo preview)", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = typeof input === "string" ? input : input.url;
    if (url.startsWith("https://example.convex.site/link-preview/meta")) {
      return new Response(
        JSON.stringify(mockMeta({ imageWidth: 400, imageHeight: 400 })),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    return new Response("unexpected fetch", { status: 500 });
  };

  try {
    const req = new Request("https://togather.nyc/e/abc123", {
      headers: { "User-Agent": "Twitterbot" },
    });

    const res = await worker.fetch(req, {
      CONVEX_SITE_URL: "https://example.convex.site",
    });

    const html = await res.text();
    assert.match(html, /property="og:image:width" content="400"/);
    assert.match(html, /property="og:image:height" content="400"/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("bot preview route renders the shared error template on a 404 from Convex", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = typeof input === "string" ? input : input.url;
    if (url.startsWith("https://example.convex.site/link-preview/meta")) {
      return new Response(JSON.stringify({ error: "Event not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response("unexpected fetch", { status: 500 });
  };

  try {
    const req = new Request("https://togather.nyc/e/notfound", {
      headers: { "User-Agent": "Twitterbot" },
    });

    const res = await worker.fetch(req, {
      CONVEX_SITE_URL: "https://example.convex.site",
    });

    assert.equal(res.status, 200);
    assert.equal(res.headers.get("Content-Type"), "text/html; charset=utf-8");

    const html = await res.text();
    assert.match(html, /Togather/);
    assert.match(html, /http-equiv="refresh" content="0;url=https:\/\/togather\.nyc\/e\/notfound"/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("bot preview route renders the shared error template when the Convex fetch throws", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = typeof input === "string" ? input : input.url;
    if (url.startsWith("https://example.convex.site/link-preview/meta")) {
      throw new Error("network error");
    }
    return new Response("unexpected fetch", { status: 500 });
  };

  try {
    const req = new Request("https://togather.nyc/g/abc123", {
      headers: { "User-Agent": "Twitterbot" },
    });

    const res = await worker.fetch(req, {
      CONVEX_SITE_URL: "https://example.convex.site",
    });

    assert.equal(res.status, 200);
    const html = await res.text();
    assert.match(html, /Togather/);
    assert.match(html, /http-equiv="refresh" content="0;url=https:\/\/togather\.nyc\/g\/abc123"/);
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

// ---------------------------------------------------------------------------
// PREVIEW_ROUTES pattern coverage: /g/, /t/, /ch/, /nearme, and community
// slugs all share the same bot/human dispatch, exercised once each here.
// ---------------------------------------------------------------------------

test("bot /g/:shortId fetches meta from Convex and returns OG tags", async () => {
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = typeof input === "string" ? input : input.url;
    calls.push(url);
    if (url.startsWith("https://example.convex.site/link-preview/meta")) {
      return new Response(
        JSON.stringify(mockMeta({ title: "Join My Group", url: "https://togather.nyc/g/g123" })),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    return new Response("unexpected fetch", { status: 500 });
  };

  try {
    const req = new Request("https://togather.nyc/g/g123", {
      headers: { "User-Agent": "facebookexternalhit/1.1" },
    });

    const res = await worker.fetch(req, { CONVEX_SITE_URL: "https://example.convex.site" });

    assert.equal(res.status, 200);
    const html = await res.text();
    assert.match(html, /Join My Group/);
    assert.ok(
      calls.some((u) => u.includes(encodeURIComponent("https://togather.nyc/g/g123"))),
      "expected a Convex meta fetch for the group short link"
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("bot /t/:shortId fetches meta from Convex and returns OG tags", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = typeof input === "string" ? input : input.url;
    if (url.startsWith("https://example.convex.site/link-preview/meta")) {
      return new Response(
        JSON.stringify(mockMeta({ title: "My Group - Run Sheet", url: "https://togather.nyc/t/t123" })),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    return new Response("unexpected fetch", { status: 500 });
  };

  try {
    const req = new Request("https://togather.nyc/t/t123", {
      headers: { "User-Agent": "Slackbot" },
    });

    const res = await worker.fetch(req, { CONVEX_SITE_URL: "https://example.convex.site" });

    assert.equal(res.status, 200);
    const html = await res.text();
    assert.match(html, /My Group - Run Sheet/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("bot /ch/:shortId fetches meta from Convex and returns OG tags", async () => {
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = typeof input === "string" ? input : input.url;
    calls.push(url);
    if (url.startsWith("https://example.convex.site/link-preview/meta")) {
      return new Response(
        JSON.stringify(
          mockMeta({
            title: "Join #worship-team in Sunday Service",
            description: "Coordinate worship sets and rehearsals",
            image: "https://cdn.example.com/group.jpg",
            url: "https://togather.nyc/ch/xyz789",
          })
        ),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
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

    const expectedMetaUrl =
      "https://example.convex.site/link-preview/meta?url=" +
      encodeURIComponent("https://togather.nyc/ch/xyz789");
    assert.ok(calls.includes(expectedMetaUrl), "expected a Convex link-preview meta fetch");
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

test("bot /nearme fetches meta from Convex and returns OG tags", async () => {
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = typeof input === "string" ? input : input.url;
    calls.push(url);
    if (url.startsWith("https://example.convex.site/link-preview/meta")) {
      return new Response(
        JSON.stringify(
          mockMeta({
            title: "Find a Group Near You",
            description: "Discover groups near you in Fount Church",
            url: "https://fount.togather.nyc/nearme",
          })
        ),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    return new Response("unexpected fetch", { status: 500 });
  };

  try {
    const req = new Request("https://fount.togather.nyc/nearme", {
      headers: { "User-Agent": "Twitterbot" },
    });

    const res = await worker.fetch(req, { CONVEX_SITE_URL: "https://example.convex.site" });

    assert.equal(res.status, 200);
    const html = await res.text();
    assert.match(html, /Find a Group Near You/);
    assert.ok(
      calls.some((u) => u.includes(encodeURIComponent("https://fount.togather.nyc/nearme"))),
      "expected a Convex meta fetch carrying the full nearme request URL"
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("bot /nearme error fallback preserves the original query string in refresh/link", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = typeof input === "string" ? input : input.url;
    if (url.startsWith("https://example.convex.site/link-preview/meta")) {
      return new Response(JSON.stringify({ error: "Community not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response("unexpected fetch", { status: 500 });
  };

  try {
    const req = new Request("https://fount.togather.nyc/nearme?type=book-club", {
      headers: { "User-Agent": "Twitterbot" },
    });

    const res = await worker.fetch(req, { CONVEX_SITE_URL: "https://example.convex.site" });

    assert.equal(res.status, 200);
    const html = await res.text();
    assert.match(
      html,
      /http-equiv="refresh" content="0;url=https:\/\/fount\.togather\.nyc\/nearme\?type=book-club"/
    );
    assert.match(
      html,
      /<a href="https:\/\/fount\.togather\.nyc\/nearme\?type=book-club">/
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("non-bot /nearme passes through to EAS Hosting (app)", async () => {
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = typeof input === "string" ? input : input.url;
    calls.push(url);
    return new Response("app content", { status: 200, headers: { "Content-Type": "text/html" } });
  };

  try {
    const req = new Request("https://fount.togather.nyc/nearme", {
      headers: { "User-Agent": "Mozilla/5.0" },
    });

    const res = await worker.fetch(req, { CONVEX_SITE_URL: "https://example.convex.site" });

    assert.equal(res.status, 200);
    assert.equal(calls.length, 1);
    assert.ok(calls[0].startsWith(APP_ORIGIN_URL));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("bot /:slug (community landing page) fetches meta from Convex and returns OG tags", async () => {
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = typeof input === "string" ? input : input.url;
    calls.push(url);
    if (url.startsWith("https://example.convex.site/link-preview/meta")) {
      return new Response(
        JSON.stringify(mockMeta({ title: "Fount Church", url: "https://togather.nyc/c/fount-church" })),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    return new Response("unexpected fetch", { status: 500 });
  };

  try {
    const req = new Request("https://togather.nyc/fount-church", {
      headers: { "User-Agent": "Twitterbot" },
    });

    const res = await worker.fetch(req, { CONVEX_SITE_URL: "https://example.convex.site" });

    assert.equal(res.status, 200);
    const html = await res.text();
    assert.match(html, /Fount Church/);
    assert.ok(
      calls.some((u) => u.includes(encodeURIComponent("https://togather.nyc/fount-church"))),
      "expected a Convex meta fetch for the community slug"
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("human /:slug (community landing page) redirects to /c/:slug", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    return new Response("should not be called", { status: 500 });
  };

  try {
    const req = new Request("https://togather.nyc/fount-church?ref=share", {
      headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)" },
      redirect: "manual",
    });

    const res = await worker.fetch(req, { CONVEX_SITE_URL: "https://example.convex.site" });

    assert.equal(res.status, 302);
    assert.equal(res.headers.get("Location"), "https://togather.nyc/c/fount-church?ref=share");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("known app route (e.g. /admin) is not treated as a community slug", async () => {
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = typeof input === "string" ? input : input.url;
    calls.push(url);
    return new Response("app content", { status: 200, headers: { "Content-Type": "text/html" } });
  };

  try {
    const req = new Request("https://togather.nyc/admin", {
      headers: { "User-Agent": "Twitterbot" },
    });

    const res = await worker.fetch(req, { CONVEX_SITE_URL: "https://example.convex.site" });

    assert.equal(res.status, 200);
    // No Convex meta fetch, no redirect - straight passthrough to the app.
    assert.equal(calls.length, 1);
    assert.ok(calls[0].startsWith(APP_ORIGIN_URL));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("bot on an invalid short-id format passes through instead of matching a preview route", async () => {
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = typeof input === "string" ? input : input.url;
    calls.push(url);
    return new Response("app content", { status: 200, headers: { "Content-Type": "text/html" } });
  };

  try {
    // "!" is not in [a-zA-Z0-9], so this shouldn't match SHORT_ID_ROUTE_PATTERN.
    const req = new Request("https://togather.nyc/e/abc!123", {
      headers: { "User-Agent": "Twitterbot" },
    });

    const res = await worker.fetch(req, { CONVEX_SITE_URL: "https://example.convex.site" });

    assert.equal(res.status, 200);
    assert.equal(calls.length, 1);
    assert.ok(
      calls[0].startsWith(APP_ORIGIN_URL),
      "invalid shortId format should pass through to the app, not hit Convex"
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// ---------------------------------------------------------------------------
// Kept behavior: static routing, .well-known files, bot detection on the
// homepage, and landing-page passthrough. None of this depends on the
// Convex link-preview contract.
// ---------------------------------------------------------------------------

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
  assert.ok(components.some(c => c["/"] === "/guides" && c.exclude === true), "should exclude guides hub");
  assert.ok(components.some(c => c["/"] === "/guides/*" && c.exclude === true), "should exclude guides sub-pages");
  assert.ok(components.some(c => c["/"] === "/developers" && c.exclude === true), "should exclude developer docs");
  assert.ok(components.some(c => c["/"] === "/developers/*" && c.exclude === true), "should exclude developer docs sub-pages");
  // Content sub-pages must be excluded too, otherwise they fall through to the
  // "*" catch-all and get captured by the app (renders "Page Not Found").
  assert.ok(components.some(c => c["/"] === "/contribute" && c.exclude === true), "should exclude contribute page");
  assert.ok(components.some(c => c["/"] === "/contribute/*" && c.exclude === true), "should exclude contribute sub-pages (e.g. /contribute/ai)");
  assert.ok(components.some(c => c["/"] === "/legal" && c.exclude === true), "should exclude legal hub");
  assert.ok(components.some(c => c["/"] === "/legal/*" && c.exclude === true), "should exclude legal sub-pages (privacy/terms)");
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

// The guides hub and its sub-pages are served by the Vite landing site, not the
// Expo app. Without this, /guides would be treated as a community slug and
// redirect to /c/guides ("Community Not Found").
test("/guides passes through to landing page", async () => {
  const calls = [];

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input.url;
    calls.push({ url, init });
    return new Response("guides hub", { status: 200, headers: { "Content-Type": "text/html" } });
  };

  try {
    const req = new Request("https://togather.nyc/guides", {
      headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)" },
    });

    const res = await worker.fetch(req, {});

    assert.equal(res.status, 200);
    assert.equal(calls.length, 1);
    assert.ok(
      calls[0].url.startsWith(LANDING_PAGE_URL),
      `expected fetch to ${LANDING_PAGE_URL}, got ${calls[0].url}`
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("/guides/:slug sub-pages pass through to landing page", async () => {
  const calls = [];

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input.url;
    calls.push({ url, init });
    return new Response("branding guide", { status: 200, headers: { "Content-Type": "text/html" } });
  };

  try {
    const req = new Request("https://togather.nyc/guides/branding", {
      headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)" },
    });

    const res = await worker.fetch(req, {});

    assert.equal(res.status, 200);
    assert.equal(calls.length, 1);
    assert.ok(
      calls[0].url.startsWith(LANDING_PAGE_URL),
      `expected fetch to ${LANDING_PAGE_URL}, got ${calls[0].url}`
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// The developer docs page is browser-only: it must be served by the Vite
// landing site, not treated as a community slug (which would redirect to
// /c/developers, "Community Not Found") or opened in the app.
test("/developers passes through to landing page", async () => {
  const calls = [];

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input.url;
    calls.push({ url, init });
    return new Response("developers", { status: 200, headers: { "Content-Type": "text/html" } });
  };

  try {
    const req = new Request("https://togather.nyc/developers", {
      headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)" },
    });

    const res = await worker.fetch(req, {});

    assert.equal(res.status, 200);
    assert.equal(calls.length, 1);
    assert.ok(
      calls[0].url.startsWith(LANDING_PAGE_URL),
      `expected fetch to ${LANDING_PAGE_URL}, got ${calls[0].url}`
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// The contribution sub-pages (e.g. /contribute/ai) are browser-only Vite routes.
// Without a "/contribute/" landing prefix they fall through to passToApp and hit
// the Expo app's 404 instead of the contribution page.
test("/contribute/:slug sub-pages pass through to landing page", async () => {
  const calls = [];

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input.url;
    calls.push({ url, init });
    return new Response("contribute ai", { status: 200, headers: { "Content-Type": "text/html" } });
  };

  try {
    const req = new Request("https://togather.nyc/contribute/ai", {
      headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)" },
    });

    const res = await worker.fetch(req, {});

    assert.equal(res.status, 200);
    assert.equal(calls.length, 1);
    assert.ok(
      calls[0].url.startsWith(LANDING_PAGE_URL),
      `expected fetch to ${LANDING_PAGE_URL}, got ${calls[0].url}`
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
