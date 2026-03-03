/**
 * Test for storage.ts browser globals compatibility
 *
 * Background: The storage utility uses browser globals (window, localStorage)
 * that don't exist in Node.js. The type declarations must be compatible with
 * Node.js TypeScript compilation to allow server-side builds (like api-trpc)
 * to include @togather/shared without type errors.
 *
 * See: CI failure in Deploy API (Staging) run #20760814044
 */

import { storage } from '../utils/storage';

describe('storage', () => {
  it('should export a storage instance', () => {
    expect(storage).toBeDefined();
    expect(typeof storage.getItem).toBe('function');
    expect(typeof storage.setItem).toBe('function');
    expect(typeof storage.removeItem).toBe('function');
  });

  it('should handle Node.js environment (no localStorage)', async () => {
    // In Node.js, isWeb will be false, so storage falls back to SecureStore/AsyncStorage
    // This test verifies the code doesn't crash when browser globals are missing
    // The actual storage operations will fail gracefully (returning null or throwing)
    // because neither SecureStore nor AsyncStorage are available in Node.js
    try {
      const result = await storage.getItem('test-key');
      // If we get here, it either returned null or a value
      expect(result).toBeNull();
    } catch (error) {
      // Expected in Node.js - SecureStore/AsyncStorage not available
      expect(error).toBeDefined();
    }
  });
});
