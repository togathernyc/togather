import { useCallback, useEffect, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

const JOIN_INTENT_KEY = "pending_join_intent";

export interface JoinIntent {
  groupId: string;
  subdomain: string;
  timestamp: number;
}

// Intent expires after 30 minutes
const INTENT_EXPIRY_MS = 30 * 60 * 1000;

/**
 * Hook for managing join group intent across the auth flow
 *
 * Usage:
 * 1. Before auth: setJoinIntent({ groupId, subdomain })
 * 2. After auth: checkJoinIntent() to get and clear the intent
 */
export function useJoinIntent() {
  const [intent, setIntent] = useState<JoinIntent | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Load intent on mount
  useEffect(() => {
    loadIntent();
  }, []);

  const loadIntent = async () => {
    try {
      const stored = await AsyncStorage.getItem(JOIN_INTENT_KEY);
      if (stored) {
        const parsed: JoinIntent = JSON.parse(stored);
        // Check if expired
        if (Date.now() - parsed.timestamp < INTENT_EXPIRY_MS) {
          setIntent(parsed);
        } else {
          // Clear expired intent
          await AsyncStorage.removeItem(JOIN_INTENT_KEY);
        }
      }
    } catch (e) {
      console.error("Failed to load join intent:", e);
    } finally {
      setIsLoading(false);
    }
  };

  const setJoinIntent = useCallback(async (groupId: string, subdomain: string) => {
    const newIntent: JoinIntent = {
      groupId,
      subdomain,
      timestamp: Date.now(),
    };
    try {
      await AsyncStorage.setItem(JOIN_INTENT_KEY, JSON.stringify(newIntent));
      setIntent(newIntent);
    } catch (e) {
      console.error("Failed to save join intent:", e);
    }
  }, []);

  const clearJoinIntent = useCallback(async () => {
    try {
      await AsyncStorage.removeItem(JOIN_INTENT_KEY);
      setIntent(null);
    } catch (e) {
      console.error("Failed to clear join intent:", e);
    }
  }, []);

  /**
   * Check and consume the join intent
   * Returns the intent if present, and clears it
   */
  const consumeJoinIntent = useCallback(async (): Promise<JoinIntent | null> => {
    try {
      const stored = await AsyncStorage.getItem(JOIN_INTENT_KEY);
      if (stored) {
        const parsed: JoinIntent = JSON.parse(stored);
        // Check if expired
        if (Date.now() - parsed.timestamp < INTENT_EXPIRY_MS) {
          await AsyncStorage.removeItem(JOIN_INTENT_KEY);
          setIntent(null);
          return parsed;
        }
        // Clear expired intent
        await AsyncStorage.removeItem(JOIN_INTENT_KEY);
      }
    } catch (e) {
      console.error("Failed to consume join intent:", e);
    }
    return null;
  }, []);

  return {
    intent,
    isLoading,
    setJoinIntent,
    clearJoinIntent,
    consumeJoinIntent,
  };
}
