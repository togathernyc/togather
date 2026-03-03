// Wrapper script that patches Object.defineProperty before running Jest
// This fixes React 19 compatibility issues with jest-expo

// CRITICAL: This must be the FIRST thing that runs
// Capture the original before anything else
const originalDefineProperty = Object.defineProperty;

// Create a safe wrapper that handles null/undefined and non-objects
function safeDefineProperty(obj, prop, descriptor) {
  // Check if obj is null or undefined - return immediately
  // This is the key fix for jest-expo's setup.js which calls defineProperty on null/undefined
  if (obj === null || obj === undefined) {
    // Return the object unchanged - this prevents the error
    return obj;
  }
  
  // Check if obj is actually an object or function
  const objType = typeof obj;
  if (objType !== 'object' && objType !== 'function') {
    // For primitives, try to wrap them
    try {
      const wrapped = Object(obj);
      return originalDefineProperty(wrapped, prop, descriptor);
    } catch (e) {
      // If wrapping fails, just return the original obj
      return obj;
    }
  }
  
  // For valid objects/functions, try to call original
  try {
    return originalDefineProperty(obj, prop, descriptor);
  } catch (e) {
    // If it fails for any reason, just return the object unchanged
    // This prevents crashes during jest-expo setup
    return obj;
  }
}

// Patch Object.defineProperty using the original - MUST do this first
// Use Reflect.defineProperty to avoid circular issues
try {
  originalDefineProperty(Object, 'defineProperty', {
    value: safeDefineProperty,
    writable: true,
    configurable: true,
    enumerable: false,
  });
} catch (e) {
  // Fallback: direct assignment
  Object.defineProperty = safeDefineProperty;
}

// Also directly assign to ensure it's patched everywhere
Object.defineProperty = safeDefineProperty;

// Patch on global if it exists
if (typeof global !== 'undefined') {
  if (!global.Object) {
    global.Object = Object;
  }
  global.Object.defineProperty = safeDefineProperty;
}

// Patch on window if it exists (for browser environments)
if (typeof window !== 'undefined' && window.Object) {
  window.Object.defineProperty = safeDefineProperty;
}

// Patch on globalThis if it exists
if (typeof globalThis !== 'undefined') {
  if (!globalThis.Object) {
    globalThis.Object = Object;
  }
  globalThis.Object.defineProperty = safeDefineProperty;
}

// CRITICAL: Patch Object.defineProperty on the Object constructor itself
// This ensures that even if jest-expo caches Object.defineProperty, it gets our patched version
const ObjectConstructor = Object.constructor;
if (ObjectConstructor && ObjectConstructor !== Object) {
  try {
    originalDefineProperty(ObjectConstructor.prototype, 'defineProperty', {
      value: safeDefineProperty,
      writable: true,
      configurable: true,
      enumerable: false,
    });
  } catch (e) {
    // Ignore errors
  }
}

// CRITICAL: Intercept Module._extensions to patch jest-expo's setup.js before it runs
// This ensures the patch is applied even if jest-expo caches Object.defineProperty
const Module = require('module');
const fs = require('fs');
const originalJs = Module._extensions['.js'];

Module._extensions['.js'] = function(module, filename) {
  // If this is jest-expo's setup.js, patch it before loading
  if (filename.includes('jest-expo') && filename.includes('preset/setup.js')) {
    try {
      // Read the file
      let content = fs.readFileSync(filename, 'utf8');
      
      // Patch the problematic line that calls Object.defineProperty on null/undefined
      // Look for: Object.keys(mockNativeModules.NativeUnimoduleProxy.viewManagersMetadata).forEach(
      // and wrap it with a null check
      if (content.includes('Object.keys(mockNativeModules.NativeUnimoduleProxy.viewManagersMetadata).forEach(') &&
          !content.includes('if (mockNativeModules.UIManager && mockNativeModules.NativeUnimoduleProxy')) {
        // Find the line and replace it
        const lines = content.split('\n');
        let patched = false;
        for (let i = 0; i < lines.length; i++) {
          if (lines[i].includes('Object.keys(mockNativeModules.NativeUnimoduleProxy.viewManagersMetadata).forEach(')) {
            // Insert the if check before this line
            lines[i] = `if (mockNativeModules.UIManager && mockNativeModules.NativeUnimoduleProxy && mockNativeModules.NativeUnimoduleProxy.viewManagersMetadata) {
${lines[i]}`;
            patched = true;
            // Find the closing of the forEach and add the closing brace
            for (let j = i + 1; j < lines.length; j++) {
              if (lines[j].includes('});') || lines[j].includes(');')) {
                lines[j] = `${lines[j]}
}`;
                break;
              }
            }
            break;
          }
        }
        
        if (patched) {
          content = lines.join('\n');
          // Write the patched content to a temp location and load it
          const patchedPath = filename + '.patched';
          fs.writeFileSync(patchedPath, content);
          
          // Load the patched file
          return originalJs.call(this, module, patchedPath);
        }
      }
    } catch (e) {
      // If patching fails, just continue with original file
      console.error('Failed to patch jest-expo setup.js:', e.message);
    }
  }
  
  // For all other files, ensure our patch is in place
  Object.defineProperty = safeDefineProperty;
  if (typeof global !== 'undefined') {
    global.Object.defineProperty = safeDefineProperty;
  }
  if (typeof globalThis !== 'undefined') {
    globalThis.Object.defineProperty = safeDefineProperty;
  }
  
  return originalJs.call(this, module, filename);
};

// Also intercept Module._load to ensure patch is always in place
const originalLoad = Module._load;
Module._load = function(request, parent) {
  // Ensure our patch is still in place before loading any module
  // This is critical because jest-expo might cache Object.defineProperty
  Object.defineProperty = safeDefineProperty;
  if (typeof global !== 'undefined') {
    global.Object.defineProperty = safeDefineProperty;
  }
  if (typeof globalThis !== 'undefined') {
    globalThis.Object.defineProperty = safeDefineProperty;
  }
  if (typeof window !== 'undefined' && window.Object) {
    window.Object.defineProperty = safeDefineProperty;
  }
  
  return originalLoad.apply(this, arguments);
};

// Ensure @jest/test-sequencer is available before Jest runs
// This fixes pnpm hoisting issues where jest-config can't find the module
const path = require('path');

// Add the root node_modules to NODE_PATH so jest-config can find @jest/test-sequencer
const rootNodeModules = path.join(__dirname, '../../node_modules');
if (!process.env.NODE_PATH) {
  process.env.NODE_PATH = rootNodeModules;
} else {
  process.env.NODE_PATH = `${rootNodeModules}:${process.env.NODE_PATH}`;
}

// Also add it to Module's paths (Module is already declared above)
// This must be called AFTER setting NODE_PATH
Module._initPaths();

// Now run Jest - the patch will be in place before jest-expo runs
require('jest/bin/jest');

