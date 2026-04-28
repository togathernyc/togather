/**
 * Chat Room Header (Ad-hoc DMs)
 *
 * Tappable header for `dm` / `group_dm` channels: stacked avatars + a
 * member name list. Tapping it opens the chat-info screen. Used in place
 * of the group-channel `<ChatHeader />` when `isAdHoc === true`.
 *
 * iMessage parity: the title line is the chat name (group_dm with name
 * set), or the other person's full name (1:1), or a comma-list of first
 * names (group_dm with no name). The subtitle reads "<N> people" so
 * larger groups still feel scannable without trying to fit every name.
 */
import React, { memo, useMemo } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Pressable,
  Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@hooks/useTheme";
import { Avatar } from "@components/ui/Avatar";
import { useIsDesktopWeb } from "../../../hooks/useIsDesktopWeb";
import { StackedMemberAvatars } from "./StackedMemberAvatars";

type Member = {
  name: string;
  imageUrl: string | null;
};

type Props = {
  channelType: "dm" | "group_dm";
  /** Channel-level name (set on group_dm). Empty string when unset. */
  channelName: string;
  /** Other members (excludes the caller). */
  otherMembers: Member[];
  onBack: () => void;
  onPressTitle: () => void;
};

export const ChatRoomHeader = memo(function ChatRoomHeader({
  channelType,
  channelName,
  otherMembers,
  onBack,
  onPressTitle,
}: Props) {
  const { colors } = useTheme();
  const isDesktopWeb = useIsDesktopWeb();
  const isOneOnOne = channelType === "dm";

  const titleLine = useMemo(() => {
    if (isOneOnOne) {
      return otherMembers[0]?.name ?? "Conversation";
    }
    if (channelName.trim().length > 0) return channelName;
    const firstNames = otherMembers
      .slice(0, 3)
      .map((m) => m.name.split(" ")[0])
      .filter(Boolean);
    return firstNames.length > 0 ? firstNames.join(", ") : "Chat";
  }, [isOneOnOne, otherMembers, channelName]);

  const subtitleLine = useMemo(() => {
    if (isOneOnOne) return null;
    const total = otherMembers.length + 1;
    return `${total} people`;
  }, [isOneOnOne, otherMembers.length]);

  return (
    <View style={[styles.header, { backgroundColor: colors.surface }]}>
      {!isDesktopWeb && (
        <TouchableOpacity onPress={onBack} style={styles.backButton} hitSlop={8}>
          <Ionicons name="chevron-back" size={28} color={colors.text} />
        </TouchableOpacity>
      )}

      {/*
        On RN-web, function-style `style` props on Pressable do NOT apply,
        so layout styles live on inner Views and pressed feedback on the
        parent uses opacity via `style` (single object, not function).
      */}
      <Pressable
        onPress={onPressTitle}
        accessibilityRole="button"
        accessibilityLabel="Open chat info"
        style={({ pressed }) => [
          styles.titleHit,
          // RN-native picks up the pressed opacity here; web uses the
          // inner View's `active:` Tailwind variants if you swap to
          // NativeWind. We stick with this for parity with neighboring
          // ChatHeader which also uses TouchableOpacity-style press.
          pressed && Platform.OS !== "web" && { opacity: 0.7 },
        ]}
      >
        <View style={styles.titleInner}>
          {isOneOnOne ? (
            <Avatar
              name={otherMembers[0]?.name ?? titleLine}
              imageUrl={otherMembers[0]?.imageUrl ?? undefined}
              size={36}
            />
          ) : (
            <StackedMemberAvatars
              members={otherMembers.length > 0 ? otherMembers : [{ name: titleLine, imageUrl: null }]}
              size={36}
              surfaceColor={colors.surface}
            />
          )}

          <View style={styles.titleTextWrap}>
            <Text
              style={[styles.titleText, { color: colors.text }]}
              numberOfLines={1}
            >
              {titleLine}
            </Text>
            {subtitleLine ? (
              <Text
                style={[styles.subtitleText, { color: colors.textSecondary }]}
                numberOfLines={1}
              >
                {subtitleLine}
              </Text>
            ) : null}
          </View>
        </View>
      </Pressable>

      <TouchableOpacity
        onPress={onPressTitle}
        style={styles.infoButton}
        accessibilityLabel="Chat info"
        hitSlop={8}
      >
        <Ionicons name="information-circle-outline" size={22} color={colors.text} />
      </TouchableOpacity>
    </View>
  );
});

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    paddingVertical: 12,
  },
  backButton: {
    padding: 4,
    marginRight: 4,
  },
  titleHit: {
    flex: 1,
    minHeight: 44,
    justifyContent: "center",
  },
  titleInner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  titleTextWrap: {
    flex: 1,
    minWidth: 0,
  },
  titleText: {
    fontSize: 17,
    fontWeight: "600",
  },
  subtitleText: {
    fontSize: 12,
    marginTop: 1,
  },
  infoButton: {
    padding: 8,
  },
});
