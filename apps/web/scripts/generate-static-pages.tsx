/**
 * Post-build step (run after `vite build`, see package.json's "build" script).
 *
 * Cloudflare Pages serves any static file that exists before falling back to
 * the SPA rewrite in public/_redirects (`/* /index.html 200`). So for every
 * route in src/routes.tsx we write a `dist/<path>/index.html` whose <head>
 * carries that route's real title/description/OG/Twitter tags — link
 * previews and crawlers get correct metadata with no server, no worker, no
 * runtime cost. The bundled JS still boots the SPA client-side as normal.
 *
 * We also render a branded 1200x630 OG card PNG (via satori -> resvg) for
 * every route that doesn't supply its own bespoke `image`.
 */
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import fs from "node:fs";
import esbuild from "esbuild";
import satori from "satori";
import { Resvg } from "@resvg/resvg-js";
import type { PageMeta } from "../src/routes.tsx";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(__dirname, "..");
const distDir = path.join(webRoot, "dist");
const SITE_ORIGIN = (process.env.SITE_ORIGIN || "https://togather.nyc").replace(/\/$/, "");

/**
 * Load the route registry (src/routes.tsx).
 *
 * That file is authored for Vite (JSX, `import.meta.env`), so it can't just
 * be `import()`-ed under plain Node/tsx: Vite statically replaces
 * `import.meta.env.*` at build time, which tsx's runtime doesn't do, and any
 * page module that reads it at module scope (e.g. AndroidDownload.tsx) would
 * throw trying to read a property off `undefined`. We bundle it with esbuild
 * first (mirroring Vite's own `define` transform) so `import.meta.env.X`
 * resolves to `undefined` instead of crashing. The `element: <Page />` JSX
 * just becomes an inert `React.createElement` call we never invoke — we only
 * read the plain metadata fields off each entry, so page component bodies
 * never actually run.
 */
async function loadRoutes() {
  const entry = path.join(webRoot, "src/routes.tsx");
  const result = await esbuild.build({
    entryPoints: [entry],
    bundle: true,
    write: false,
    format: "esm",
    platform: "node",
    jsx: "automatic",
    absWorkingDir: webRoot,
    // esbuild's `define` only accepts an identifier/entity-name or a JS
    // literal as the replacement — not an object literal — so we point
    // `import.meta.env` at a global stub injected via `banner` instead.
    banner: { js: "globalThis.__importMetaEnvStub = {};" },
    define: { "import.meta.env": "globalThis.__importMetaEnvStub" },
    // Defensive: if a page component ever imports an asset or stylesheet at
    // module scope, don't let bundling fail over it — we never render pages.
    loader: { ".png": "dataurl", ".svg": "dataurl", ".jpg": "dataurl", ".jpeg": "dataurl", ".css": "empty" },
    external: ["react", "react-dom", "react-router-dom"],
  });
  const bundled = result.outputFiles[0].text;
  const tmpFile = path.join(webRoot, "node_modules/.generate-static-pages-routes.mjs");
  fs.mkdirSync(path.dirname(tmpFile), { recursive: true });
  fs.writeFileSync(tmpFile, bundled);
  try {
    const mod = (await import(pathToFileURL(tmpFile).href)) as {
      routes: PageMeta[];
      ogSlug: (routePath: string) => string;
    };
    return mod;
  } finally {
    fs.rmSync(tmpFile, { force: true });
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Resolve an entry's OG image to an absolute URL. */
function resolveImageUrl(entry: PageMeta, ogSlug: (p: string) => string): string {
  if (entry.image) {
    return entry.image.startsWith("http") ? entry.image : `${SITE_ORIGIN}${entry.image}`;
  }
  return `${SITE_ORIGIN}/og/${ogSlug(entry.path)}.png`;
}

function resolveCanonicalUrl(entry: PageMeta): string {
  return entry.path === "/" ? SITE_ORIGIN : `${SITE_ORIGIN}${entry.path}`;
}

/**
 * Replace the generic <title>...<meta twitter:image> head block (see
 * apps/web/index.html for the block being targeted) with one baked for this
 * route. The theme-color value is preserved from whatever the template
 * currently has rather than hardcoded, so this keeps working if it changes.
 */
function renderHeadForEntry(templateHtml: string, entry: PageMeta, ogSlug: (p: string) => string): string {
  const themeColorMatch = templateHtml.match(/<meta name="theme-color" content="([^"]*)"/);
  const themeColor = themeColorMatch?.[1] ?? "#D4A574";
  const title = escapeHtml(entry.title);
  const description = escapeHtml(entry.description);
  const imageUrl = resolveImageUrl(entry, ogSlug);
  const canonicalUrl = resolveCanonicalUrl(entry);

  const headBlock = `<title>${title}</title>
    <meta name="description" content="${description}" />
    <meta name="theme-color" content="${themeColor}" />

    <!-- Open Graph -->
    <meta property="og:title" content="${title}" />
    <meta property="og:description" content="${description}" />
    <meta property="og:type" content="website" />
    <meta property="og:url" content="${canonicalUrl}" />
    <meta property="og:image" content="${imageUrl}" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta property="og:image:secure_url" content="${imageUrl}" />
    <meta property="og:site_name" content="Togather" />

    <!-- Twitter Card -->
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${title}" />
    <meta name="twitter:description" content="${description}" />
    <meta name="twitter:image" content="${imageUrl}" />`;

  const headBlockPattern = /<title>[\s\S]*?<meta name="twitter:image"[^>]*>/;
  if (!headBlockPattern.test(templateHtml)) {
    throw new Error(
      "generate-static-pages: could not find the title..twitter:image head block in dist/index.html to replace — did apps/web/index.html's head markup change shape?",
    );
  }
  return templateHtml.replace(headBlockPattern, headBlock);
}

function outputPathFor(routePath: string): string {
  if (routePath === "/") return path.join(distDir, "index.html");
  return path.join(distDir, routePath.replace(/^\//, ""), "index.html");
}

// ---------------------------------------------------------------------------
// OG card rendering (satori -> PNG)

const CARD_WIDTH = 1200;
const CARD_HEIGHT = 630;
const BRAND_ACCENT = "#D4A574";
const TEXT_DARK = "#1c1917"; // --color-neutral-900
const TEXT_MUTED = "#78716c"; // --color-neutral-500
const CARD_BG_FROM = "#faf7f4"; // --color-primary-50

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  // Mirrors safeSliceForJson in apps/convex/lib/utils.ts: slice() can split a
  // UTF-16 surrogate pair, leaving a lone high surrogate that renders as a
  // broken glyph on the OG card. Drop it if the cut landed mid-pair.
  let sliced = text.slice(0, max - 1);
  const lastCode = sliced.charCodeAt(sliced.length - 1);
  if (lastCode >= 0xd800 && lastCode <= 0xdbff) {
    sliced = sliced.slice(0, -1);
  }
  return `${sliced.trimEnd()}…`;
}

async function loadFonts() {
  const fontDir = path.join(
    webRoot,
    "node_modules/@fontsource/plus-jakarta-sans/files",
  );
  // satori needs raw ttf/otf/woff font data — NOT woff2 — so we read the
  // .woff files @fontsource ships alongside its .woff2 ones.
  const read = (weight: number) => fs.readFileSync(path.join(fontDir, `plus-jakarta-sans-latin-${weight}-normal.woff`));
  return [
    { name: "Plus Jakarta Sans", data: read(400), weight: 400 as const, style: "normal" as const },
    { name: "Plus Jakarta Sans", data: read(600), weight: 600 as const, style: "normal" as const },
    { name: "Plus Jakarta Sans", data: read(700), weight: 700 as const, style: "normal" as const },
  ];
}

async function renderOgCard(entry: PageMeta, fonts: Awaited<ReturnType<typeof loadFonts>>): Promise<Buffer> {
  const card = {
    type: "div",
    props: {
      style: {
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        width: CARD_WIDTH,
        height: CARD_HEIGHT,
        padding: "72px",
        backgroundColor: CARD_BG_FROM,
        backgroundImage: "linear-gradient(135deg, #faf7f4 0%, #ffffff 65%)",
        fontFamily: "Plus Jakarta Sans",
      },
      children: [
        // Wordmark
        {
          type: "div",
          props: {
            style: { display: "flex", alignItems: "center", gap: 12 },
            children: [
              {
                type: "div",
                props: {
                  style: {
                    display: "flex",
                    width: 14,
                    height: 14,
                    borderRadius: 4,
                    backgroundColor: BRAND_ACCENT,
                  },
                },
              },
              {
                type: "div",
                props: {
                  style: { display: "flex", fontSize: 28, fontWeight: 700, color: TEXT_DARK },
                  children: "Togather",
                },
              },
            ],
          },
        },
        // Title + description
        {
          type: "div",
          props: {
            style: { display: "flex", flexDirection: "column", maxWidth: 1000 },
            children: [
              {
                type: "div",
                props: {
                  style: {
                    display: "flex",
                    fontSize: 60,
                    fontWeight: 700,
                    color: TEXT_DARK,
                    lineHeight: 1.15,
                  },
                  children: truncate(entry.title, 90),
                },
              },
              {
                type: "div",
                props: {
                  style: {
                    display: "flex",
                    marginTop: 24,
                    fontSize: 28,
                    fontWeight: 400,
                    color: TEXT_MUTED,
                    lineHeight: 1.4,
                  },
                  children: truncate(entry.description, 140),
                },
              },
            ],
          },
        },
        // Footer accent bar + domain
        {
          type: "div",
          props: {
            style: { display: "flex", alignItems: "center", gap: 20 },
            children: [
              {
                type: "div",
                props: {
                  style: { display: "flex", width: 100, height: 8, borderRadius: 4, backgroundColor: BRAND_ACCENT },
                },
              },
              {
                type: "div",
                props: {
                  style: { display: "flex", fontSize: 22, fontWeight: 600, color: TEXT_MUTED },
                  children: "togather.nyc",
                },
              },
            ],
          },
        },
      ],
    },
  };

  const svg = await satori(card, { width: CARD_WIDTH, height: CARD_HEIGHT, fonts });
  const resvg = new Resvg(svg, { fitTo: { mode: "width", value: CARD_WIDTH } });
  return resvg.render().asPng();
}

// ---------------------------------------------------------------------------

async function main() {
  const templatePath = path.join(distDir, "index.html");
  if (!fs.existsSync(templatePath)) {
    console.error(`generate-static-pages: ${templatePath} not found — run "vite build" first.`);
    process.exit(1);
  }
  const templateHtml = fs.readFileSync(templatePath, "utf8");

  const { routes, ogSlug } = await loadRoutes();
  if (!Array.isArray(routes) || routes.length === 0) {
    console.error("generate-static-pages: src/routes.tsx exported an empty routes array.");
    process.exit(1);
  }

  const ogDir = path.join(distDir, "og");
  fs.mkdirSync(ogDir, { recursive: true });
  const fonts = await loadFonts();

  const writtenHtmlPaths: string[] = [];
  const generatedImagePaths: string[] = [];

  for (const entry of routes) {
    const outPath = outputPathFor(entry.path);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    const html = renderHeadForEntry(templateHtml, entry, ogSlug);
    fs.writeFileSync(outPath, html);
    writtenHtmlPaths.push(outPath);

    if (!entry.image) {
      const pngPath = path.join(ogDir, `${ogSlug(entry.path)}.png`);
      const png = await renderOgCard(entry, fonts);
      fs.writeFileSync(pngPath, png);
      generatedImagePaths.push(pngPath);
    }
  }

  // Self-check: every route got its HTML, every generated-image route got its PNG.
  const missingHtml = writtenHtmlPaths.filter((p) => !fs.existsSync(p));
  const missingPng = generatedImagePaths.filter((p) => !fs.existsSync(p));
  if (missingHtml.length || missingPng.length) {
    console.error("generate-static-pages: post-write verification failed.");
    if (missingHtml.length) console.error("  Missing HTML:", missingHtml);
    if (missingPng.length) console.error("  Missing PNG:", missingPng);
    process.exit(1);
  }

  console.log(
    `generate-static-pages: wrote ${writtenHtmlPaths.length} route HTML file(s) and ${generatedImagePaths.length} OG card PNG(s).`,
  );
}

main().catch((err) => {
  console.error("generate-static-pages: failed.", err);
  process.exit(1);
});
