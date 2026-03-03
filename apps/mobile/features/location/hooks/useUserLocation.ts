/**
 * useUserLocation Hook
 *
 * Provides location management for the mobile app.
 *
 * Features:
 * - Auto-detection via browser/device geolocation
 * - Manual entry via zip code
 * - Address geocoding (native only)
 * - Persistent caching between sessions
 *
 * Note: Web-based geocoding requires an external geocoding service.
 * For now, web users should use zip code lookup which uses a local database.
 */

import { useState, useCallback, useEffect } from "react";
import { Platform } from "react-native";
import * as Location from "expo-location";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { geocodeZipCode, geocodeAddressAsync } from "@/features/groups/utils/geocodeLocation";

const LOCATION_CACHE_KEY = "user_location_cache";
const CACHE_EXPIRY_MS = 30 * 60 * 1000; // 30 minutes

export interface Coordinates {
  latitude: number;
  longitude: number;
}

interface CachedLocation {
  coordinates: Coordinates;
  timestamp: number;
  source: "device" | "manual";
}

interface UseUserLocationResult {
  /** Current user coordinates (null if not yet determined) */
  coordinates: Coordinates | null;
  /** Whether location is currently being fetched */
  isLoading: boolean;
  /** Error message if location fetch failed */
  error: string | null;
  /** Source of the current location */
  source: "device" | "manual" | null;
  /** Request location from device (prompts for permission) */
  requestDeviceLocation: () => Promise<void>;
  /** Set location manually from zip code */
  setLocationFromZip: (zipCode: string) => boolean;
  /** Set location from address (async, uses geocoding API) */
  setLocationFromAddress: (address: string) => Promise<boolean>;
  /** Clear cached location */
  clearLocation: () => void;
}

/**
 * Hook for managing user location
 *
 * Provides:
 * - Auto-detection via browser/device geolocation
 * - Manual entry via zip code
 * - Persistent caching between sessions
 *
 * Usage:
 * ```tsx
 * const { coordinates, requestDeviceLocation, setLocationFromZip, isLoading, error } = useUserLocation();
 *
 * // Request device location
 * await requestDeviceLocation();
 *
 * // Or set manually
 * setLocationFromZip("75001");
 * ```
 */
export function useUserLocation(): UseUserLocationResult {
  const [coordinates, setCoordinates] = useState<Coordinates | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<"device" | "manual" | null>(null);

  // Load cached location on mount
  useEffect(() => {
    loadCachedLocation();
  }, []);

  const loadCachedLocation = async () => {
    try {
      const cached = await AsyncStorage.getItem(LOCATION_CACHE_KEY);
      if (cached) {
        const data: CachedLocation = JSON.parse(cached);
        // Check if cache is still valid
        if (Date.now() - data.timestamp < CACHE_EXPIRY_MS) {
          setCoordinates(data.coordinates);
          setSource(data.source);
        }
      }
    } catch (e) {
      // Ignore cache errors
    }
  };

  const cacheLocation = async (coords: Coordinates, src: "device" | "manual") => {
    try {
      const data: CachedLocation = {
        coordinates: coords,
        timestamp: Date.now(),
        source: src,
      };
      await AsyncStorage.setItem(LOCATION_CACHE_KEY, JSON.stringify(data));
    } catch (e) {
      // Ignore cache errors
    }
  };

  const requestDeviceLocation = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      // Request permission
      const { status } = await Location.requestForegroundPermissionsAsync();

      if (status !== "granted") {
        setError("Location permission denied. Please enter your zip code instead.");
        setIsLoading(false);
        return;
      }

      // Get current position
      const location = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });

      const coords: Coordinates = {
        latitude: location.coords.latitude,
        longitude: location.coords.longitude,
      };

      setCoordinates(coords);
      setSource("device");
      await cacheLocation(coords, "device");
      setError(null);
    } catch (e) {
      console.error("Failed to get device location:", e);
      setError("Failed to get your location. Please enter your zip code instead.");
    } finally {
      setIsLoading(false);
    }
  }, []);

  const setLocationFromZip = useCallback((zipCode: string): boolean => {
    setError(null);

    const coords = geocodeZipCode(zipCode);
    if (coords) {
      setCoordinates(coords);
      setSource("manual");
      cacheLocation(coords, "manual");
      return true;
    }

    setError("Invalid zip code. Please enter a valid US zip code.");
    return false;
  }, []);

  const setLocationFromAddress = useCallback(async (address: string): Promise<boolean> => {
    setError(null);
    setIsLoading(true);

    try {
      // First check if it's just a zip code
      const zipMatch = address.trim().match(/^\d{5}$/);
      if (zipMatch) {
        const coords = geocodeZipCode(zipMatch[0]);
        if (coords) {
          setCoordinates(coords);
          setSource("manual");
          await cacheLocation(coords, "manual");
          return true;
        }
      }

      // Try native geocoding (works on iOS/Android)
      if (Platform.OS !== "web") {
        const nativeCoords = await geocodeAddressAsync(address);
        if (nativeCoords) {
          setCoordinates(nativeCoords);
          setSource("manual");
          await cacheLocation(nativeCoords, "manual");
          return true;
        }
      } else {
        // On web, suggest using zip code instead
        // (External geocoding API not available)
        setError("Address lookup is not available on web. Please enter a zip code instead.");
        return false;
      }

      setError("Could not find that address. Please try a different address or zip code.");
      return false;
    } catch (e) {
      console.error("Failed to geocode address:", e);
      setError("Failed to look up address. Please try again.");
      return false;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const clearLocation = useCallback(() => {
    setCoordinates(null);
    setSource(null);
    setError(null);
    AsyncStorage.removeItem(LOCATION_CACHE_KEY);
  }, []);

  return {
    coordinates,
    isLoading,
    error,
    source,
    requestDeviceLocation,
    setLocationFromZip,
    setLocationFromAddress,
    clearLocation,
  };
}
