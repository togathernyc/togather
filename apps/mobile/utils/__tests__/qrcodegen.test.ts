import { qrModules } from '../qrcodegen';

describe('qrModules', () => {
  test('returns a square, odd-sized matrix', () => {
    const modules = qrModules('https://togather.nyc/c/demo');
    const size = modules.length;
    expect(size).toBeGreaterThan(0);
    expect(size % 2).toBe(1);
    for (const row of modules) {
      expect(row.length).toBe(size);
    }
  });

  test('places a 7x7 finder pattern at the top-left corner', () => {
    const modules = qrModules('https://togather.nyc/g/abc123');

    // Standard QR finder pattern: solid 7x7 dark border, one-module light
    // ring inside it, solid 3x3 dark core.
    for (let y = 0; y < 7; y++) {
      for (let x = 0; x < 7; x++) {
        const isBorder = x === 0 || x === 6 || y === 0 || y === 6;
        const isCore = x >= 2 && x <= 4 && y >= 2 && y <= 4;
        const expected = isBorder || isCore;
        expect(modules[y][x]).toBe(expected);
      }
    }
  });

  test('places finder patterns at all three non-bottom-right corners', () => {
    const modules = qrModules('https://togather.nyc/g/abc123');
    const size = modules.length;

    const isFinderShape = (getModule: (dx: number, dy: number) => boolean) => {
      for (let y = 0; y < 7; y++) {
        for (let x = 0; x < 7; x++) {
          const isBorder = x === 0 || x === 6 || y === 0 || y === 6;
          const isCore = x >= 2 && x <= 4 && y >= 2 && y <= 4;
          if (getModule(x, y) !== (isBorder || isCore)) return false;
        }
      }
      return true;
    };

    // Top-right finder pattern starts at column (size - 7).
    expect(isFinderShape((dx, dy) => modules[dy][size - 7 + dx])).toBe(true);
    // Bottom-left finder pattern starts at row (size - 7).
    expect(isFinderShape((dx, dy) => modules[size - 7 + dy][dx])).toBe(true);
  });

  test('timing patterns on row 6 and column 6 alternate dark/light', () => {
    const modules = qrModules('https://togather.nyc/c/demo');
    const size = modules.length;

    // The timing pattern runs between the two finder patterns (columns/rows
    // 8 .. size-9) and must strictly alternate, starting dark at an even
    // offset from the pattern's own start.
    for (let x = 8; x <= size - 9; x++) {
      expect(modules[6][x]).toBe(x % 2 === 0);
    }
    for (let y = 8; y <= size - 9; y++) {
      expect(modules[y][6]).toBe(y % 2 === 0);
    }
  });

  test('different inputs produce different matrices', () => {
    const a = qrModules('https://togather.nyc/c/fount');
    const b = qrModules('https://togather.nyc/c/riverside');

    // Compare flattened matrices; they should differ somewhere (and,
    // generally, in overall shape/size too since content length differs).
    const flatten = (m: boolean[][]) => m.map((row) => row.join('')).join('|');
    expect(flatten(a)).not.toBe(flatten(b));
  });

  test('same input produces a deterministic matrix', () => {
    const a = qrModules('https://togather.nyc/c/fount');
    const b = qrModules('https://togather.nyc/c/fount');
    expect(a).toEqual(b);
  });

  test('throws a clear error for text exceeding version-10 ECC-M capacity', () => {
    const tooLong = 'x'.repeat(500);
    expect(() => qrModules(tooLong)).toThrow(/too long/i);
  });
});

describe('golden vector', () => {
  // Full-matrix regression check: this exact output was verified scannable
  // (independent zbar decode round-trip during PR #637 review). A change in
  // ECC, interleaving, masking, or format-info placement — which the
  // structural tests above cannot see — changes this hash.
  test('known input reproduces the verified matrix', () => {
    const mods = qrModules('https://livinggrace.togather.nyc');
    expect(mods.length).toBe(29); // version 3

    const s = mods.map((r) => r.map((b) => (b ? '1' : '0')).join('')).join('|');
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    expect(h.toString(16)).toBe('a03d811b');
  });
});
