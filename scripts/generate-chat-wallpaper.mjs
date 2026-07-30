#!/usr/bin/env node
/**
 * Generates the WhatsApp-shell chat wallpaper doodle tiles.
 *
 * WA-VISUAL-DELTAS.md §S4.1 asks for a *patterned* chat wallpaper rather than
 * the flat `colors.chatWallpaper` tint. WhatsApp's own doodle artwork is
 * copyrighted, so this script draws an ORIGINAL line-art tile from scratch —
 * simple community/church motifs (star, heart, leaf, candle, calendar, cup,
 * note, chapel, cross, book, balloon…) at 1.5px stroke and ~7-10% ink
 * opacity — and rasterizes it to a transparent PNG that the app tiles over its
 * cream (light) / near-black (dark) wallpaper base color.
 *
 * ## Why the output is a TypeScript module, not two PNGs
 *
 * The tiles used to be committed as `apps/mobile/assets/images/chat-wallpaper-*.png`
 * and `require()`d. On the simulator (Metro serves assets off the dev server)
 * that worked; on a real device running an **OTA update** it did not — the PNGs
 * were newer than the installed binary (runtimeVersion 1.0.21), so they had to
 * arrive as expo-updates *assets*, and on device they never resolved. The
 * wallpaper rendered as flat cream while the same bundle's bubbles/replies were
 * fine (owner's device report, 2026-07-30).
 *
 * Rather than debug expo-updates asset manifests, this eliminates the failure
 * class: the tiles are emitted as `data:image/png;base64,…` strings inside a
 * generated **TS module**, so they ship *inside the JS bundle* and can never be
 * a missing asset. ~17-23 KB per tile → ~30 KB of base64 each; negligible.
 *
 * Run:  node scripts/generate-chat-wallpaper.mjs
 * Deps: `@resvg/resvg-js` (already a dependency of `apps/web`; this script
 *       resolves it from there so nothing new is added to `apps/mobile`).
 *
 * Output (committed):
 *   apps/mobile/features/chat/chatWallpaperTiles.ts
 */
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
// Resolve @resvg/resvg-js from apps/web, which already depends on it for the
// OG-image build — keeps apps/mobile's dependency graph untouched (CLAUDE.md
// "JS Changes Can Break Native Rendering").
const requireFromWeb = createRequire(path.join(repoRoot, 'apps/web/package.json'));
const { Resvg } = requireFromWeb('@resvg/resvg-js');

// 256px tile. The app tiles this explicitly in JS (`ChatWallpaper` lays out a
// grid of 256pt <Image>s) rather than via `resizeMode="repeat"`, which UIKit
// silently stretched on device — a 512pt sheet smeared over the screen read as
// a flat cream.
const TILE = 256;

// --- Motifs -----------------------------------------------------------------
// Each motif is drawn in its own local space roughly centered on (0,0) and
// about 48 units across, so the layout below can place/rotate them freely.

const motifs = {
  star: 'M0,-24 L6.6,-8.2 L23.4,-7.4 L10.4,3.1 L14.6,19.4 L0,10.2 L-14.6,19.4 L-10.4,3.1 L-23.4,-7.4 L-6.6,-8.2 Z',
  heart:
    'M0,20 C-16,8 -24,0 -24,-8 C-24,-17 -16,-22 -9,-22 C-4,-22 -1,-19 0,-16 C1,-19 4,-22 9,-22 C16,-22 24,-17 24,-8 C24,0 16,8 0,20 Z',
  leaf: 'M-18,18 C-18,-6 -6,-18 18,-18 C18,6 6,18 -18,18 Z M-10,10 L12,-12',
  cup: 'M-16,-12 L16,-12 L14,14 C14,18 11,20 8,20 L-8,20 C-11,20 -14,18 -14,14 Z M16,-6 C24,-6 26,0 24,4 C22,8 19,8 15,7 M-12,-20 C-12,-24 -8,-24 -8,-28 M-2,-20 C-2,-24 2,-24 2,-28 M8,-20 C8,-24 12,-24 12,-28',
  note: 'M-4,16 L-4,-20 L20,-26 L20,10 M-4,-8 L20,-14 M-4,16 C-4,20 -8,23 -13,23 C-18,23 -20,20 -20,17 C-20,13 -16,10 -11,10 C-7,10 -4,12 -4,16 Z M20,10 C20,14 16,17 11,17 C6,17 4,14 4,11 C4,7 8,4 13,4 C17,4 20,6 20,10 Z',
  calendar:
    'M-20,-14 L20,-14 L20,20 L-20,20 Z M-20,-4 L20,-4 M-12,-14 L-12,-22 M12,-14 L12,-22 M-10,6 L-4,6 M2,6 L8,6 M-10,14 L-4,14 M2,14 L8,14',
  // Paper plane ("sent with love") — stands in for the dove motif, which
  // never read cleanly as line art at this size.
  plane: 'M-24,-2 L24,-22 L10,20 L1,3 Z M-24,-2 L1,3 M1,3 L14,-11',
  candle:
    'M-10,20 L10,20 L10,-8 L-10,-8 Z M-10,-2 L10,-2 M0,-8 C-6,-14 -6,-20 0,-26 C6,-20 6,-14 0,-8 Z',
  chapel:
    'M-20,20 L-20,-2 L0,-16 L20,-2 L20,20 Z M-5,20 L-5,4 L5,4 L5,20 M0,-16 L0,-24 M-5,-21 L5,-21',
  cross: 'M-5,22 L-5,-6 L-20,-6 L-20,-16 L-5,-16 L-5,-24 L5,-24 L5,-16 L20,-16 L20,-6 L5,-6 L5,22 Z',
  book: 'M0,-14 C-6,-19 -14,-20 -22,-19 L-22,15 C-14,14 -6,15 0,20 C6,15 14,14 22,15 L22,-19 C14,-20 6,-19 0,-14 Z M0,-14 L0,20',
  balloon:
    'M0,10 C-10,10 -16,0 -16,-8 C-16,-17 -9,-24 0,-24 C9,-24 16,-17 16,-8 C16,0 10,10 0,10 Z M0,10 L-3,15 L3,15 L0,10 M0,15 C0,20 -6,20 -6,25 C-6,28 -3,29 0,28',
  sun: 'M0,-11 A11,11 0 1,0 0,11 A11,11 0 1,0 0,-11 Z M0,-20 L0,-26 M0,20 L0,26 M-20,0 L-26,0 M20,0 L26,0 M-14,-14 L-18,-18 M14,14 L18,18 M14,-14 L18,-18 M-14,14 L-18,18',
  chat: 'M-22,-16 L22,-16 L22,10 L-2,10 L-12,20 L-12,10 L-22,10 Z M-13,-3 L13,-3 M-13,4 L5,4',
  flower:
    'M0,-6 C-6,-14 -2,-22 4,-20 C10,-18 10,-10 2,-6 M0,-6 C8,-10 16,-6 15,0 C14,6 6,8 2,2 M0,-6 C4,2 0,10 -6,8 C-12,6 -12,-2 -4,-6 M0,-6 C-8,-2 -16,-6 -15,-12 C-14,-18 -6,-20 -2,-14 M0,4 L0,22',
  gift: 'M-20,-4 L20,-4 L20,20 L-20,20 Z M-20,-4 L-20,4 L20,4 L20,-4 M0,-4 L0,20 M0,-4 C-5,-13 -13,-13 -13,-8 C-13,-4 -6,-4 0,-4 C6,-4 13,-4 13,-8 C13,-13 5,-13 0,-4 Z',
};

const motifNames = Object.keys(motifs);

/**
 * Deterministic PRNG so re-running the script reproduces the committed module
 * byte-for-byte (no diff churn on regeneration). Never seed from Date.now().
 */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Lays motifs out on a jittered 4x4 grid at ~41-53px each — the density the
 * owner's WhatsApp reference shows: clearly visible line art, still subtle.
 *
 * Each motif is emitted NINE times — once in place and once per neighbouring
 * tile offset (±TILE on each axis) — so a motif that overhangs an edge is
 * completed by its wrapped twin on the opposite edge. Without that the grid of
 * <Image> tiles shows a hard seam wherever a motif was clipped.
 */
function buildTileSvg({ ink, inkOpacity }) {
  const rand = mulberry32(20260729);
  const cols = 4;
  const cell = TILE / cols;
  const parts = [];

  const order = [...motifNames];

  for (let row = 0; row < cols; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const name = order[(row * cols + col) % order.length];
      const jitterX = (rand() - 0.5) * (cell * 0.3);
      const jitterY = (rand() - 0.5) * (cell * 0.3);
      const cx = col * cell + cell / 2 + jitterX;
      const cy = row * cell + cell / 2 + jitterY;
      const rotation = Math.round((rand() - 0.5) * 44);
      // Motif paths span ~48 units, so this lands each one at ~41-53px.
      const scale = (0.86 + rand() * 0.24).toFixed(3);
      for (const dx of [-TILE, 0, TILE]) {
        for (const dy of [-TILE, 0, TILE]) {
          parts.push(
            `<g transform="translate(${(cx + dx).toFixed(2)} ${(cy + dy).toFixed(2)}) rotate(${rotation}) scale(${scale})"><path d="${motifs[name]}"/></g>`
          );
        }
      }
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${TILE}" height="${TILE}" viewBox="0 0 ${TILE} ${TILE}">
  <g fill="none" stroke="${ink}" stroke-opacity="${inkOpacity}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
${parts.join('\n')}
  </g>
</svg>`;
}

// Ink opacity raised from 0.08/0.05 after the device check: at the old values
// the pattern was invisible on a real screen (it only ever read on a
// brightness-boosted desktop browser).
const variants = [
  { constant: 'WALLPAPER_TILE_LIGHT_URI', ink: '#3B4A54', inkOpacity: 0.1 },
  { constant: 'WALLPAPER_TILE_DARK_URI', ink: '#FFFFFF', inkOpacity: 0.07 },
];

const lines = [
  '/**',
  ' * DO NOT EDIT — generated by `node scripts/generate-chat-wallpaper.mjs`.',
  ' *',
  ' * The WhatsApp-shell chat wallpaper doodle tiles, inlined as base64 data',
  ' * URIs. They live in the JS bundle rather than `assets/images/*.png` on',
  ' * purpose: as committed PNGs they were expo-updates *assets* newer than the',
  ' * installed binary, and on a real device running an OTA they never resolved —',
  ' * the wallpaper rendered as flat cream while the rest of the same bundle was',
  ' * fine (owner report, 2026-07-30). A data URI cannot go missing.',
  ' *',
  ' * Original line art (see the generator for the motif vocabulary); WhatsApp’s',
  ' * own doodle wallpaper is copyrighted and deliberately NOT used.',
  ' */',
  '',
];

for (const variant of variants) {
  const svg = buildTileSvg(variant);
  const png = new Resvg(svg, { fitTo: { mode: 'width', value: TILE } }).render().asPng();
  const uri = `data:image/png;base64,${png.toString('base64')}`;
  lines.push(`export const ${variant.constant} =`, `  '${uri}';`, '');
  console.log(
    `${variant.constant}: ${(png.length / 1024).toFixed(1)} KB png -> ${(uri.length / 1024).toFixed(1)} KB uri`
  );
}

const outPath = path.join(repoRoot, 'apps/mobile/features/chat/chatWallpaperTiles.ts');
fs.writeFileSync(outPath, lines.join('\n'));
console.log(`wrote ${path.relative(repoRoot, outPath)} (${(fs.statSync(outPath).size / 1024).toFixed(1)} KB)`);
