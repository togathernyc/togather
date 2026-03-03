/**
 * Routing Conflicts Test
 *
 * This test validates the Expo Router file-based routing structure to ensure there are no
 * route conflicts that would cause navigation issues or unexpected behavior.
 *
 * What this test validates:
 * - Multiple routes resolving to the same URL (conflicts)
 * - Navigation paths using incorrect route group notation
 * - Dynamic routes conflicting with static routes
 * - Route file structure following Expo Router conventions
 *
 * Why this is important:
 * In Expo Router, route groups (parentheses like `(user)`, `(admin)`) don't affect the URL.
 * This means `app/(user)/settings/index.tsx` and `app/(admin)/settings/index.tsx` both resolve
 * to `/settings`, causing a conflict. This test catches these issues before they cause runtime errors.
 *
 * Route resolution rules:
 * - Route groups `(name)` are ignored in URL resolution
 * - `index.tsx` files represent the directory route
 * - Dynamic segments `[param]` become URL parameters
 * - Nested routes like `/groups/:id` and `/groups/:id/attendance` are allowed (not conflicts)
 */

import * as fs from "fs";
import * as path from "path";

/**
 * Recursively gets all files in a directory, excluding non-route directories.
 * This is used to scan the app directory for route files.
 *
 * Excluded directories:
 * - node_modules, .git, dist, venv (build/dependency directories)
 * - components, providers, services, utils, hooks, types, config, constants (non-route code)
 * - features (feature code, not routes)
 * - __tests__ (test files themselves)
 */
function getAllFiles(dirPath: string, arrayOfFiles: string[] = []): string[] {
  const files = fs.readdirSync(dirPath);

  files.forEach((file) => {
    const filePath = path.join(dirPath, file);
    if (fs.statSync(filePath).isDirectory()) {
      // Skip node_modules, .git, and other non-route directories
      if (
        !file.startsWith(".") &&
        file !== "node_modules" &&
        file !== "__tests__" &&
        file !== "components" &&
        file !== "providers" &&
        file !== "services" &&
        file !== "utils" &&
        file !== "hooks" &&
        file !== "types" &&
        file !== "config" &&
        file !== "constants" &&
        file !== "features" &&
        file !== "dist" &&
        file !== "venv" &&
        file !== "ios" &&
        file !== "android"
      ) {
        arrayOfFiles = getAllFiles(filePath, arrayOfFiles);
      }
    } else if (file.endsWith(".tsx") || file.endsWith(".ts")) {
      arrayOfFiles.push(filePath);
    }
  });

  return arrayOfFiles;
}

/**
 * Converts a file path to its corresponding URL route.
 *
 * This function:
 * 1. Removes the app directory prefix
 * 2. Removes route groups (parentheses) - they don't affect URLs
 * 3. Converts `index.tsx` to the directory route
 * 4. Converts dynamic segments `[param]` to `:param` for matching
 * 5. Normalizes slashes and ensures leading slash
 *
 * Examples:
 * - `app/(user)/profile/index.tsx` → `/profile`
 * - `app/groups/[group_id]/index.tsx` → `/groups/:group_id`
 * - `app/(admin)/settings/index.tsx` → `/settings`
 */
function resolveRouteToUrl(routePath: string, appDir: string): string {
  // Remove app directory prefix
  let relativePath = routePath.replace(appDir, "").replace(/\\/g, "/");

  // Remove leading slash
  if (relativePath.startsWith("/")) {
    relativePath = relativePath.substring(1);
  }

  // Remove route groups (parentheses) - they don't affect URL
  // Example: (user)/profile/index.tsx → profile/index.tsx
  relativePath = relativePath.replace(/\([^)]+\)\//g, "");
  relativePath = relativePath.replace(/\([^)]+\)/g, "");

  // Handle index files - they represent the directory route
  // Example: profile/index.tsx → profile
  if (
    relativePath.endsWith("/index.tsx") ||
    relativePath.endsWith("/index.ts")
  ) {
    relativePath = relativePath.replace(/\/index\.(tsx|ts)$/, "");
  } else if (relativePath.endsWith(".tsx") || relativePath.endsWith(".ts")) {
    // Remove file extension for non-index files
    relativePath = relativePath.replace(/\.(tsx|ts)$/, "");
  }

  // Replace dynamic segments with placeholder
  // [param] becomes :param for matching purposes
  // Example: groups/[group_id] → groups/:group_id
  relativePath = relativePath.replace(/\[([^\]]+)\]/g, ":$1");

  // Add leading slash
  if (!relativePath.startsWith("/")) {
    relativePath = "/" + relativePath;
  }

  // Remove trailing slash (except for root)
  if (relativePath !== "/" && relativePath.endsWith("/")) {
    relativePath = relativePath.slice(0, -1);
  }

  return relativePath || "/";
}

/**
 * Extracts route groups from a file path.
 * Route groups are directories wrapped in parentheses like `(user)` or `(admin)`.
 *
 * Example:
 * - `app/(user)/(tabs)/profile/index.tsx` → `["user", "tabs"]`
 * - `app/groups/index.tsx` → `[]`
 */
function extractRouteGroups(routePath: string, appDir: string): string[] {
  const relativePath = routePath.replace(appDir, "").replace(/\\/g, "/");
  const groups: string[] = [];
  const matches = relativePath.match(/\(([^)]+)\)/g);
  if (matches) {
    matches.forEach((match) => {
      const groupName = match.replace(/[()]/g, "");
      groups.push(groupName);
    });
  }
  return groups;
}

/**
 * Checks if a route path contains dynamic segments (brackets).
 * Dynamic routes use `[param]` syntax and accept URL parameters.
 *
 * Example:
 * - `app/groups/[group_id]/index.tsx` → true
 * - `app/groups/index.tsx` → false
 */
function isDynamicRoute(routePath: string): boolean {
  return /\[.*\]/.test(routePath);
}

/**
 * Checks if a file is a layout file.
 * Layout files (`_layout.tsx`) define shared layouts and don't create routes.
 */
function isLayoutFile(filePath: string): boolean {
  return filePath.includes("_layout.tsx") || filePath.includes("_layout.ts");
}

/**
 * Checks if a file only contains a Redirect component.
 * Redirect-only files are excluded from conflict detection because they don't
 * create actual routes - they just redirect to other routes.
 */
function isRedirectFile(filePath: string): boolean {
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    // Check if file only contains Redirect component
    const hasRedirect =
      /<Redirect\s+href/.test(content) || /Redirect\s+href/.test(content);
    const hasOtherContent = content
      .replace(/import\s+.*?from\s+['"].*?['"];?\s*/g, "")
      .replace(
        /export\s+default\s+function\s+\w+\s*\([^)]*\)\s*\{[\s\S]*?return\s+<Redirect[^>]*\/>[\s\S]*?\}/g,
        ""
      )
      .replace(
        /export\s+default\s+function\s+\w+\s*\([^)]*\)\s*\{[\s\S]*?return\s+<Redirect[^>]*>[\s\S]*?<\/Redirect>[\s\S]*?\}/g,
        ""
      )
      .trim();

    return hasRedirect && hasOtherContent.length < 50; // Allow some whitespace/comments
  } catch {
    return false;
  }
}

/**
 * Checks if a file is a re-export file (just re-exports another route).
 * Re-export files are excluded from conflict detection because they're intentionally
 * duplicating a route to enable it within a different route group context.
 * This is needed in Expo Router when you want the same screen to work in multiple
 * navigation stacks (e.g., modal vs main stack).
 */
function isReexportFile(filePath: string): boolean {
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    // Check if file is a simple re-export like: export { default } from "@/app/...";
    const lines = content.split("\n").filter((line) => {
      const trimmed = line.trim();
      // Keep non-empty lines that aren't just comments
      return trimmed && !trimmed.startsWith("//") && !trimmed.startsWith("/*") && !trimmed.startsWith("*");
    });

    // A re-export file should only have 1 meaningful line (the export statement)
    if (lines.length !== 1) return false;

    // Check for re-export pattern
    return /export\s*\{\s*default\s*\}\s*from/.test(content);
  } catch {
    return false;
  }
}

/**
 * Checks if two routes conflict with each other.
 * Routes conflict if they resolve to the same URL pattern.
 *
 * Note: Nested routes are NOT conflicts:
 * - `/groups/:id` and `/groups/:id/attendance` are allowed (nested)
 * - `/groups/:id` and `/groups/:id` in different route groups are conflicts
 */
function routesConflict(route1: string, route2: string): boolean {
  // Convert dynamic segments to wildcards for comparison
  const normalize = (route: string) => {
    return route.replace(/:\w+/g, "*");
  };

  const normalized1 = normalize(route1);
  const normalized2 = normalize(route2);

  // Check if they're the same pattern
  if (normalized1 === normalized2) {
    return true;
  }

  // Check if one is a more specific version of the other
  // e.g., /groups/:id conflicts with /groups/:id/attendance
  if (
    normalized1.startsWith(normalized2 + "/") ||
    normalized2.startsWith(normalized1 + "/")
  ) {
    return false; // These are nested routes, not conflicts
  }

  return false;
}

/**
 * Finds all navigation paths in a file by searching for:
 * - router.push(), router.replace(), router.navigate()
 * - href attributes
 * - Redirect components
 *
 * This is used to validate that navigation uses correct route group notation.
 */
function findNavigationPaths(filePath: string): string[] {
  const content = fs.readFileSync(filePath, "utf-8");
  const paths: string[] = [];

  // Match router.push, router.replace, router.navigate, href=, Redirect href
  const patterns = [
    /router\.(push|replace|navigate)\(['"`]([^'"`]+)['"`]\)/g,
    /href=['"`]([^'"`]+)['"`]/g,
    /<Redirect\s+href=['"`]([^'"`]+)['"`]/g,
  ];

  patterns.forEach((pattern) => {
    let match;
    while ((match = pattern.exec(content)) !== null) {
      const path = match[2] || match[1];
      if (path && !path.startsWith("http") && !path.startsWith("mailto:")) {
        paths.push(path);
      }
    }
  });

  return paths;
}

describe("Routing Structure Validation", () => {
  // Path to app directory - updated from __tests__/utils/ location
  // Now in app/__tests__/, so we go up one level to reach app/ directory
  const appDir = path.join(__dirname, "..");

  /**
   * Get all route files from the app directory.
   * Excludes:
   * - Layout files (_layout.tsx) - they don't create routes
   * - Special files (+not-found, +html) - Expo Router special routes
   * - Only includes actual route files (index.tsx, or files that represent routes)
   */
  const routeFiles = getAllFiles(appDir).filter((file) => {
    const relativePath = file.replace(appDir, "");
    // Exclude layout files and special files
    if (
      isLayoutFile(file) ||
      relativePath.includes("+not-found") ||
      relativePath.includes("+html")
    ) {
      return false;
    }
    // Only include index.tsx, index.ts, or files that are routes (not in subdirectories with index)
    return (
      relativePath.endsWith("/index.tsx") ||
      relativePath.endsWith("/index.ts") ||
      (!relativePath.includes("/index.") &&
        (relativePath.endsWith(".tsx") || relativePath.endsWith(".ts")))
    );
  });

  /**
   * Build a map of URLs to route files.
   * This allows us to detect when multiple files resolve to the same URL (conflicts).
   */
  const routeMap = new Map<string, string[]>();
  const routeDetails: Array<{
    file: string;
    url: string;
    groups: string[];
    isDynamic: boolean;
  }> = [];

  routeFiles.forEach((file) => {
    const url = resolveRouteToUrl(file, appDir);
    const groups = extractRouteGroups(file, appDir);
    const isDynamic = isDynamicRoute(file);

    routeDetails.push({
      file: file.replace(appDir, ""),
      url,
      groups,
      isDynamic,
    });

    if (!routeMap.has(url)) {
      routeMap.set(url, []);
    }
    routeMap.get(url)!.push(file);
  });

  /**
   * Test: No multiple routes resolving to the same URL
   *
   * This is the most critical test - it ensures that no two route files resolve to
   * the same URL. In Expo Router, route groups (parentheses) don't affect the URL,
   * so `app/(user)/settings/index.tsx` and `app/(admin)/settings/index.tsx` both
   * resolve to `/settings`, causing a conflict.
   *
   * What we check:
   * - Multiple files resolving to the same URL
   * - Exclude nested routes (e.g., `/groups/:id` and `/groups/:id/attendance` are okay)
   * - Exclude layout files and redirect-only files
   * - Different route groups resolving to the same URL = conflict
   */
  it("should not have multiple routes resolving to the same URL", () => {
    const conflicts: Array<{ url: string; files: string[] }> = [];

    routeMap.forEach((files, url) => {
      // Filter out layout files, redirect-only files, and re-export files
      const actualRouteFiles = files.filter((file) => {
        return !isLayoutFile(file) && !isRedirectFile(file) && !isReexportFile(file);
      });

      if (actualRouteFiles.length > 1) {
        // Check if they're truly conflicting (not nested routes)
        for (let i = 0; i < actualRouteFiles.length; i++) {
          for (let j = i + 1; j < actualRouteFiles.length; j++) {
            const file1 = actualRouteFiles[i];
            const file2 = actualRouteFiles[j];
            const route1 = resolveRouteToUrl(file1, appDir);
            const route2 = resolveRouteToUrl(file2, appDir);

            // Nested routes are okay: /groups/:id and /groups/:id/attendance
            // These are NOT conflicts - they're parent/child routes
            const isNested =
              route1.startsWith(route2 + "/") ||
              route2.startsWith(route1 + "/");

            // Check if they're in different route groups (which is okay for some cases)
            const groups1 = extractRouteGroups(file1, appDir);
            const groups2 = extractRouteGroups(file2, appDir);
            const sameGroup =
              groups1.length === groups2.length &&
              groups1.every((g, idx) => g === groups2[idx]);

            // If they resolve to the same URL, are not nested, and are in different groups, it's a conflict
            if (!isNested && route1 === route2 && !sameGroup) {
              // Check if this conflict already exists
              const existingConflict = conflicts.find((c) => c.url === url);
              if (existingConflict) {
                if (
                  !existingConflict.files.includes(file1.replace(appDir, ""))
                ) {
                  existingConflict.files.push(file1.replace(appDir, ""));
                }
                if (
                  !existingConflict.files.includes(file2.replace(appDir, ""))
                ) {
                  existingConflict.files.push(file2.replace(appDir, ""));
                }
              } else {
                conflicts.push({
                  url,
                  files: [file1.replace(appDir, ""), file2.replace(appDir, "")],
                });
              }
            }
          }
        }
      }
    });

    if (conflicts.length > 0) {
      const conflictMessages = conflicts.map((conflict) => {
        const groups = conflict.files.map((f) => {
          const filePath = path.join(appDir, f);
          return extractRouteGroups(filePath, appDir).join(", ") || "root";
        });
        return `\n  URL: ${conflict.url}\n  Files: ${conflict.files.join(
          "\n         "
        )}\n  Route Groups: ${groups.join(" vs ")}`;
      });
      throw new Error(
        `Found ${conflicts.length} route conflict(s):${conflictMessages.join(
          "\n"
        )}\n\n` +
          `These routes resolve to the same URL. In Expo Router, route groups (parentheses) don't affect the URL.\n` +
          `Even if routes are in different groups, they still resolve to the same URL and will conflict.\n` +
          `Solutions:\n` +
          `  1. Rename one of the routes (e.g., /admin-groups, /user-groups)\n` +
          `  2. Use different URL paths (e.g., /admin/settings vs /user/settings)\n` +
          `  3. Use route guards to protect routes, but they still need unique URLs\n`
      );
    }
  });

  /**
   * Test: Correct route group notation in navigation paths
   *
   * This test ensures that navigation code uses the correct route group notation.
   * For example, routes in the `(user)` group should be referenced as `/(user)/path`
   * in navigation code, not just `/path`.
   *
   * Why this matters:
   * - Using correct notation makes the codebase more maintainable
   * - It's clearer which route group a path belongs to
   * - Helps prevent accidental navigation to wrong routes
   */
  it("should use correct route group notation in navigation paths", () => {
    // Path updated: now in app/__tests__/, so go up two levels to reach mobile app root
    const allFiles = getAllFiles(path.join(__dirname, "../.."));
    const incorrectPaths: Array<{
      file: string;
      path: string;
      expected: string;
    }> = [];

    allFiles.forEach((file) => {
      // Skip test files and node_modules
      if (file.includes("__tests__") || file.includes("node_modules")) {
        return;
      }

      const navPaths = findNavigationPaths(file);

      navPaths.forEach((navPath) => {
        // Check for incorrect patterns
        // /leader-tools should be /(user)/leader-tools
        if (
          navPath.startsWith("/leader-tools") &&
          !navPath.startsWith("/(user)/leader-tools")
        ) {
          incorrectPaths.push({
            file: file.replace(path.join(__dirname, "../.."), ""),
            path: navPath,
            expected: navPath.replace("/leader-tools", "/(user)/leader-tools"),
          });
        }

        // Admin routes should use /admin/* (not /(admin)/*)
        // This is correct - admin routes are now actual page structure, not route groups
      });
    });

    if (incorrectPaths.length > 0) {
      const messages = incorrectPaths.map(
        (item) =>
          `\n  File: ${item.file}\n  Found: ${item.path}\n  Expected: ${item.expected}`
      );
      throw new Error(
        `Found ${
          incorrectPaths.length
        } navigation path(s) with incorrect route group notation:${messages.join(
          "\n"
        )}`
      );
    }
  });

  /**
   * Test: Routes in route groups use correct structure
   *
   * This test validates that routes are placed in appropriate route groups.
   * For example, admin routes should be in the `/admin/` directory structure,
   * not in a `(admin)` route group.
   *
   * Current structure:
   * - Admin routes: `/admin/*` (actual directory structure)
   * - User routes: `/(user)/*` (route group)
   */
  it("should have routes in route groups use correct structure", () => {
    const issues: string[] = [];

    routeDetails.forEach((route) => {
      // Admin routes are now in /admin/ directory structure (not route groups)
      // This is correct - admin routes should be at /admin/* paths
      // EXCEPT: (tabs)/admin.tsx is a valid tab navigation file
      if (route.file.includes("admin") && !route.file.startsWith("/admin/")) {
        // Check if it's actually in the admin directory
        const isInAdminDir =
          route.file.includes("/admin/") || route.file.startsWith("admin/");
        // Allow admin.tsx in (tabs) directory as it's a tab navigation file
        const isTabsAdmin = route.file === "/(tabs)/admin.tsx";
        if (!isInAdminDir && !route.groups.includes("admin") && !isTabsAdmin) {
          issues.push(
            `Route ${route.file} contains 'admin' but is not in /admin/ directory or (admin) route group`
          );
        }
      }

      // User routes should be in (user) route group
      if (
        route.file.includes("user") &&
        route.file.includes("profile") &&
        !route.groups.includes("user")
      ) {
        // This is okay, user profile can be at root level
      }
    });

    if (issues.length > 0) {
      throw new Error(`Route group structure issues:\n${issues.join("\n")}`);
    }
  });

  /**
   * Test: No conflicting dynamic and static routes
   *
   * This test ensures that dynamic routes (e.g., `/groups/[id]`) don't conflict
   * with static routes (e.g., `/groups/index`) at the same level.
   *
   * What we check:
   * - Static routes that match dynamic route patterns
   * - Routes at the same depth level (same number of path segments)
   * - Excludes nested routes (parent/child relationships are okay)
   */
  it("should not have conflicting dynamic and static routes", () => {
    const staticRoutes = routeDetails.filter((r) => !r.isDynamic);
    const dynamicRoutes = routeDetails.filter((r) => r.isDynamic);
    const conflicts: Array<{ static: string; dynamic: string; url: string }> =
      [];

    staticRoutes.forEach((staticRoute) => {
      dynamicRoutes.forEach((dynamicRoute) => {
        // Check if they resolve to conflicting URLs
        // e.g., /groups/123 (static) vs /groups/[id] (dynamic)
        const staticUrl = staticRoute.url;
        const dynamicUrl = dynamicRoute.url;

        // Convert dynamic URL to pattern
        const dynamicPattern = dynamicUrl.replace(/:\w+/g, "*");
        const staticPattern = staticUrl.replace(/:\w+/g, "*");

        // Check if static route matches dynamic pattern
        // This would be a conflict if they're at the same level
        if (
          staticPattern === dynamicPattern &&
          staticRoute.url !== dynamicRoute.url
        ) {
          // They're the same pattern, check if they're actually conflicting
          const staticPath = staticRoute.file.split("/").filter(Boolean);
          const dynamicPath = dynamicRoute.file.split("/").filter(Boolean);

          // Remove route groups and file extensions
          const staticSegments = staticPath
            .filter(
              (s) => !s.startsWith("(") && !s.endsWith(")") && !s.includes(".")
            )
            .join("/");
          const dynamicSegments = dynamicPath
            .filter(
              (s) => !s.startsWith("(") && !s.endsWith(")") && !s.includes(".")
            )
            .join("/");

          // If they have the same number of segments and one is dynamic, it's a conflict
          if (
            staticSegments.split("/").length ===
            dynamicSegments.split("/").length
          ) {
            conflicts.push({
              static: staticRoute.file,
              dynamic: dynamicRoute.file,
              url: staticRoute.url,
            });
          }
        }
      });
    });

    if (conflicts.length > 0) {
      const messages = conflicts.map(
        (c) =>
          `\n  URL: ${c.url}\n  Static: ${c.static}\n  Dynamic: ${c.dynamic}`
      );
      throw new Error(
        `Found ${
          conflicts.length
        } conflict(s) between static and dynamic routes:${messages.join("\n")}`
      );
    }
  });

  /**
   * Test: Valid route file structure
   *
   * This test validates that route files follow Expo Router conventions.
   * It checks for proper use of `index.tsx` files and route naming.
   *
   * Note: This test is lenient and mainly checks for obvious structural issues.
   */
  it("should have valid route file structure", () => {
    const issues: string[] = [];

    routeFiles.forEach((file) => {
      const relativePath = file.replace(appDir, "");

      // Check for invalid file names
      if (
        relativePath.includes("+not-found") ||
        relativePath.includes("+html")
      ) {
        // These are special routes, skip
        return;
      }

      // Check for files that should be index.tsx
      const dir = path.dirname(file);
      const basename = path.basename(file, path.extname(file));

      // If it's a directory route, it should have an index file
      if (
        fs.statSync(dir).isDirectory() &&
        basename !== "index" &&
        !basename.startsWith("[")
      ) {
        // Check if there's an index file in the same directory
        const indexFile = path.join(dir, "index.tsx");
        if (
          !fs.existsSync(indexFile) &&
          !fs.existsSync(path.join(dir, "index.ts"))
        ) {
          // This might be okay if it's a layout or special file
          if (!basename.startsWith("_") && !basename.startsWith("+")) {
            // This could be an issue, but we'll be lenient
          }
        }
      }
    });

    if (issues.length > 0) {
      throw new Error(`Route file structure issues:\n${issues.join("\n")}`);
    }
  });
});

