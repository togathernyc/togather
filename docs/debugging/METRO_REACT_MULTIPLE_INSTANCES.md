# Metro Error: Cannot Read Properties of Null (Reading 'useEffect')

## Problem Summary

**Error Message:**
```
Metro error: Cannot read properties of null (reading 'useEffect')
TypeError: Cannot read properties of null (reading 'useEffect')
  at Object.useEffect (/path/to/react/cjs/react.development.js:1186:25)
  at ServerContainer (/path/to/@react-navigation/native/lib/module/ServerContainer.js:18:9)
  at Object.react-stack-bottom-frame (/path/to/react-dom/cjs/react-dom-server-legacy.node.development.js:8970:18)
```

**Symptoms:**
- Error occurs during Metro bundling for web platform
- Happens specifically during Server-Side Rendering (SSR) bundling
- Error appears in Metro terminal, not browser console
- App works fine in EAS builds but fails locally
- Error occurs before component code runs (during bundling phase)

## Root Cause

The issue occurs in **pnpm monorepo setups** with **React 19** and **Expo Router** when:

1. **Multiple React Instances**: Metro resolves React from different locations during SSR bundling
2. **SSR Bundling**: When Metro bundles `react-dom/server` for SSR, it internally requires React, but that internal require gets a different (or null) React instance
3. **Missing extraNodeModules**: Without `extraNodeModules`, Metro's default resolver can resolve React from different locations, causing React to be `null` when `react-dom/server` tries to use it

## Environment

- **Package Manager**: pnpm (with `shamefully-hoist=true`)
- **React Version**: 19.1.0
- **Expo Router**: 6.0.14
- **Metro Bundler**: Expo Metro config
- **Platform**: Web (SSR enabled)

## Solution

The fix requires **both** `extraNodeModules` and `resolveRequest` in Metro config:

### 1. Resolve React Paths Correctly

```javascript
// Resolve React from workspace root (where it's hoisted)
let reactPath, reactDomPath;
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
} catch (e) {
  // Fallback logic...
}
```

### 2. Configure Metro Resolver

```javascript
config.resolver = {
  ...config.resolver,
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
  },
  
  // CRITICAL: resolveRequest ensures React resolves to CJS file directly
  resolveRequest: (context, moduleName, platform) => {
    if (moduleName === "react") {
      const fs = require("fs");
      
      // Resolve directly to CJS file, not index.js wrapper
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
      
      // Final fallback
      try {
        const resolved = require.resolve("react", {
          paths: [workspaceRoot, projectRoot],
        });
        return {
          type: "sourceFile",
          filePath: resolved,
        };
      } catch (e) {
        console.error(`[Metro] ❌ Failed to resolve react:`, e);
      }
    }
    
    // Handle JSX runtime
    if (
      moduleName === "react/jsx-runtime" ||
      moduleName === "react/jsx-dev-runtime"
    ) {
      const jsxRuntimePath = path.join(
        reactPath,
        moduleName.replace("react/", "")
      );
      const fs = require("fs");
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
```

## Why Both Are Needed

1. **`extraNodeModules`**: Forces Metro to use the same React instance for ALL imports, including internal requires from `react-dom/server`
2. **`resolveRequest`**: Ensures React resolves directly to the CJS file, bypassing the `index.js` wrapper that can cause initialization issues during SSR bundling

## Debugging Steps

If you encounter this issue:

1. **Check if error occurs during bundling** (Metro terminal) vs runtime (browser console)
2. **Verify React resolution**: Add logging to `resolveRequest` to see if it's being called
3. **Check for SSR**: Look for `react-dom-server-legacy` in error stack traces
4. **Verify pnpm hoisting**: Check if React is hoisted to workspace root with `shamefully-hoist=true`
5. **Test with both configs**: Ensure both `extraNodeModules` and `resolveRequest` are present

## Alternative Solutions

If you don't need SSR, you can disable it:

```json
// app.json
{
  "expo": {
    "extra": {
      "router": {
        "unstable_ssr": false
      }
    }
  }
}
```

However, the Metro config solution is preferred as it fixes the root cause and allows SSR to work correctly.

## Related Issues

- React 19 compatibility with Metro bundler
- pnpm monorepo module resolution
- Expo Router SSR with React 19
- Multiple React instances in monorepos

## Prevention

For future projects:
1. Always configure Metro resolver for pnpm monorepos
2. Use `extraNodeModules` to ensure single React instance
3. Resolve React directly to CJS files in `resolveRequest`
4. Test SSR builds locally, not just EAS builds

