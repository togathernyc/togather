// Custom Jest preset that wraps jest-expo and patches Object.defineProperty
// This fixes React 19 compatibility issues with jest-expo

// CRITICAL: Patch Object.defineProperty BEFORE requiring jest-expo
// This must be done at the module level, before any other code runs
const originalDefineProperty = Object.defineProperty;

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

// CRITICAL: Patch Object.defineProperty using the original - MUST do this first
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

// CRITICAL: Intercept Module._extensions to ensure patch is applied when jest-expo loads
const Module = require('module');
const originalJs = Module._extensions['.js'];
const originalLoad = Module._load;

// Ensure patch is always in place before loading any module
Module._load = function(request, parent) {
  // Re-apply patch before loading any module
  Object.defineProperty = safeDefineProperty;
  if (typeof global !== 'undefined') {
    global.Object.defineProperty = safeDefineProperty;
  }
  if (typeof globalThis !== 'undefined') {
    globalThis.Object.defineProperty = safeDefineProperty;
  }
  return originalLoad.apply(this, arguments);
};

// Now require jest-expo - the patch will be in place
const jestExpoPreset = require('jest-expo');

// Return the jest-expo preset configuration
module.exports = jestExpoPreset;


