import React, { useState } from "react";
import { Alert, TextInput } from "react-native";
import { useTheme } from "@hooks/useTheme";
import type { SlackBotNagEntry } from "../../../hooks/useSlackBotConfig";
import { URGENCY_LEVELS, urgencyColor } from "../constants";
import { ChipSelect, EditorLabel, EditorModal } from "../primitives";
import { DAY_NAMES, formatHour } from "../schedule";
import { styles } from "../styles";

const REMINDER_HOURS = [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20];

/** Create or edit one scheduled reminder. Mount it fresh for each entry. */
export function ReminderEditorModal({
  entry,
  isNew,
  onClose,
  onSave,
}: {
  entry: SlackBotNagEntry;
  isNew: boolean;
  onClose: () => void;
  onSave: (entry: SlackBotNagEntry) => void;
}) {
  const { colors } = useTheme();
  const [label, setLabel] = useState(entry.label);
  const [dayOfWeek, setDayOfWeek] = useState(entry.dayOfWeek);
  const [hourET, setHourET] = useState(entry.hourET);
  const [urgency, setUrgency] = useState(entry.urgency);

  const handleSave = () => {
    if (!label.trim()) {
      Alert.alert("Error", "Label is required");
      return;
    }
    onSave({ label: label.trim(), dayOfWeek, hourET, urgency });
  };

  return (
    <EditorModal
      visible
      title={isNew ? "New reminder" : "Edit reminder"}
      onClose={onClose}
      onSave={handleSave}
    >
      <EditorLabel first>Label</EditorLabel>
      <TextInput
        style={[styles.textFieldSingle, { backgroundColor: colors.surfaceSecondary, color: colors.text }]}
        value={label}
        onChangeText={setLabel}
        placeholder="e.g. Mid-week check-in"
        placeholderTextColor={colors.inputPlaceholder}
      />
      <EditorLabel>Day</EditorLabel>
      <ChipSelect
        options={DAY_NAMES.map((l, value) => ({ value, label: l }))}
        isSelected={(d) => d === dayOfWeek}
        onPress={setDayOfWeek}
      />
      <EditorLabel>Time (ET)</EditorLabel>
      <ChipSelect
        options={REMINDER_HOURS.map((value) => ({ value, label: formatHour(value) }))}
        isSelected={(h) => h === hourET}
        onPress={setHourET}
      />
      <EditorLabel>Tone</EditorLabel>
      <ChipSelect
        options={URGENCY_LEVELS.map((value) => ({ value, label: value }))}
        isSelected={(u) => u === urgency}
        onPress={setUrgency}
        activeColor={(u) => urgencyColor(u, colors)}
      />
    </EditorModal>
  );
}
