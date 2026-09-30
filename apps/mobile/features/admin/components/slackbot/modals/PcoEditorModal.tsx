import React, { useState } from "react";
import { Text, TextInput, View } from "react-native";
import { useTheme } from "@hooks/useTheme";
import type { PcoRoleMapping } from "../../../hooks/useSlackBotConfig";
import { EditorLabel, EditorModal } from "../primitives";
import { styles } from "../styles";

export interface PcoConfig {
  communityId: string;
  serviceTypeIds: Record<string, string>;
  roleMappings: Record<string, PcoRoleMapping>;
}

/** Edit the Planning Center connection. Mount it fresh each time it opens. */
export function PcoEditorModal({
  pcoConfig,
  onClose,
  onSave,
}: {
  pcoConfig: PcoConfig;
  onClose: () => void;
  onSave: (pcoConfig: PcoConfig) => void;
}) {
  const { colors } = useTheme();
  const [communityId, setCommunityId] = useState(pcoConfig.communityId);
  const [serviceTypeIds, setServiceTypeIds] = useState({ ...pcoConfig.serviceTypeIds });
  // Copy only the validator's fields — the stored rows can carry extras.
  const [roleMappings, setRoleMappings] = useState<Record<string, PcoRoleMapping>>(
    Object.fromEntries(
      Object.entries(pcoConfig.roleMappings).map(([k, v]) => [
        k,
        { teamNamePattern: v.teamNamePattern, positionName: v.positionName },
      ]),
    ),
  );
  const fieldStyle = { backgroundColor: colors.surfaceSecondary, color: colors.text };
  const setMapping = (role: string, patch: Partial<PcoRoleMapping>) =>
    setRoleMappings((prev) => ({ ...prev, [role]: { ...prev[role], ...patch } }));

  return (
    <EditorModal
      visible
      title="Planning Center"
      onClose={onClose}
      onSave={() => onSave({ communityId, serviceTypeIds, roleMappings })}
    >
      <EditorLabel first>Community ID</EditorLabel>
      <TextInput
        style={[styles.textFieldSingle, fieldStyle]}
        value={communityId}
        onChangeText={setCommunityId}
        placeholder="Convex community ID"
        placeholderTextColor={colors.inputPlaceholder}
        autoCapitalize="none"
      />

      <EditorLabel>Service type IDs</EditorLabel>
      {Object.entries(serviceTypeIds).map(([location, typeId]) => (
        <View key={location} style={{ marginBottom: 12 }}>
          <Text style={[styles.configLabel, { color: colors.textSecondary }]}>{location}</Text>
          <TextInput
            style={[styles.textFieldSingle, fieldStyle]}
            value={typeId}
            onChangeText={(text) => setServiceTypeIds((prev) => ({ ...prev, [location]: text }))}
            placeholder={`PCO service type ID for ${location}`}
            placeholderTextColor={colors.inputPlaceholder}
            autoCapitalize="none"
            keyboardType="number-pad"
          />
        </View>
      ))}

      <EditorLabel>Role mappings</EditorLabel>
      {Object.entries(roleMappings).map(([role, mapping]) => (
        <View
          key={role}
          style={[styles.subCard, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border }]}
        >
          <Text style={[styles.configLabel, { fontSize: 15, color: colors.text }]}>{role}</Text>
          <Text style={[styles.configLabel, { marginTop: 8, color: colors.textSecondary }]}>Team name pattern</Text>
          <TextInput
            style={[styles.textFieldSingle, { backgroundColor: colors.surface, color: colors.text }]}
            value={mapping.teamNamePattern}
            onChangeText={(teamNamePattern) => setMapping(role, { teamNamePattern })}
            placeholder="e.g. Worship"
            placeholderTextColor={colors.inputPlaceholder}
            autoCapitalize="none"
          />
          <Text style={[styles.configLabel, { marginTop: 8, color: colors.textSecondary }]}>Position name</Text>
          <TextInput
            style={[styles.textFieldSingle, { backgroundColor: colors.surface, color: colors.text }]}
            value={mapping.positionName}
            onChangeText={(positionName) => setMapping(role, { positionName })}
            placeholder="e.g. Worship Leader"
            placeholderTextColor={colors.inputPlaceholder}
            autoCapitalize="none"
          />
        </View>
      ))}
    </EditorModal>
  );
}
