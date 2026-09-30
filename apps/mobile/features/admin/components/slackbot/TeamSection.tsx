import React from "react";
import { Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@hooks/useTheme";
import type { SlackBotTeamMember } from "../../hooks/useSlackBotConfig";
import { Card, Divider, Section, SmallButton } from "./primitives";
import { styles } from "./styles";

/** The people the bot knows about, and which roles and campuses they cover. */
export function TeamSection({
  teamMembers,
  onAdd,
  onEdit,
  onRemove,
}: {
  teamMembers: SlackBotTeamMember[];
  onAdd: () => void;
  onEdit: (member: SlackBotTeamMember) => void;
  onRemove: (member: SlackBotTeamMember) => void;
}) {
  const { colors } = useTheme();
  return (
    <Section
      title={`Team (${teamMembers.length})`}
      subtitle="Who the bot asks about each part of the service"
      action={<SmallButton icon="add" label="Add" onPress={onAdd} />}
    >
      <Card>
        {teamMembers.length === 0 ? (
          <Text style={[styles.emptyCardText, { color: colors.textTertiary }]}>
            No team members yet. Tap Add to pick people from Slack.
          </Text>
        ) : (
          teamMembers.map((member, index) => (
            <View key={member.slackUserId}>
              {index > 0 && <Divider />}
              <View style={styles.row}>
                <TouchableOpacity style={styles.rowLeft} onPress={() => onEdit(member)}>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.rowLabel, { color: colors.text, fontWeight: "500" }]}>
                      {member.name}
                    </Text>
                    <Text style={[styles.rowDetail, { color: colors.textTertiary }]}>
                      {member.roles.join(", ")} · {member.locations.join(", ")}
                    </Text>
                  </View>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.iconButton}
                  onPress={() => onRemove(member)}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  accessibilityLabel={`Remove ${member.name}`}
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
