import React, { useState, useMemo } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  ScrollView,
  Switch,
  RefreshControl,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { UserRoute } from "@components/guards/UserRoute";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery, useAuthenticatedMutation, api } from "@services/api/convex";
import { Id } from "@services/api/convex";
import { useAuth } from "@providers/AuthProvider";
import { DEFAULT_PRIMARY_COLOR } from "@utils/styles";
import { useCommunityTheme } from "@hooks/useCommunityTheme";
import { BotConfigModal } from "./BotConfigModal";
import { TaskReminderConfigModal } from "./TaskReminderConfigModal";
import { CommunicationBotConfigModal } from "./CommunicationBotConfigModal";
import { DragHandle } from "@components/ui/DragHandle";
import { useTheme } from "@hooks/useTheme";

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

export function BotsScreen() {
  const { colors } = useTheme();
  // NOTE: group_id is expected to be a Convex Id<"groups"> passed from navigation.
  // The leader-tools routes should only receive Convex IDs, not legacy UUIDs.
  const { group_id } = useLocalSearchParams<{ group_id: string }>();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const currentUserId = user?.id as Id<"users"> | undefined;
  const { primaryColor } = useCommunityTheme();

  // State for config modals
  const [selectedBot, setSelectedBot] = useState<Bot | null>(null);
  const [configModalVisible, setConfigModalVisible] = useState(false);
  const [taskReminderModalVisible, setTaskReminderModalVisible] = useState(false);
  const [communicationBotModalVisible, setCommunicationBotModalVisible] = useState(false);

  // Fetch communication bot config to pass as initialConfig
  const communicationBotConfig = useQuery(
    api.functions.groupBots.getConfig,
    group_id ? { groupId: group_id as Id<"groups">, botId: "communication" } : "skip"
  );

  const handleOpenConfig = (bot: Bot) => {
    setSelectedBot(bot);
    // Use custom modal for specific bots
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

  // Fetch bots list using Convex
  const botsData = useQuery(
    api.functions.groupBots.listForGroup,
    group_id ? { groupId: group_id as Id<"groups"> } : "skip"
  );

  const isLoading = botsData === undefined;
  const error: Error | null = null; // Convex throws on error, handle with ErrorBoundary
  const isRefetching = false;
  const refetch = () => {}; // Convex auto-updates

  // Transform data for backward compatibility
  const bots = useMemo(() => {
    if (!botsData) return undefined;
    return botsData;
  }, [botsData]);

  // Fetch group info for header using Convex
  const groupData = useQuery(
    api.functions.groups.index.getById,
    group_id ? { groupId: group_id as Id<"groups"> } : "skip"
  );

  const group = useMemo(() => {
    if (!groupData) return undefined;
    return { name: groupData.name };
  }, [groupData]);

  // Toggle bot mutation using Convex (auto-injects token)
  const toggleBot = useAuthenticatedMutation(api.functions.groupBots.toggle);
  const updateConfig = useAuthenticatedMutation(api.functions.groupBots.updateConfig);

  const toggleMutation = {
    mutate: async (args: { groupId: string; botId: string; enabled: boolean }) => {
      try {
        await toggleBot({
          groupId: args.groupId as Id<"groups">,
          botId: args.botId,
          enabled: args.enabled,
        });
        // Convex auto-updates reactive queries
      } catch (err) {
        console.error("Failed to toggle bot:", err);
      }
    },
    isPending: false,
  };

  const handleBack = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.push("/(tabs)/chat");
    }
  };

  const handleToggle = (botId: string, enabled: boolean) => {
    if (!group_id) return;
    toggleMutation.mutate({
      groupId: group_id,
      botId,
      enabled,
    });
  };

  // Handler for saving communication bot config (supports multiple messages)
  const handleSaveCommunicationBotConfig = async (config: {
    messages: Array<{
      id: string;
      message: string;
      schedule: { dayOfWeek: number; hour: number; minute: number };
      targetChannelSlug: string;
      enabled: boolean;
    }>;
  }) => {
    if (!group_id) return;
    await updateConfig({
      groupId: group_id as Id<"groups">,
      botId: "communication",
      config,
    });
  };

  // Only show full loading screen on initial load (no data yet)
  const showFullLoading = isLoading && !bots;

  // Render the content based on state
  const renderContent = () => {
    if (showFullLoading) {
      return (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={primaryColor} />
          <Text style={styles.loadingText}>Loading bots...</Text>
        </View>
      );
    }

    if (error) {
      const err = error as Error;
      return (
        <View style={styles.errorContainer}>
          <Ionicons name="alert-circle-outline" size={48} color={colors.destructive} />
          <Text style={styles.errorText}>
            {err.message || "Failed to load bots"}
          </Text>
          <TouchableOpacity style={styles.retryButton} onPress={() => refetch()}>
            <Text style={styles.retryButtonText}>Retry</Text>
          </TouchableOpacity>
        </View>
      );
    }

    return (
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={refetch}
            colors={[primaryColor]}
            tintColor={primaryColor}
          />
        }
      >
        <Text style={styles.subheader}>
          Enable bots to automate group activities
        </Text>

        <View style={styles.botList}>
          {bots?.map((bot: Bot) => (
            <View key={bot.id} style={styles.botCard}>
              <View style={styles.botHeader}>
                <Text style={styles.botIcon}>{bot.icon}</Text>
                <View style={styles.botInfo}>
                  <Text style={styles.botName}>{bot.name}</Text>
                  <Text style={styles.botDescription}>{bot.description}</Text>
                </View>
                <Switch
                  value={bot.enabled}
                  onValueChange={(value) => handleToggle(bot.id, value)}
                  disabled={toggleMutation.isPending}
                  trackColor={{ false: colors.border, true: primaryColor }}
                  thumbColor={bot.enabled ? primaryColor : "#f4f3f4"}
                />
              </View>
              <View style={styles.botFooter}>
                <Text style={styles.triggerInfo}>
                  {bot.triggerType === "cron" ? "Runs on schedule" : "Triggers on events"}
                </Text>
                {(bot.hasConfig || bot.customConfigUI) && (
                  <TouchableOpacity
                    style={styles.configButton}
                    onPress={() => handleOpenConfig(bot)}
                  >
                    <Ionicons name="settings-outline" size={16} color={primaryColor} />
                    <Text style={[styles.configButtonText, { color: primaryColor }]}>Configure</Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>
          ))}
        </View>

        {(!bots || bots.length === 0) && (
          <View style={styles.emptyContainer}>
            <Ionicons name="hardware-chip-outline" size={64} color={colors.iconSecondary} />
            <Text style={styles.emptyTitle}>No bots available</Text>
            <Text style={styles.emptyText}>
              Bots for this group will appear here when available.
            </Text>
          </View>
        )}
      </ScrollView>
    );
  };

  return (
    <UserRoute>
      <DragHandle />
      {/* Header - always visible */}
      <View style={[styles.header, { paddingTop: insets.top + 16 }]}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={handleBack}
          testID="back-button"
        >
          <Ionicons name="arrow-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <View style={styles.headerContent}>
          <Text style={styles.headerTitle}>Bots</Text>
          <Text style={styles.headerSubtitle}>
            {group?.name || "Group"}
          </Text>
        </View>
      </View>

      {/* Content - loading/error/list */}
      {renderContent()}

      {/* Generic bot config modal */}
      {selectedBot && group_id && selectedBot.id !== "task-reminder" && selectedBot.id !== "communication" && (
        <BotConfigModal
          visible={configModalVisible}
          onClose={handleCloseConfig}
          groupId={group_id}
          botId={selectedBot.id}
          botName={selectedBot.name}
          botIcon={selectedBot.icon}
        />
      )}

      {/* Task Reminder config modal */}
      {group_id && (
        <TaskReminderConfigModal
          visible={taskReminderModalVisible}
          onClose={handleCloseConfig}
          groupId={group_id}
        />
      )}

      {/* Communication Bot config modal */}
      {group_id && (
        <CommunicationBotConfigModal
          visible={communicationBotModalVisible}
          onClose={handleCloseConfig}
          groupId={group_id as Id<"groups">}
          initialConfig={communicationBotConfig?.config as any}
          onSave={handleSaveCommunicationBotConfig}
        />
      )}
    </UserRoute>
  );
}

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  loadingText: {
    marginTop: 12,
    fontSize: 16,
    color: "#666",
  },
  errorContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  errorText: {
    fontSize: 16,
    color: "#666",
    marginTop: 12,
    marginBottom: 20,
    textAlign: "center",
  },
  retryButton: {
    backgroundColor: DEFAULT_PRIMARY_COLOR,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
  },
  retryButtonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    padding: 16,
    backgroundColor: "#fff",
    borderBottomWidth: 1,
    borderBottomColor: "#e0e0e0",
  },
  backButton: {
    marginRight: 12,
    padding: 4,
  },
  headerContent: {
    flex: 1,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: "bold",
    color: "#333",
  },
  headerSubtitle: {
    fontSize: 14,
    color: "#666",
    marginTop: 2,
  },
  scrollView: {
    flex: 1,
    backgroundColor: "#f5f5f5",
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 100,
  },
  subheader: {
    fontSize: 14,
    color: "#666",
    marginBottom: 16,
  },
  botList: {
    gap: 12,
  },
  botCard: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  botHeader: {
    flexDirection: "row",
    alignItems: "center",
  },
  botIcon: {
    fontSize: 32,
    marginRight: 12,
  },
  botInfo: {
    flex: 1,
  },
  botName: {
    fontSize: 16,
    fontWeight: "600",
    color: "#333",
    marginBottom: 2,
  },
  botDescription: {
    fontSize: 13,
    color: "#666",
  },
  botFooter: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: "#f0f0f0",
  },
  triggerInfo: {
    fontSize: 12,
    color: "#999",
  },
  configButton: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 4,
    paddingHorizontal: 8,
  },
  configButtonText: {
    fontSize: 13,
    marginLeft: 4,
    fontWeight: "500",
  },
  emptyContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingVertical: 60,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: "600",
    color: "#333",
    marginTop: 16,
  },
  emptyText: {
    fontSize: 14,
    color: "#666",
    marginTop: 8,
    textAlign: "center",
  },
});
