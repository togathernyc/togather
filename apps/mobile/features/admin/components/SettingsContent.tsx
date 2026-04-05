/**
 * SettingsContent - Community settings management for admins
 *
 * Provides forms for:
 * - Basic community info (name, logo, subdomain)
 * - Address fields
 * - Branding colors
 * - Explore page default filters (group types, meeting type)
 * - Group types management
 * - Integrations
 */
import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  TextInput,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  Platform,
} from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { DEFAULT_PRIMARY_COLOR, DEFAULT_SECONDARY_COLOR } from "../../../utils/styles";
import { useCommunityTheme } from "@hooks/useCommunityTheme";
import { useTheme } from "@hooks/useTheme";
import { uploadAsync, FileSystemUploadType } from "expo-file-system/legacy";
import { ImagePicker } from "@components/ui";
import * as Linking from "expo-linking";
import { useCommunitySettings, useGroupTypes, GroupType } from "../hooks";
import { GroupTypeEditModal } from "./GroupTypeEditModal";
import { useAvailableIntegrations } from "../../integrations/hooks/useIntegrations";
import { ColorPicker } from "./ColorPicker";
import { ColorPreview } from "./ColorPreview";
import { formatError } from "@/utils/error-handling";
import { getGroupTypeColor } from "../../explore/constants";
import { useAuth } from "@providers/AuthProvider";
import { useQuery, api } from "@services/api/convex";
import { DOMAIN_CONFIG } from "@togather/shared/config";
import type { Id } from "@services/api/convex";

export function SettingsContent() {
  const router = useRouter();
  const { primaryColor: themePrimaryColor } = useCommunityTheme();
  const { colors, isDark } = useTheme();
  const {
    settings,
    isLoading,
    isError,
    refetch,
    updateSettings,
    isUpdating,
    uploadLogo,
    isUploadingLogo,
  } = useCommunitySettings();

  const {
    groupTypes,
    isLoading: groupTypesLoading,
    refetch: refetchGroupTypes,
    updateGroupType,
    isUpdating: isUpdatingGroupType,
    createGroupType,
    isCreating,
  } = useGroupTypes();

  // Billing data
  const { community, token } = useAuth();
  const billing = useQuery(
    api.functions.ee.billing.getSubscriptionStatus,
    community?.id && token
      ? { token, communityId: community.id as Id<"communities"> }
      : "skip"
  );

  const {
    data: integrations,
    isLoading: integrationsLoading,
    refetch: refetchIntegrations,
  } = useAvailableIntegrations();

  // Form state
  const [name, setName] = useState("");
  const [subdomain, setSubdomain] = useState("");
  const [addressLine1, setAddressLine1] = useState("");
  const [addressLine2, setAddressLine2] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [zipCode, setZipCode] = useState("");
  const [country, setCountry] = useState("");
  const [primaryColor, setPrimaryColor] = useState(DEFAULT_PRIMARY_COLOR);
  const [secondaryColor, setSecondaryColor] = useState(DEFAULT_SECONDARY_COLOR);

  // UI state
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [selectedImageUri, setSelectedImageUri] = useState<string | null>(null);
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  const [editingGroupType, setEditingGroupType] = useState<GroupType | null>(null);
  const [isCreatingGroupType, setIsCreatingGroupType] = useState(false);

  // Explore page settings state
  const [exploreGroupTypes, setExploreGroupTypes] = useState<string[]>([]);
  const [exploreDefaultMeetingType, setExploreDefaultMeetingType] = useState<number | null>(null);
  const [isSavingExplore, setIsSavingExplore] = useState(false);

  // Populate form with current settings
  useEffect(() => {
    if (settings) {
      setName(settings.name || "");
      setSubdomain(settings.subdomain || "");
      setAddressLine1(settings.addressLine1 || "");
      setAddressLine2(settings.addressLine2 || "");
      setCity(settings.city || "");
      setState(settings.state || "");
      setZipCode(settings.zipCode || "");
      setCountry(settings.country || "");
      setPrimaryColor(settings.primaryColor || DEFAULT_PRIMARY_COLOR);
      setSecondaryColor(settings.secondaryColor || DEFAULT_SECONDARY_COLOR);
      setExploreGroupTypes(settings.exploreDefaultGroupTypes || []);
      setExploreDefaultMeetingType(settings.exploreDefaultMeetingType ?? null);
    }
  }, [settings]);

  // Track if form is dirty
  useEffect(() => {
    if (settings) {
      const hasChanges =
        name !== (settings.name || "") ||
        subdomain !== (settings.subdomain || "") ||
        addressLine1 !== (settings.addressLine1 || "") ||
        addressLine2 !== (settings.addressLine2 || "") ||
        city !== (settings.city || "") ||
        state !== (settings.state || "") ||
        zipCode !== (settings.zipCode || "") ||
        country !== (settings.country || "") ||
        primaryColor !== (settings.primaryColor || DEFAULT_PRIMARY_COLOR) ||
        secondaryColor !== (settings.secondaryColor || DEFAULT_SECONDARY_COLOR);
      setIsDirty(hasChanges);
    }
  }, [settings, name, subdomain, addressLine1, addressLine2, city, state, zipCode, country, primaryColor, secondaryColor]);

  // Image upload function (replaces React Query useMutation)
  const uploadImage = async (imageUri: string) => {
    setIsUploadingImage(true);

    try {
      const fileName = imageUri.split("/").pop() || "logo.jpg";
      const cleanFileName = fileName.split("?")[0];
      const fileExtension = cleanFileName.split(".").pop()?.toLowerCase() || "jpg";
      const contentType = `image/${fileExtension === "jpg" ? "jpeg" : fileExtension}`;

      // Get presigned URL
      const { uploadUrl, storagePath } = await uploadLogo({
        fileName: cleanFileName,
        contentType,
      });

      // Upload to R2
      if (Platform.OS === "web") {
        const response = await fetch(imageUri);
        const blob = await response.blob();
        const uploadResponse = await fetch(uploadUrl, {
          method: "PUT",
          body: blob,
          headers: {
            "Content-Type": contentType,
          },
        });
        if (!uploadResponse.ok) {
          throw new Error(`Upload failed: ${uploadResponse.status}`);
        }
      } else {
        const uploadResult = await uploadAsync(uploadUrl, imageUri, {
          httpMethod: "PUT",
          uploadType: FileSystemUploadType.BINARY_CONTENT,
          headers: {
            "Content-Type": contentType,
          },
        });
        if (uploadResult.status < 200 || uploadResult.status >= 300) {
          throw new Error(`Upload failed: ${uploadResult.status}`);
        }
      }

      // Save the logo path to the community record
      await updateSettings({ logo: storagePath });

      // Success
      setIsUploadingImage(false);
      setSelectedImageUri(null); // Clear local image so server URL is used
      await refetch();
    } catch (error) {
      console.error("Upload error:", error);
      setIsUploadingImage(false);
      Alert.alert("Upload Failed", (error as Error).message || "Failed to upload logo");
      throw error;
    }
  };

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await Promise.all([refetch(), refetchGroupTypes(), refetchIntegrations()]);
    setIsRefreshing(false);
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await updateSettings({
        name: name.trim(),
        subdomain: subdomain.trim().toLowerCase(),
        addressLine1: addressLine1.trim() || undefined,
        addressLine2: addressLine2.trim() || undefined,
        city: city.trim() || undefined,
        state: state.trim() || undefined,
        zipCode: zipCode.trim() || undefined,
        country: country.trim() || undefined,
        primaryColor: primaryColor,
        secondaryColor: secondaryColor,
      });
      setIsDirty(false);
      Alert.alert("Success", "Community settings updated");
    } catch (error: any) {
      Alert.alert("Error", formatError(error, "Failed to update settings"));
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveExploreDefaults = async () => {
    setIsSavingExplore(true);
    try {
      await updateSettings({
        exploreDefaultGroupTypes: (exploreGroupTypes.length > 0 ? exploreGroupTypes : []) as Id<"groupTypes">[],
        exploreDefaultMeetingType: exploreDefaultMeetingType ?? 0,
      });
      Alert.alert("Success", "Explore page defaults updated");
    } catch (error: any) {
      Alert.alert("Error", formatError(error, "Failed to update explore defaults"));
    } finally {
      setIsSavingExplore(false);
    }
  };

  const toggleExploreGroupType = (groupTypeId: string) => {
    setExploreGroupTypes((prev) =>
      prev.includes(groupTypeId)
        ? prev.filter((id) => id !== groupTypeId)
        : [...prev, groupTypeId]
    );
  };

  const handleImageSelected = async (imageUri: string) => {
    if (!imageUri) return;
    setSelectedImageUri(imageUri);
    try {
      await new Promise((resolve) => setTimeout(resolve, 200));
      await uploadImage(imageUri);
    } catch (error) {
      console.error("Failed to upload logo:", error);
    }
  };

  const handleSaveGroupType = async (data: { name: string; description: string }) => {
    try {
      if (isCreatingGroupType) {
        await createGroupType({
          name: data.name.trim(),
          description: data.description.trim() || undefined,
        });
        Alert.alert("Success", "Group type created");
      } else if (editingGroupType) {
        await updateGroupType({
          groupTypeId: editingGroupType.id,
          name: data.name.trim(),
          description: data.description.trim() || undefined,
        });
        Alert.alert("Success", "Group type updated");
      }
      setEditingGroupType(null);
      setIsCreatingGroupType(false);
    } catch (error: any) {
      Alert.alert("Error", formatError(error, "Failed to save group type"));
    }
  };

  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={themePrimaryColor} />
        <Text style={[styles.loadingText, { color: colors.textSecondary }]}>Loading settings...</Text>
      </View>
    );
  }

  if (isError) {
    return (
      <View style={styles.errorContainer}>
        <Ionicons name="alert-circle-outline" size={48} color={colors.error} />
        <Text style={[styles.errorTitle, { color: colors.text }]}>Failed to load settings</Text>
        <TouchableOpacity style={[styles.retryButton, { backgroundColor: themePrimaryColor }]} onPress={() => refetch()}>
          <Text style={styles.retryButtonText}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.surfaceSecondary }]}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} />
        }
      >
        {/* Quick Links Section */}
        <View style={[styles.section, { backgroundColor: colors.surface }]}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Quick Links</Text>
          <TouchableOpacity
            style={[styles.quickLinkItem, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border }]}
            onPress={() => router.push("/(user)/admin/community-wide-events")}
          >
            <View style={[styles.quickLinkIcon, { backgroundColor: colors.surface }]}>
              <Ionicons name="calendar-outline" size={20} color={themePrimaryColor} />
            </View>
            <View style={styles.quickLinkInfo}>
              <Text style={[styles.quickLinkName, { color: colors.text }]}>Community-Wide Events</Text>
              <Text style={[styles.quickLinkDescription, { color: colors.textSecondary }]}>
                Manage events that span multiple groups
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color={colors.textTertiary} />
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.quickLinkItem, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border }]}
            onPress={() => router.push("/(user)/admin/landing")}
          >
            <View style={[styles.quickLinkIcon, { backgroundColor: colors.surface }]}>
              <Ionicons name="globe-outline" size={20} color={themePrimaryColor} />
            </View>
            <View style={styles.quickLinkInfo}>
              <Text style={[styles.quickLinkName, { color: colors.text }]}>Landing Page</Text>
              <Text style={[styles.quickLinkDescription, { color: colors.textSecondary }]}>
                Customize your community landing page
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color={colors.textTertiary} />
          </TouchableOpacity>
        </View>

        {/* Basic Info Section */}
        <View style={[styles.section, { backgroundColor: colors.surface }]}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Basic Information</Text>

          <View style={styles.field}>
            <Text style={[styles.label, { color: colors.textSecondary }]}>Community Name</Text>
            <TextInput
              style={[styles.input, { backgroundColor: colors.inputBackground, color: colors.text, borderColor: colors.inputBorder }]}
              value={name}
              onChangeText={setName}
              placeholder="Enter community name"
              placeholderTextColor={colors.inputPlaceholder}
            />
          </View>

          <View style={styles.field}>
            <Text style={[styles.label, { color: colors.textSecondary }]}>Logo</Text>
            <ImagePicker
              currentImage={selectedImageUri || settings?.logo || undefined}
              onImageSelected={handleImageSelected}
              buttonText="Select Logo"
              isUploading={isUploadingImage}
              aspect={[1, 1]}
            />
          </View>

          <View style={styles.field}>
            <Text style={[styles.label, { color: colors.textSecondary }]}>Subdomain</Text>
            <TextInput
              style={[styles.input, { backgroundColor: colors.inputBackground, color: colors.text, borderColor: colors.inputBorder }]}
              value={subdomain}
              onChangeText={(text) => setSubdomain(text.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
              placeholder="your-community"
              placeholderTextColor={colors.inputPlaceholder}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <Text style={[styles.hint, { color: colors.textTertiary }]}>
              Lowercase letters, numbers, and hyphens only
            </Text>
          </View>
        </View>

        {/* Address Section */}
        <View style={[styles.section, { backgroundColor: colors.surface }]}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Address</Text>

          <View style={styles.field}>
            <Text style={[styles.label, { color: colors.textSecondary }]}>Address Line 1</Text>
            <TextInput
              style={[styles.input, { backgroundColor: colors.inputBackground, color: colors.text, borderColor: colors.inputBorder }]}
              value={addressLine1}
              onChangeText={setAddressLine1}
              placeholder="Street address"
              placeholderTextColor={colors.inputPlaceholder}
            />
          </View>

          <View style={styles.field}>
            <Text style={[styles.label, { color: colors.textSecondary }]}>Address Line 2</Text>
            <TextInput
              style={[styles.input, { backgroundColor: colors.inputBackground, color: colors.text, borderColor: colors.inputBorder }]}
              value={addressLine2}
              onChangeText={setAddressLine2}
              placeholder="Apt, suite, unit, etc."
              placeholderTextColor={colors.inputPlaceholder}
            />
          </View>

          <View style={styles.row}>
            <View style={[styles.field, styles.flex2]}>
              <Text style={[styles.label, { color: colors.textSecondary }]}>City</Text>
              <TextInput
                style={[styles.input, { backgroundColor: colors.inputBackground, color: colors.text, borderColor: colors.inputBorder }]}
                value={city}
                onChangeText={setCity}
                placeholder="City"
                placeholderTextColor={colors.inputPlaceholder}
              />
            </View>
            <View style={[styles.field, styles.flex1]}>
              <Text style={[styles.label, { color: colors.textSecondary }]}>State</Text>
              <TextInput
                style={[styles.input, { backgroundColor: colors.inputBackground, color: colors.text, borderColor: colors.inputBorder }]}
                value={state}
                onChangeText={setState}
                placeholder="State"
                placeholderTextColor={colors.inputPlaceholder}
              />
            </View>
          </View>

          <View style={styles.row}>
            <View style={[styles.field, styles.flex1]}>
              <Text style={[styles.label, { color: colors.textSecondary }]}>ZIP Code</Text>
              <TextInput
                style={[styles.input, { backgroundColor: colors.inputBackground, color: colors.text, borderColor: colors.inputBorder }]}
                value={zipCode}
                onChangeText={setZipCode}
                placeholder="ZIP"
                placeholderTextColor={colors.inputPlaceholder}
                keyboardType="numeric"
              />
            </View>
            <View style={[styles.field, styles.flex2]}>
              <Text style={[styles.label, { color: colors.textSecondary }]}>Country</Text>
              <TextInput
                style={[styles.input, { backgroundColor: colors.inputBackground, color: colors.text, borderColor: colors.inputBorder }]}
                value={country}
                onChangeText={setCountry}
                placeholder="Country"
                placeholderTextColor={colors.inputPlaceholder}
              />
            </View>
          </View>
        </View>

        {/* Branding Colors Section */}
        <View style={[styles.section, { backgroundColor: colors.surface }]}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Branding Colors</Text>
          <Text style={[styles.sectionDescription, { color: colors.textSecondary }]}>
            Customize your community's accent colors. These colors will be used for buttons, links, and other interactive elements.
          </Text>

          <ColorPicker
            label="Primary Color"
            value={primaryColor}
            onChange={setPrimaryColor}
            defaultColor={DEFAULT_PRIMARY_COLOR}
          />

          <ColorPicker
            label="Secondary Color"
            value={secondaryColor}
            onChange={setSecondaryColor}
            defaultColor={DEFAULT_SECONDARY_COLOR}
          />

          <ColorPreview
            primaryColor={primaryColor}
            secondaryColor={secondaryColor}
          />
        </View>

        {/* Explore Page Settings Section */}
        <View style={[styles.section, { backgroundColor: colors.surface }]}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Explore Page Settings</Text>
          <Text style={[styles.sectionDescription, { color: colors.textSecondary }]}>
            Configure default filters for the explore page. These filters will be applied for everyone in your community.
          </Text>

          {/* Group Type Filter */}
          <View style={styles.field}>
            <Text style={[styles.label, { color: colors.textSecondary }]}>Group Type</Text>
            {groupTypesLoading ? (
              <ActivityIndicator size="small" color={themePrimaryColor} />
            ) : (
              <View style={styles.exploreChipsGrid}>
                {exploreGroupTypes.length === 0 && (
                  <View
                    style={[
                      styles.exploreChip,
                      { backgroundColor: themePrimaryColor, borderColor: themePrimaryColor },
                    ]}
                  >
                    <Text style={styles.exploreChipTextSelected}>All Types</Text>
                  </View>
                )}
                {exploreGroupTypes.length > 0 && (
                  <TouchableOpacity
                    style={[styles.exploreChip, { borderColor: colors.border, backgroundColor: colors.surface }]}
                    onPress={() => setExploreGroupTypes([])}
                    activeOpacity={0.7}
                  >
                    <Text style={[styles.exploreChipText, { color: colors.text }]}>All Types</Text>
                  </TouchableOpacity>
                )}
                {groupTypes?.map((gt) => {
                  const isSelected = exploreGroupTypes.includes(gt.id);
                  const typeColor = getGroupTypeColor(gt.id);

                  return (
                    <TouchableOpacity
                      key={gt.id}
                      style={[
                        styles.exploreChip,
                        { borderColor: colors.border, backgroundColor: colors.surface },
                        isSelected && { backgroundColor: typeColor, borderColor: typeColor },
                      ]}
                      onPress={() => toggleExploreGroupType(gt.id)}
                      activeOpacity={0.7}
                    >
                      <Text
                        style={[
                          styles.exploreChipText,
                          { color: colors.text },
                          isSelected && styles.exploreChipTextSelected,
                        ]}
                      >
                        {gt.name}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}
          </View>

          {/* Meeting Type Filter */}
          <View style={styles.field}>
            <Text style={[styles.label, { color: colors.textSecondary }]}>Meeting Type</Text>
            <View style={styles.exploreChipsGrid}>
              {[
                { label: "All", value: null },
                { label: "In-Person", value: 1, icon: "people-outline" as const },
                { label: "Online", value: 2, icon: "videocam-outline" as const },
              ].map((option) => {
                const isSelected = exploreDefaultMeetingType === option.value;

                return (
                  <TouchableOpacity
                    key={option.label}
                    style={[
                      styles.exploreChip,
                      { borderColor: colors.border, backgroundColor: colors.surface },
                      isSelected && { backgroundColor: themePrimaryColor, borderColor: themePrimaryColor },
                    ]}
                    onPress={() => setExploreDefaultMeetingType(option.value)}
                    activeOpacity={0.7}
                  >
                    {option.icon && (
                      <Ionicons
                        name={option.icon}
                        size={16}
                        color={isSelected ? "#fff" : colors.textSecondary}
                        style={styles.exploreChipIcon}
                      />
                    )}
                    <Text
                      style={[
                        styles.exploreChipText,
                        { color: colors.text },
                        isSelected && styles.exploreChipTextSelected,
                      ]}
                    >
                      {option.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          {/* Save Explore Defaults Button */}
          <TouchableOpacity
            style={[
              styles.exploreSaveButton,
              { backgroundColor: themePrimaryColor },
              isSavingExplore && styles.saveButtonDisabled,
            ]}
            onPress={handleSaveExploreDefaults}
            disabled={isSavingExplore}
          >
            {isSavingExplore ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Text style={styles.exploreSaveButtonText}>Save Explore Defaults</Text>
            )}
          </TouchableOpacity>
        </View>

        {/* Group Types Section */}
        <View style={[styles.section, { backgroundColor: colors.surface }]}>
          <View style={styles.sectionHeader}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>Group Types</Text>
            <TouchableOpacity
              style={styles.addButton}
              onPress={() => setIsCreatingGroupType(true)}
            >
              <Ionicons name="add-circle" size={24} color={themePrimaryColor} />
              <Text style={[styles.addButtonText, { color: themePrimaryColor }]}>Add New</Text>
            </TouchableOpacity>
          </View>

          {groupTypesLoading ? (
            <ActivityIndicator size="small" color={themePrimaryColor} />
          ) : groupTypes && groupTypes.length > 0 ? (
            <View style={styles.groupTypesList}>
              {groupTypes.map((gt) => (
                <TouchableOpacity
                  key={gt.id}
                  style={[styles.groupTypeItem, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border }]}
                  onPress={() => setEditingGroupType(gt)}
                >
                  <View style={styles.groupTypeInfo}>
                    <Text style={[styles.groupTypeName, { color: colors.text }]}>{gt.name}</Text>
                    {gt.description && (
                      <Text style={[styles.groupTypeDescription, { color: colors.textSecondary }]} numberOfLines={1}>
                        {gt.description}
                      </Text>
                    )}
                    <Text style={[styles.groupTypeCount, { color: colors.textTertiary }]}>
                      {gt.groupCount} {gt.groupCount === 1 ? "group" : "groups"}
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={20} color={colors.textTertiary} />
                </TouchableOpacity>
              ))}
            </View>
          ) : (
            <Text style={[styles.emptyText, { color: colors.textTertiary }]}>No group types defined</Text>
          )}
        </View>

        {/* Integrations Section */}
        <View style={[styles.section, { backgroundColor: colors.surface }]}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Integrations</Text>
          <Text style={[styles.sectionDescription, { color: colors.textSecondary }]}>
            Connect third-party services to sync groups, events, and members.
          </Text>

          {integrationsLoading ? (
            <ActivityIndicator size="small" color={themePrimaryColor} />
          ) : integrations && integrations.length > 0 ? (
            <View style={styles.groupTypesList}>
              {integrations.map((integration) => (
                <TouchableOpacity
                  key={integration.type}
                  style={[styles.integrationItem, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border }]}
                  onPress={() => {
                    if (integration.type === "planning_center") {
                      router.push("/leader-tools/integrations/planning-center");
                    }
                  }}
                >
                  <View style={styles.groupTypeInfo}>
                    <Text style={[styles.groupTypeName, { color: colors.text }]}>{integration.display_name}</Text>
                    <Text style={[styles.groupTypeDescription, { color: colors.textSecondary }]} numberOfLines={2}>
                      {integration.description}
                    </Text>
                  </View>
                  {integration.is_connected ? (
                    <View style={[styles.connectedBadge, { backgroundColor: isDark ? 'rgba(52,199,89,0.15)' : '#E8F5E9' }]}>
                      <Ionicons name="checkmark-circle" size={18} color={colors.success} />
                      <Text style={[styles.connectedText, { color: colors.success }]}>Connected</Text>
                    </View>
                  ) : (
                    <Ionicons name="chevron-forward" size={20} color={colors.textTertiary} />
                  )}
                </TouchableOpacity>
              ))}
            </View>
          ) : (
            <Text style={[styles.emptyText, { color: colors.textTertiary }]}>No integrations available</Text>
          )}
        </View>

        {/* Billing Section */}
        <View style={[styles.section, { backgroundColor: colors.surface }]}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Billing</Text>
          {billing && billing.subscriptionStatus ? (
            <>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 }}>
                <Text style={[styles.sectionDescription, { color: colors.textSecondary, marginBottom: 0 }]}>
                  Status:
                </Text>
                <View style={{
                  backgroundColor: billing.subscriptionStatus === "active" ? (isDark ? "rgba(52,199,89,0.15)" : "#E8F5E9")
                    : billing.subscriptionStatus === "past_due" ? (isDark ? "rgba(255,149,0,0.15)" : "#FFF8E1")
                    : isDark ? "rgba(255,59,48,0.15)" : "#FFF0F0",
                  paddingHorizontal: 10, paddingVertical: 3, borderRadius: 12,
                }}>
                  <Text style={{
                    fontSize: 12, fontWeight: "600", textTransform: "capitalize",
                    color: billing.subscriptionStatus === "active" ? colors.success
                      : billing.subscriptionStatus === "past_due" ? colors.warning
                      : colors.error,
                  }}>
                    {billing.subscriptionStatus}
                  </Text>
                </View>
              </View>
              {billing.subscriptionPriceMonthly != null && (
                <Text style={[styles.sectionDescription, { color: colors.textSecondary }]}>
                  ${billing.subscriptionPriceMonthly}/month
                </Text>
              )}
            </>
          ) : (
            <Text style={[styles.sectionDescription, { color: colors.textSecondary }]}>
              No subscription set up yet.
            </Text>
          )}

          {Platform.OS === "web" ? (
            <TouchableOpacity
              style={[styles.integrationItem, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border }]}
              onPress={() => {
                if (community?.id) {
                  window.location.href = `${DOMAIN_CONFIG.landingUrl}/billing/${community.id}`;
                }
              }}
            >
              <View style={styles.groupTypeInfo}>
                <Text style={[styles.groupTypeName, { color: colors.text }]}>
                  {billing?.subscriptionStatus ? "Manage Subscription" : "Set Up Billing"}
                </Text>
                <Text style={[styles.groupTypeDescription, { color: colors.textSecondary }]}>
                  {billing?.subscriptionStatus
                    ? "Update payment method, view invoices, or manage your plan"
                    : "Add a subscription to keep your community active"}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color={colors.textTertiary} />
            </TouchableOpacity>
          ) : (
            <View style={[styles.integrationItem, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border }]}>
              <View style={styles.groupTypeInfo}>
                <Text style={[styles.groupTypeName, { color: colors.text }]}>
                  Manage on Web
                </Text>
                <Text style={[styles.groupTypeDescription, { color: colors.textSecondary }]}>
                  Billing is managed through the web app. Tap to open in your browser.
                </Text>
              </View>
              <TouchableOpacity
                onPress={() => {
                  if (community?.id) {
                    Linking.openURL(`${DOMAIN_CONFIG.landingUrl}/billing/${community.id}`);
                  }
                }}
              >
                <Ionicons name="open-outline" size={20} color={themePrimaryColor} />
              </TouchableOpacity>
            </View>
          )}
        </View>

        {/* Spacer for save button */}
        <View style={{ height: 80 }} />
      </ScrollView>

      {/* Save Button */}
      {isDirty && (
        <View style={[styles.saveButtonContainer, { backgroundColor: colors.surface, borderTopColor: colors.border }]}>
          <TouchableOpacity
            style={[styles.saveButton, { backgroundColor: themePrimaryColor }, isSaving && styles.saveButtonDisabled]}
            onPress={handleSave}
            disabled={isSaving}
          >
            {isSaving ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Text style={styles.saveButtonText}>Save Changes</Text>
            )}
          </TouchableOpacity>
        </View>
      )}

      {/* Group Type Edit Modal */}
      <GroupTypeEditModal
        visible={!!editingGroupType || isCreatingGroupType}
        groupType={editingGroupType}
        onClose={() => {
          setEditingGroupType(null);
          setIsCreatingGroupType(false);
        }}
        onSave={handleSaveGroupType}
        isSaving={isUpdatingGroupType || isCreating}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    gap: 12,
  },
  loadingText: {
    fontSize: 16,
  },
  errorContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    gap: 12,
    padding: 20,
  },
  errorTitle: {
    fontSize: 18,
    fontWeight: "600",
  },
  retryButton: {
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
  },
  retryButtonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
  section: {
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "600",
    marginBottom: 16,
  },
  field: {
    marginBottom: 16,
  },
  label: {
    fontSize: 14,
    fontWeight: "500",
    marginBottom: 8,
  },
  input: {
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    borderWidth: 1,
  },
  hint: {
    fontSize: 12,
    marginTop: 4,
  },
  row: {
    flexDirection: "row",
    gap: 12,
  },
  flex1: {
    flex: 1,
  },
  flex2: {
    flex: 2,
  },
  addButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  addButtonText: {
    fontSize: 14,
    fontWeight: "600",
  },
  groupTypesList: {
    gap: 8,
  },
  groupTypeItem: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 8,
    padding: 12,
    borderWidth: 1,
  },
  groupTypeInfo: {
    flex: 1,
  },
  groupTypeName: {
    fontSize: 16,
    fontWeight: "600",
  },
  groupTypeDescription: {
    fontSize: 14,
    marginTop: 2,
  },
  groupTypeCount: {
    fontSize: 12,
    marginTop: 4,
  },
  emptyText: {
    fontSize: 14,
    textAlign: "center",
    paddingVertical: 20,
  },
  sectionDescription: {
    fontSize: 14,
    marginBottom: 16,
    lineHeight: 20,
  },
  integrationItem: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 8,
    padding: 12,
    borderWidth: 1,
  },
  connectedBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  connectedText: {
    fontSize: 12,
    fontWeight: "600",
  },
  saveButtonContainer: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    padding: 16,
    borderTopWidth: 1,
  },
  saveButton: {
    borderRadius: 8,
    padding: 16,
    alignItems: "center",
  },
  saveButtonDisabled: {
    opacity: 0.6,
  },
  saveButtonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
  quickLinkItem: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 8,
    padding: 12,
    borderWidth: 1,
    marginBottom: 10,
  },
  quickLinkIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: "center",
    alignItems: "center",
    marginRight: 12,
  },
  quickLinkInfo: {
    flex: 1,
  },
  quickLinkName: {
    fontSize: 16,
    fontWeight: "600",
  },
  quickLinkDescription: {
    fontSize: 13,
    marginTop: 2,
  },
  exploreChipsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  exploreChip: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1.5,
  },
  exploreChipText: {
    fontSize: 14,
    fontWeight: "500",
  },
  exploreChipTextSelected: {
    color: "#fff",
  },
  exploreChipIcon: {
    marginRight: 6,
  },
  exploreSaveButton: {
    borderRadius: 8,
    padding: 14,
    alignItems: "center",
    marginTop: 8,
  },
  exploreSaveButtonText: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "600",
  },
});
