#!/usr/bin/env node
/**
 * Generates the WhatsApp-shell chat wallpaper doodle tiles.
 *
 * WA-VISUAL-DELTAS.md §S4.1 asks for a *patterned* chat wallpaper rather than
 * the flat `colors.chatWallpaper` tint. WhatsApp's own doodle artwork is
 * copyrighted, so this script draws an ORIGINAL line-art tile from scratch —
 * simple community/church motifs (star, heart, leaf, candle, calendar, cup,
 * note, chapel, cross, book, balloon…) at 1.5px stroke and ~5-8% ink
 * opacity — and rasterizes it to a transparent PNG that the app tiles over its
 * cream (light) / near-black (dark) wallpaper base color.
 *
 * Run:  node scripts/generate-chat-wallpaper.mjs
 * Deps: `@resvg/resvg-js` (already a dependency of `apps/web`; this script
 *       resolves it from there so nothing new is added to `apps/mobile`).
 *
 * Output (committed):
 *   apps/mobile/assets/images/chat-wallpaper-light.png
 *   apps/mobile/assets/images/chat-wallpaper-dark.png
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

const TILE = 512;

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
 * Deterministic PRNG so re-running the script reproduces the committed PNGs
 * byte-for-byte (no diff churn on regeneration).
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

/** Lays motifs out on a jittered 4x4 grid, kept clear of the tile edges so no
 *  motif is clipped where the tile repeats. */
function buildTileSvg({ ink, inkOpacity }) {
  const rand = mulberry32(20260729);
  const cols = 4;
  const cell = TILE / cols;
  const parts = [];
  const order = [...motifNames];

  for (let row = 0; row < cols; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const name = order[(row * cols + col) % order.length];
      const jitterX = (rand() - 0.5) * (cell * 0.22);
      const jitterY = (rand() - 0.5) * (cell * 0.22);
      const cx = col * cell + cell / 2 + jitterX;
      const cy = row * cell + cell / 2 + jitterY;
      const rotation = Math.round((rand() - 0.5) * 44);
      const scale = (0.85 + rand() * 0.35).toFixed(3);
      parts.push(
        `<g transform="translate(${cx.toFixed(2)} ${cy.toFixed(2)}) rotate(${rotation}) scale(${scale})"><path d="${motifs[name]}"/></g>`
      );
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${TILE}" height="${TILE}" viewBox="0 0 ${TILE} ${TILE}">
  <g fill="none" stroke="${ink}" stroke-opacity="${inkOpacity}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
${parts.join('\n')}
  </g>
</svg>`;
}

const variants = [
  { file: 'chat-wallpaper-light.png', ink: '#3B4A54', inkOpacity: 0.08 },
  { file: 'chat-wallpaper-dark.png', ink: '#FFFFFF', inkOpacity: 0.05 },
];

const outDir = path.join(repoRoot, 'apps/mobile/assets/images');
fs.mkdirSync(outDir, { recursive: true });

for (const variant of variants) {
  const svg = buildTileSvg(variant);
  const png = new Resvg(svg, { fitTo: { mode: 'width', value: TILE } }).render().asPng();
  const outPath = path.join(outDir, variant.file);
  fs.writeFileSync(outPath, png);
  console.log(`${variant.file}: ${(png.length / 1024).toFixed(1)} KB`);
}
