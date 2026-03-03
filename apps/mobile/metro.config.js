// Load polyfills before Metro starts
require("./metro-polyfills");

const { getSentryExpoConfig } = require("@sentry/react-native/metro");
const path = require("path");

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "../..");

// Use Sentry's Metro config wrapper for Debug ID injection (source maps)
const config = getSentryExpoConfig(projectRoot);

// Add workspace root to watchFolders for pnpm workspaces
// Include default watchFolders from Expo and add workspace root
// Also add shared package so Metro watches those files
// Include pnpm store so Metro can watch files resolved from symlinks
const pnpmStore = path.resolve(workspaceRoot, "node_modules/.pnpm");

config.watchFolders = [
  ...(config.watchFolders || [projectRoot]),
  workspaceRoot,
  path.resolve(workspaceRoot, "packages/shared"),
  pnpmStore, // Critical for pnpm symlink resolution - Metro needs to watch the real files
].filter((folder) => {
  // Only include folders that exist
  const fs = require("fs");
  return fs.existsSync(folder);
});

// Resolve React paths to ensure mobile app uses its own React 19.1.0
// With shamefully-hoist=true, React 18.3.1 is hoisted to workspace root (from web app)
// We need to prioritize project root (mobile app's React 19.1.0) over workspace root
let reactPath, reactDomPath;
try {
  // Try project root first (mobile app's own React 19.1.0)
  reactPath = path.dirname(
    require.resolve("react/package.json", {
      paths: [projectRoot],
    })
  );
  reactDomPath = path.dirname(
    require.resolve("react-dom/package.json", {
      paths: [projectRoot],
    })
  );
} catch (e) {
  // Fallback to workspace root if project root resolution fails
  try {
    reactPath = path.dirname(
      require.resolve("react/package.json", {
        paths: [workspaceRoot],
      })
    );
    reactDomPath = path.dirname(
      require.resolve("react-dom/package.json", {
        paths: [workspaceRoot],
      })
    );
  } catch (e2) {
    // Final fallback to direct path resolution
    reactPath = path.resolve(workspaceRoot, "node_modules", "react");
    reactDomPath = path.resolve(workspaceRoot, "node_modules", "react-dom");
  }
}

// Log resolved React versions for debugging
try {
  const fs = require("fs");
  const reactPackageJson = path.join(reactPath, "package.json");
  const reactDomPackageJson = path.join(reactDomPath, "package.json");
  if (fs.existsSync(reactPackageJson)) {
    const reactVersion = JSON.parse(fs.readFileSync(reactPackageJson, "utf-8")).version;
    const reactDomVersion = fs.existsSync(reactDomPackageJson)
      ? JSON.parse(fs.readFileSync(reactDomPackageJson, "utf-8")).version
      : "unknown";
    console.log(`[Metro] ✅ Resolved React ${reactVersion} from: ${reactPath}`);
    console.log(`[Metro] ✅ Resolved react-dom ${reactDomVersion} from: ${reactDomPath}`);
  }
} catch (e) {
  console.warn(`[Metro] ⚠️ Could not log React versions:`, e);
}

// Store the default resolveRequest if it exists
const defaultResolveRequest = config.resolver.resolveRequest;

// Configure resolver for pnpm workspaces
// With shamefully-hoist=true, dependencies are hoisted to workspace root
// NOTE: nodeModulesPaths order is workspace root first for general dependencies,
// but extraNodeModules below ensures React/react-dom use project root versions
config.resolver = {
  ...config.resolver,
  // CRITICAL: Enable symlink support for pnpm - fixes SHA-1 errors
  unstable_enableSymlinks: true,
  nodeModulesPaths: [
    path.resolve(workspaceRoot, "node_modules"),
    path.resolve(projectRoot, "node_modules"),
  ],
  unstable_enablePackageExports: true,
  resolverMainFields: ["react-native", "browser", "main"],
  // CRITICAL: extraNodeModules ensures ALL React imports use the same instance
  // This includes internal requires from react-dom/server
  extraNodeModules: {
    react: reactPath,
    "react-dom": reactDomPath,
    "react/jsx-runtime": path.join(reactPath, "jsx-runtime.js"),
    "react/jsx-dev-runtime": path.join(reactPath, "jsx-dev-runtime.js"),
    // Add shared package to extraNodeModules for Metro resolution
    "@togather/shared": path.resolve(workspaceRoot, "packages/shared/src"),
  },
  resolveRequest: (context, moduleName, platform) => {
    // Handle expo-router/entry - pnpm symlinks cause Metro resolution issues
    // Resolve to the real path so Metro can find it in watchFolders
    if (moduleName === "expo-router/entry") {
      const fs = require("fs");
      const expoRouterEntry = path.resolve(
        workspaceRoot,
        "node_modules/expo-router/entry.js"
      );
      if (fs.existsSync(expoRouterEntry)) {
        try {
          // Resolve symlink to real path
          const realPath = fs.realpathSync(expoRouterEntry);
          return {
            type: "sourceFile",
            filePath: realPath,
          };
        } catch (e) {
          // Fall through to default resolver
        }
      }
    }

    // Mock react-native-fs on web platform (used by stream-chat-react-native)
    if (platform === "web" && moduleName === "react-native-fs") {
      return {
        type: "empty",
      };
    }

    // Mock react-native-audio-recorder-player on web platform
    if (platform === "web" && moduleName === "react-native-audio-recorder-player") {
      return {
        type: "empty",
      };
    }

    // StreamChat mocks removed - migration to Convex-native messaging complete

    // CRITICAL: Handle React resolution FIRST - before any other modules
    // This ensures React is available when react-dom modules need it
    if (moduleName === "react") {
      const fs = require("fs");

      // Check if we're in a react-server environment (RSC)
      // Expo sets this in context.customResolverOptions.environment
      const environment = context.customResolverOptions?.environment;
      const isReactServer = environment === "react-server";

      if (isReactServer) {
        // For React Server Components, use the react-server export
        // React 19+ has a special build for RSC that exports server-only APIs
        const reactServerFile = path.join(reactPath, "react.react-server.js");
        if (fs.existsSync(reactServerFile)) {
          console.log(`[Metro] ✅ Resolved react (react-server) to: ${reactServerFile}`);
          return {
            type: "sourceFile",
            filePath: reactServerFile,
          };
        }
        // Fallback: let Metro's default resolver handle it with conditions
        console.log(`[Metro] ⚠️ react.react-server.js not found, falling back to default resolver`);
        if (defaultResolveRequest) {
          return defaultResolveRequest(context, moduleName, platform);
        }
        return context.resolveRequest(context, moduleName, platform);
      }

      // For client bundles, resolve directly to the CJS file
      const isDev = process.env.NODE_ENV !== "production";
      const cjsFile = isDev
        ? path.join(reactPath, "cjs", "react.development.js")
        : path.join(reactPath, "cjs", "react.production.js");

      if (fs.existsSync(cjsFile)) {
        return {
          type: "sourceFile",
          filePath: cjsFile,
        };
      }

      // Fallback to index.js
      const indexPath = path.join(reactPath, "index.js");
      if (fs.existsSync(indexPath)) {
        return {
          type: "sourceFile",
          filePath: indexPath,
        };
      }

      // Final fallback - try project root first, then workspace root
      try {
        const resolved = require.resolve("react", {
          paths: [projectRoot, workspaceRoot],
        });
        return {
          type: "sourceFile",
          filePath: resolved,
        };
      } catch (e) {
        console.error(`[Metro] ❌ Failed to resolve react:`, e);
      }
    }

    // Handle @togather/shared package resolution
    if (moduleName.startsWith("@togather/shared")) {
      const sharedPackagePath = path.resolve(workspaceRoot, "packages/shared");
      const packageJsonPath = path.join(sharedPackagePath, "package.json");
      const fs = require("fs");

      if (fs.existsSync(packageJsonPath)) {
        try {
          const packageJson = JSON.parse(
            fs.readFileSync(packageJsonPath, "utf8")
          );
          const exports = packageJson.exports || {};

          // Extract the subpath (e.g., "/api/services" from "@togather/shared/api/services")
          // Convert to export format (./api/services instead of /api/services)
          let subpath = moduleName.replace("@togather/shared", "") || ".";
          if (subpath.startsWith("/")) {
            subpath = "." + subpath;
          } else if (subpath === "") {
            subpath = ".";
          }
          const exportConfig = exports[subpath];

          if (exportConfig) {
            // Handle export object with default/types fields or direct string
            let targetPath;
            if (typeof exportConfig === "string") {
              targetPath = exportConfig;
            } else if (exportConfig.default) {
              targetPath = exportConfig.default;
            } else if (exportConfig.types) {
              targetPath = exportConfig.types;
            }

            if (targetPath) {
              const resolvedPath = path.resolve(sharedPackagePath, targetPath);

              if (fs.existsSync(resolvedPath)) {
                // Check if it's a directory - if so, try index.ts
                const stats = fs.statSync(resolvedPath);
                let finalPath = resolvedPath;

                if (stats.isDirectory()) {
                  const indexPath = path.join(resolvedPath, "index.ts");
                  if (fs.existsSync(indexPath)) {
                    finalPath = indexPath;
                  } else {
                    // Directory but no index.ts - skip this export
                    return null;
                  }
                }

                // Only return if it's a file
                if (
                  fs.existsSync(finalPath) &&
                  fs.statSync(finalPath).isFile()
                ) {
                  return {
                    type: "sourceFile",
                    filePath: finalPath,
                  };
                }
              }
            }
          }

          // Fallback: try to resolve directly from src
          // Use original subpath (without the dot prefix) for fallback
          const originalSubpath =
            moduleName.replace("@togather/shared", "") || ".";
          const subpathWithoutSlash =
            originalSubpath === "." ? "" : originalSubpath.replace(/^\//, "");
          const srcBasePath = path.resolve(sharedPackagePath, "src");
          let fallbackPath = path.join(
            srcBasePath,
            subpathWithoutSlash || "index.ts"
          );

          // Check if the path exists as a directory first
          const potentialDir = path.join(srcBasePath, subpathWithoutSlash);
          if (fs.existsSync(potentialDir)) {
            const stats = fs.statSync(potentialDir);
            if (stats.isDirectory()) {
              // It's a directory, try index.ts inside it
              fallbackPath = path.join(potentialDir, "index.ts");
            }
          } else {
            // Not a directory, try with .ts extension
            if (
              !fallbackPath.endsWith(".ts") &&
              !fallbackPath.endsWith(".tsx")
            ) {
              const withExtension = fallbackPath + ".ts";
              if (fs.existsSync(withExtension)) {
                fallbackPath = withExtension;
              }
            }
          }

          // Only return if it's a file
          if (fs.existsSync(fallbackPath)) {
            const stats = fs.statSync(fallbackPath);
            if (stats.isFile()) {
              return {
                type: "sourceFile",
                filePath: fallbackPath,
              };
            }
          }
        } catch (error) {
          // If package.json parsing fails, fall through to default resolver
          console.warn(`[Metro] Failed to parse shared package.json:`, error);
        }
      }
    }

    // Log SSR-related resolutions
    if (
      moduleName === "react-dom/server" ||
      moduleName.startsWith("react-dom/server")
    ) {
      console.log(`[Metro] ⚠️ SSR: Resolving ${moduleName}`);
    }

    // CRITICAL: Handle react-dom/client to ensure it uses our React instance
    // When react-dom/client internally requires React, it needs to use our resolved instance
    // This is critical for web builds where react-native-web imports react-dom/client
    if (
      moduleName === "react-dom/client" ||
      moduleName.startsWith("react-dom/client")
    ) {
      try {
        const resolved = require.resolve(moduleName, {
          paths: [projectRoot, workspaceRoot],
        });
        console.log(`[Metro] ✅ Resolved ${moduleName} to: ${resolved}`);
        return {
          type: "sourceFile",
          filePath: resolved,
        };
      } catch (e) {
        // Let it fall through to default resolver
      }
    }

    // CRITICAL: Handle react-dom/server to ensure it uses our React instance
    // When react-dom/server internally requires React, it needs to use our resolved instance
    if (
      moduleName === "react-dom/server" ||
      moduleName.startsWith("react-dom/server")
    ) {
      // Let Metro resolve react-dom/server normally (it handles package.json exports)
      // But we need to ensure React is available when react-dom/server needs it
      // The key is that our React resolution above should handle this
      // But we can also explicitly ensure react-dom/server resolves correctly
      try {
        const resolved = require.resolve(moduleName, {
          paths: [projectRoot, workspaceRoot],
        });
        console.log(`[Metro] ✅ Resolved ${moduleName} to: ${resolved}`);
        return {
          type: "sourceFile",
          filePath: resolved,
        };
      } catch (e) {
        // Let it fall through to default resolver
      }
    }

    // CRITICAL: Handle react-dom itself to ensure consistent resolution
    // This ensures react-dom can properly access React when it needs to
    // Must resolve from projectRoot first so react-dom uses the same React instance
    if (moduleName === "react-dom") {
      try {
        const resolved = require.resolve(moduleName, {
          paths: [projectRoot, workspaceRoot],
        });
        console.log(`[Metro] ✅ Resolved ${moduleName} to: ${resolved}`);
        return {
          type: "sourceFile",
          filePath: resolved,
        };
      } catch (e) {
        // Let it fall through to default resolver
      }
    }

    // Handle React JSX runtime modules
    if (
      moduleName === "react/jsx-runtime" ||
      moduleName === "react/jsx-dev-runtime"
    ) {
      const fs = require("fs");
      const runtimeName = moduleName.replace("react/", "");

      // Check if we're in a react-server environment (RSC)
      const environment = context.customResolverOptions?.environment;
      const isReactServer = environment === "react-server";

      if (isReactServer) {
        // For React Server Components, use the react-server export
        const reactServerRuntimeFile = path.join(
          reactPath,
          `${runtimeName}.react-server.js`
        );
        if (fs.existsSync(reactServerRuntimeFile)) {
          console.log(`[Metro] ✅ Resolved ${moduleName} (react-server) to: ${reactServerRuntimeFile}`);
          return {
            type: "sourceFile",
            filePath: reactServerRuntimeFile,
          };
        }
        // Fallback: let Metro's default resolver handle it
        console.log(`[Metro] ⚠️ ${runtimeName}.react-server.js not found, falling back to default resolver`);
        if (defaultResolveRequest) {
          return defaultResolveRequest(context, moduleName, platform);
        }
        return context.resolveRequest(context, moduleName, platform);
      }

      // For client bundles, use the standard runtime
      const jsxRuntimePath = path.join(reactPath, runtimeName);
      if (fs.existsSync(jsxRuntimePath + ".js")) {
        return {
          type: "sourceFile",
          filePath: jsxRuntimePath + ".js",
        };
      }
    }

    // Use default resolver for everything else
    if (defaultResolveRequest) {
      return defaultResolveRequest(context, moduleName, platform);
    }
    return context.resolveRequest(context, moduleName, platform);
  },
};

module.exports = config;
