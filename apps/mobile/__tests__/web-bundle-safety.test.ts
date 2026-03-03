/**
 * Web Bundle Safety Tests
 *
 * These tests prevent native-only code from breaking the web bundle.
 *
 * Background: Zustand v5's `zustand/middleware` uses `import.meta.env.MODE` which
 * crashes Metro web bundles (served as regular <script>, not ES modules).
 * Similarly, modules like `@react-native-community/netinfo` may not have web support.
 *
 * The fix: every file importing native-only packages must have a `.web.ts`/`.web.tsx`
 * counterpart that Metro will resolve instead when bundling for web.
 *
 * These tests will catch regressions if:
 * - Someone adds a new Zustand store without a .web.ts no-op
 * - Someone adds a new provider using native-only modules without a .web.tsx counterpart
 * - A .web.ts counterpart is missing an export that importers depend on
 */

import fs from 'fs';
import path from 'path';

const mobileRoot = path.resolve(__dirname, '..');

/**
 * Recursively find all .ts/.tsx files in a directory (excluding .web., .test., __tests__, node_modules)
 */
function findSourceFiles(dir: string, extensions: string[] = ['.ts', '.tsx']): string[] {
  const results: string[] = [];
  if (!fs.existsSync(dir)) return results;

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === '__tests__') continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findSourceFiles(fullPath, extensions));
    } else if (
      extensions.some(ext => entry.name.endsWith(ext)) &&
      !entry.name.includes('.web.') &&
      !entry.name.includes('.test.') &&
      !entry.name.includes('.spec.')
    ) {
      results.push(fullPath);
    }
  }
  return results;
}

/**
 * Check if a file imports from a specific package
 */
function fileImportsPackage(filePath: string, packagePattern: RegExp): boolean {
  const content = fs.readFileSync(filePath, 'utf-8');
  return packagePattern.test(content);
}

/**
 * Get the web counterpart path for a given file
 */
function getWebCounterpart(filePath: string): string {
  const ext = path.extname(filePath);
  const base = filePath.slice(0, -ext.length);
  return `${base}.web${ext}`;
}

/**
 * Extract named exports from a file (simple regex-based)
 */
function getExportedNames(filePath: string): string[] {
  if (!fs.existsSync(filePath)) return [];
  const content = fs.readFileSync(filePath, 'utf-8');
  const exports: string[] = [];

  // Match: export const/let/var/function/class NAME
  const namedExportPattern = /export\s+(?:const|let|var|function|class)\s+(\w+)/g;
  let match;
  while ((match = namedExportPattern.exec(content)) !== null) {
    exports.push(match[1]);
  }

  // Match: export default
  if (/export\s+default\s/.test(content)) {
    exports.push('default');
  }

  return exports;
}

describe('Web Bundle Safety', () => {
  describe('Zustand stores must have .web.ts counterparts', () => {
    const storesDir = path.join(mobileRoot, 'stores');
    const storeFiles = findSourceFiles(storesDir, ['.ts']);

    // Find all store files that import from zustand
    const zustandStores = storeFiles.filter(f =>
      fileImportsPackage(f, /from\s+['"]zustand/)
    );

    it('should find at least one Zustand store (sanity check)', () => {
      expect(zustandStores.length).toBeGreaterThan(0);
    });

    for (const storeFile of zustandStores) {
      const relativePath = path.relative(mobileRoot, storeFile);
      const webCounterpart = getWebCounterpart(storeFile);
      const webRelativePath = path.relative(mobileRoot, webCounterpart);

      it(`${relativePath} must have a web counterpart (${webRelativePath})`, () => {
        expect(fs.existsSync(webCounterpart)).toBe(true);
      });

      it(`${webRelativePath} must NOT import from zustand`, () => {
        if (fs.existsSync(webCounterpart)) {
          const content = fs.readFileSync(webCounterpart, 'utf-8');
          expect(content).not.toMatch(/from\s+['"]zustand/);
        }
      });

      it(`${webRelativePath} must export the same symbols as ${relativePath}`, () => {
        if (fs.existsSync(webCounterpart)) {
          const nativeExports = getExportedNames(storeFile);
          const webExports = getExportedNames(webCounterpart);

          for (const exportName of nativeExports) {
            expect(webExports).toContain(exportName);
          }
        }
      });
    }
  });

  describe('Native-only providers must have .web.tsx counterparts', () => {
    const providersDir = path.join(mobileRoot, 'providers');
    const providerFiles = findSourceFiles(providersDir, ['.tsx']);

    // ConnectionProvider uses useConvexConnectionState (custom native hook for WebSocket monitoring).
    // It needs a .web.tsx counterpart because it ties into native connection monitoring.
    // Note: @react-native-community/netinfo has built-in web support and does NOT need a counterpart.
    const nativeOnlyProviders = providerFiles.filter(f =>
      fileImportsPackage(f, /useConvexConnectionState/)
    );

    for (const providerFile of nativeOnlyProviders) {
      const relativePath = path.relative(mobileRoot, providerFile);
      const webCounterpart = getWebCounterpart(providerFile);
      const webRelativePath = path.relative(mobileRoot, webCounterpart);

      it(`${relativePath} must have a web counterpart (${webRelativePath})`, () => {
        expect(fs.existsSync(webCounterpart)).toBe(true);
      });

      it(`${webRelativePath} must export the same symbols as ${relativePath}`, () => {
        if (fs.existsSync(webCounterpart)) {
          const nativeExports = getExportedNames(providerFile);
          const webExports = getExportedNames(webCounterpart);

          for (const exportName of nativeExports) {
            expect(webExports).toContain(exportName);
          }
        }
      });
    }
  });

  describe('Web counterpart files must not use import.meta', () => {
    const webFiles = [
      ...findWebFiles(path.join(mobileRoot, 'stores')),
      ...findWebFiles(path.join(mobileRoot, 'providers')),
      ...findWebFiles(path.join(mobileRoot, 'components')),
    ];

    function findWebFiles(dir: string): string[] {
      if (!fs.existsSync(dir)) return [];
      const results: string[] = [];
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name === 'node_modules') continue;
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          results.push(...findWebFiles(fullPath));
        } else if (entry.name.includes('.web.')) {
          results.push(fullPath);
        }
      }
      return results;
    }

    for (const webFile of webFiles) {
      const relativePath = path.relative(mobileRoot, webFile);

      it(`${relativePath} must not contain import.meta`, () => {
        const content = fs.readFileSync(webFile, 'utf-8');
        expect(content).not.toMatch(/import\.meta/);
      });
    }
  });

  describe('Share page routes exist and are valid', () => {
    it('group share page route exists at app/g/[shortId]/', () => {
      const routeDir = path.join(mobileRoot, 'app', 'g', '[shortId]');
      expect(fs.existsSync(routeDir)).toBe(true);

      const indexFile = path.join(routeDir, 'index.tsx');
      expect(fs.existsSync(indexFile)).toBe(true);

      // Verify it renders GroupPageClient
      const content = fs.readFileSync(indexFile, 'utf-8');
      expect(content).toMatch(/GroupPageClient/);
    });

    it('event share page route exists at app/e/[shortId]/', () => {
      const routeDir = path.join(mobileRoot, 'app', 'e', '[shortId]');
      expect(fs.existsSync(routeDir)).toBe(true);

      const indexFile = path.join(routeDir, 'index.tsx');
      expect(fs.existsSync(indexFile)).toBe(true);

      // Verify it renders EventPageClient
      const content = fs.readFileSync(indexFile, 'utf-8');
      expect(content).toMatch(/EventPageClient/);
    });

    it('GroupPageClient does not directly import native-only packages', () => {
      const clientFile = path.join(mobileRoot, 'app', 'g', '[shortId]', 'GroupPageClient.tsx');
      expect(fs.existsSync(clientFile)).toBe(true);

      const content = fs.readFileSync(clientFile, 'utf-8');
      // Share pages should not import zustand or native-only packages directly
      expect(content).not.toMatch(/from\s+['"]zustand/);
      expect(content).not.toMatch(/import\.meta/);
    });

    it('EventPageClient does not directly import native-only packages', () => {
      const clientFile = path.join(mobileRoot, 'app', 'e', '[shortId]', 'EventPageClient.tsx');
      expect(fs.existsSync(clientFile)).toBe(true);

      const content = fs.readFileSync(clientFile, 'utf-8');
      // Share pages should not import zustand or native-only packages directly
      expect(content).not.toMatch(/from\s+['"]zustand/);
      expect(content).not.toMatch(/import\.meta/);
    });
  });
});
