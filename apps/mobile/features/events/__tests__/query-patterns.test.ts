/**
 * Source-level regression test: ensure events feature files do NOT use the
 * raw `useQuery` + `token` spread pattern.
 *
 * ## Why this test exists
 *
 * Token refreshes (foreground resume, periodic refresh, login) cause
 * `useAuth().token` to emit a new string. Any hook/component that
 *
 *   const { token } = useAuth();
 *   const args = useMemo(() => ({ ...other, token }), [..., token]);
 *   useQuery(api.foo.bar, args);
 *
 * ...re-memoizes `args` on every token change, which causes the Convex
 * client to re-subscribe / re-fetch, which flickers the UI. This was
 * a real, shipped regression and was the entire motivation for the
 * `useAuthenticatedQuery` wrapper.
 *
 * See:
 * - PR #281 — original fix (reverted due to stale-JWT review concern)
 * - PR #299 / commit 01251be — re-landed with rationale
 * - commit 7f1f619 — AuthProvider context-deps regression test
 * - commit 38de798 — useStoredAuthToken ref-based polling + spread fix
 * - `apps/mobile/services/api/convex.ts` → `useAuthenticatedQuery`
 *
 * ## Rule
 *
 * If a feature file imports raw `useQuery` from `@services/api/convex`
 * AND pulls `token` from `useAuth()`, it's almost certainly doing the
 * wrong thing. Use `useAuthenticatedQuery` instead — it handles the
 * token stability internally via `useStoredAuthToken`.
 *
 * If you have a legitimate reason to use raw `useQuery` + token (e.g.
 * a non-authenticated call on a page that still reads user info for
 * display), add the path to `ALLOWED_FILES` below with a comment
 * explaining why.
 */

import fs from "fs";
import path from "path";

const FEATURE_ROOT = path.resolve(__dirname, "..");

// Glob-ish file collector: walk the events feature tree and return every
// .ts/.tsx file. Skip __tests__ (this file itself is exempt).
function collectFeatureFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "__tests__") continue;
      collectFeatureFiles(full, acc);
    } else if (entry.isFile() && /\.tsx?$/.test(entry.name)) {
      acc.push(full);
    }
  }
  return acc;
}

// Any file in this list is allowed to use raw useQuery + token. Add with a
// comment justifying the exception. Keep this list SHORT.
const ALLOWED_FILES: string[] = [
  // (none right now — add entries like "components/SomeFile.tsx" with reason)
];

function isAllowed(absPath: string): boolean {
  const rel = path.relative(FEATURE_ROOT, absPath);
  return ALLOWED_FILES.includes(rel);
}

describe("events feature — query patterns", () => {
  const files = collectFeatureFiles(FEATURE_ROOT);

  it("has events feature files to scan", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  /**
   * Detect the pattern:
   *   import { useQuery } from '@services/api/convex'  (raw useQuery)
   *   const { token } = useAuth();                      (reads token)
   *
   * Fail with a clear message listing every file that matches.
   */
  it("must not combine raw useQuery with a useAuth token read", () => {
    const violations: Array<{ file: string; reason: string }> = [];

    for (const file of files) {
      if (isAllowed(file)) continue;
      const src = fs.readFileSync(file, "utf-8");

      // Does this file import `useQuery` (as a named import) from the
      // convex services module? We check for the string on the import
      // line to avoid false positives on unrelated `useQuery` identifiers.
      const importsRawUseQuery =
        /import\s*{[^}]*\buseQuery\b[^}]*}\s*from\s*['"]@services\/api\/convex['"]/.test(
          src
        );

      // Does the file read `token` from `useAuth()` destructuring?
      const readsTokenFromUseAuth =
        /const\s*{[^}]*\btoken\b[^}]*}\s*=\s*useAuth\s*\(\s*\)/.test(src);

      if (importsRawUseQuery && readsTokenFromUseAuth) {
        violations.push({
          file: path.relative(FEATURE_ROOT, file),
          reason:
            "Raw `useQuery` + `useAuth().token` combo. Switch to `useAuthenticatedQuery` " +
            "from `@services/api/convex` — it internally uses `useStoredAuthToken` which " +
            "is stable across token refreshes.",
        });
      }
    }

    if (violations.length > 0) {
      const details = violations
        .map((v) => `  • ${v.file}\n    ${v.reason}`)
        .join("\n");
      throw new Error(
        `Found ${violations.length} file(s) using the forbidden raw useQuery + token pattern:\n` +
          details +
          `\n\nSee apps/mobile/features/events/__tests__/query-patterns.test.ts for the full rationale.`
      );
    }
  });
});
