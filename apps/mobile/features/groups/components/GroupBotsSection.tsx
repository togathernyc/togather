/**
 * GroupBotsSection
 *
 * Inline bots list on the group page. Replaces the "Bots" toolbar chip in
 * the chat navigation. Renders a compact card per bot with a Switch toggle
 * and a Configure affordance for bots that have config UI. Mounts the same
 * config modals BotsScreen does so behavior is identical.
 *
 * Hidden for non-leaders. Hidden if the bots query returns no entries.
 */
import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Switch,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import {
  useQuery,
  useAuthenticatedMutation,
  api,
} from "@services/api/convex";
import type { Id } from "@services/api/convex";
import { useTheme } from "@hooks/useTheme";
import { useCommunityTheme } from "@hooks/useCommunityTheme";
import { BotConfigModal } from "@features/leader-tools/components/BotConfigModal";
import { TaskReminderConfigModal } from "@features/leader-tools/components/TaskReminderConfigModal";
import { CommunicationBotConfigModal } from "@features/leader-tools/components/CommunicationBotConfigModal";

interface Props {
  groupId: string;
  isLeader: boolean;
}

type Bot = {
  id: string;
  name: string;
  description: string;
  icon: string;
  triggerType: string;
  enabled: boolean;
  hasConfig?: boolean;
  customConfigUI?: boolean;
};

export function GroupBotsSection({ groupId, isLeader }: Props) {
  const { colors } = useTheme();
  const { primaryColor } = useCommunityTheme();

  const [selectedBot, setSelectedBot] = useState<Bot | null>(null);
  const [configModalVisible, setConfigModalVisible] = useState(false);
  const [taskReminderModalVisible, setTaskReminderModalVisible] = useState(false);
  const [communicationBotModalVisible, setCommunicationBotModalVisible] =
    useState(false);

  const botsData = useQuery(
    api.functions.groupBots.listForGroup,
    isLeader && groupId ? { groupId: groupId as Id<"groups"> } : "skip",
  );

  const communicationBotConfig = useQuery(
    api.functions.groupBots.getConfig,
    isLeader && groupId
      ? { groupId: groupId as Id<"groups">, botId: "communication" }
      : "skip",
  );

  const toggleBot = useAuthenticatedMutation(api.functions.groupBots.toggle);
  const updateConfig = useAuthenticatedMutation(
    api.functions.groupBots.updateConfig,
  );

  if (!isLeader) return null;
  if (!botsData || botsData.length === 0) return null;

  const bots = botsData as Bot[];

  const handleOpenConfig = (bot: Bot) => {
    setSelectedBot(bot);
    if (bot.id === "task-reminder") {
      setTaskReminderModalVisible(true);
    } else if (bot.id === "communication") {
      setCommunicationBotModalVisible(true);
    } else {
      setConfigModalVisible(true);
    }
  };

  const handleCloseConfig = () => {
    setConfigModalVisible(false);
    setTaskReminderModalVisible(false);
    setCommunicationBotModalVisible(false);
    setSelectedBot(null);
  };

  const handleToggle = async (bot: Bot, value: boolean) => {
    try {
      await toggleBot({
        groupId: groupId as Id<"groups">,
        botId: bot.id,
        enabled: value,
      });
    } catch (e) {
      // Convex auto-rolls back; nothing to do here. BotConfigModal owns
      // alerts for richer flows.
    }
  };

  const handleSaveCommunicationBotConfig = async (config: {
    messages: Array<{
      id: string;
      message: string;
      schedule: { dayOfWeek: number; hour: number; minute: number };
      targetChannelSlug: string;
      enabled: boolean;
    }>;
  }) => {
    await updateConfig({
      groupId: groupId as Id<"groups">,
      botId: "communication",
      config,
    });
  };

  return (
    <View style={styles.section}>
      <Text style={[styles.header, { color: colors.textSecondary }]}>BOTS</Text>
      <View
        style={[styles.card, { backgroundColor: colors.surfaceSecondary }]}
      >
        {bots.map((bot, idx) => (
          <View
            key={bot.id}
            style={[
              styles.row,
              idx > 0 && {
                borderTopWidth: StyleSheet.hairlineWidth,
                borderTopColor: colors.border,
              },
            ]}
          >
            <Text style={styles.botIcon}>{bot.icon}</Text>
            <View style={styles.botInfo}>
              <Text style={[styles.botName, { color: colors.text }]} numberOfLines={1}>
                {bot.name}
              </Text>
              <Text
                style={[styles.botDescription, { color: colors.textSecondary }]}
                numberOfLines={2}
              >
                {bot.description}
              </Text>
              {(bot.hasConfig || bot.customConfigUI) && (
                <Pressable
                  onPress={() => handleOpenConfig(bot)}
                  hitSlop={6}
                  style={styles.configButton}
                >
                  <Ionicons
                    name="settings-outline"
                    size={14}
                    color={primaryColor}
                  />
                  <Text style={[styles.configLabel, { color: primaryColor }]}>
                    Configure
                  </Text>
                </Pressable>
              )}
            </View>
            <Switch
              value={bot.enabled}
              onValueChange={(value) => handleToggle(bot, value)}
              trackColor={{ false: colors.border, true: primaryColor }}
              thumbColor={bot.enabled ? primaryColor : "#f4f3f4"}
            />
          </View>
        ))}
      </View>

      {selectedBot &&
        selectedBot.id !== "task-reminder" &&
        selectedBot.id !== "communication" && (
          <BotConfigModal
            visible={configModalVisible}
            onClose={handleCloseConfig}
            groupId={groupId}
            botId={selectedBot.id}
            botName={selectedBot.name}
            botIcon={selectedBot.icon}
          />
        )}

      <TaskReminderConfigModal
        visible={taskReminderModalVisible}
        onClose={handleCloseConfig}
        groupId={groupId}
      />

      <CommunicationBotConfigModal
        visible={communicationBotModalVisible}
        onClose={handleCloseConfig}
        groupId={groupId as Id<"groups">}
        initialConfig={communicationBotConfig?.config as any}
        onSave={handleSaveCommunicationBotConfig}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    marginTop: 24,
    paddingHorizontal: 16,
    gap: 8,
  },
  header: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.6,
  },
  card: {
    borderRadius: 12,
    overflow: "hidden",
  },
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  botIcon: {
    fontSize: 24,
    lineHeight: 28,
    marginTop: 2,
  },
  botInfo: {
    flex: 1,
    gap: 4,
  },
  botName: {
    fontSize: 15,
    fontWeight: "600",
  },
  botDescription: {
    fontSize: 13,
    lineHeight: 18,
  },
  configButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginTop: 4,
  },
  configLabel: {
    fontSize: 12,
    fontWeight: "600",
  },
});
