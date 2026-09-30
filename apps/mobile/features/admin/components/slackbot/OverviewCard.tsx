import React from "react";
import { Switch, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useCommunityTheme } from "@hooks/useCommunityTheme";
import { useTheme } from "@hooks/useTheme";
import { Card, Divider } from "./primitives";
import { formatSchedule } from "./schedule";
import { styles } from "./styles";
import type { SlackBotConfig } from "./types";

function joinNames(names: string[]): string {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/**
 * The top of the page: is the bot running, and what will it do next — in one
 * sentence, so an admin can tell at a glance without reading every section.
 */
export function OverviewCard({
  config,
  channelName,
  runningLocations,
  isToggling,
  onToggleBot,
  onOpenActivity,
}: {
  config: SlackBotConfig;
  channelName: string;
  runningLocations: string[];
  isToggling: boolean;
  onToggleBot: () => void;
  onOpenActivity: () => void;
}) {
  const { colors } = useTheme();
  const { primaryColor } = useCommunityTheme();

  const allPaused = config.enabled && runningLocations.length === 0;
  const status = !config.enabled
    ? { label: "Off", color: colors.error }
    : allPaused
      ? { label: "All campuses paused", color: colors.warning }
      : { label: "Running", color: colors.success };

  const schedule = formatSchedule(config.threadCreation.dayOfWeek, config.threadCreation.hourET);
  const summary = !config.enabled
    ? "The bot is off. It won't post threads, send reminders, or reply in Slack until you turn it back on."
    : allPaused
      ? "Every campus is paused, so no weekly threads or reminders will go out. Turn a campus on below to resume."
      : `Posts a planning thread for ${joinNames(runningLocations)} in ${channelName} on ${schedule}, then follows up with reminders until everything is filled in.`;

  return (
    <View style={styles.section}>
      <Card>
        <View style={styles.overviewHeader}>
          <View style={[styles.overviewIcon, { backgroundColor: colors.surfaceSecondary }]}>
            <Ionicons name="chatbubbles" size={22} color={primaryColor} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.overviewTitle, { color: colors.text }]}>Service planning bot</Text>
            <View style={[styles.statusPill, { backgroundColor: colors.surfaceSecondary }]}>
              <View style={[styles.statusDot, { backgroundColor: status.color }]} />
              <Text style={[styles.statusPillText, { color: colors.text }]}>{status.label}</Text>
            </View>
          </View>
          <Switch
            value={config.enabled}
            onValueChange={onToggleBot}
            disabled={isToggling}
            trackColor={{ true: primaryColor }}
            accessibilityLabel="Bot enabled"
          />
        </View>

        <Text style={[styles.overviewSummary, { color: colors.textSecondary }]}>{summary}</Text>

        {config.devMode && (
          <View style={[styles.banner, { backgroundColor: colors.surfaceSecondary }]}>
            <Ionicons name="bug-outline" size={16} color={colors.warning} />
            <Text style={[styles.bannerText, { color: colors.textSecondary }]}>
              Dev mode is on, so this deployment skips scheduled threads and reminders. Turn it off
              under Advanced.
            </Text>
          </View>
        )}

        <Divider />
        <TouchableOpacity style={styles.row} onPress={onOpenActivity}>
          <View style={styles.rowLeft}>
            <Ionicons name="time-outline" size={18} color={colors.textSecondary} />
            <Text style={[styles.rowLabel, { color: colors.text }]}>Activity log</Text>
          </View>
          <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
        </TouchableOpacity>
      </Card>
    </View>
  );
}
