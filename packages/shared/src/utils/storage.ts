/**
 * Platform-aware storage abstraction
 * Uses localStorage on web, SecureStore on mobile (with AsyncStorage fallback)
 */

// Minimal type declarations for browser globals (not available in Node.js)
// These are only used for type-checking; runtime checks handle actual availability
declare const window: object | undefined;
declare const localStorage:
  | {
      getItem(key: string): string | null;
      setItem(key: string, value: string): void;
      removeItem(key: string): void;
    }
  | undefined;

// Platform detection
const isWeb =
  typeof window !== "undefined" && typeof localStorage !== "undefined";

class Storage {
  async getItem(key: string): Promise<string | null> {
    if (isWeb) {
      return localStorage!.getItem(key);
    } else {
      // Try SecureStore first (more secure), fallback to AsyncStorage
      try {
        // Dynamic import for mobile to avoid bundling issues
        const SecureStore = require("expo-secure-store");
        return await SecureStore.getItemAsync(key);
      } catch (secureError) {
        // Fallback to AsyncStorage if SecureStore fails
        try {
          const AsyncStorage =
            require("@react-native-async-storage/async-storage").default;
          return await AsyncStorage.getItem(key);
        } catch (error) {
          console.error(`Error getting item ${key}:`, error);
          return null;
        }
      }
    }
  }

  async setItem(key: string, value: string): Promise<void> {
    if (isWeb) {
      localStorage!.setItem(key, value);
    } else {
      // Try SecureStore first (more secure), fallback to AsyncStorage
      try {
        const SecureStore = require("expo-secure-store");
        await SecureStore.setItemAsync(key, value);
      } catch (secureError) {
        // Fallback to AsyncStorage if SecureStore fails
        try {
          const AsyncStorage =
            require("@react-native-async-storage/async-storage").default;
          await AsyncStorage.setItem(key, value);
        } catch (error) {
          console.error(`Error setting item ${key}:`, error);
          throw error;
        }
      }
    }
  }

  async removeItem(key: string): Promise<void> {
    if (isWeb) {
      localStorage!.removeItem(key);
    } else {
      // Try SecureStore first (more secure), fallback to AsyncStorage
      try {
        const SecureStore = require("expo-secure-store");
        await SecureStore.deleteItemAsync(key);
      } catch (secureError) {
        // Fallback to AsyncStorage if SecureStore fails
        try {
          const AsyncStorage =
            require("@react-native-async-storage/async-storage").default;
          await AsyncStorage.removeItem(key);
        } catch (error) {
          console.error(`Error removing item ${key}:`, error);
        }
      }
    }
  }
}

export const storage = new Storage();

