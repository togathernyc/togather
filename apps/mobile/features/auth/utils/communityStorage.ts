// Community storage utilities using AsyncStorage

import AsyncStorage from "@react-native-async-storage/async-storage";
import { Community } from "../types";

const COMMUNITY_STORAGE_KEY = "current_community";
const COMMUNITY_ID_STORAGE_KEY = "newCommunityId";

export const communityStorage = {
  /**
   * Get community from storage
   */
  async getCommunity(): Promise<Community | null> {
    try {
      const communityData = await AsyncStorage.getItem(COMMUNITY_STORAGE_KEY);
      if (communityData && communityData !== "null" && communityData !== "undefined") {
        try {
          return JSON.parse(communityData);
        } catch {
          // If not JSON, treat as ID
          const communityId = await AsyncStorage.getItem(COMMUNITY_ID_STORAGE_KEY);
          return communityId ? { id: communityId } : null;
        }
      }
      return null;
    } catch (error) {
      console.error("Error getting community from storage:", error);
      return null;
    }
  },

  /**
   * Save community to storage
   */
  async setCommunity(community: Community): Promise<void> {
    try {
      await AsyncStorage.setItem(COMMUNITY_STORAGE_KEY, JSON.stringify(community));
      if (community.id) {
        await AsyncStorage.setItem(COMMUNITY_ID_STORAGE_KEY, String(community.id));
      }
    } catch (error) {
      console.error("Error saving community to storage:", error);
      throw error;
    }
  },

  /**
   * Get community ID from storage
   */
  async getCommunityId(): Promise<string | null> {
    try {
      return await AsyncStorage.getItem(COMMUNITY_ID_STORAGE_KEY);
    } catch (error) {
      console.error("Error getting community ID from storage:", error);
      return null;
    }
  },

  /**
   * Save community ID to storage
   */
  async setCommunityId(communityId: string | number): Promise<void> {
    try {
      await AsyncStorage.setItem(COMMUNITY_ID_STORAGE_KEY, String(communityId));
    } catch (error) {
      console.error("Error saving community ID to storage:", error);
      throw error;
    }
  },

  /**
   * Remove community from storage
   */
  async removeCommunity(): Promise<void> {
    try {
      await AsyncStorage.removeItem(COMMUNITY_STORAGE_KEY);
      await AsyncStorage.removeItem(COMMUNITY_ID_STORAGE_KEY);
    } catch (error) {
      console.error("Error removing community from storage:", error);
      throw error;
    }
  },
};

