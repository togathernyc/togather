import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Share,
  ActivityIndicator,
  Platform,
  Alert,
} from "react-native";
import * as Clipboard from "expo-clipboard";
import { Ionicons } from "@expo/vector-icons";
import { CustomModal } from "@components/ui/Modal";
import { useTheme } from "@hooks/useTheme";
import { useQuery, api } from "@services/api/convex";
import type { Id } from "@services/api/convex";
import { DOMAIN_CONFIG } from "@togather/shared";

interface InviteToEventSheetProps {
  visible: boolean;
  meetingId: string | null;
  eventTitle?: string;
  onClose: () => void;
}

/**
 * Post-create "invite people" sheet. Replaces the old Share-to-Group-Chat
 * modal: instead of forcing a single-channel post, we give the creator a
 * shareable link they can paste anywhere — togather chats, iMessage, group
 * threads, email. Native Share sheet wraps platform-standard delivery.
 */
export function InviteToEventSheet({
  visible,
  meetingId,
  eventTitle,
  onClose,
}: InviteToEventSheetProps) {
  const { colors } = useTheme();
  const [copied, setCopied] = useState(false);

  // Fetch the meeting so we can build the public share URL from its shortId.
  // Skip when we don't have an id yet (sheet opens right after the create
  // mutation returns the id).
  const meeting = useQuery(
    api.functions.meetings.index.getById,
    meetingId ? { meetingId: meetingId as Id<"meetings"> } : "skip",
  );
  const shortId = (meeting as any)?.shortId as string | undefined;
  const shareUrl = shortId ? DOMAIN_CONFIG.eventShareUrl(shortId) : "";

  const handleCopy = async () => {
    if (!shareUrl) return;
    await Clipboard.setStringAsync(shareUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleShare = async () => {
    if (!shareUrl) return;
    try {
      const message = eventTitle ? `${eventTitle}\n${shareUrl}` : shareUrl;
      await Share.share({ message, url: shareUrl });
    } catch (error: any) {
      if (error?.message !== "User did not share") {
        Alert.alert("Error", "Failed to open share sheet.");
      }
    }
  };

  return (
    <CustomModal visible={visible} onClose={onClose}>
      <View style={styles.container}>
        <View style={styles.headerRow}>
          <Text style={[styles.title, { color: colors.text }]}>Invite people</Text>
          <TouchableOpacity onPress={onClose} hitSlop={8}>
            <Ionicons name="close" size={22} color={colors.textSecondary} />
          </TouchableOpacity>
        </View>

        <Text style={[styles.description, { color: colors.textSecondary }]}>
          Copy the link and paste it into a Togather chat or anywhere else —
          iMessage, WhatsApp, a group text. Anyone with the link can view and
          RSVP.
        </Text>

        <View
          style={[
            styles.linkBox,
            { backgroundColor: colors.surfaceSecondary, borderColor: colors.border },
          ]}
        >
          {shareUrl ? (
            <Text style={[styles.linkText, { color: colors.text }]} numberOfLines={1}>
              {shareUrl}
            </Text>
          ) : (
            <ActivityIndicator size="small" color={colors.textSecondary} />
          )}
        </View>

        <View style={styles.actionsRow}>
          <TouchableOpacity
            testID="copy-link-button"
            style={[
              styles.button,
              styles.secondaryButton,
              { borderColor: colors.border, backgroundColor: colors.surface },
              !shareUrl && styles.buttonDisabled,
            ]}
            onPress={handleCopy}
            disabled={!shareUrl}
          >
            <Ionicons
              name={copied ? "checkmark" : "copy-outline"}
              size={18}
              color={colors.text}
            />
            <Text style={[styles.buttonText, { color: colors.text }]}>
              {copied ? "Copied" : "Copy link"}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            testID="share-link-button"
            style={[
              styles.button,
              styles.primaryButton,
              !shareUrl && styles.buttonDisabled,
            ]}
            onPress={handleShare}
            disabled={!shareUrl}
          >
            <Ionicons name="share-outline" size={18} color="#fff" />
            <Text style={[styles.buttonText, { color: "#fff" }]}>
              {Platform.OS === "ios" ? "Share" : "Share via…"}
            </Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity onPress={onClose} style={styles.doneRow}>
          <Text style={[styles.doneText, { color: colors.textSecondary }]}>Done</Text>
        </TouchableOpacity>
      </View>
    </CustomModal>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 20,
  },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  title: {
    fontSize: 18,
    fontWeight: "600",
  },
  description: {
    fontSize: 14,
    lineHeight: 20,
    marginTop: 8,
    marginBottom: 16,
  },
  linkBox: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
    minHeight: 40,
    justifyContent: "center",
  },
  linkText: {
    fontSize: 14,
    fontFamily: Platform.select({ ios: "Menlo", android: "monospace" }),
  },
  actionsRow: {
    flexDirection: "row",
    gap: 12,
    marginTop: 16,
  },
  button: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 12,
    borderRadius: 8,
  },
  secondaryButton: {
    borderWidth: StyleSheet.hairlineWidth,
  },
  primaryButton: {
    backgroundColor: "#16A34A",
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonText: {
    fontSize: 14,
    fontWeight: "600",
  },
  doneRow: {
    marginTop: 16,
    alignItems: "center",
  },
  doneText: {
    fontSize: 14,
    fontWeight: "500",
  },
});
