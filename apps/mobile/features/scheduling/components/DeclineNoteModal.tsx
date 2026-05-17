/**
 * DeclineNoteModal
 *
 * Prompts the volunteer for an optional one-line note when declining an
 * assignment. The note is free-text and may be left blank.
 */
import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  Pressable,
  ActivityIndicator,
} from "react-native";
import { CustomModal } from "@components/ui/Modal";
import { useTheme } from "@hooks/useTheme";

export function DeclineNoteModal({
  visible,
  onClose,
  onSubmit,
}: {
  visible: boolean;
  onClose: () => void;
  onSubmit: (note: string) => Promise<void> | void;
}) {
  const { colors } = useTheme();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  // Clear the field each time the modal opens.
  React.useEffect(() => {
    if (visible) setNote("");
  }, [visible]);

  const handleSubmit = async () => {
    setBusy(true);
    try {
      await onSubmit(note);
    } finally {
      setBusy(false);
    }
  };

  return (
    <CustomModal visible={visible} onClose={onClose} title="Decline this request">
      <View>
        <Text style={[styles.hint, { color: colors.textSecondary }]}>
          Want to let the leader know why? This is optional.
        </Text>
        <TextInput
          value={note}
          onChangeText={setNote}
          placeholder="e.g. Out of town that weekend"
          placeholderTextColor={colors.textSecondary}
          maxLength={140}
          autoFocus
          style={[
            styles.input,
            {
              color: colors.text,
              backgroundColor: colors.inputBackground,
              borderColor: colors.inputBorder,
            },
          ]}
        />
        <View style={styles.buttons}>
          <Pressable
            onPress={onClose}
            disabled={busy}
            style={[styles.btn, { backgroundColor: colors.surfaceSecondary }]}
          >
            <Text style={[styles.btnText, { color: colors.text }]}>Cancel</Text>
          </Pressable>
          <Pressable
            onPress={handleSubmit}
            disabled={busy}
            style={[
              styles.btn,
              { backgroundColor: colors.destructive },
              busy && { opacity: 0.6 },
            ]}
          >
            {busy ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Text style={[styles.btnText, { color: "#fff" }]}>Decline</Text>
            )}
          </Pressable>
        </View>
      </View>
    </CustomModal>
  );
}

const styles = StyleSheet.create({
  hint: {
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 12,
  },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 16,
    minHeight: 44,
  },
  buttons: {
    flexDirection: "row",
    gap: 12,
    marginTop: 20,
  },
  btn: {
    flex: 1,
    minHeight: 48,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  btnText: {
    fontSize: 16,
    fontWeight: "600",
  },
});
