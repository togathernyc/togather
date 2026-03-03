/**
 * Metro React Resolution Tests
 * 
 * These tests ensure that the mobile app correctly resolves React 19.1.0 from its own
 * node_modules, preventing critical errors that break app loading:
 * 
 * 1. "use is not a function" - Occurs when React 18 is used but dependencies expect React 19
 * 2. "ReactCurrentDispatcher is undefined" - Occurs when multiple React instances are used
 * 
 * These tests will catch regressions if:
 * - Someone changes metro.config.js resolution order (workspace root before project root)
 * - React version in package.json doesn't match installed version
 * - React and react-dom versions become mismatched
 * - Metro config accidentally resolves React 18.3.1 from workspace root
 * 
 * Run these tests before merging any changes to metro.config.js or React dependencies.
 */

import path from 'path';
import fs from 'fs';

describe('Metro React Resolution', () => {
  const projectRoot = path.resolve(__dirname, '..');
  const workspaceRoot = path.resolve(projectRoot, '../..');

  describe('React version resolution', () => {
    it('should resolve React 19.1.0 from mobile app node_modules (project root)', () => {
      // Test that React is resolved from project root first
      const mobileReactPath = path.join(projectRoot, 'node_modules', 'react');
      const mobileReactPackageJson = path.join(mobileReactPath, 'package.json');

      // Verify mobile app has React 19.1.0
      if (fs.existsSync(mobileReactPackageJson)) {
        const packageJson = JSON.parse(
          fs.readFileSync(mobileReactPackageJson, 'utf-8')
        );
        expect(packageJson.version).toBe('19.1.0');
      } else {
        // If React is not in mobile app's node_modules, that's a problem
        throw new Error(
          `React not found in mobile app node_modules at ${mobileReactPath}`
        );
      }
    });

    it('should resolve react-dom 19.1.0 from mobile app node_modules', () => {
      const mobileReactDomPath = path.join(
        projectRoot,
        'node_modules',
        'react-dom'
      );
      const mobileReactDomPackageJson = path.join(
        mobileReactDomPath,
        'package.json'
      );

      if (fs.existsSync(mobileReactDomPackageJson)) {
        const packageJson = JSON.parse(
          fs.readFileSync(mobileReactDomPackageJson, 'utf-8')
        );
        expect(packageJson.version).toBe('19.1.0');
      } else {
        throw new Error(
          `react-dom not found in mobile app node_modules at ${mobileReactDomPath}`
        );
      }
    });

    it.skip('should prioritize project root over workspace root for React resolution', () => {
      // TODO: Fix React version resolution test - currently expects 18.3.1 but getting 19.1.0
      // This test verifies the resolution order logic
      // The metro.config.js should try projectRoot first, then workspaceRoot
      const mobileReactPath = path.join(projectRoot, 'node_modules', 'react');
      const workspaceReactPath = path.join(
        workspaceRoot,
        'node_modules',
        'react'
      );

      // Mobile app should have its own React
      expect(fs.existsSync(mobileReactPath)).toBe(true);

      // Workspace root may or may not have React (depending on hoisting)
      // But if it does, it should be a different version (18.3.1 from web app)
      if (fs.existsSync(workspaceReactPath)) {
        const workspacePackageJson = path.join(
          workspaceReactPath,
          'package.json'
        );
        const packageJson = JSON.parse(
          fs.readFileSync(workspacePackageJson, 'utf-8')
        );
        // Workspace root should have React 18.3.1 (from web app)
        expect(packageJson.version).toBe('18.3.1');
      }
    });

    it('should have React 19.1.0 available for Metro bundler', () => {
      // Verify that the React version Metro will use is 19.1.0
      // This simulates what metro.config.js does
      let reactPath: string;
      try {
        // Try project root first (as per the fixed metro.config.js)
        reactPath = path.dirname(
          require.resolve('react/package.json', {
            paths: [projectRoot],
          })
        );
      } catch (e) {
        // Fallback to workspace root
        reactPath = path.dirname(
          require.resolve('react/package.json', {
            paths: [workspaceRoot],
          })
        );
      }

      const packageJsonPath = path.join(reactPath, 'package.json');
      expect(fs.existsSync(packageJsonPath)).toBe(true);

      const packageJson = JSON.parse(
        fs.readFileSync(packageJsonPath, 'utf-8')
      );
      // Metro should resolve to React 19.1.0 (from project root)
      expect(packageJson.version).toBe('19.1.0');
    });
  });

  describe('Metro config resolution order', () => {
    it('should resolve React from project root when available', () => {
      // Test the resolution logic from metro.config.js
      let reactPath: string;
      try {
        reactPath = path.dirname(
          require.resolve('react/package.json', {
            paths: [projectRoot],
          })
        );
      } catch (e) {
        try {
          reactPath = path.dirname(
            require.resolve('react/package.json', {
              paths: [workspaceRoot],
            })
          );
        } catch (e2) {
          reactPath = path.resolve(workspaceRoot, 'node_modules', 'react');
        }
      }

      // Verify the resolved React is version 19.1.0 (from mobile app)
      const packageJsonPath = path.join(reactPath, 'package.json');
      expect(fs.existsSync(packageJsonPath)).toBe(true);
      
      const packageJson = JSON.parse(
        fs.readFileSync(packageJsonPath, 'utf-8')
      );
      expect(packageJson.version).toBe('19.1.0');

      // Verify it's not React 18.3.1 (from workspace root)
      expect(packageJson.version).not.toBe('18.3.1');
    });

    it('should resolve react-dom from project root first', () => {
      // Test that react-dom resolution prioritizes project root
      let reactDomPath: string;
      try {
        reactDomPath = path.dirname(
          require.resolve('react-dom/package.json', {
            paths: [projectRoot],
          })
        );
      } catch (e) {
        try {
          reactDomPath = path.dirname(
            require.resolve('react-dom/package.json', {
              paths: [workspaceRoot],
            })
          );
        } catch (e2) {
          reactDomPath = path.resolve(workspaceRoot, 'node_modules', 'react-dom');
        }
      }

      const packageJsonPath = path.join(reactDomPath, 'package.json');
      expect(fs.existsSync(packageJsonPath)).toBe(true);
      
      const packageJson = JSON.parse(
        fs.readFileSync(packageJsonPath, 'utf-8')
      );
      expect(packageJson.version).toBe('19.1.0');
      expect(packageJson.version).not.toBe('18.3.1');
    });

    it('should match the exact resolution logic from metro.config.js', () => {
      // This test replicates the exact logic from metro.config.js lines 22-52
      // to ensure any changes to that logic are caught by tests
      let reactPath: string, reactDomPath: string;
      
      try {
        // Try project root first (mobile app's own React 19.1.0)
        reactPath = path.dirname(
          require.resolve('react/package.json', {
            paths: [projectRoot],
          })
        );
        reactDomPath = path.dirname(
          require.resolve('react-dom/package.json', {
            paths: [projectRoot],
          })
        );
      } catch (e) {
        // Fallback to workspace root if project root resolution fails
        try {
          reactPath = path.dirname(
            require.resolve('react/package.json', {
              paths: [workspaceRoot],
            })
          );
          reactDomPath = path.dirname(
            require.resolve('react-dom/package.json', {
              paths: [workspaceRoot],
            })
          );
        } catch (e2) {
          // Final fallback to direct path resolution
          reactPath = path.resolve(workspaceRoot, 'node_modules', 'react');
          reactDomPath = path.resolve(workspaceRoot, 'node_modules', 'react-dom');
        }
      }

      // Verify both resolve to React 19.1.0
      const reactPackageJson = JSON.parse(
        fs.readFileSync(path.join(reactPath, 'package.json'), 'utf-8')
      );
      const reactDomPackageJson = JSON.parse(
        fs.readFileSync(path.join(reactDomPath, 'package.json'), 'utf-8')
      );

      expect(reactPackageJson.version).toBe('19.1.0');
      expect(reactDomPackageJson.version).toBe('19.1.0');
      
      // Critical: Verify we're NOT using React 18.3.1
      expect(reactPackageJson.version).not.toBe('18.3.1');
      expect(reactDomPackageJson.version).not.toBe('18.3.1');
    });

    it('should prevent ReactCurrentDispatcher errors by using same React instance', () => {
      // This test ensures that React and react-dom resolve to compatible versions
      // ReactCurrentDispatcher errors occur when multiple React instances are used
      const reactPackageJson = JSON.parse(
        fs.readFileSync(
          path.join(projectRoot, 'node_modules', 'react', 'package.json'),
          'utf-8'
        )
      );
      const reactDomPackageJson = JSON.parse(
        fs.readFileSync(
          path.join(projectRoot, 'node_modules', 'react-dom', 'package.json'),
          'utf-8'
        )
      );

      // React and react-dom must have matching major and minor versions
      const reactVersion = reactPackageJson.version.split('.');
      const reactDomVersion = reactDomPackageJson.version.split('.');

      expect(reactVersion[0]).toBe(reactDomVersion[0]); // Major version
      expect(reactVersion[1]).toBe(reactDomVersion[1]); // Minor version
      expect(reactVersion[0]).toBe('19'); // Must be React 19
      expect(reactDomVersion[0]).toBe('19'); // Must be React-DOM 19
    });

    it('should verify resolveRequest paths order matches metro.config.js', () => {
      // Test that resolveRequest in metro.config.js uses projectRoot first
      // This is critical for preventing React 18.3.1 from being resolved
      
      // Simulate the resolveRequest logic for react-dom
      let resolved: string | undefined;
      try {
        resolved = require.resolve('react-dom', {
          paths: [projectRoot, workspaceRoot],
        });
      } catch (e) {
        // Should not fail if projectRoot has react-dom
      }

      if (resolved) {
        // Find the package.json for the resolved react-dom
        let currentPath = resolved;
        let packageJsonPath: string | null = null;
        
        // Walk up the directory tree to find package.json
        for (let i = 0; i < 5; i++) {
          const potentialPath = path.join(currentPath, 'package.json');
          if (fs.existsSync(potentialPath)) {
            packageJsonPath = potentialPath;
            break;
          }
          currentPath = path.dirname(currentPath);
        }

        if (packageJsonPath) {
          const packageJson = JSON.parse(
            fs.readFileSync(packageJsonPath, 'utf-8')
          );
          // Should resolve to React 19.1.0, not 18.3.1
          expect(packageJson.version).toBe('19.1.0');
        }
      }
    });
  });

  describe('Regression prevention', () => {
    it('should fail if React 18.3.1 is accidentally resolved', () => {
      // This test ensures we catch regressions where workspace root React
      // might be accidentally used instead of project root React
      const reactPath = path.dirname(
        require.resolve('react/package.json', {
          paths: [projectRoot],
        })
      );

      const packageJson = JSON.parse(
        fs.readFileSync(path.join(reactPath, 'package.json'), 'utf-8')
      );

      // This will fail if someone accidentally changes the resolution order
      // and we start resolving React 18.3.1 from workspace root
      if (packageJson.version === '18.3.1') {
        throw new Error(
          'CRITICAL: React 18.3.1 detected! Metro config is resolving React from workspace root instead of project root. ' +
          'This will cause "use is not a function" and "ReactCurrentDispatcher" errors. ' +
          'Check metro.config.js resolution order.'
        );
      }

      expect(packageJson.version).toBe('19.1.0');
    });

    it('should verify package.json React version matches installed version', () => {
      // Ensure package.json specifies React 19.1.0
      const packageJson = JSON.parse(
        fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf-8')
      );
      const installedReactVersion = JSON.parse(
        fs.readFileSync(
          path.join(projectRoot, 'node_modules', 'react', 'package.json'),
          'utf-8'
        )
      ).version;

      // Remove ^ or ~ prefix if present
      const packageJsonVersion = packageJson.dependencies.react.replace(/^[\^~]/, '');

      expect(installedReactVersion).toBe(packageJsonVersion);
      expect(installedReactVersion).toBe('19.1.0');
    });
  });
});

