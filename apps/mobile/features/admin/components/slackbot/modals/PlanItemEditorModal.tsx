import React, { useState } from "react";
import { ActivityIndicator, Alert, Text, TextInput, View } from "react-native";
import { useCommunityTheme } from "@hooks/useCommunityTheme";
import { useTheme } from "@hooks/useTheme";
import type {
  PcoPlanItemTitle,
  PcoTeamInfo,
  ServicePlanItemV2,
} from "../../../hooks/useSlackBotConfig";
import { AVAILABLE_ROLES, PLAN_ITEM_ACTIONS, planItemActionColor } from "../constants";
import { ChipSelect, EditorLabel, EditorModal, toggleIn } from "../primitives";
import { styles } from "../styles";

const slugify = (text: string) =>
  text.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");

/**
 * Create or edit one tracked item and what the bot does in Planning Center
 * once it's answered. Mount it fresh for each item.
 */
export function PlanItemEditorModal({
  item,
  isNew,
  pcoTeams,
  pcoPlanItemTitles,
  isLoadingPcoData,
  onClose,
  onSave,
}: {
  item: ServicePlanItemV2;
  isNew: boolean;
  pcoTeams: PcoTeamInfo[];
  pcoPlanItemTitles: PcoPlanItemTitle[];
  isLoadingPcoData: boolean;
  onClose: () => void;
  onSave: (item: ServicePlanItemV2) => void;
}) {
  const { colors } = useTheme();
  const { primaryColor } = useCommunityTheme();
  const [id, setId] = useState(item.id);
  const [label, setLabel] = useState(item.label);
  const [roles, setRoles] = useState<string[]>(item.responsibleRoles);
  const [actionType, setActionType] = useState(item.actionType);
  const [teamPattern, setTeamPattern] = useState(item.pcoTeamNamePattern || "");
  const [positionName, setPositionName] = useState(item.pcoPositionName || "");
  const [titlePattern, setTitlePattern] = useState(item.pcoItemTitlePattern || "");
  const [field, setField] = useState(item.pcoItemField || "description");
  const [preserveSections, setPreserveSections] = useState((item.preserveSections || []).join(", "));
  const [aiInstructions, setAiInstructions] = useState(item.aiInstructions || "");

  const fieldStyle = { backgroundColor: colors.surfaceSecondary, color: colors.text };
  const innerFieldStyle = { backgroundColor: colors.surface, color: colors.text };

  const handleSave = () => {
    if (!label.trim()) {
      Alert.alert("Error", "Label is required");
      return;
    }
    const sections = preserveSections.trim()
      ? preserveSections.split(",").map((s) => s.trim()).filter(Boolean)
      : undefined;
    onSave({
      id: id.trim() || slugify(label.trim()),
      label: label.trim(),
      responsibleRoles: roles,
      actionType,
      ...(actionType === "assign_role"
        ? { pcoTeamNamePattern: teamPattern || undefined, pcoPositionName: positionName || undefined }
        : {}),
      ...(actionType === "update_plan_item"
        ? { pcoItemTitlePattern: titlePattern || undefined, pcoItemField: field || undefined, preserveSections: sections }
        : {}),
      ...(aiInstructions.trim() ? { aiInstructions: aiInstructions.trim() } : {}),
    });
  };

  return (
    <EditorModal visible title={isNew ? "New item" : "Edit item"} onClose={onClose} onSave={handleSave}>
      <EditorLabel first>Label</EditorLabel>
      <TextInput
        style={[styles.textFieldSingle, fieldStyle]}
        value={label}
        onChangeText={(text) => {
          setLabel(text);
          if (isNew) setId(slugify(text));
        }}
        placeholder="e.g. Preacher, Service Video"
        placeholderTextColor={colors.inputPlaceholder}
      />

      <EditorLabel>ID</EditorLabel>
      <TextInput
        style={[styles.textFieldSingle, fieldStyle, !isNew && { color: colors.textTertiary }]}
        value={id}
        onChangeText={setId}
        placeholder="Auto-generated from label"
        placeholderTextColor={colors.inputPlaceholder}
        autoCapitalize="none"
        editable={isNew}
      />

      <EditorLabel>Responsible roles</EditorLabel>
      <ChipSelect
        options={AVAILABLE_ROLES.map((value) => ({ value, label: value }))}
        isSelected={(r) => roles.includes(r)}
        onPress={(r) => setRoles((prev) => toggleIn(prev, r))}
      />

      <EditorLabel>When answered</EditorLabel>
      <ChipSelect
        options={PLAN_ITEM_ACTIONS.map(({ key, label: l }) => ({ value: key, label: l }))}
        isSelected={(k) => k === actionType}
        onPress={setActionType}
        activeColor={(k) => (k === "none" ? colors.textSecondary : planItemActionColor(k, colors))}
      />

      {actionType === "assign_role" && (
        <View style={[styles.subCard, { marginTop: 16, backgroundColor: colors.surfaceSecondary, borderColor: colors.border }]}>
          <Text style={[styles.configLabel, { fontSize: 14, color: colors.text }]}>Assign in Planning Center</Text>
          <Text style={[styles.configLabel, { marginTop: 10, color: colors.textSecondary }]}>Team name pattern</Text>
          <TextInput
            style={[styles.textFieldSingle, innerFieldStyle]}
            value={teamPattern}
            onChangeText={setTeamPattern}
            placeholder="e.g. platform, worship"
            placeholderTextColor={colors.inputPlaceholder}
            autoCapitalize="none"
          />
          {pcoTeams.length > 0 && (
            <View style={{ marginTop: 8 }}>
              <ChipSelect
                small
                options={pcoTeams.map((t) => ({ value: t.name.toLowerCase(), label: t.name }))}
                isSelected={(name) => teamPattern.toLowerCase() === name}
                onPress={setTeamPattern}
              />
            </View>
          )}
          <Text style={[styles.configLabel, { marginTop: 10, color: colors.textSecondary }]}>Position name</Text>
          <TextInput
            style={[styles.textFieldSingle, innerFieldStyle]}
            value={positionName}
            onChangeText={setPositionName}
            placeholder="e.g. Preacher, Meeting Leader"
            placeholderTextColor={colors.inputPlaceholder}
          />
        </View>
      )}

      {actionType === "update_plan_item" && (
        <View style={[styles.subCard, { marginTop: 16, backgroundColor: colors.surfaceSecondary, borderColor: colors.border }]}>
          <Text style={[styles.configLabel, { fontSize: 14, color: colors.text }]}>Update a plan item</Text>
          <Text style={[styles.configLabel, { marginTop: 10, color: colors.textSecondary }]}>
            Item title pattern (pipe-separated)
          </Text>
          <TextInput
            style={[styles.textFieldSingle, innerFieldStyle]}
            value={titlePattern}
            onChangeText={setTitlePattern}
            placeholder="e.g. message|preach|sermon"
            placeholderTextColor={colors.inputPlaceholder}
            autoCapitalize="none"
          />
          {pcoPlanItemTitles.length > 0 && (
            <View style={{ marginTop: 8 }}>
              <ChipSelect
                small
                options={pcoPlanItemTitles.map((t) => ({ value: t.title.toLowerCase(), label: t.title }))}
                isSelected={(title) => titlePattern.toLowerCase().includes(title)}
                onPress={(title) => {
                  const current = titlePattern.trim();
                  setTitlePattern(current ? `${current}|${title}` : title);
                }}
              />
            </View>
          )}
          <Text style={[styles.configLabel, { marginTop: 10, marginBottom: 8, color: colors.textSecondary }]}>
            Field to update
          </Text>
          <ChipSelect
            small
            options={[
              { value: "description", label: "description" },
              { value: "notes", label: "notes" },
            ]}
            isSelected={(f) => f === field}
            onPress={setField}
          />
          <Text style={[styles.configLabel, { marginTop: 10, color: colors.textSecondary }]}>
            Preserve sections (comma-separated)
          </Text>
          <TextInput
            style={[styles.textFieldSingle, innerFieldStyle]}
            value={preserveSections}
            onChangeText={setPreserveSections}
            placeholder="e.g. GIVING"
            placeholderTextColor={colors.inputPlaceholder}
            autoCapitalize="characters"
          />
        </View>
      )}

      <EditorLabel>AI instructions (optional)</EditorLabel>
      <TextInput
        style={[styles.textFieldMulti, fieldStyle]}
        value={aiInstructions}
        onChangeText={setAiInstructions}
        placeholder="Special instructions for the AI when handling this item..."
        placeholderTextColor={colors.inputPlaceholder}
        multiline
        textAlignVertical="top"
      />

      {isLoadingPcoData && (
        <View style={{ alignItems: "center", marginTop: 12 }}>
          <ActivityIndicator size="small" color={primaryColor} />
          <Text style={[styles.rowDetail, { marginTop: 4, color: colors.textTertiary }]}>
            Loading Planning Center data...
          </Text>
        </View>
      )}
    </EditorModal>
  );
}
