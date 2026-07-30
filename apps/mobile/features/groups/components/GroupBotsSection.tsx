/**
 * GroupBotsSection
 *
 * Inline bots list on the group page. Replaces the "Bots" toolbar chip in
 * the chat navigation. Renders a compact card per bot with a Switch toggle
 * and a Configure affordance for bots that have config UI. Mounts the same
 * config modals BotsScreen does so behavior is identical.
 *
 * Hidden for non-leaders. Hidden if the bots query returns no entries.
 *
 * whatsapp-shell (flag-on): restyled to
 * `docs/plans/church-migration-ui-redesign/WHATSAPP-DESIGN-SYSTEM.md` §3.2 —
 * a `WaInsetGroup` of `WaCell`s (`variant="toggle"`), the bot's emoji as the
 * `iconNode`, and (for bots with config UI) the row's own `onPress` opening
 * Configure — replacing the flag-off card's separate "Configure" link
 * (`WaCell` has one description slot, no secondary tap target inside a row;
 * see the flag-on branch below). This component is also rendered unmodified
 * inside `GroupDetailScreen` (flag off), so every render is gated on
 * `useWhatsappShell()`; flag-off is byte-identical to before this pass.
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
import { useWhatsappShell } from "@hooks/useWhatsappShell";
import { BotConfigModal } from "@features/leader-tools/components/BotConfigModal";
import { TaskReminderConfigModal } from "@features/leader-tools/components/TaskReminderConfigModal";
import { CommunicationBotConfigModal } from "@features/leader-tools/components/CommunicationBotConfigModal";
import { WaInsetGroup, WaCell, WA_GROUP_SPACING } from "@components/wa";

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
  const whatsappShell = useWhatsappShell();

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

  if (whatsappShell) {
    return (
      <View style={styles.waSection}>
        <WaInsetGroup header="Bots">
          {bots.map((bot) => {
            const hasConfigure = !!(bot.hasConfig || bot.customConfigUI);
            return (
              <WaCell
                key={bot.id}
                iconNode={<Text style={styles.waBotGlyph}>{bot.icon}</Text>}
                title={bot.name}
                description={bot.description}
                variant="toggle"
                toggleValue={bot.enabled}
                onToggleChange={(value) => handleToggle(bot, value)}
                accent={primaryColor}
                // Configure via row press — WaCell has one description slot
                // and no secondary tap target inside a toggle row, so the
                // flag-off card's separate "Configure" link becomes "tap the
                // row" here; the trailing Switch keeps its own touch target.
                onPress={hasConfigure ? () => handleOpenConfig(bot) : undefined}
              />
            );
          })}
        </WaInsetGroup>

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
  // --- whatsapp-shell (flag-on) -------------------------------------------
  waSection: {
    marginTop: WA_GROUP_SPACING,
  },
  waBotGlyph: {
    fontSize: 20,
    lineHeight: 24,
  },
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
