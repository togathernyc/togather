import React from "react";
import { Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@hooks/useTheme";
import type { SlackBotNagEntry } from "../../hooks/useSlackBotConfig";
import { urgencyColor } from "./constants";
import { Badge, Card, ChipSelect, Divider, Section, SmallButton } from "./primitives";
import { DAY_NAMES, formatHour } from "./schedule";
import { styles } from "./styles";
import type { SlackBotConfig } from "./types";

const THREAD_HOURS = [7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17];

/** Where and when the weekly thread is posted. */
export function ThreadScheduleSection({
  config,
  channelName,
  onOpenChannelPicker,
  onChangeDay,
  onChangeHour,
}: {
  config: SlackBotConfig;
  channelName: string;
  onOpenChannelPicker: () => void;
  onChangeDay: (dayOfWeek: number) => void;
  onChangeHour: (hourET: number) => void;
}) {
  const { colors } = useTheme();
  return (
    <Section title="Weekly thread" subtitle="Where and when each campus's planning thread is posted">
      <Card>
        <TouchableOpacity style={styles.row} onPress={onOpenChannelPicker}>
          <View style={styles.rowLeft}>
            <Ionicons name="chatbubbles-outline" size={18} color={colors.textSecondary} />
            <Text style={[styles.rowLabel, { color: colors.text }]}>Posts in</Text>
          </View>
          <Text style={[styles.rowValue, { color: colors.textSecondary }]}>{channelName}</Text>
          <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
        </TouchableOpacity>
        <Divider />
        <Text style={[styles.fieldLabel, { color: colors.textTertiary, marginBottom: 8 }]}>Day</Text>
        <ChipSelect
          small
          options={DAY_NAMES.map((label, value) => ({ value, label }))}
          isSelected={(d) => d === config.threadCreation.dayOfWeek}
          onPress={onChangeDay}
        />
        <Text style={[styles.fieldLabel, { color: colors.textTertiary, marginTop: 14, marginBottom: 8 }]}>
          Time (ET)
        </Text>
        <ChipSelect
          small
          options={THREAD_HOURS.map((value) => ({ value, label: formatHour(value) }))}
          isSelected={(h) => h === config.threadCreation.hourET}
          onPress={onChangeHour}
        />
      </Card>
    </Section>
  );
}

/** The follow-ups the bot posts in open threads until every item is filled in. */
export function RemindersSection({
  nagSchedule,
  onAdd,
  onEdit,
  onRemove,
}: {
  nagSchedule: SlackBotNagEntry[];
  onAdd: () => void;
  onEdit: (index: number) => void;
  onRemove: (index: number) => void;
}) {
  const { colors } = useTheme();
  return (
    <Section
      title="Reminders"
      subtitle="Follow-ups in each open thread for whatever is still missing, getting firmer as Sunday gets closer"
      action={<SmallButton icon="add" label="Add" onPress={onAdd} />}
    >
      <Card>
        {nagSchedule.length === 0 ? (
          <Text style={[styles.emptyCardText, { color: colors.textTertiary }]}>
            No reminders scheduled.
          </Text>
        ) : (
          nagSchedule.map((nag, index) => (
            <View key={`${nag.dayOfWeek}-${nag.hourET}-${nag.urgency}-${index}`}>
              {index > 0 && <Divider />}
              <View style={styles.row}>
                <TouchableOpacity style={styles.rowLeft} onPress={() => onEdit(index)}>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.rowLabel, { color: colors.text }]}>{nag.label}</Text>
                    <Text style={[styles.rowDetail, { color: colors.textTertiary }]}>
                      {DAY_NAMES[nag.dayOfWeek]} at {formatHour(nag.hourET)} ET
                    </Text>
                  </View>
                  <Badge label={nag.urgency} color={urgencyColor(nag.urgency, colors)} />
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.iconButton}
                  onPress={() => onRemove(index)}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  accessibilityLabel={`Remove ${nag.label}`}
                >
                  <Ionicons name="trash-outline" size={18} color={colors.destructive} />
                </TouchableOpacity>
              </View>
            </View>
          ))
        )}
      </Card>
    </Section>
  );
}
