import React, { useCallback, useEffect, useState, useMemo } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ActivityIndicator,
  ScrollView,
  TextInput,
  Modal,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useCommunityTheme } from "@hooks/useCommunityTheme";
import { DEFAULT_PRIMARY_COLOR } from "@utils/styles";
import {
  SUBTITLE_VARIABLES,
  normalizeSubtitleVariableIds,
} from "./followupShared";
import {
  useAuthenticatedQuery,
  useAuthenticatedMutation,
  api,
} from "@services/api/convex";
import type { Id } from "@services/api/convex";
import { useQuery } from "@services/api/convex";
import { DragHandle } from "@components/ui/DragHandle";

interface Props {
  groupId: Id<"groups">;
}

interface VariableInfo {
  id: string;
  label: string;
  description: string;
  category: string;
}

interface ScoreVariable {
  variableId: string;
  weight: number;
}

interface ScoreDefinition {
  id: string;
  name: string;
  variables: ScoreVariable[];
}

interface AlertDefinition {
  id: string;
  variableId: string;
  operator: string;
  threshold: number;
  label?: string;
}

// Default config matches backend DEFAULT_SCORE_CONFIG
const DEFAULT_SCORES: ScoreDefinition[] = [
  {
    id: "default_attendance",
    name: "Attendance",
    variables: [{ variableId: "attendance_pct", weight: 1 }],
  },
  {
    id: "default_connection",
    name: "Connection",
    variables: [
      { variableId: "attendance_streak", weight: 1 },
      { variableId: "followup_recency", weight: 1 },
    ],
  },
];

export function FollowupScoreSettings({ groupId }: Props) {
  const { primaryColor } = useCommunityTheme();
  const themeColor = primaryColor || DEFAULT_PRIMARY_COLOR;
  const [scores, setScores] = useState<ScoreDefinition[]>(DEFAULT_SCORES);
  const [alerts, setAlerts] = useState<AlertDefinition[]>([]);
  const [hasChanges, setHasChanges] = useState(false);
  const [saving, setSaving] = useState(false);
  const [addVariableTarget, setAddVariableTarget] = useState<number | null>(null);
  const [alertVariablePickerIndex, setAlertVariablePickerIndex] = useState<number | null>(null);

  // Fetch group data
  const groupData = useAuthenticatedQuery(
    api.functions.groups.queries.getById,
    { groupId }
  ) as any;

  // Fetch available variables
  const availableVariables = useQuery(
    api.functions.followupScoring.getAvailableVariables
  ) as VariableInfo[] | undefined;

  // Tool display name state
  const [toolDisplayName, setToolDisplayName] = useState("");
  // Member subtitle state (array of variable IDs, max 2)
  const [subtitleVars, setSubtitleVars] = useState<string[]>([]);

  // Mutations
  const updateConfig = useAuthenticatedMutation(
    api.functions.groups.mutations.updateFollowupScoreConfig
  );
  const updateDisplayName = useAuthenticatedMutation(
    api.functions.groups.mutations.updateToolDisplayName
  );

  // Load existing config when group data arrives
  useEffect(() => {
    if (groupData?.followupScoreConfig?.scores) {
      setScores(groupData.followupScoreConfig.scores);
    }
    const savedSubtitle = groupData?.followupScoreConfig?.memberSubtitle ?? "";
    setSubtitleVars(normalizeSubtitleVariableIds(savedSubtitle));
    setAlerts(groupData?.followupScoreConfig?.alerts ?? []);
  }, [groupData?.followupScoreConfig]);

  // Load existing display name
  useEffect(() => {
    const names = (groupData as any)?.toolDisplayNames as Record<string, string> | undefined;
    setToolDisplayName(names?.followup ?? "");
  }, [(groupData as any)?.toolDisplayNames]);

  // Variable lookup map
  const variableMap = useMemo(() => {
    if (!availableVariables) return new Map<string, VariableInfo>();
    return new Map(availableVariables.map((v) => [v.id, v]));
  }, [availableVariables]);

  // Group variables by category for the picker
  const variablesByCategory = useMemo(() => {
    if (!availableVariables) return new Map<string, VariableInfo[]>();
    const map = new Map<string, VariableInfo[]>();
    for (const v of availableVariables) {
      const list = map.get(v.category) || [];
      list.push(v);
      map.set(v.category, list);
    }
    return map;
  }, [availableVariables]);

  const handleNameChange = useCallback((scoreIndex: number, name: string) => {
    // Enforce max 12 chars
    const trimmed = name.slice(0, 12);
    setScores((prev) => {
      const updated = [...prev];
      updated[scoreIndex] = { ...updated[scoreIndex], name: trimmed };
      return updated;
    });
    setHasChanges(true);
  }, []);

  const handleWeightChange = useCallback(
    (scoreIndex: number, varIndex: number, delta: number) => {
      setScores((prev) => {
        const updated = [...prev];
        const score = { ...updated[scoreIndex] };
        const variables = [...score.variables];
        const newWeight = Math.max(1, Math.min(5, variables[varIndex].weight + delta));
        variables[varIndex] = { ...variables[varIndex], weight: newWeight };
        score.variables = variables;
        updated[scoreIndex] = score;
        return updated;
      });
      setHasChanges(true);
    },
    []
  );

  const handleRemoveVariable = useCallback(
    (scoreIndex: number, varIndex: number) => {
      setScores((prev) => {
        const updated = [...prev];
        const score = { ...updated[scoreIndex] };
        score.variables = score.variables.filter((_, i) => i !== varIndex);
        updated[scoreIndex] = score;
        return updated;
      });
      setHasChanges(true);
    },
    []
  );

  const handleAddVariable = useCallback(
    (scoreIndex: number, variableId: string) => {
      setScores((prev) => {
        const updated = [...prev];
        const score = { ...updated[scoreIndex] };
        // Don't add duplicate
        if (score.variables.some((v) => v.variableId === variableId)) return prev;
        score.variables = [...score.variables, { variableId, weight: 1 }];
        updated[scoreIndex] = score;
        return updated;
      });
      setHasChanges(true);
      setAddVariableTarget(null);
    },
    []
  );

  const handleAddScore = useCallback(() => {
    setScores((prev) => {
      if (prev.length >= 4) return prev;
      const newId = `custom_score_${Date.now()}`;
      return [
        ...prev,
        { id: newId, name: `Score ${prev.length + 1}`, variables: [{ variableId: "attendance_pct", weight: 1 }] },
      ];
    });
    setHasChanges(true);
  }, []);

  const handleRemoveScore = useCallback((scoreIndex: number) => {
    setScores((prev) => {
      if (prev.length <= 1) return prev;
      return prev.filter((_, i) => i !== scoreIndex);
    });
    setHasChanges(true);
  }, []);

  // Alert handlers
  const handleAddAlert = useCallback(() => {
    const firstVar = availableVariables?.[0]?.id ?? "attendance_pct";
    setAlerts((prev) => [
      ...prev,
      { id: `alert_${Date.now()}`, variableId: firstVar, operator: "above", threshold: 0 },
    ]);
    setHasChanges(true);
  }, [availableVariables]);

  const handleRemoveAlert = useCallback((index: number) => {
    setAlerts((prev) => prev.filter((_, i) => i !== index));
    setHasChanges(true);
  }, []);

  const handleAlertVariableChange = useCallback((index: number, variableId: string) => {
    setAlerts((prev) => {
      const updated = [...prev];
      updated[index] = { ...updated[index], variableId };
      return updated;
    });
    setHasChanges(true);
    setAlertVariablePickerIndex(null);
  }, []);

  const handleAlertOperatorToggle = useCallback((index: number) => {
    setAlerts((prev) => {
      const updated = [...prev];
      updated[index] = {
        ...updated[index],
        operator: updated[index].operator === "above" ? "below" : "above",
      };
      return updated;
    });
    setHasChanges(true);
  }, []);

  const handleAlertThresholdChange = useCallback((index: number, text: string) => {
    const num = parseFloat(text);
    setAlerts((prev) => {
      const updated = [...prev];
      updated[index] = { ...updated[index], threshold: isNaN(num) ? 0 : num };
      return updated;
    });
    setHasChanges(true);
  }, []);

  const handleAlertLabelChange = useCallback((index: number, label: string) => {
    setAlerts((prev) => {
      const updated = [...prev];
      updated[index] = { ...updated[index], label: label || undefined };
      return updated;
    });
    setHasChanges(true);
  }, []);

  const handleResetToDefaults = useCallback(() => {
    setScores(DEFAULT_SCORES);
    setAlerts([]);
    setSubtitleVars([]);
    setHasChanges(true);
  }, []);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      // Check if current config matches defaults — if so, clear custom config
      const isDefault =
        JSON.stringify(scores) === JSON.stringify(DEFAULT_SCORES) && subtitleVars.length === 0 && alerts.length === 0;

      await Promise.all([
        updateConfig({
          groupId,
          followupScoreConfig: isDefault
            ? undefined
            : {
                scores,
                memberSubtitle: subtitleVars.length > 0 ? subtitleVars.join(",") : undefined,
                alerts: alerts.length > 0 ? alerts : undefined,
              },
        }),
        updateDisplayName({
          groupId,
          toolId: "followup",
          displayName: toolDisplayName.trim() || undefined,
        }),
      ]);
      setHasChanges(false);
    } catch (error) {
      console.error("Failed to save follow-up score config:", error);
    } finally {
      setSaving(false);
    }
  }, [groupId, scores, alerts, toolDisplayName, subtitleVars, updateConfig, updateDisplayName]);

  if (!groupData || !availableVariables) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={themeColor} />
      </View>
    );
  }

  // Variables already used in a given score (to gray them out in picker)
  const getUsedVariableIds = (scoreIndex: number) =>
    new Set(scores[scoreIndex]?.variables.map((v) => v.variableId) ?? []);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <DragHandle />
      {/* Display Name */}
      <View style={styles.section}>
        <Text style={styles.nameLabel}>Tool Display Name</Text>
        <TextInput
          style={styles.displayNameInput}
          value={toolDisplayName}
          onChangeText={(text) => {
            setToolDisplayName(text);
            setHasChanges(true);
          }}
          placeholder="People"
          maxLength={20}
        />
        <Text style={styles.displayNameHint}>
          Customize what this tool is called in the toolbar. Leave empty for default.
        </Text>
      </View>

      {/* Member Subtitle */}
      <View style={styles.section}>
        <Text style={styles.nameLabel}>Member Card Subtitle</Text>
        <Text style={styles.displayNameHint}>
          Choose up to 2 items to show below each member's name. Each appears on its own line.
        </Text>
        <View style={styles.subtitleOptions}>
          {SUBTITLE_VARIABLES.map((v) => {
            const selected = subtitleVars.includes(v.id);
            const disabled = !selected && subtitleVars.length >= 2;
            return (
              <Pressable
                key={v.id}
                style={[
                  styles.subtitleOption,
                  selected && styles.subtitleOptionSelected,
                  selected && { borderColor: themeColor },
                  disabled && { opacity: 0.4 },
                ]}
                disabled={disabled}
                onPress={() => {
                  if (disabled) return;
                  if (selected) {
                    setSubtitleVars((prev) => prev.filter((id) => id !== v.id));
                  } else {
                    setSubtitleVars((prev) => [...prev, v.id]);
                  }
                  setHasChanges(true);
                }}
              >
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <View style={[
                    styles.subtitleCheckbox,
                    selected && { backgroundColor: themeColor, borderColor: themeColor },
                  ]}>
                    {selected && <Ionicons name="checkmark" size={14} color="#fff" />}
                  </View>
                  <Text style={[
                    styles.subtitleOptionText,
                    selected && { color: themeColor, fontWeight: "600" },
                  ]}>
                    {v.label}
                  </Text>
                </View>
              </Pressable>
            );
          })}
        </View>
        {subtitleVars.length >= 2 && (
          <Text style={[styles.displayNameHint, { marginTop: 4 }]}>
            Maximum of 2 selected
          </Text>
        )}
      </View>

      {/* Alerts */}
      <View style={styles.section}>
        <Text style={styles.nameLabel}>Alerts</Text>
        <Text style={styles.displayNameHint}>
          Flag members when a variable exceeds a threshold.
        </Text>

        {alerts.map((alert, index) => {
          const varInfo = variableMap.get(alert.variableId);
          return (
            <View key={alert.id} style={styles.alertRow}>
              {/* Variable picker */}
              <Pressable
                style={styles.alertVariablePicker}
                onPress={() => setAlertVariablePickerIndex(index)}
              >
                <Text style={styles.alertVariableText} numberOfLines={1}>
                  {varInfo?.label ?? alert.variableId}
                </Text>
                <Ionicons name="chevron-down" size={14} color="#666" />
              </Pressable>

              {/* Direction toggle */}
              <View style={styles.alertDirectionToggle}>
                <Pressable
                  style={[
                    styles.alertDirectionButton,
                    alert.operator === "above" && { backgroundColor: themeColor },
                  ]}
                  onPress={() => alert.operator !== "above" && handleAlertOperatorToggle(index)}
                >
                  <Text style={[styles.alertDirectionText, alert.operator === "above" && styles.alertDirectionTextActive]}>
                    Above
                  </Text>
                </Pressable>
                <Pressable
                  style={[
                    styles.alertDirectionButton,
                    alert.operator === "below" && { backgroundColor: themeColor },
                  ]}
                  onPress={() => alert.operator !== "below" && handleAlertOperatorToggle(index)}
                >
                  <Text style={[styles.alertDirectionText, alert.operator === "below" && styles.alertDirectionTextActive]}>
                    Below
                  </Text>
                </Pressable>
              </View>

              {/* Threshold input */}
              <TextInput
                style={styles.alertThresholdInput}
                value={alert.threshold === 0 ? "" : String(alert.threshold)}
                onChangeText={(text) => handleAlertThresholdChange(index, text)}
                keyboardType="numeric"
                placeholder="0"
                placeholderTextColor="#ccc"
              />

              {/* Delete button */}
              <Pressable
                style={styles.alertDeleteButton}
                onPress={() => handleRemoveAlert(index)}
              >
                <Ionicons name="trash-outline" size={18} color="#FF5252" />
              </Pressable>

              {/* Label input (full width below) */}
              <View style={styles.alertLabelRow}>
                <TextInput
                  style={styles.alertLabelInput}
                  value={alert.label ?? ""}
                  onChangeText={(text) => handleAlertLabelChange(index, text)}
                  placeholder={`${varInfo?.label ?? alert.variableId} ${alert.operator === "above" ? "high" : "low"}`}
                  placeholderTextColor="#ccc"
                  maxLength={30}
                />
              </View>
            </View>
          );
        })}

        <Pressable style={styles.addButton} onPress={handleAddAlert}>
          <Ionicons name="add-circle-outline" size={18} color={themeColor} />
          <Text style={[styles.addButtonText, { color: themeColor }]}>
            Add Alert
          </Text>
        </Pressable>
      </View>

      <Text style={styles.pageDescription}>
        Configure how people scores are calculated. Each score uses a
        weighted combination of variables.
      </Text>

      {scores.map((score, scoreIndex) => (
        <View key={score.id} style={styles.section}>
          {/* Score name input */}
          <View style={styles.nameRow}>
            <Text style={styles.nameLabel}>Score {scoreIndex + 1}</Text>
            <View style={styles.nameInputContainer}>
              <TextInput
                style={styles.nameInput}
                value={score.name}
                onChangeText={(text) => handleNameChange(scoreIndex, text)}
                maxLength={12}
                placeholder="Score name"
              />
              <Text style={styles.charCount}>{score.name.length}/12</Text>
            </View>
            {scores.length > 1 && (
              <Pressable
                style={styles.removeScoreButton}
                onPress={() => handleRemoveScore(scoreIndex)}
              >
                <Ionicons name="trash-outline" size={18} color="#FF5252" />
              </Pressable>
            )}
          </View>

          {/* Variables list */}
          {score.variables.map((variable, varIndex) => {
            const info = variableMap.get(variable.variableId);
            return (
              <View key={variable.variableId} style={styles.variableRow}>
                <View style={styles.variableInfo}>
                  <Text style={styles.variableLabel}>
                    {info?.label ?? variable.variableId}
                  </Text>
                  <Text style={styles.variableDesc}>
                    {info?.description ?? ""}
                  </Text>
                </View>

                {/* Weight stepper */}
                <View style={styles.weightControl}>
                  <Pressable
                    style={styles.weightButton}
                    onPress={() => handleWeightChange(scoreIndex, varIndex, -1)}
                    disabled={variable.weight <= 1}
                  >
                    <Ionicons
                      name="remove"
                      size={16}
                      color={variable.weight <= 1 ? "#ccc" : themeColor}
                    />
                  </Pressable>
                  <Text style={styles.weightValue}>{variable.weight}</Text>
                  <Pressable
                    style={styles.weightButton}
                    onPress={() => handleWeightChange(scoreIndex, varIndex, 1)}
                    disabled={variable.weight >= 5}
                  >
                    <Ionicons
                      name="add"
                      size={16}
                      color={variable.weight >= 5 ? "#ccc" : themeColor}
                    />
                  </Pressable>
                </View>

                {/* Remove button */}
                {score.variables.length > 1 && (
                  <Pressable
                    style={styles.removeButton}
                    onPress={() => handleRemoveVariable(scoreIndex, varIndex)}
                  >
                    <Ionicons name="close-circle" size={20} color="#FF5252" />
                  </Pressable>
                )}
              </View>
            );
          })}

          {/* Add variable button */}
          <Pressable
            style={styles.addButton}
            onPress={() => setAddVariableTarget(scoreIndex)}
          >
            <Ionicons name="add-circle-outline" size={18} color={themeColor} />
            <Text style={[styles.addButtonText, { color: themeColor }]}>
              Add Variable
            </Text>
          </Pressable>
        </View>
      ))}

      {/* Add Score button */}
      {scores.length < 4 && (
        <Pressable style={styles.addScoreButton} onPress={handleAddScore}>
          <Ionicons name="add-circle-outline" size={20} color={themeColor} />
          <Text style={[styles.addScoreButtonText, { color: themeColor }]}>
            Add Score
          </Text>
        </Pressable>
      )}

      {/* Reset to Defaults */}
      <Pressable style={styles.resetButton} onPress={handleResetToDefaults}>
        <Ionicons name="refresh-outline" size={18} color="#666" />
        <Text style={styles.resetButtonText}>Reset to Defaults</Text>
      </Pressable>

      {/* Save */}
      {hasChanges && (
        <Pressable
          style={[styles.saveButton, { backgroundColor: themeColor }]}
          onPress={handleSave}
          disabled={saving}
        >
          {saving ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <Text style={styles.saveButtonText}>Save Changes</Text>
          )}
        </Pressable>
      )}

      {/* Variable Picker Modal */}
      <Modal
        visible={addVariableTarget !== null}
        transparent
        animationType="slide"
        onRequestClose={() => setAddVariableTarget(null)}
      >
        <View style={styles.modalOverlay}>
          <Pressable
            style={styles.modalOverlayTouchable}
            onPress={() => setAddVariableTarget(null)}
          />
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Add Variable</Text>

            <ScrollView style={styles.modalScrollArea} bounces={false}>
              {Array.from(variablesByCategory.entries()).map(
                ([category, variables]) => {
                  const usedIds =
                    addVariableTarget !== null
                      ? getUsedVariableIds(addVariableTarget)
                      : new Set<string>();

                  return (
                    <View key={category}>
                      <Text style={styles.categoryHeader}>
                        {category.charAt(0).toUpperCase() + category.slice(1)}
                      </Text>
                      {variables.map((v) => {
                        const isUsed = usedIds.has(v.id);
                        return (
                          <Pressable
                            key={v.id}
                            style={[
                              styles.variablePickerRow,
                              isUsed && styles.variablePickerRowDisabled,
                            ]}
                            onPress={() =>
                              !isUsed &&
                              addVariableTarget !== null &&
                              handleAddVariable(addVariableTarget, v.id)
                            }
                            disabled={isUsed}
                          >
                            <Text
                              style={[
                                styles.variablePickerLabel,
                                isUsed && styles.variablePickerLabelDisabled,
                              ]}
                            >
                              {v.label}
                            </Text>
                            <Text style={styles.variablePickerDesc}>
                              {v.description}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  );
                }
              )}
            </ScrollView>

            <Pressable
              style={styles.modalCloseButton}
              onPress={() => setAddVariableTarget(null)}
            >
              <Text style={[styles.modalCloseText, { color: themeColor }]}>
                Cancel
              </Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* Alert Variable Picker Modal */}
      <Modal
        visible={alertVariablePickerIndex !== null}
        transparent
        animationType="slide"
        onRequestClose={() => setAlertVariablePickerIndex(null)}
      >
        <View style={styles.modalOverlay}>
          <Pressable
            style={styles.modalOverlayTouchable}
            onPress={() => setAlertVariablePickerIndex(null)}
          />
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Select Variable</Text>

            <ScrollView style={styles.modalScrollArea} bounces={false}>
              {Array.from(variablesByCategory.entries()).map(
                ([category, variables]) => (
                  <View key={category}>
                    <Text style={styles.categoryHeader}>
                      {category.charAt(0).toUpperCase() + category.slice(1)}
                    </Text>
                    {variables.map((v) => (
                      <Pressable
                        key={v.id}
                        style={styles.variablePickerRow}
                        onPress={() =>
                          alertVariablePickerIndex !== null &&
                          handleAlertVariableChange(alertVariablePickerIndex, v.id)
                        }
                      >
                        <Text style={styles.variablePickerLabel}>{v.label}</Text>
                        <Text style={styles.variablePickerDesc}>{v.description}</Text>
                      </Pressable>
                    ))}
                  </View>
                )
              )}
            </ScrollView>

            <Pressable
              style={styles.modalCloseButton}
              onPress={() => setAlertVariablePickerIndex(null)}
            >
              <Text style={[styles.modalCloseText, { color: themeColor }]}>
                Cancel
              </Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f8f9fa",
  },
  centered: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#f8f9fa",
  },
  content: {
    padding: 16,
    paddingBottom: 40,
  },
  displayNameInput: {
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    color: "#333",
    marginTop: 8,
  },
  displayNameHint: {
    fontSize: 12,
    color: "#999",
    marginTop: 6,
  },
  pageDescription: {
    fontSize: 14,
    color: "#666",
    marginBottom: 20,
    lineHeight: 20,
  },
  section: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  nameRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 16,
  },
  nameLabel: {
    fontSize: 14,
    fontWeight: "600",
    color: "#333",
    marginRight: 12,
  },
  nameInputContainer: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 8,
    paddingHorizontal: 10,
  },
  nameInput: {
    flex: 1,
    fontSize: 16,
    fontWeight: "600",
    paddingVertical: 8,
    color: "#333",
  },
  charCount: {
    fontSize: 11,
    color: "#999",
  },
  variableRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#f0f0f0",
  },
  variableInfo: {
    flex: 1,
  },
  variableLabel: {
    fontSize: 14,
    fontWeight: "500",
    color: "#333",
  },
  variableDesc: {
    fontSize: 11,
    color: "#999",
    marginTop: 1,
  },
  weightControl: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#f5f5f5",
    borderRadius: 8,
    paddingHorizontal: 4,
    marginLeft: 8,
  },
  weightButton: {
    padding: 6,
  },
  weightValue: {
    fontSize: 14,
    fontWeight: "700",
    color: "#333",
    minWidth: 20,
    textAlign: "center",
  },
  removeButton: {
    padding: 4,
    marginLeft: 6,
  },
  addButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingTop: 12,
  },
  addButtonText: {
    fontSize: 14,
    fontWeight: "500",
  },
  subtitleOptions: {
    gap: 8,
    marginTop: 10,
  },
  subtitleOption: {
    borderWidth: 1.5,
    borderColor: "#e0e0e0",
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  subtitleOptionSelected: {
    backgroundColor: "#f0f8ff",
  },
  subtitleOptionText: {
    fontSize: 14,
    color: "#333",
  },
  subtitleCheckbox: {
    width: 20,
    height: 20,
    borderRadius: 4,
    borderWidth: 1.5,
    borderColor: "#ccc",
    alignItems: "center" as const,
    justifyContent: "center" as const,
  },
  removeScoreButton: {
    padding: 6,
    marginLeft: 8,
  },
  addScoreButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 14,
    marginBottom: 8,
    backgroundColor: "#fff",
    borderRadius: 12,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: "#ddd",
  },
  addScoreButtonText: {
    fontSize: 15,
    fontWeight: "600",
  },
  resetButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 12,
    marginBottom: 8,
  },
  resetButtonText: {
    fontSize: 14,
    color: "#666",
  },
  saveButton: {
    paddingVertical: 14,
    paddingHorizontal: 24,
    borderRadius: 8,
    alignItems: "center",
    marginTop: 8,
  },
  saveButtonText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "600",
  },
  // Alert styles
  alertRow: {
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#f0f0f0",
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 8,
  },
  alertVariablePicker: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#f5f5f5",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 4,
    flex: 1,
    minWidth: 100,
  },
  alertVariableText: {
    fontSize: 13,
    fontWeight: "500",
    color: "#333",
    flex: 1,
  },
  alertDirectionToggle: {
    flexDirection: "row",
    borderRadius: 8,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "#ddd",
  },
  alertDirectionButton: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: "#f5f5f5",
  },
  alertDirectionText: {
    fontSize: 12,
    fontWeight: "600",
    color: "#666",
  },
  alertDirectionTextActive: {
    color: "#fff",
  },
  alertThresholdInput: {
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    fontSize: 14,
    color: "#333",
    width: 60,
    textAlign: "center",
  },
  alertDeleteButton: {
    padding: 4,
  },
  alertLabelRow: {
    width: "100%",
    marginTop: 4,
  },
  alertLabelInput: {
    borderWidth: 1,
    borderColor: "#eee",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    fontSize: 13,
    color: "#333",
  },
  // Modal styles
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "flex-end",
  },
  modalOverlayTouchable: {
    flex: 1,
  },
  modalContent: {
    backgroundColor: "#fff",
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    padding: 20,
    maxHeight: "70%",
  },
  modalScrollArea: {
    flexGrow: 0,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: "600",
    marginBottom: 16,
    color: "#333",
  },
  categoryHeader: {
    fontSize: 12,
    fontWeight: "600",
    color: "#999",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginTop: 12,
    marginBottom: 6,
  },
  variablePickerRow: {
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#f0f0f0",
  },
  variablePickerRowDisabled: {
    opacity: 0.4,
  },
  variablePickerLabel: {
    fontSize: 15,
    fontWeight: "500",
    color: "#333",
  },
  variablePickerLabelDisabled: {
    color: "#999",
  },
  variablePickerDesc: {
    fontSize: 12,
    color: "#999",
    marginTop: 2,
  },
  modalCloseButton: {
    alignItems: "center",
    paddingVertical: 16,
    marginTop: 8,
  },
  modalCloseText: {
    fontSize: 16,
    fontWeight: "600",
  },
});
