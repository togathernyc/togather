/**
 * QR Code generator — condensed TypeScript port for Togather's Invite Kit.
 *
 * Ported from "QR Code generator library" by Project Nayuki
 * (https://www.nayuki.io/page/qr-code-generation-library), original
 * TypeScript source: https://github.com/nayuki/QR-Code-generator
 *
 * Copyright (c) Project Nayuki. (MIT License)
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy of
 * this software and associated documentation files (the "Software"), to deal in
 * the Software without restriction, including without limitation the rights to
 * use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
 * the Software, and to permit persons to whom the Software is furnished to do so,
 * subject to the following conditions:
 * - The above copyright notice and this permission notice shall be included in
 *   all copies or substantial portions of the Software.
 * - The Software is provided "as is", without warranty of any kind, express or
 *   implied, including but not limited to the warranties of merchantability,
 *   fitness for a particular purpose and noninfringement. In no event shall the
 *   authors or copyright holders be liable for any claim, damages or other
 *   liability, whether in an action of contract, tort or otherwise, arising from,
 *   out of or in connection with the Software or the use or other dealings in the
 *   Software.
 *
 * This file trims the original library down to exactly what the Invite Kit
 * needs, so it can ship with zero dependencies (no `react-native-svg`, no
 * `qrcode` npm package):
 *   - Byte mode only (raw UTF-8 bytes; no numeric/alphanumeric/kanji modes).
 *   - Error correction level M only (good balance of scan reliability and
 *     data capacity for the short invite URLs this renders).
 *   - Automatic version selection from 1 to 10 (up to ~213 bytes of byte-mode
 *     data at ECC M — comfortably more than any URL this app generates).
 * The encoding pipeline (data codeword layout, Reed-Solomon error
 * correction, function pattern placement, and mask-penalty scoring) mirrors
 * the original library's algorithm so the output is spec-correct, scannable
 * QR Code data.
 */

const MIN_VERSION = 1;
const MAX_VERSION = 10;

// Error correction codewords per block, and number of error-correction
// blocks, for ECC level M, indexed by version (index 0 is unused/invalid).
// Values come straight from the QR Code model 2 standard's ECC table.
const ECC_CODEWORDS_PER_BLOCK_M = [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26];
const NUM_ERROR_CORRECTION_BLOCKS_M = [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5];

// Fixed format-info mask and ECC-level indicator bits for level M, per the
// QR spec's format information encoding table.
const FORMAT_INFO_MASK = 0x5412;
const FORMAT_ECC_BITS_M = 0b00;

const PENALTY_N1 = 3;
const PENALTY_N2 = 3;
const PENALTY_N3 = 40;
const PENALTY_N4 = 10;

/**
 * Encodes `text` as a QR Code (byte mode, ECC level M) and returns its
 * module matrix as `modules[row][col]`, `true` meaning a dark module.
 * Automatically picks the smallest QR version (1-10) that fits the text.
 */
export function qrModules(text: string): boolean[][] {
  const bytes = utf8Encode(text);
  const version = selectVersion(bytes.length);
  const dataCodewords = buildDataCodewords(bytes, version);
  const allCodewords = addEccAndInterleave(dataCodewords, version);

  const size = version * 4 + 17;
  const modules: boolean[][] = makeGrid(size);
  const isFunction: boolean[][] = makeGrid(size);

  drawFunctionPatterns(modules, isFunction, size, version);
  drawCodewords(modules, isFunction, size, allCodewords);

  // Try all 8 mask patterns and keep whichever minimizes the standard
  // penalty score (fewest scanner-confusing patterns).
  let bestMask = 0;
  let bestPenalty = Infinity;
  for (let mask = 0; mask < 8; mask++) {
    applyMask(modules, isFunction, size, mask);
    drawFormatBits(modules, isFunction, size, mask);
    const penalty = computePenalty(modules, size);
    if (penalty < bestPenalty) {
      bestPenalty = penalty;
      bestMask = mask;
    }
    applyMask(modules, isFunction, size, mask); // XOR again == undo
  }
  applyMask(modules, isFunction, size, bestMask);
  drawFormatBits(modules, isFunction, size, bestMask);

  return modules;
}

function makeGrid(size: number): boolean[][] {
  return Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
}

// ============================================================
// UTF-8 encoding (no Buffer/TextEncoder dependency)
// ============================================================

function utf8Encode(str: string): number[] {
  const bytes: number[] = [];
  for (let i = 0; i < str.length; i++) {
    const codePoint = str.codePointAt(i);
    if (codePoint === undefined) continue;
    if (codePoint > 0xffff) i++; // consumed a surrogate pair

    if (codePoint < 0x80) {
      bytes.push(codePoint);
    } else if (codePoint < 0x800) {
      bytes.push(0xc0 | (codePoint >> 6), 0x80 | (codePoint & 0x3f));
    } else if (codePoint < 0x10000) {
      bytes.push(
        0xe0 | (codePoint >> 12),
        0x80 | ((codePoint >> 6) & 0x3f),
        0x80 | (codePoint & 0x3f)
      );
    } else {
      bytes.push(
        0xf0 | (codePoint >> 18),
        0x80 | ((codePoint >> 12) & 0x3f),
        0x80 | ((codePoint >> 6) & 0x3f),
        0x80 | (codePoint & 0x3f)
      );
    }
  }
  return bytes;
}

// ============================================================
// Capacity / version selection
// ============================================================

function getNumRawDataModules(version: number): number {
  let result = (16 * version + 128) * version + 64;
  if (version >= 2) {
    const numAlign = Math.floor(version / 7) + 2;
    result -= (25 * numAlign - 10) * numAlign - 55;
    if (version >= 7) result -= 36;
  }
  return result;
}

function getTotalCodewords(version: number): number {
  return Math.floor(getNumRawDataModules(version) / 8);
}

function getNumDataCodewords(version: number): number {
  return (
    getTotalCodewords(version) -
    ECC_CODEWORDS_PER_BLOCK_M[version] * NUM_ERROR_CORRECTION_BLOCKS_M[version]
  );
}

function charCountBitsForVersion(version: number): number {
  // Byte-mode character-count indicator width per the QR spec.
  return version <= 9 ? 8 : 16;
}

function selectVersion(byteLength: number): number {
  for (let version = MIN_VERSION; version <= MAX_VERSION; version++) {
    const capacityBits = getNumDataCodewords(version) * 8;
    const requiredBits = 4 + charCountBitsForVersion(version) + byteLength * 8;
    if (requiredBits <= capacityBits) return version;
  }
  const maxBytes =
    Math.floor(
      (getNumDataCodewords(MAX_VERSION) * 8 - 4 - charCountBitsForVersion(MAX_VERSION)) / 8
    );
  throw new Error(
    `qrModules: text is too long to encode at ECC level M within version ${MAX_VERSION} ` +
      `(max ~${maxBytes} bytes, got ${byteLength} bytes).`
  );
}

// ============================================================
// Data codeword construction (mode + count + data + terminator + padding)
// ============================================================

function buildDataCodewords(bytes: number[], version: number): number[] {
  const bits: number[] = [];
  const pushBits = (val: number, len: number) => {
    for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1);
  };

  pushBits(0b0100, 4); // byte mode indicator
  pushBits(bytes.length, charCountBitsForVersion(version));
  for (const b of bytes) pushBits(b, 8);

  const capacityBits = getNumDataCodewords(version) * 8;

  // Terminator (up to 4 zero bits, only as many as fit).
  const terminatorLen = Math.max(0, Math.min(4, capacityBits - bits.length));
  pushBits(0, terminatorLen);

  // Pad to a byte boundary.
  while (bits.length % 8 !== 0) bits.push(0);

  // Pad codewords (alternating 0xEC, 0x11) to fill remaining capacity.
  const padBytes = [0xec, 0x11];
  let p = 0;
  while (bits.length < capacityBits) {
    pushBits(padBytes[p % 2], 8);
    p++;
  }

  const codewords: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8; j++) byte = (byte << 1) | bits[i + j];
    codewords.push(byte);
  }
  return codewords;
}

// ============================================================
// Reed-Solomon error correction (GF(256), primitive polynomial 0x11D)
// ============================================================

function reedSolomonMultiply(x: number, y: number): number {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z & 0xff;
}

function reedSolomonComputeDivisor(degree: number): number[] {
  const result = new Array<number>(degree).fill(0);
  result[degree - 1] = 1; // start with the monomial x^0

  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < result.length; j++) {
      result[j] = reedSolomonMultiply(result[j], root);
      if (j + 1 < result.length) result[j] ^= result[j + 1];
    }
    root = reedSolomonMultiply(root, 0x02);
  }
  return result;
}

function reedSolomonComputeRemainder(data: number[], divisor: number[]): number[] {
  let result = divisor.map(() => 0);
  for (const b of data) {
    const factor = b ^ (result.shift() as number);
    result.push(0);
    divisor.forEach((coef, i) => {
      result[i] ^= reedSolomonMultiply(coef, factor);
    });
  }
  return result;
}

/**
 * Splits data codewords into the version's ECC blocks, computes each
 * block's Reed-Solomon remainder, and interleaves data+ECC codewords in
 * the order the QR spec requires them to be read off the matrix.
 */
function addEccAndInterleave(dataCodewords: number[], version: number): number[] {
  const numBlocks = NUM_ERROR_CORRECTION_BLOCKS_M[version];
  const blockEccLen = ECC_CODEWORDS_PER_BLOCK_M[version];
  const rawCodewords = getTotalCodewords(version);
  const numShortBlocks = numBlocks - (rawCodewords % numBlocks);
  const shortBlockLen = Math.floor(rawCodewords / numBlocks);

  const rsDiv = reedSolomonComputeDivisor(blockEccLen);
  const blocks: number[][] = [];
  let k = 0;
  for (let i = 0; i < numBlocks; i++) {
    const len = shortBlockLen - blockEccLen + (i < numShortBlocks ? 0 : 1);
    const dat = dataCodewords.slice(k, k + len);
    k += dat.length;
    const ecc = reedSolomonComputeRemainder(dat, rsDiv);
    if (i < numShortBlocks) dat.push(0); // pad short blocks to align interleaving
    blocks.push(dat.concat(ecc));
  }

  const result: number[] = [];
  for (let i = 0; i < blocks[0].length; i++) {
    blocks.forEach((block, j) => {
      // Skip the padding codeword inserted into short blocks above.
      if (i !== shortBlockLen - blockEccLen || j >= numShortBlocks) {
        result.push(block[i]);
      }
    });
  }
  return result;
}

// ============================================================
// Matrix drawing: function patterns, codeword placement, masking
// ============================================================

function setFunctionModule(
  modules: boolean[][],
  isFunction: boolean[][],
  x: number,
  y: number,
  dark: boolean
) {
  modules[y][x] = dark;
  isFunction[y][x] = true;
}

function getBit(x: number, i: number): boolean {
  return ((x >>> i) & 1) !== 0;
}

function drawFinderPattern(
  modules: boolean[][],
  isFunction: boolean[][],
  size: number,
  cx: number,
  cy: number
) {
  for (let dy = -4; dy <= 4; dy++) {
    for (let dx = -4; dx <= 4; dx++) {
      const dist = Math.max(Math.abs(dx), Math.abs(dy));
      const x = cx + dx;
      const y = cy + dy;
      if (x >= 0 && x < size && y >= 0 && y < size) {
        setFunctionModule(modules, isFunction, x, y, dist !== 2 && dist !== 4);
      }
    }
  }
}

function drawAlignmentPattern(
  modules: boolean[][],
  isFunction: boolean[][],
  cx: number,
  cy: number
) {
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      setFunctionModule(
        modules,
        isFunction,
        cx + dx,
        cy + dy,
        Math.max(Math.abs(dx), Math.abs(dy)) !== 1
      );
    }
  }
}

function getAlignmentPatternPositions(version: number, size: number): number[] {
  if (version === 1) return [];
  const numAlign = Math.floor(version / 7) + 2;
  const step =
    version === 32 ? 26 : Math.ceil((version * 4 + 4) / (numAlign * 2 - 2)) * 2;
  const result = [6];
  for (let pos = size - 7; result.length < numAlign; pos -= step) {
    result.splice(1, 0, pos);
  }
  return result;
}

function drawFormatBits(
  modules: boolean[][],
  isFunction: boolean[][],
  size: number,
  mask: number
) {
  const data = (FORMAT_ECC_BITS_M << 3) | mask;
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  const bits = ((data << 10) | rem) ^ FORMAT_INFO_MASK;

  for (let i = 0; i <= 5; i++) setFunctionModule(modules, isFunction, 8, i, getBit(bits, i));
  setFunctionModule(modules, isFunction, 8, 7, getBit(bits, 6));
  setFunctionModule(modules, isFunction, 8, 8, getBit(bits, 7));
  setFunctionModule(modules, isFunction, 7, 8, getBit(bits, 8));
  for (let i = 9; i < 15; i++) setFunctionModule(modules, isFunction, 14 - i, 8, getBit(bits, i));

  for (let i = 0; i < 8; i++) {
    setFunctionModule(modules, isFunction, size - 1 - i, 8, getBit(bits, i));
  }
  for (let i = 8; i < 15; i++) {
    setFunctionModule(modules, isFunction, 8, size - 15 + i, getBit(bits, i));
  }
  setFunctionModule(modules, isFunction, 8, size - 8, true); // always-dark module
}

function drawVersionInfo(
  modules: boolean[][],
  isFunction: boolean[][],
  size: number,
  version: number
) {
  if (version < 7) return;
  let rem = version;
  for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
  const bits = (version << 12) | rem;
  for (let i = 0; i < 18; i++) {
    const bit = getBit(bits, i);
    const a = size - 11 + (i % 3);
    const b = Math.floor(i / 3);
    setFunctionModule(modules, isFunction, a, b, bit);
    setFunctionModule(modules, isFunction, b, a, bit);
  }
}

function drawFunctionPatterns(
  modules: boolean[][],
  isFunction: boolean[][],
  size: number,
  version: number
) {
  // Timing patterns (row/col 6, alternating dark/light starting dark).
  for (let i = 0; i < size; i++) {
    setFunctionModule(modules, isFunction, 6, i, i % 2 === 0);
    setFunctionModule(modules, isFunction, i, 6, i % 2 === 0);
  }

  // Finder patterns in the three non-bottom-right corners.
  drawFinderPattern(modules, isFunction, size, 3, 3);
  drawFinderPattern(modules, isFunction, size, size - 4, 3);
  drawFinderPattern(modules, isFunction, size, 3, size - 4);

  // Alignment patterns (skip the three finder corners).
  const alignPos = getAlignmentPatternPositions(version, size);
  const n = alignPos.length;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if ((i === 0 && j === 0) || (i === 0 && j === n - 1) || (i === n - 1 && j === 0)) {
        continue;
      }
      drawAlignmentPattern(modules, isFunction, alignPos[i], alignPos[j]);
    }
  }

  // Reserve format-info area (dummy mask 0; overwritten after mask selection)
  // and draw version info (fixed regardless of mask, versions 7+ only).
  drawFormatBits(modules, isFunction, size, 0);
  drawVersionInfo(modules, isFunction, size, version);
}

function drawCodewords(
  modules: boolean[][],
  isFunction: boolean[][],
  size: number,
  data: number[]
) {
  let i = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5; // skip the vertical timing column
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - vert : vert;
        if (!isFunction[y][x] && i < data.length * 8) {
          modules[y][x] = getBit(data[i >>> 3], 7 - (i & 7));
          i++;
        }
      }
    }
  }
}

function getMaskBit(mask: number, x: number, y: number): boolean {
  switch (mask) {
    case 0:
      return (x + y) % 2 === 0;
    case 1:
      return y % 2 === 0;
    case 2:
      return x % 3 === 0;
    case 3:
      return (x + y) % 3 === 0;
    case 4:
      return (Math.floor(y / 2) + Math.floor(x / 3)) % 2 === 0;
    case 5:
      return ((x * y) % 2) + ((x * y) % 3) === 0;
    case 6:
      return (((x * y) % 2) + ((x * y) % 3)) % 2 === 0;
    case 7:
      return (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
    default:
      throw new Error(`qrModules: invalid mask ${mask}`);
  }
}

function applyMask(
  modules: boolean[][],
  isFunction: boolean[][],
  size: number,
  mask: number
) {
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (!isFunction[y][x] && getMaskBit(mask, x, y)) {
        modules[y][x] = !modules[y][x];
      }
    }
  }
}

// ============================================================
// Mask penalty scoring (the 4 standard QR penalty rules)
// ============================================================

function finderPenaltyCountPatterns(runHistory: number[]): number {
  const n = runHistory[1];
  const core =
    n > 0 &&
    runHistory[2] === n &&
    runHistory[3] === n * 3 &&
    runHistory[4] === n &&
    runHistory[5] === n;
  let count = 0;
  if (core && runHistory[0] >= n * 4 && runHistory[6] >= n) count++;
  if (core && runHistory[6] >= n * 4 && runHistory[0] >= n) count++;
  return count;
}

function finderPenaltyAddHistory(currentRunLength: number, runHistory: number[], size: number) {
  let len = currentRunLength;
  if (runHistory[0] === 0) len += size; // initial run includes the light border
  runHistory.pop();
  runHistory.unshift(len);
}

function finderPenaltyTerminateAndCount(
  currentRunColor: boolean,
  currentRunLength: number,
  runHistory: number[],
  size: number
): number {
  let len = currentRunLength;
  if (currentRunColor) {
    finderPenaltyAddHistory(len, runHistory, size);
    len = 0;
  }
  len += size; // final run includes the light border
  finderPenaltyAddHistory(len, runHistory, size);
  return finderPenaltyCountPatterns(runHistory);
}

function computePenalty(modules: boolean[][], size: number): number {
  let result = 0;

  // Rule 1 & 3: same-color runs and finder-like patterns, per row.
  for (let y = 0; y < size; y++) {
    let runColor = false;
    let runX = 0;
    const runHistory = [0, 0, 0, 0, 0, 0, 0];
    for (let x = 0; x < size; x++) {
      if (modules[y][x] === runColor) {
        runX++;
        if (runX === 5) result += PENALTY_N1;
        else if (runX > 5) result++;
      } else {
        finderPenaltyAddHistory(runX, runHistory, size);
        if (!runColor) result += finderPenaltyCountPatterns(runHistory) * PENALTY_N3;
        runColor = modules[y][x];
        runX = 1;
      }
    }
    result += finderPenaltyTerminateAndCount(runColor, runX, runHistory, size) * PENALTY_N3;
  }

  // Rule 1 & 3: same-color runs and finder-like patterns, per column.
  for (let x = 0; x < size; x++) {
    let runColor = false;
    let runY = 0;
    const runHistory = [0, 0, 0, 0, 0, 0, 0];
    for (let y = 0; y < size; y++) {
      if (modules[y][x] === runColor) {
        runY++;
        if (runY === 5) result += PENALTY_N1;
        else if (runY > 5) result++;
      } else {
        finderPenaltyAddHistory(runY, runHistory, size);
        if (!runColor) result += finderPenaltyCountPatterns(runHistory) * PENALTY_N3;
        runColor = modules[y][x];
        runY = 1;
      }
    }
    result += finderPenaltyTerminateAndCount(runColor, runY, runHistory, size) * PENALTY_N3;
  }

  // Rule 2: 2x2 blocks of the same color.
  for (let y = 0; y < size - 1; y++) {
    for (let x = 0; x < size - 1; x++) {
      const color = modules[y][x];
      if (
        color === modules[y][x + 1] &&
        color === modules[y + 1][x] &&
        color === modules[y + 1][x + 1]
      ) {
        result += PENALTY_N2;
      }
    }
  }

  // Rule 4: balance of dark vs. light modules.
  let dark = 0;
  for (const row of modules) {
    for (const cell of row) if (cell) dark++;
  }
  const total = size * size;
  const k = Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1;
  result += k * PENALTY_N4;

  return result;
}
