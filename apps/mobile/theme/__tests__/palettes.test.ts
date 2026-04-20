import {
  lightColors,
  darkColors,
  hearthColors,
  consoleColors,
  conservatoryColors,
  type ThemeColors,
} from '../colors';

// The full list of keys that every palette MUST provide. Derived from lightColors —
// if a new token is added to the contract, lightColors will have it and this list
// will catch palettes that forgot.
const REQUIRED_KEYS = Object.keys(lightColors) as Array<keyof ThemeColors>;

const PALETTES: Array<{ name: string; palette: ThemeColors }> = [
  { name: 'lightColors', palette: lightColors },
  { name: 'darkColors', palette: darkColors },
  { name: 'hearthColors', palette: hearthColors },
  { name: 'consoleColors', palette: consoleColors },
  { name: 'conservatoryColors', palette: conservatoryColors },
];

describe('theme palettes', () => {
  PALETTES.forEach(({ name, palette }) => {
    describe(name, () => {
      test('implements every ThemeColors key', () => {
        const missing = REQUIRED_KEYS.filter((key) => palette[key] === undefined);
        expect(missing).toEqual([]);
      });

      test('every value is a non-empty string', () => {
        const bad: string[] = [];
        for (const key of REQUIRED_KEYS) {
          const value = palette[key];
          if (typeof value !== 'string' || value.length === 0) {
            bad.push(`${key}=${String(value)}`);
          }
        }
        expect(bad).toEqual([]);
      });

      test('every value is a valid CSS color (hex or rgba)', () => {
        const cssColor = /^(#[0-9a-fA-F]{3,8}|rgba?\([^)]+\))$/;
        const bad: string[] = [];
        for (const key of REQUIRED_KEYS) {
          if (!cssColor.test(palette[key])) {
            bad.push(`${key}=${palette[key]}`);
          }
        }
        expect(bad).toEqual([]);
      });
    });
  });

  test('all palettes share the exact same key set', () => {
    const reference = new Set(REQUIRED_KEYS);
    for (const { name, palette } of PALETTES) {
      const keys = new Set(Object.keys(palette));
      const extra = [...keys].filter((k) => !reference.has(k as keyof ThemeColors));
      const missing = [...reference].filter((k) => !keys.has(k));
      expect({ name, extra, missing }).toEqual({ name, extra: [], missing: [] });
    }
  });
});
