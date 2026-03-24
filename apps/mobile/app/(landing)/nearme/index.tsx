import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  FlatList,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Platform,
} from "react-native";
import { AppImage } from "@components/ui/AppImage";
import { useRouter, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery, api } from "@services/api/convex";
import { useSubdomainCommunity } from "@/features/auth/hooks/useSubdomainCommunity";
import { useUserLocation } from "@/features/location/hooks/useUserLocation";
import { useTheme } from "@hooks/useTheme";
import { DEFAULT_PRIMARY_COLOR } from "@utils/styles";
import { DistanceSlider } from "@/features/nearme/components/DistanceSlider";
import { NearbyGroupCard } from "@/features/nearme/components/NearbyGroupCard";

function NearMeScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const typeParam = typeof params.type === "string" ? params.type : undefined;

  // Community from subdomain
  const { community, subdomain, isLoading: communityLoading, error: communityError } = useSubdomainCommunity();

  // User location
  const {
    coordinates,
    isLoading: locationLoading,
    error: locationError,
    source: locationSource,
    requestDeviceLocation,
    setLocationFromAddress,
    clearLocation,
  } = useUserLocation();

  // Local state
  const [addressInput, setAddressInput] = useState("");
  const [maxDistance, setMaxDistance] = useState(25);
  const [selectedGroupType, setSelectedGroupType] = useState<string | undefined>(typeParam);

  // Fetch group types for filter dropdown
  const groupTypes = useQuery(
    api.functions.groupSearch.listTypesBySubdomain,
    subdomain ? { communitySubdomain: subdomain } : "skip"
  );

  // Find the selected group type info for display
  const selectedGroupTypeInfo = groupTypes?.find((t) => t.slug === selectedGroupType);
  const isFilteredByType = !!typeParam;

  // Fetch nearby groups
  const searchResult = useQuery(
    api.functions.groupSearch.publicSearchNearLocation,
    subdomain && coordinates
      ? {
          communitySubdomain: subdomain,
          groupTypeSlug: selectedGroupType,
          latitude: coordinates.latitude,
          longitude: coordinates.longitude,
          maxDistanceMiles: maxDistance,
          limit: 50,
        }
      : "skip"
  );

  // Convex useQuery returns undefined while loading
  const searchLoading = searchResult === undefined && !!subdomain && !!coordinates;

  // Handle address submit
  const handleAddressSubmit = async () => {
    if (addressInput.trim().length >= 3) {
      const success = await setLocationFromAddress(addressInput.trim());
      if (success) {
        setAddressInput("");
      }
    }
  };

  // Navigate to public group details
  const handleGroupPress = (groupId: string) => {
    router.push(`/group/${groupId}?subdomain=${subdomain}`);
  };

  const handleClose = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace("/(tabs)/search");
    }
  };

  // Community not found
  if (communityError || (!communityLoading && !community && subdomain)) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={[styles.closeButtonRow, { paddingTop: insets.top + 8 }]}>
          <TouchableOpacity style={styles.closeButton} onPress={handleClose}>
            <Ionicons name="close" size={22} color={colors.text} />
          </TouchableOpacity>
        </View>
        <View style={styles.errorContainer}>
          <Ionicons name="alert-circle-outline" size={64} color={colors.textTertiary} />
          <Text style={[styles.errorTitle, { color: colors.text }]}>Community Not Found</Text>
          <Text style={[styles.errorMessage, { color: colors.textSecondary }]}>
            The community "{subdomain}" doesn't exist or is no longer available.
          </Text>
          <TouchableOpacity style={[styles.errorButton, styles.errorButtonPrimary]} onPress={handleClose}>
            <Text style={[styles.errorButtonText, styles.errorButtonPrimaryText]}>Go to Explore</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // No subdomain provided
  if (!subdomain && !communityLoading) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={[styles.closeButtonRow, { paddingTop: insets.top + 8 }]}>
          <TouchableOpacity style={styles.closeButton} onPress={handleClose}>
            <Ionicons name="close" size={22} color={colors.text} />
          </TouchableOpacity>
        </View>
        <View style={styles.errorContainer}>
          <Ionicons name="location-outline" size={64} color={colors.textTertiary} />
          <Text style={[styles.errorTitle, { color: colors.text }]}>Community Required</Text>
          <Text style={[styles.errorMessage, { color: colors.textSecondary }]}>
            Please access this page through a community subdomain.
          </Text>
          <TouchableOpacity style={[styles.errorButton, styles.errorButtonPrimary]} onPress={handleClose}>
            <Text style={[styles.errorButtonText, styles.errorButtonPrimaryText]}>Go to Explore</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // Loading community
  if (communityLoading) {
    return (
      <View style={[styles.loadingContainer, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={DEFAULT_PRIMARY_COLOR} />
        <Text style={[styles.loadingText, { color: colors.textSecondary }]}>Loading community...</Text>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: colors.border, paddingTop: insets.top + 8 }]}>
        <TouchableOpacity style={styles.closeButton} onPress={handleClose}>
          <Ionicons name="close" size={22} color={colors.text} />
        </TouchableOpacity>
        {community?.logo && (
          <AppImage
            source={community.logo}
            style={styles.communityLogo}
            optimizedWidth={96}
            placeholder={{
              type: 'initials',
              name: community.name,
            }}
          />
        )}
        <View style={styles.headerText}>
          <Text style={[styles.communityName, { color: colors.textSecondary }]}>{community?.name}</Text>
          <Text style={[styles.pageTitle, { color: colors.text }]}>
            {selectedGroupTypeInfo
              ? `Find a ${selectedGroupTypeInfo.name} Near You`
              : "Find a group near you"}
          </Text>
        </View>
      </View>

      <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent}>
        {/* Location Section */}
        <View style={[styles.section, { borderBottomColor: colors.border }]}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Your Location</Text>

          {coordinates ? (
            <View style={[styles.locationActive, { backgroundColor: colors.surfaceSecondary }]}>
              <Ionicons
                name={locationSource === "device" ? "location" : "pin"}
                size={20}
                color={DEFAULT_PRIMARY_COLOR}
              />
              <Text style={[styles.locationText, { color: colors.text }]}>
                {locationSource === "device" ? "Using your current location" : "Using entered location"}
              </Text>
              <TouchableOpacity onPress={clearLocation} style={styles.changeButton}>
                <Text style={styles.changeButtonText}>Change</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.locationOptions}>
              <TouchableOpacity
                style={styles.locationButton}
                onPress={requestDeviceLocation}
                disabled={locationLoading}
              >
                {locationLoading ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <>
                    <Ionicons name="locate" size={20} color="#fff" />
                    <Text style={styles.locationButtonText}>Use my location</Text>
                  </>
                )}
              </TouchableOpacity>

              <Text style={[styles.orText, { color: colors.textTertiary }]}>or</Text>

              <View style={styles.addressInputContainer}>
                <TextInput
                  style={[styles.addressInput, { borderColor: colors.border, color: colors.text, backgroundColor: colors.inputBackground }]}
                  placeholder="Enter address or zip code"
                  placeholderTextColor={colors.inputPlaceholder}
                  value={addressInput}
                  onChangeText={setAddressInput}
                  autoCapitalize="words"
                  autoCorrect={false}
                  onSubmitEditing={handleAddressSubmit}
                />
                <TouchableOpacity
                  style={[styles.addressButton, (addressInput.trim().length < 3 || locationLoading) && styles.addressButtonDisabled]}
                  onPress={handleAddressSubmit}
                  disabled={addressInput.trim().length < 3 || locationLoading}
                >
                  {locationLoading ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <Ionicons name="arrow-forward" size={20} color="#fff" />
                  )}
                </TouchableOpacity>
              </View>
            </View>
          )}

          {locationError && <Text style={styles.locationErrorText}>{locationError}</Text>}
        </View>

        {/* Distance Slider */}
        {coordinates && (
          <View style={[styles.section, { borderBottomColor: colors.border }]}>
            <DistanceSlider value={maxDistance} onChange={setMaxDistance} />
          </View>
        )}

        {/* Group Type Filter - hidden when pre-filtered by URL param */}
        {groupTypes && groupTypes.length > 1 && !isFilteredByType && (
          <View style={[styles.section, { borderBottomColor: colors.border }]}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>Group Type</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View style={styles.filterRow}>
                <TouchableOpacity
                  style={[styles.filterChip, { backgroundColor: colors.surfaceSecondary }, !selectedGroupType && styles.filterChipActive]}
                  onPress={() => setSelectedGroupType(undefined)}
                >
                  <Text
                    style={[styles.filterChipText, { color: colors.text }, !selectedGroupType && styles.filterChipTextActive]}
                  >
                    All
                  </Text>
                </TouchableOpacity>
                {groupTypes.map((type) => (
                  <TouchableOpacity
                    key={type.id}
                    style={[styles.filterChip, { backgroundColor: colors.surfaceSecondary }, selectedGroupType === type.slug && styles.filterChipActive]}
                    onPress={() => setSelectedGroupType(type.slug)}
                  >
                    <Text
                      style={[
                        styles.filterChipText,
                        { color: colors.text },
                        selectedGroupType === type.slug && styles.filterChipTextActive,
                      ]}
                    >
                      {type.name}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </ScrollView>
          </View>
        )}

        {/* Results */}
        {coordinates && (
          <View style={[styles.section, { borderBottomColor: colors.border }]}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>
              {searchLoading
                ? "Searching..."
                : searchResult?.groups.length
                ? `${searchResult.groups.length} group${searchResult.groups.length !== 1 ? "s" : ""} found`
                : "No groups found"}
            </Text>

            {searchLoading ? (
              <ActivityIndicator size="large" color={DEFAULT_PRIMARY_COLOR} style={styles.loader} />
            ) : searchResult?.groups.length ? (
              <View style={styles.groupsList}>
                {searchResult.groups.map((group) => (
                  <NearbyGroupCard
                    key={group.id}
                    group={group}
                    onPress={() => handleGroupPress(group.id)}
                  />
                ))}
              </View>
            ) : (
              <View style={styles.emptyState}>
                <Ionicons name="search-outline" size={48} color={colors.textTertiary} />
                <Text style={[styles.emptyTitle, { color: colors.text }]}>No groups nearby</Text>
                <Text style={[styles.emptyMessage, { color: colors.textSecondary }]}>
                  Try increasing the distance or changing your location.
                </Text>
              </View>
            )}
          </View>
        )}

        {/* Prompt to set location */}
        {!coordinates && !locationLoading && (
          <View style={styles.promptContainer}>
            <Ionicons name="compass-outline" size={64} color={colors.textTertiary} />
            <Text style={[styles.promptTitle, { color: colors.text }]}>Set your location</Text>
            <Text style={[styles.promptMessage, { color: colors.textSecondary }]}>
              We need your location to find groups near you.
            </Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  loadingText: {
    marginTop: 16,
    fontSize: 16,
  },
  closeButtonRow: {
    flexDirection: "row",
    justifyContent: "flex-start",
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  closeButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "rgba(150, 150, 150, 0.15)",
    justifyContent: "center",
    alignItems: "center",
  },
  errorContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 40,
  },
  errorTitle: {
    fontSize: 24,
    fontWeight: "600",
    marginTop: 16,
    textAlign: "center",
  },
  errorMessage: {
    fontSize: 16,
    marginTop: 8,
    textAlign: "center",
    lineHeight: 24,
  },
  errorButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 8,
    marginTop: 24,
  },
  errorButtonPrimary: {
    backgroundColor: DEFAULT_PRIMARY_COLOR,
  },
  errorButtonText: {
    fontSize: 16,
    fontWeight: "500",
  },
  errorButtonPrimaryText: {
    color: "#fff",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    padding: 16,
    borderBottomWidth: 1,
  },
  communityLogo: {
    width: 48,
    height: 48,
    borderRadius: 8,
    marginRight: 12,
  },
  headerText: {
    flex: 1,
  },
  communityName: {
    fontSize: 14,
  },
  pageTitle: {
    fontSize: 20,
    fontWeight: "600",
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 40,
  },
  section: {
    padding: 16,
    borderBottomWidth: 1,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "600",
    marginBottom: 12,
  },
  locationActive: {
    flexDirection: "row",
    alignItems: "center",
    padding: 12,
    borderRadius: 8,
  },
  locationText: {
    flex: 1,
    marginLeft: 8,
    fontSize: 14,
  },
  changeButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  changeButtonText: {
    color: DEFAULT_PRIMARY_COLOR,
    fontWeight: "500",
  },
  locationOptions: {
    gap: 12,
  },
  locationButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: DEFAULT_PRIMARY_COLOR,
    padding: 14,
    borderRadius: 8,
    gap: 8,
  },
  locationButtonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
  orText: {
    textAlign: "center",
    fontSize: 14,
  },
  addressInputContainer: {
    flexDirection: "row",
    gap: 8,
  },
  addressInput: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 8,
    padding: 14,
    fontSize: 16,
  },
  addressButton: {
    backgroundColor: DEFAULT_PRIMARY_COLOR,
    width: 48,
    borderRadius: 8,
    justifyContent: "center",
    alignItems: "center",
  },
  addressButtonDisabled: {
    opacity: 0.5,
  },
  locationErrorText: {
    color: "#e74c3c",
    fontSize: 14,
    marginTop: 8,
  },
  filterRow: {
    flexDirection: "row",
    gap: 8,
  },
  filterChip: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
  },
  filterChipActive: {
    backgroundColor: DEFAULT_PRIMARY_COLOR,
  },
  filterChipText: {
    fontSize: 14,
  },
  filterChipTextActive: {
    color: "#fff",
    fontWeight: "500",
  },
  loader: {
    marginTop: 24,
  },
  groupsList: {
    gap: 12,
  },
  emptyState: {
    alignItems: "center",
    paddingVertical: 40,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: "600",
    marginTop: 16,
  },
  emptyMessage: {
    fontSize: 14,
    marginTop: 8,
    textAlign: "center",
  },
  promptContainer: {
    alignItems: "center",
    paddingVertical: 60,
    paddingHorizontal: 40,
  },
  promptTitle: {
    fontSize: 20,
    fontWeight: "600",
    marginTop: 16,
  },
  promptMessage: {
    fontSize: 16,
    marginTop: 8,
    textAlign: "center",
    lineHeight: 24,
  },
});

export default NearMeScreen;
