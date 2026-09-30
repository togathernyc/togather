import React, { useState } from "react";
import { Text, TextInput, View } from "react-native";
import { useTheme } from "@hooks/useTheme";
import { URGENCY_LEVELS } from "../constants";
import { EditorLabel, EditorModal } from "../primitives";
import { styles } from "../styles";

export interface AiConfig {
  model: string;
  botPersonality: string;
  responseRules: string;
  teamContext: string;
  nagToneByLevel: Record<string, string>;
}

/** Edit the bot's model and prompts. Mount it fresh each time it opens. */
export function AiConfigEditorModal({
  aiConfig,
  onClose,
  onSave,
}: {
  aiConfig: AiConfig;
  onClose: () => void;
  onSave: (aiConfig: AiConfig) => void;
}) {
  const { colors } = useTheme();
  const [draft, setDraft] = useState<AiConfig>({
    ...aiConfig,
    nagToneByLevel: { ...aiConfig.nagToneByLevel },
  });
  const set = (patch: Partial<AiConfig>) => setDraft((d) => ({ ...d, ...patch }));
  const fieldStyle = { backgroundColor: colors.surfaceSecondary, color: colors.text };

  const multiline = (value: string, onChangeText: (t: string) => void, placeholder: string) => (
    <TextInput
      style={[styles.textFieldMulti, fieldStyle]}
      value={value}
      onChangeText={onChangeText}
      placeholder={placeholder}
      placeholderTextColor={colors.inputPlaceholder}
      multiline
      textAlignVertical="top"
    />
  );

  return (
    <EditorModal visible title="AI prompts" onClose={onClose} onSave={() => onSave(draft)}>
      <EditorLabel first>Model</EditorLabel>
      <TextInput
        style={[styles.textFieldSingle, fieldStyle]}
        value={draft.model}
        onChangeText={(model) => set({ model })}
        placeholder="e.g. gpt-4o"
        placeholderTextColor={colors.inputPlaceholder}
        autoCapitalize="none"
      />
      <EditorLabel>Bot personality</EditorLabel>
      {multiline(draft.botPersonality, (botPersonality) => set({ botPersonality }), "Describe the bot's personality...")}
      <EditorLabel>Response rules</EditorLabel>
      {multiline(draft.responseRules, (responseRules) => set({ responseRules }), "Rules for how the bot should respond...")}
      <EditorLabel>Team context</EditorLabel>
      {multiline(draft.teamContext, (teamContext) => set({ teamContext }), "Context about the team/organization...")}
      <EditorLabel>Reminder tone by level</EditorLabel>
      {URGENCY_LEVELS.map((level) => (
        <View key={level} style={{ marginBottom: 12 }}>
          <Text style={[styles.configLabel, { color: colors.textSecondary }]}>{level}</Text>
          {multiline(
            draft.nagToneByLevel[level] ?? "",
            (text) => set({ nagToneByLevel: { ...draft.nagToneByLevel, [level]: text } }),
            `Tone for ${level} reminders...`,
          )}
        </View>
      ))}
    </EditorModal>
  );
}
