import React, { useState } from "react";
import { Alert } from "react-native";
import type { SlackBotTeamMember } from "../../../hooks/useSlackBotConfig";
import { AVAILABLE_LOCATIONS, AVAILABLE_ROLES } from "../constants";
import { ChipSelect, EditorLabel, EditorModal, toggleIn } from "../primitives";

/** Pick a team member's roles and campuses. Mount it fresh for each member. */
export function MemberEditorModal({
  member,
  onClose,
  onSave,
}: {
  member: SlackBotTeamMember;
  onClose: () => void;
  onSave: (member: SlackBotTeamMember) => void;
}) {
  const [roles, setRoles] = useState<string[]>(member.roles);
  const [locations, setLocations] = useState<string[]>(member.locations);

  const handleSave = () => {
    if (roles.length === 0) {
      Alert.alert("Error", "Select at least one role");
      return;
    }
    if (locations.length === 0) {
      Alert.alert("Error", "Select at least one campus");
      return;
    }
    onSave({ ...member, roles, locations });
  };

  return (
    <EditorModal visible title={member.name} onClose={onClose} onSave={handleSave}>
      <EditorLabel first>Roles</EditorLabel>
      <ChipSelect
        options={AVAILABLE_ROLES.map((value) => ({ value, label: value }))}
        isSelected={(r) => roles.includes(r)}
        onPress={(r) => setRoles((prev) => toggleIn(prev, r))}
      />
      <EditorLabel>Campuses</EditorLabel>
      <ChipSelect
        options={AVAILABLE_LOCATIONS.map((value) => ({ value, label: value }))}
        isSelected={(l) => locations.includes(l)}
        onPress={(l) => setLocations((prev) => toggleIn(prev, l))}
      />
    </EditorModal>
  );
}
