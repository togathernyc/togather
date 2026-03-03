/**
 * Geocoding utility for converting addresses and zip codes to coordinates.
 * This allows us to deprecate stored coordinates and compute them on-the-fly.
 *
 * Supports both sync (zip code lookup) and async (full address) geocoding:
 * - Sync: Uses us-zips database for instant zip code lookups
 * - Async: Uses expo-location for full address geocoding (Apple Maps on iOS, Google on Android)
 */

import usZips from 'us-zips';
import { Platform } from 'react-native';
import * as Location from 'expo-location';
import { Group } from '../types';

// Simple in-memory cache for geocoded addresses
const geocodeCache = new Map<string, Coordinates>();

export interface Coordinates {
  latitude: number;
  longitude: number;
}

/**
 * Geocodes a zip code to coordinates using the us-zips database.
 * @param zipCode - The zip code string (will be trimmed)
 * @returns Coordinates if found, null otherwise
 */
export function geocodeZipCode(zipCode: string | null | undefined): Coordinates | null {
  if (!zipCode) return null;

  let trimmedZip = zipCode.toString().trim();
  if (!trimmedZip) return null;

  // Handle zip codes that lost leading zeros (e.g., "7030" -> "07030")
  // US zip codes are always 5 digits (or 9 with extension: 12345-6789)
  if (/^\d{4}$/.test(trimmedZip)) {
    trimmedZip = '0' + trimmedZip;
  } else if (/^\d{3}$/.test(trimmedZip)) {
    trimmedZip = '00' + trimmedZip;
  }

  const zipData = usZips[trimmedZip];
  if (zipData && zipData.latitude && zipData.longitude) {
    return {
      latitude: zipData.latitude,
      longitude: zipData.longitude,
    };
  }

  return null;
}

/**
 * Geocodes a full address string to coordinates.
 * Currently uses zip code lookup from the address or provided zip code.
 * In the future, this could use a geocoding API (Google Maps, Mapbox, etc.) for more precise results.
 * 
 * @param address - Full address string
 * @param zipCode - Optional zip code for faster lookup
 * @returns Coordinates if found, null otherwise
 */
export function geocodeAddress(
  address: string | null | undefined,
  zipCode?: string | null | undefined
): Coordinates | null {
  // First try zip code if provided (fastest)
  if (zipCode) {
    const zipCoords = geocodeZipCode(zipCode);
    if (zipCoords) return zipCoords;
  }
  
  // Try to extract zip code from address string
  if (address) {
    const zipMatch = address.match(/\b\d{5}(?:-\d{4})?\b/);
    if (zipMatch) {
      const zipCoords = geocodeZipCode(zipMatch[0]);
      if (zipCoords) return zipCoords;
    }
  }
  
  return null;
}

/**
 * Geocodes a full address string to coordinates using native geocoding.
 * Uses expo-location which leverages Apple Maps on iOS and Google Maps on Android.
 * Falls back to zip code extraction on web.
 *
 * @param address - Full address string (e.g., "123 Main St, Dallas, TX")
 * @returns Coordinates if found, null otherwise
 */
export async function geocodeAddressAsync(
  address: string | null | undefined
): Promise<Coordinates | null> {
  if (!address || !address.trim()) return null;

  const normalizedAddress = address.trim();

  // Check cache first
  if (geocodeCache.has(normalizedAddress)) {
    return geocodeCache.get(normalizedAddress)!;
  }

  // First try zip code extraction (fast, no API call)
  const zipMatch = normalizedAddress.match(/\b\d{5}(?:-\d{4})?\b/);
  if (zipMatch) {
    const zipCoords = geocodeZipCode(zipMatch[0]);
    if (zipCoords) {
      geocodeCache.set(normalizedAddress, zipCoords);
      return zipCoords;
    }
  }

  // On web, expo-location geocoding isn't available, so return null
  if (Platform.OS === 'web') {
    return null;
  }

  // Use expo-location for native geocoding
  try {
    const results = await Location.geocodeAsync(normalizedAddress);
    if (results && results.length > 0) {
      const { latitude, longitude } = results[0];
      const coords = { latitude, longitude };
      geocodeCache.set(normalizedAddress, coords);
      return coords;
    }
  } catch (error) {
    // Geocoding failed - could be network issue, invalid address, etc.
    // Silently fail and return null
    console.warn('Geocoding failed for address:', normalizedAddress, error);
  }

  return null;
}

/**
 * Gets coordinates for a group from its location data.
 * Handles both snake_case (legacy) and camelCase (tRPC) field names.
 * Priority:
 * 1. Full address geocoding (most precise)
 * 2. Zip code geocoding
 * 3. Legacy location field parsing (extract zip code if possible)
 * 4. Stored coordinates (final fallback)
 *
 * @param group - The group object (can have snake_case or camelCase fields)
 * @returns Coordinates if found, null otherwise
 */
export function getGroupCoordinates(group: Group | any): Coordinates | null {
  // Handle both camelCase (tRPC) and snake_case (legacy) field names
  const addressLine1 = group.address_line1 || group.addressLine1;
  const addressLine2 = group.address_line2 || group.addressLine2;
  const city = group.city;
  const state = group.state;
  const zipCode = group.zip_code || group.zipCode;

  // PRIORITY 1: Try full address geocoding first (most precise)
  if (group.full_address || addressLine1) {
    const address = group.full_address ||
      [addressLine1, addressLine2, city, state, zipCode]
        .filter(Boolean)
        .join(', ');

    const addressCoords = geocodeAddress(address, zipCode || undefined);
    if (addressCoords) return addressCoords;
  }

  // PRIORITY 2: Try zip code geocoding (fallback)
  if (zipCode) {
    const zipCoords = geocodeZipCode(zipCode);
    if (zipCoords) return zipCoords;
  }

  // PRIORITY 3: Fallback to legacy location field if it exists
  // Extract zip code from location string if possible
  if (group.location) {
    const zipMatch = group.location.match(/\b\d{5}(?:-\d{4})?\b/);
    if (zipMatch) {
      const zipCoords = geocodeZipCode(zipMatch[0]);
      if (zipCoords) return zipCoords;
    }
  }

  // PRIORITY 4: Use stored coordinates if available (final fallback)
  // Some groups have pre-computed coordinates stored in the database
  if (group.latitude && group.longitude) {
    return {
      latitude: group.latitude,
      longitude: group.longitude,
    };
  }

  return null;
}

/**
 * Adds computed coordinates to a group object.
 * This is useful for map display when coordinates aren't stored.
 *
 * @param group - The group object
 * @returns Group with computed coordinates added
 */
export function addComputedCoordinates(group: Group): Group & { latitude: number; longitude: number } | null {
  const coords = getGroupCoordinates(group);
  if (!coords) return null;

  return {
    ...group,
    latitude: coords.latitude,
    longitude: coords.longitude,
  };
}

/**
 * Validates a zip code format and checks if it exists in the US zip database.
 * Returns validation result with helpful error messages.
 *
 * @param zipCode - The zip code string to validate
 * @returns Validation result with isValid flag and optional error message
 */
export function validateZipCode(zipCode: string | null | undefined): { isValid: boolean; error?: string } {
  // Empty is valid (zip code is optional)
  if (!zipCode || zipCode.trim() === '') {
    return { isValid: true };
  }

  const trimmed = zipCode.trim();

  // Check basic format: 5 digits, or 5+4 format (12345 or 12345-6789)
  if (!/^\d{3,5}(-\d{4})?$/.test(trimmed)) {
    return {
      isValid: false,
      error: 'ZIP code must be 5 digits (e.g., 10001 or 07030)'
    };
  }

  // Extract the 5-digit part (ignore +4 extension)
  let fiveDigitZip = trimmed.split('-')[0];

  // Pad with leading zeros if needed (handles 3-4 digit inputs)
  fiveDigitZip = fiveDigitZip.padStart(5, '0');

  // Check if it exists in the US zip database
  const coords = geocodeZipCode(fiveDigitZip);
  if (!coords) {
    return {
      isValid: false,
      error: `ZIP code "${trimmed}" not found. Please enter a valid US ZIP code.`
    };
  }

  return { isValid: true };
}

/**
 * Normalizes a zip code by padding with leading zeros if needed.
 * Call this before saving to ensure consistent format.
 *
 * @param zipCode - The zip code string to normalize
 * @returns Normalized zip code or empty string
 */
export function normalizeZipCode(zipCode: string | null | undefined): string {
  if (!zipCode || zipCode.trim() === '') {
    return '';
  }

  const trimmed = zipCode.trim();

  // Extract the 5-digit part (ignore +4 extension)
  const parts = trimmed.split('-');
  const fiveDigitZip = parts[0].padStart(5, '0');

  // Return with extension if provided
  if (parts.length > 1) {
    return `${fiveDigitZip}-${parts[1]}`;
  }

  return fiveDigitZip;
}

