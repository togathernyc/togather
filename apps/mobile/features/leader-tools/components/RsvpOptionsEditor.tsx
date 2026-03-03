import React from "react";
import { View, Text, StyleSheet, Switch, TextInput } from "react-native";
import { DEFAULT_PRIMARY_COLOR } from "@utils/styles";

export interface RsvpOption {
  id: number;
  label: string;
  enabled: boolean;
}

export const DEFAULT_RSVP_OPTIONS: RsvpOption[] = [
  { id: 1, label: "Going 👍", enabled: true },
  { id: 2, label: "Maybe 🤔", enabled: true },
  { id: 3, label: "Can't Go 😢", enabled: true },
];

// Helper to parse label into text and emoji parts
function parseLabel(label: string): { text: string; emoji: string } {
  // Match emoji at the end of the string (common emoji patterns)
  const emojiRegex = /\s*(\p{Emoji_Presentation}|\p{Emoji}\uFE0F)$/u;
  const match = label.match(emojiRegex);

  if (match) {
    const emoji = match[1]; // Just the emoji, not the space
    const text = label.slice(0, match.index);
    return { text, emoji };
  }

  return { text: label, emoji: "" };
}

// Helper to combine text and emoji into label (only trim for storage, not during editing)
function combineLabel(text: string, emoji: string): string {
  if (emoji) {
    return `${text} ${emoji}`;
  }
  return text;
}

interface RsvpOptionsEditorProps {
  options: RsvpOption[];
  onChange: (options: RsvpOption[]) => void;
}

interface RsvpOptionRowProps {
  option: RsvpOption;
  onTextChange: (text: string) => void;
  onEmojiChange: (emoji: string) => void;
  onToggle?: (enabled: boolean) => void;
  disabled?: boolean;
  showToggle?: boolean;
  textPlaceholder: string;
}

function RsvpOptionRow({
  option,
  onTextChange,
  onEmojiChange,
  onToggle,
  disabled = false,
  showToggle = false,
  textPlaceholder,
}: RsvpOptionRowProps) {
  const { text, emoji } = parseLabel(option.label);

  return (
    <View style={styles.optionRow}>
      <View style={styles.optionContent}>
        <View style={styles.inputRow}>
          <TextInput
            style={[styles.textInput, disabled && styles.inputDisabled]}
            value={text}
            onChangeText={onTextChange}
            placeholder={textPlaceholder}
            maxLength={15}
            editable={!disabled}
          />
          <TextInput
            style={[styles.emojiInput, disabled && styles.inputDisabled]}
            value={emoji}
            onChangeText={onEmojiChange}
            maxLength={2}
            editable={!disabled}
          />
          {showToggle && onToggle && (
            <Switch
              value={option.enabled}
              onValueChange={onToggle}
              trackColor={{ false: "#e0e0e0", true: DEFAULT_PRIMARY_COLOR }}
              thumbColor="#fff"
            />
          )}
        </View>
        {!showToggle && <Text style={styles.alwaysEnabled}>Always shown</Text>}
      </View>
    </View>
  );
}

export function RsvpOptionsEditor({ options, onChange }: RsvpOptionsEditorProps) {
  const handleToggle = (optionId: number, enabled: boolean) => {
    const updatedOptions = options.map((opt) =>
      opt.id === optionId ? { ...opt, enabled } : opt
    );
    onChange(updatedOptions);
  };

  const handleTextChange = (optionId: number, newText: string) => {
    const updatedOptions = options.map((opt) => {
      if (opt.id === optionId) {
        const { emoji } = parseLabel(opt.label);
        return { ...opt, label: combineLabel(newText, emoji) };
      }
      return opt;
    });
    onChange(updatedOptions);
  };

  const handleEmojiChange = (optionId: number, newEmoji: string) => {
    const updatedOptions = options.map((opt) => {
      if (opt.id === optionId) {
        const { text } = parseLabel(opt.label);
        return { ...opt, label: combineLabel(text, newEmoji) };
      }
      return opt;
    });
    onChange(updatedOptions);
  };

  // Find options by id
  const goingOption = options.find((opt) => opt.id === 1);
  const maybeOption = options.find((opt) => opt.id === 2);
  const cantGoOption = options.find((opt) => opt.id === 3);

  return (
    <View style={styles.container}>
      {goingOption && (
        <RsvpOptionRow
          option={goingOption}
          onTextChange={(text) => handleTextChange(1, text)}
          onEmojiChange={(emoji) => handleEmojiChange(1, emoji)}
          textPlaceholder="Going"
        />
      )}

      {maybeOption && (
        <RsvpOptionRow
          option={maybeOption}
          onTextChange={(text) => handleTextChange(2, text)}
          onEmojiChange={(emoji) => handleEmojiChange(2, emoji)}
          onToggle={(enabled) => handleToggle(2, enabled)}
          disabled={!maybeOption.enabled}
          showToggle
          textPlaceholder="Maybe"
        />
      )}

      {cantGoOption && (
        <RsvpOptionRow
          option={cantGoOption}
          onTextChange={(text) => handleTextChange(3, text)}
          onEmojiChange={(emoji) => handleEmojiChange(3, emoji)}
          textPlaceholder="Can't Go"
        />
      )}

      <Text style={styles.helperText}>
        Customize response text and emoji. The "Maybe" option can be hidden.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginTop: 8,
    backgroundColor: "#fff",
    borderRadius: 8,
    padding: 12,
    borderWidth: 1,
    borderColor: "#ecedf0",
  },
  optionRow: {
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#f0f0f0",
  },
  optionContent: {
    flex: 1,
  },
  inputRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  textInput: {
    flex: 1,
    fontSize: 15,
    color: "#333",
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: "#ecedf0",
    borderRadius: 6,
    backgroundColor: "#fafafa",
  },
  emojiInput: {
    width: 50,
    fontSize: 20,
    textAlign: "center",
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderWidth: 1,
    borderColor: "#ecedf0",
    borderRadius: 6,
    backgroundColor: "#fafafa",
  },
  inputDisabled: {
    backgroundColor: "#f0f0f0",
    color: "#999",
  },
  alwaysEnabled: {
    fontSize: 11,
    color: "#999",
    fontStyle: "italic",
    marginTop: 4,
    marginLeft: 4,
  },
  helperText: {
    fontSize: 12,
    color: "#999",
    marginTop: 12,
    textAlign: "center",
  },
});
