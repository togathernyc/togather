import React from "react";
import { Switch, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useCommunityTheme } from "@hooks/useCommunityTheme";
import { useTheme } from "@hooks/useTheme";
import { AVAILABLE_LOCATIONS, isLocationOn } from "./constants";
import { Card, Section, SmallButton } from "./primitives";
import { describeNextRun, formatHour } from "./schedule";
import { styles } from "./styles";
import type { SlackBotConfig } from "./types";

/**
 * One card per campus with its weekly-thread switch up front. Turning a campus
 * off stops BOTH its weekly thread and its reminders (see setLocationEnabled);
 * the other campuses keep running.
 */
export function CampusesSection({
  config,
  resolveSlackName,
  onToggleLocation,
  onEditMentions,
}: {
  config: SlackBotConfig;
  resolveSlackName: (slackUserId: string) => string;
  onToggleLocation: (location: string, enabled: boolean) => void;
  onEditMentions: (location: string) => void;
}) {
  const { colors } = useTheme();
  const { primaryColor } = useCommunityTheme();
  const { dayOfWeek, hourET } = config.threadCreation;
  const nextRun = describeNextRun(new Date(), dayOfWeek, hourET);

  return (
    <Section
      title="Campuses"
      subtitle="Pause a campus while you're not meeting there. It gets no weekly thread and no reminders; other campuses keep running."
    >
      <View style={styles.cardGap}>
        {AVAILABLE_LOCATIONS.map((location) => {
          const on = isLocationOn(config.locationsEnabled, location);
          const mentions: string[] = config.threadMentions[location] ?? [];
          const statusLine = !on
            ? "Paused: no weekly thread or reminders"
            : !config.enabled
              ? "On, but the bot is off"
              : nextRun
                ? `Next thread ${nextRun} at ${formatHour(hourET)} ET`
                : "Weekly thread on";

          return (
            <Card key={location}>
              <View style={styles.campusHeader}>
                <Ionicons
                  name={on ? "location" : "location-outline"}
                  size={20}
                  color={on ? primaryColor : colors.iconSecondary}
                />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.campusName, { color: colors.text }]}>{location}</Text>
                  <Text
                    style={[styles.rowDetail, { color: on ? colors.textSecondary : colors.warning }]}
                  >
                    {statusLine}
                  </Text>
                </View>
                <Switch
                  value={on}
                  onValueChange={(value) => onToggleLocation(location, value)}
                  trackColor={{ true: primaryColor }}
                  accessibilityLabel={`${location} weekly thread`}
                />
              </View>

              <View style={[styles.campusBody, !on && { opacity: 0.5 }]}>
                <View style={[styles.row, { marginBottom: 8 }]}>
                  <Text style={[styles.fieldLabel, { color: colors.textTertiary }]}>
                    Tagged in new threads
                  </Text>
                  <SmallButton icon="pencil" label="Edit" onPress={() => onEditMentions(location)} />
                </View>
                {mentions.length > 0 ? (
                  <View style={styles.chipContainer}>
                    {mentions.map((id) => (
                      <View key={id} style={[styles.chip, { backgroundColor: colors.surfaceSecondary }]}>
                        <Text style={[styles.chipText, { color: colors.text }]}>{resolveSlackName(id)}</Text>
                      </View>
                    ))}
                  </View>
                ) : (
                  <Text style={[styles.rowDetail, { color: colors.textTertiary }]}>Nobody yet</Text>
                )}
              </View>
            </Card>
          );
        })}
      </View>
    </Section>
  );
}
