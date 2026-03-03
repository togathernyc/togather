/**
 * PcoAutoChannelConfig - Configuration component for PCO Auto Channels.
 *
 * Allows users to configure an auto channel synced with Planning Center Services.
 * Uses a filter-based approach for flexible member filtering.
 *
 * Features:
 * - Select multiple service types from PCO (filter-based)
 * - Choose team scope (all teams or specific teams)
 * - Filter by positions using PositionSelector
 * - Preview matching members before creation
 * - Configure membership timing (days before/after service)
 */
import React, { useState, useEffect, useCallback } from "react";
import {
  View,
  StyleSheet,
  ActivityIndicator,
  TouchableOpacity,
} from "react-native";
import { Text } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useAction } from "convex/react";
import { api } from "@services/api/convex";
import { Select } from "@components/ui/Select";
import { Input } from "@components/ui/Input";
import { useCommunityTheme } from "@hooks/useCommunityTheme";
import { useAuth } from "@providers/AuthProvider";
import { PositionSelector } from "./PositionSelector";
import type { Id } from "@services/api/convex";

interface PcoAutoChannelConfigProps {
  communityId: Id<"communities">;
  onChange: (config: AutoChannelConfig | null) => void;
  initialConfig?: AutoChannelConfig;
}

/**
 * Position filter with optional context for disambiguation.
 * When teamId or serviceTypeId is provided, the position will only match
 * members from that specific team/service.
 */
export interface PositionFilter {
  name: string;
  teamId?: string;
  teamName?: string;
  serviceTypeId?: string;
  serviceTypeName?: string;
}

// Position filter can be either a simple string or an object with context
export type PositionFilterInput = string | PositionFilter;

// Updated interface with filter-based config
export interface AutoChannelConfig {
  // NEW: Filter-based config (preferred)
  filters?: {
    serviceTypeIds?: string[];
    serviceTypeNames?: string[];
    teamIds?: string[];
    teamNames?: string[];
    positions?: PositionFilterInput[];
    statuses?: string[];
  };

  // LEGACY: Keep for backward compatibility
  serviceTypeId?: string;
  serviceTypeName?: string;
  syncScope?: "all_teams" | "single_team" | "multi_team";
  teamIds?: string[];
  teamNames?: string[];

  // Timing
  addMembersDaysBefore: number;
  removeMembersDaysAfter: number;
}

interface ServiceType {
  id: string;
  name: string;
}

interface Team {
  id: string;
  name: string;
  serviceTypeName?: string;
  displayName?: string;
}

interface Position {
  name: string;
  teamId?: string | null;
  teamName?: string | null;
  serviceTypeId?: string | null;
  serviceTypeName?: string | null;
  displayName?: string;
  count: number;
}

interface PreviewResult {
  totalCount: number;
  sample: Array<{
    name: string;
    position: string | null;
    team: string | null;
    service: string | null;
  }>;
  nextServiceDate: number | null;
}

export function PcoAutoChannelConfig({
  communityId,
  onChange,
  initialConfig,
}: PcoAutoChannelConfigProps) {
  const { primaryColor } = useCommunityTheme();
  const { token } = useAuth();

  // State for data loading
  const [serviceTypes, setServiceTypes] = useState<ServiceType[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [positions, setPositions] = useState<Position[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingTeams, setLoadingTeams] = useState(false);
  const [loadingPositions, setLoadingPositions] = useState(false);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Preview state
  const [preview, setPreview] = useState<PreviewResult | null>(null);

  // Config state - migrate from legacy config if needed
  const [selectedServiceTypes, setSelectedServiceTypes] = useState<ServiceType[]>(() => {
    if (initialConfig?.filters?.serviceTypeIds) {
      return initialConfig.filters.serviceTypeIds.map((id, i) => ({
        id,
        name: initialConfig.filters?.serviceTypeNames?.[i] || id,
      }));
    }
    if (initialConfig?.serviceTypeId) {
      return [{
        id: initialConfig.serviceTypeId,
        name: initialConfig.serviceTypeName || initialConfig.serviceTypeId,
      }];
    }
    return [];
  });

  const [syncScope, setSyncScope] = useState<"all_teams" | "single_team" | "multi_team">(() => {
    if (initialConfig?.filters?.teamIds?.length) {
      return initialConfig.filters.teamIds.length === 1 ? "single_team" : "multi_team";
    }
    return initialConfig?.syncScope || "all_teams";
  });

  // Teams need hydration similar to positions because the saved config
  // only has id and name, but loaded teams have serviceTypeName for disambiguation
  const [selectedTeams, setSelectedTeams] = useState<Team[]>([]);

  // Store selected positions as Position objects with full context
  // The displayName is used as the unique key for selection
  const [selectedPositions, setSelectedPositions] = useState<Position[]>(() => {
    // Convert initialConfig positions (which can be strings or objects) back to Position objects
    // This requires loading the positions list first, so we start with empty
    // and will hydrate from initialConfig once positions load
    return [];
  });

  // Track if we've hydrated from initialConfig
  const [hasHydratedTeams, setHasHydratedTeams] = useState(false);
  const [hasHydratedPositions, setHasHydratedPositions] = useState(false);

  const [addDaysBefore, setAddDaysBefore] = useState(
    initialConfig?.addMembersDaysBefore?.toString() || "5"
  );
  const [removeDaysAfter, setRemoveDaysAfter] = useState(
    initialConfig?.removeMembersDaysAfter?.toString() || "1"
  );

  // UI state
  const [showPositionFilter, setShowPositionFilter] = useState(
    (initialConfig?.filters?.positions?.length || 0) > 0
  );

  // Actions
  const getServiceTypesAction = useAction(
    api.functions.pcoServices.actions.getServiceTypes
  );
  const getTeamsForServiceTypeAction = useAction(
    api.functions.pcoServices.actions.getTeamsForServiceType
  );
  const getAvailablePositionsAction = useAction(
    api.functions.pcoServices.actions.getAvailablePositions
  );
  const previewFilterResultsAction = useAction(
    api.functions.pcoServices.actions.previewFilterResults
  );

  // Load service types on mount
  useEffect(() => {
    async function loadServiceTypes() {
      if (!token) return;
      try {
        setLoading(true);
        setError(null);
        const types = await getServiceTypesAction({ token, communityId });
        setServiceTypes(types);
      } catch (err) {
        // Check if this is an admin access error
        const errorMessage = err instanceof Error ? err.message : String(err);
        if (errorMessage.includes("Admin access required")) {
          setError("Only community admins can modify PCO channel configuration. You can still view and sync this channel.");
        } else {
          setError("Failed to load service types from Planning Center");
        }
        console.error(err);
      } finally {
        setLoading(false);
      }
    }
    loadServiceTypes();
  }, [communityId, token, getServiceTypesAction]);

  // Load teams when service types change (combine teams from all selected service types)
  useEffect(() => {
    async function loadTeams() {
      if (selectedServiceTypes.length === 0 || !token) {
        setTeams([]);
        return;
      }

      try {
        setLoadingTeams(true);
        // Load teams from all selected service types
        const allTeams: Team[] = [];
        const seenIds = new Set<string>();

        for (const st of selectedServiceTypes) {
          const loadedTeams = await getTeamsForServiceTypeAction({
            token,
            communityId,
            serviceTypeId: st.id,
            serviceTypeName: st.name,
          });
          for (const team of loadedTeams) {
            // Use composite key to allow same team from different service types
            const compositeKey = `${st.id}:${team.id}`;
            if (!seenIds.has(compositeKey)) {
              seenIds.add(compositeKey);
              allTeams.push(team);
            }
          }
        }
        setTeams(allTeams);
      } catch (err) {
        console.error("Failed to load teams:", err);
      } finally {
        setLoadingTeams(false);
      }
    }
    loadTeams();
  }, [selectedServiceTypes, communityId, token, getTeamsForServiceTypeAction]);

  // Hydrate selected teams from initialConfig once teams list is loaded
  useEffect(() => {
    if (hasHydratedTeams) {
      return;
    }

    // Check if there are teams to hydrate from config
    const configTeamIds = initialConfig?.filters?.teamIds || initialConfig?.teamIds;
    const configTeamNames = initialConfig?.filters?.teamNames || initialConfig?.teamNames;

    if (!configTeamIds?.length) {
      setHasHydratedTeams(true);
      return;
    }

    // Wait for teams to load before hydrating
    if (teams.length === 0) {
      return;
    }

    // Find matching teams from the loaded teams list
    const hydratedTeams: Team[] = [];
    for (let i = 0; i < configTeamIds.length; i++) {
      const teamId = configTeamIds[i];
      const teamName = configTeamNames?.[i];

      // Try to find the team in the loaded teams
      // Match by ID, and prefer matches where name also matches
      let found = teams.find((t) => t.id === teamId && t.name === teamName);

      // Fallback: match by ID only
      if (!found) {
        found = teams.find((t) => t.id === teamId);
      }

      if (found && !hydratedTeams.some((ht) => ht.id === found!.id && ht.serviceTypeName === found!.serviceTypeName)) {
        hydratedTeams.push(found);
      }
    }

    if (hydratedTeams.length > 0) {
      setSelectedTeams(hydratedTeams);
    }
    setHasHydratedTeams(true);
  }, [teams, initialConfig, hasHydratedTeams]);

  // Load positions when service types or teams change
  // Implements cascading filter: positions are filtered by selected teams
  useEffect(() => {
    async function loadPositions() {
      if (selectedServiceTypes.length === 0 || !token || !showPositionFilter) {
        setPositions([]);
        return;
      }

      try {
        setLoadingPositions(true);
        // Pass selected team IDs to filter positions (cascading filter)
        // If no teams are selected but service types are, show all positions from those services
        const teamIds = syncScope !== "all_teams" && selectedTeams.length > 0
          ? selectedTeams.map((t) => t.id)
          : undefined;

        const loadedPositions = await getAvailablePositionsAction({
          token,
          communityId,
          serviceTypeIds: selectedServiceTypes.map((st) => st.id),
          teamIds,
        });
        setPositions(loadedPositions);
      } catch (err) {
        console.error("Failed to load positions:", err);
      } finally {
        setLoadingPositions(false);
      }
    }
    loadPositions();
  }, [selectedServiceTypes, selectedTeams, syncScope, showPositionFilter, communityId, token, getAvailablePositionsAction]);

  // Hydrate selected positions from initialConfig once positions list is loaded
  useEffect(() => {
    if (hasHydratedPositions) {
      return;
    }

    // If no positions in config to hydrate, mark as hydrated immediately
    if (!initialConfig?.filters?.positions?.length) {
      setHasHydratedPositions(true);
      return;
    }

    // Wait for positions to load before hydrating
    if (positions.length === 0) {
      return;
    }

    // Convert initialConfig positions to Position objects by finding them in the loaded positions
    const hydratedPositions: Position[] = [];
    for (const configPosition of initialConfig.filters.positions) {
      let found: Position | undefined;

      if (typeof configPosition === "string") {
        // Legacy string format - try to find by name or displayName match
        found = positions.find(
          (p) => p.name === configPosition || p.displayName === configPosition
        );
      } else {
        // Object format with context - try multiple matching strategies

        // Strategy 1: Match by name + teamId + serviceTypeId (strictest)
        if (configPosition.teamId && configPosition.serviceTypeId) {
          found = positions.find(
            (p) =>
              p.name === configPosition.name &&
              p.teamId === configPosition.teamId &&
              p.serviceTypeId === configPosition.serviceTypeId
          );
        }

        // Strategy 2: Match by name + teamId only
        if (!found && configPosition.teamId) {
          found = positions.find(
            (p) => p.name === configPosition.name && p.teamId === configPosition.teamId
          );
        }

        // Strategy 3: Match by name + serviceTypeId only
        if (!found && configPosition.serviceTypeId) {
          found = positions.find(
            (p) => p.name === configPosition.name && p.serviceTypeId === configPosition.serviceTypeId
          );
        }

        // Strategy 4: Build expected displayName and match
        if (!found && (configPosition.serviceTypeName || configPosition.teamName)) {
          const expectedDisplayName = configPosition.serviceTypeName && configPosition.teamName
            ? `${configPosition.serviceTypeName} > ${configPosition.teamName} > ${configPosition.name}`
            : configPosition.teamName
              ? `${configPosition.teamName} > ${configPosition.name}`
              : configPosition.name;
          found = positions.find((p) => p.displayName === expectedDisplayName);
        }

        // Strategy 5: Match by name only (least strict, last resort)
        if (!found) {
          found = positions.find((p) => p.name === configPosition.name);
        }
      }

      if (found) {
        // Avoid duplicates
        if (!hydratedPositions.some((hp) => (hp.displayName || hp.name) === (found!.displayName || found!.name))) {
          hydratedPositions.push(found);
        }
      }
    }

    if (hydratedPositions.length > 0) {
      setSelectedPositions(hydratedPositions);
    }
    setHasHydratedPositions(true);
  }, [positions, initialConfig, hasHydratedPositions]);

  // Load preview when filters change
  const loadPreview = useCallback(async () => {
    if (selectedServiceTypes.length === 0 || !token) {
      setPreview(null);
      return;
    }

    // Convert selected Position objects to PositionFilter objects with full context
    const positionFilters: PositionFilterInput[] | undefined = selectedPositions.length > 0
      ? selectedPositions.map((position) => ({
          name: position.name,
          teamId: position.teamId ?? undefined,
          teamName: position.teamName ?? undefined,
          serviceTypeId: position.serviceTypeId ?? undefined,
          serviceTypeName: position.serviceTypeName ?? undefined,
        }))
      : undefined;

    try {
      setLoadingPreview(true);
      const result = await previewFilterResultsAction({
        token,
        communityId,
        filters: {
          serviceTypeIds: selectedServiceTypes.map((st) => st.id),
          teamIds: syncScope !== "all_teams" ? selectedTeams.map((t) => t.id) : undefined,
          positions: positionFilters,
        },
        addMembersDaysBefore: Number.isNaN(parseInt(addDaysBefore)) ? 5 : parseInt(addDaysBefore),
      });
      setPreview(result);
    } catch (err) {
      console.error("Failed to load preview:", err);
      setPreview(null);
    } finally {
      setLoadingPreview(false);
    }
  }, [
    selectedServiceTypes,
    syncScope,
    selectedTeams,
    selectedPositions,
    addDaysBefore,
    communityId,
    token,
    previewFilterResultsAction,
  ]);

  // Debounce preview loading
  useEffect(() => {
    const timeout = setTimeout(loadPreview, 500);
    return () => clearTimeout(timeout);
  }, [loadPreview]);

  // Update parent when config changes
  // Wait until team and position hydration is complete (or confirmed unnecessary) before updating parent
  // This prevents the initial empty selections from overwriting the saved config
  useEffect(() => {
    // Don't update parent until team hydration is complete
    const hasTeamsToHydrate = syncScope !== "all_teams" && (initialConfig?.filters?.teamIds?.length || initialConfig?.teamIds?.length);
    if (hasTeamsToHydrate && !hasHydratedTeams) {
      return;
    }

    // Don't update parent until position hydration is complete
    const hasPositionsToHydrate = showPositionFilter && initialConfig?.filters?.positions?.length;
    if (hasPositionsToHydrate && !hasHydratedPositions) {
      return;
    }

    if (selectedServiceTypes.length === 0) {
      onChange(null);
      return;
    }

    // Convert selected Position objects to PositionFilter objects with full context
    // This enables the backend to filter by team/service context, solving the
    // "same position name in different teams" problem (e.g., "Worship Leader" in Manhattan vs Brooklyn)
    const positionFilters: PositionFilterInput[] | undefined = selectedPositions.length > 0
      ? selectedPositions.map((position) => ({
          name: position.name,
          teamId: position.teamId ?? undefined,
          teamName: position.teamName ?? undefined,
          serviceTypeId: position.serviceTypeId ?? undefined,
          serviceTypeName: position.serviceTypeName ?? undefined,
        }))
      : undefined;

    const config: AutoChannelConfig = {
      // New filter-based config
      filters: {
        serviceTypeIds: selectedServiceTypes.map((st) => st.id),
        serviceTypeNames: selectedServiceTypes.map((st) => st.name),
        teamIds: syncScope !== "all_teams" ? selectedTeams.map((t) => t.id) : undefined,
        teamNames: syncScope !== "all_teams" ? selectedTeams.map((t) => t.name) : undefined,
        positions: positionFilters,
      },
      // Legacy fields for backward compatibility
      serviceTypeId: selectedServiceTypes[0]?.id,
      serviceTypeName: selectedServiceTypes[0]?.name,
      syncScope,
      teamIds: syncScope !== "all_teams" ? selectedTeams.map((t) => t.id) : undefined,
      teamNames: syncScope !== "all_teams" ? selectedTeams.map((t) => t.name) : undefined,
      // Timing - use explicit NaN check to allow 0 values
      addMembersDaysBefore: Number.isNaN(parseInt(addDaysBefore)) ? 5 : parseInt(addDaysBefore),
      removeMembersDaysAfter: Number.isNaN(parseInt(removeDaysAfter)) ? 1 : parseInt(removeDaysAfter),
    };

    onChange(config);
  }, [
    selectedServiceTypes,
    syncScope,
    selectedTeams,
    selectedPositions,
    addDaysBefore,
    removeDaysAfter,
    onChange,
    showPositionFilter,
    initialConfig?.filters?.teamIds?.length,
    initialConfig?.teamIds?.length,
    initialConfig?.filters?.positions?.length,
    hasHydratedTeams,
    hasHydratedPositions,
  ]);

  // Toggle service type selection
  const toggleServiceType = (st: ServiceType) => {
    const isSelected = selectedServiceTypes.some((s) => s.id === st.id);
    if (isSelected) {
      setSelectedServiceTypes(selectedServiceTypes.filter((s) => s.id !== st.id));
    } else {
      setSelectedServiceTypes([...selectedServiceTypes, st]);
    }
    // Reset teams when service types change
    setSelectedTeams([]);
  };

  // Toggle team selection
  // Uses composite comparison since same team can exist in different service types
  const toggleTeam = (team: Team) => {
    const isSelected = selectedTeams.some(
      (t) => t.id === team.id && t.serviceTypeName === team.serviceTypeName
    );
    if (isSelected) {
      setSelectedTeams(
        selectedTeams.filter(
          (t) => !(t.id === team.id && t.serviceTypeName === team.serviceTypeName)
        )
      );
    } else {
      if (syncScope === "single_team") {
        setSelectedTeams([team]);
      } else {
        setSelectedTeams([...selectedTeams, team]);
      }
    }
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="small" color={primaryColor} />
        <Text style={styles.loadingText}>Loading Planning Center...</Text>
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.errorContainer}>
        <Text style={styles.errorText}>{error}</Text>
      </View>
    );
  }

  const scopeOptions = [
    { value: "all_teams", label: "All Teams" },
    { value: "single_team", label: "Single Team" },
    { value: "multi_team", label: "Multiple Teams" },
  ];

  return (
    <View style={styles.container}>
      <Text style={styles.sectionTitle}>Planning Center Sync Settings</Text>

      {/* Service Type Selection - Multi-select */}
      <View style={styles.field}>
        <Text style={styles.label}>
          Service Types <Text style={styles.required}>*</Text>
        </Text>
        <Text style={styles.hint}>
          Select which services to sync members from
        </Text>
        <View style={styles.checkboxList}>
          {serviceTypes.map((st) => {
            const isSelected = selectedServiceTypes.some((s) => s.id === st.id);
            return (
              <TouchableOpacity
                key={st.id}
                style={styles.checkboxItem}
                onPress={() => toggleServiceType(st)}
                activeOpacity={0.7}
              >
                <Ionicons
                  name={isSelected ? "checkmark-circle" : "ellipse-outline"}
                  size={24}
                  color={isSelected ? primaryColor : "#ccc"}
                />
                <Text style={styles.checkboxLabel}>{st.name}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
        {selectedServiceTypes.length > 0 && (
          <View style={styles.selectedChips}>
            <Text style={styles.selectedChipsLabel}>
              Selected ({selectedServiceTypes.length}):
            </Text>
            <View style={styles.chipContainer}>
              {selectedServiceTypes.map((st) => (
                <TouchableOpacity
                  key={st.id}
                  style={[styles.chip, { backgroundColor: primaryColor + "20" }]}
                  onPress={() => toggleServiceType(st)}
                >
                  <Text style={[styles.chipText, { color: primaryColor }]}>
                    {st.name}
                  </Text>
                  <Ionicons name="close" size={14} color={primaryColor} />
                </TouchableOpacity>
              ))}
            </View>
          </View>
        )}
      </View>

      {selectedServiceTypes.length > 0 && (
        <>
          {/* Team Scope */}
          <Select
            label="Team Scope"
            value={syncScope}
            options={scopeOptions}
            onSelect={(value) => {
              setSyncScope(value as typeof syncScope);
              if (value === "all_teams") {
                setSelectedTeams([]);
              }
            }}
          />

          {/* Team Selection */}
          {(syncScope === "single_team" || syncScope === "multi_team") && (
            <View style={styles.field}>
              <Text style={styles.label}>
                {syncScope === "single_team" ? "Select Team" : "Select Teams"}
              </Text>
              {loadingTeams ? (
                <View style={styles.loadingInline}>
                  <ActivityIndicator size="small" color={primaryColor} />
                  <Text style={styles.loadingInlineText}>Loading teams...</Text>
                </View>
              ) : (
                <View style={styles.checkboxList}>
                  {teams.map((team) => {
                    // Use composite key since same team can appear in different service types
                    const teamKey = `${team.serviceTypeName || ""}:${team.id}`;
                    const isSelected = selectedTeams.some(
                      (t) => t.id === team.id && t.serviceTypeName === team.serviceTypeName
                    );
                    return (
                      <TouchableOpacity
                        key={teamKey}
                        style={styles.checkboxItem}
                        onPress={() => toggleTeam(team)}
                        activeOpacity={0.7}
                      >
                        <Ionicons
                          name={isSelected ? "checkmark-circle" : "ellipse-outline"}
                          size={24}
                          color={isSelected ? primaryColor : "#ccc"}
                        />
                        <Text style={styles.checkboxLabel}>
                          {team.displayName || team.name}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              )}
              {selectedTeams.length > 0 && (
                <View style={styles.selectedChips}>
                  <Text style={styles.selectedChipsLabel}>
                    Selected ({selectedTeams.length}):
                  </Text>
                  <View style={styles.chipContainer}>
                    {selectedTeams.map((team) => {
                      const teamKey = `${team.serviceTypeName || ""}:${team.id}`;
                      return (
                        <TouchableOpacity
                          key={teamKey}
                          style={[styles.chip, { backgroundColor: primaryColor + "20" }]}
                          onPress={() => toggleTeam(team)}
                        >
                          <Text style={[styles.chipText, { color: primaryColor }]}>
                            {team.displayName || team.name}
                          </Text>
                          <Ionicons name="close" size={14} color={primaryColor} />
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </View>
              )}
            </View>
          )}

          {/* Position Filter Toggle */}
          <View style={styles.field}>
            <TouchableOpacity
              style={styles.filterToggle}
              onPress={() => {
                setShowPositionFilter(!showPositionFilter);
                if (showPositionFilter) {
                  setSelectedPositions([]);
                }
              }}
              activeOpacity={0.7}
            >
              <Ionicons
                name={showPositionFilter ? "checkbox" : "square-outline"}
                size={22}
                color={showPositionFilter ? primaryColor : "#666"}
              />
              <Text style={styles.filterToggleText}>Filter by positions</Text>
              <Text style={styles.filterToggleHint}>(optional)</Text>
            </TouchableOpacity>
          </View>

          {/* Position Selector */}
          {showPositionFilter && (
            <View style={styles.positionSection}>
              <Text style={styles.label}>Positions</Text>
              <Text style={styles.hint}>
                Only include people with specific positions (e.g., Director, Lead Vocals)
              </Text>
              <PositionSelector
                positions={positions}
                selected={selectedPositions}
                onChange={setSelectedPositions}
                loading={loadingPositions}
              />
            </View>
          )}

          {/* Timing */}
          <View style={styles.timingSection}>
            <Text style={styles.label}>Membership Timing</Text>
            <Text style={styles.hint}>
              Control when members are added and removed from the channel
            </Text>

            <View style={styles.timingFields}>
              <View style={styles.timingField}>
                <Text style={styles.smallLabel}>Add members</Text>
                <View style={styles.inputRow}>
                  <View style={styles.numberInputContainer}>
                    <Input
                      value={addDaysBefore}
                      onChangeText={setAddDaysBefore}
                      style={styles.numberInput}
                    />
                  </View>
                  <Text style={styles.inputSuffix}>days before service</Text>
                </View>
              </View>

              <View style={styles.timingField}>
                <Text style={styles.smallLabel}>Remove members</Text>
                <View style={styles.inputRow}>
                  <View style={styles.numberInputContainer}>
                    <Input
                      value={removeDaysAfter}
                      onChangeText={setRemoveDaysAfter}
                      style={styles.numberInput}
                    />
                  </View>
                  <Text style={styles.inputSuffix}>days after service</Text>
                </View>
              </View>
            </View>

            <View style={styles.timingPreview}>
              <Text style={styles.previewText}>
                Example: For a Sunday service, members will be added on{" "}
                {getDayName(7 - (parseInt(addDaysBefore) || 5))} and removed on{" "}
                {getDayName(parseInt(removeDaysAfter) || 1)}.
              </Text>
            </View>
          </View>

          {/* Preview Results */}
          <View style={styles.previewSection}>
            <Text style={styles.label}>Preview</Text>
            {loadingPreview ? (
              <View style={styles.loadingInline}>
                <ActivityIndicator size="small" color={primaryColor} />
                <Text style={styles.loadingInlineText}>Loading preview...</Text>
              </View>
            ) : preview ? (
              <View style={[styles.previewCard, { borderColor: primaryColor + "40" }]}>
                <View style={styles.previewHeader}>
                  <Ionicons name="people" size={20} color={primaryColor} />
                  <Text style={[styles.previewCount, { color: primaryColor }]}>
                    {preview.totalCount} {preview.totalCount === 1 ? "person" : "people"} match
                  </Text>
                </View>
                {preview.nextServiceDate && (
                  <Text style={styles.previewNextService}>
                    Next service: {new Date(preview.nextServiceDate).toLocaleDateString()}
                  </Text>
                )}
                {preview.sample.length > 0 && (
                  <View style={styles.previewSample}>
                    <Text style={styles.previewSampleLabel}>Sample members:</Text>
                    {preview.sample.map((person, i) => (
                      <Text key={i} style={styles.previewSampleItem}>
                        {person.name}
                        {person.position && ` - ${person.position}`}
                        {person.team && ` (${person.team})`}
                      </Text>
                    ))}
                    {preview.totalCount > 5 && (
                      <Text style={styles.previewMore}>
                        ...and {preview.totalCount - 5} more
                      </Text>
                    )}
                  </View>
                )}
                {preview.totalCount === 0 && (
                  <Text style={styles.previewEmpty}>
                    No one matches the current filters. Try adjusting your selection.
                  </Text>
                )}
              </View>
            ) : (
              <Text style={styles.previewPlaceholder}>
                Select service types to see a preview
              </Text>
            )}
          </View>
        </>
      )}
    </View>
  );
}

function getDayName(daysFromSunday: number): string {
  const days = [
    "Sunday",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
  ];
  const index = ((daysFromSunday % 7) + 7) % 7;
  return days[index];
}

const styles = StyleSheet.create({
  container: {
    paddingVertical: 16,
  },
  loadingContainer: {
    flexDirection: "row",
    alignItems: "center",
    padding: 16,
  },
  loadingText: {
    marginLeft: 8,
    fontSize: 14,
    color: "#666",
  },
  loadingInline: {
    flexDirection: "row",
    alignItems: "center",
    padding: 8,
  },
  loadingInlineText: {
    marginLeft: 8,
    fontSize: 13,
    color: "#666",
  },
  errorContainer: {
    padding: 16,
  },
  errorText: {
    fontSize: 14,
    color: "#FF3B30",
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: "#333",
    marginBottom: 16,
  },
  field: {
    marginBottom: 16,
  },
  label: {
    fontSize: 14,
    fontWeight: "500",
    color: "#333",
    marginBottom: 8,
  },
  required: {
    color: "#FF3B30",
  },
  smallLabel: {
    fontSize: 13,
    color: "#666",
    marginBottom: 4,
  },
  hint: {
    fontSize: 13,
    color: "#999",
    marginBottom: 12,
  },
  checkboxList: {
    gap: 8,
  },
  checkboxItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 8,
    paddingHorizontal: 4,
    gap: 12,
  },
  checkboxLabel: {
    fontSize: 15,
    color: "#333",
  },
  selectedChips: {
    marginTop: 12,
    padding: 12,
    backgroundColor: "#f5f5f5",
    borderRadius: 8,
  },
  selectedChipsLabel: {
    fontSize: 12,
    color: "#666",
    marginBottom: 8,
  },
  chipContainer: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 16,
    gap: 4,
  },
  chipText: {
    fontSize: 13,
    fontWeight: "500",
  },
  filterToggle: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 8,
  },
  filterToggleText: {
    fontSize: 14,
    fontWeight: "500",
    color: "#333",
  },
  filterToggleHint: {
    fontSize: 13,
    color: "#999",
  },
  positionSection: {
    marginBottom: 16,
    paddingLeft: 8,
    borderLeftWidth: 2,
    borderLeftColor: "#e0e0e0",
  },
  timingSection: {
    marginTop: 8,
  },
  timingFields: {
    gap: 12,
  },
  timingField: {
    marginBottom: 8,
  },
  inputRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  numberInputContainer: {
    width: 70,
  },
  numberInput: {
    marginBottom: 0,
  },
  inputSuffix: {
    fontSize: 14,
    color: "#666",
    marginLeft: 8,
  },
  timingPreview: {
    padding: 12,
    backgroundColor: "#f9f9f9",
    borderRadius: 8,
    marginTop: 12,
  },
  previewText: {
    fontSize: 13,
    fontStyle: "italic",
    color: "#666",
  },
  previewSection: {
    marginTop: 20,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: "#e0e0e0",
  },
  previewCard: {
    padding: 16,
    backgroundColor: "#fafafa",
    borderRadius: 12,
    borderWidth: 1,
  },
  previewHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 8,
  },
  previewCount: {
    fontSize: 16,
    fontWeight: "600",
  },
  previewNextService: {
    fontSize: 13,
    color: "#666",
    marginBottom: 12,
  },
  previewSample: {
    marginTop: 8,
  },
  previewSampleLabel: {
    fontSize: 12,
    color: "#666",
    marginBottom: 4,
  },
  previewSampleItem: {
    fontSize: 13,
    color: "#333",
    paddingVertical: 2,
  },
  previewMore: {
    fontSize: 12,
    color: "#999",
    fontStyle: "italic",
    marginTop: 4,
  },
  previewEmpty: {
    fontSize: 13,
    color: "#999",
    fontStyle: "italic",
  },
  previewPlaceholder: {
    fontSize: 13,
    color: "#999",
    fontStyle: "italic",
  },
});
