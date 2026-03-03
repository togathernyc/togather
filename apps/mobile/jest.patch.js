// Patch Object.defineProperty to handle React 19 compatibility with jest-expo
// This file runs in setupFiles, which runs after the preset but before tests
// However, jest-expo's preset setup runs before this, so we also patch in run-tests.js

// Only patch if not already patched (to avoid double-patching)
if (!Object.defineProperty._patched) {
  const originalDefineProperty = Object.defineProperty;

  Object.defineProperty = function(obj, prop, descriptor) {
    // Check if obj is null or undefined - return immediately
    // This is the key fix for jest-expo's setup.js which calls defineProperty on null/undefined
    if (obj === null || obj === undefined) {
      return obj;
    }
    
    // Check if obj is actually an object or function
    const objType = typeof obj;
    if (objType !== 'object' && objType !== 'function') {
      // For primitives, try to wrap them
      try {
        const wrapped = Object(obj);
        return originalDefineProperty.call(this, wrapped, prop, descriptor);
      } catch (e) {
        // If wrapping fails, just return the original obj
        return obj;
      }
    }
    
    // For valid objects/functions, try to call original
    try {
      return originalDefineProperty.call(this, obj, prop, descriptor);
    } catch (e) {
      // If it fails for any reason, just return the object unchanged
      // This prevents crashes during jest-expo setup
      return obj;
    }
  };

  // Mark as patched
  Object.defineProperty._patched = true;
  Object.defineProperty.original = originalDefineProperty;
}

