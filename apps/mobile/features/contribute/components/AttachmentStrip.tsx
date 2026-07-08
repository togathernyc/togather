/**
 * Thumbnail row for pictures attached to the contribute composer (ADR-029).
 * Shows each picked image with an upload spinner while in flight and a remove
 * button; renders nothing when there are no attachments.
 */
import React from "react";
import {
  View,
  Image,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@hooks/useTheme";
import type { ImageAttachment } from "../hooks/useImageAttachments";

export function AttachmentStrip({
  attachments,
  onRemove,
}: {
  attachments: ImageAttachment[];
  onRemove: (id: string) => void;
}) {
  const { colors } = useTheme();
  if (attachments.length === 0) return null;
  return (
    <View style={styles.row}>
      {attachments.map((att) => (
        <View key={att.id} style={styles.item}>
          <Image
            source={{ uri: att.localUri }}
            style={[styles.thumb, { backgroundColor: colors.surfaceSecondary }]}
            resizeMode="cover"
          />
          {att.uploading ? (
            <View style={styles.overlay}>
              <ActivityIndicator size="small" color="#ffffff" />
            </View>
          ) : null}
          {att.failed ? (
            <View style={[styles.overlay, styles.failedOverlay]}>
              <Ionicons name="alert-circle" size={20} color="#ffffff" />
            </View>
          ) : null}
          <TouchableOpacity
            style={styles.removeBtn}
            onPress={() => onRemove(att.id)}
            hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
            accessibilityLabel="Remove picture"
          >
            <Ionicons name="close-circle" size={20} color="#000000" />
          </TouchableOpacity>
        </View>
      ))}
    </View>
  );
}

const THUMB = 64;

const styles = StyleSheet.create({
  row: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 10 },
  item: { width: THUMB, height: THUMB },
  thumb: { width: THUMB, height: THUMB, borderRadius: 8 },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.35)",
  },
  failedOverlay: { backgroundColor: "rgba(220,38,38,0.5)" },
  removeBtn: {
    position: "absolute",
    top: -6,
    right: -6,
    backgroundColor: "#ffffff",
    borderRadius: 10,
  },
});
