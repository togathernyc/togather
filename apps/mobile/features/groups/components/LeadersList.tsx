import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { Card, Avatar, Badge } from "@components/ui";
import { GroupMember } from "../types";

interface LeadersListProps {
  leaders: GroupMember[];
}

export function LeadersList({ leaders }: LeadersListProps) {
  if (!leaders || leaders.length === 0) return null;

  return (
    <Card style={styles.section}>
      <Text style={styles.sectionTitle}>Leaders</Text>
      {leaders.map((leader, index) => (
        <View key={leader.id || index} style={styles.memberItem}>
          <Avatar
            name={`${leader.first_name || ""} ${leader.last_name || ""}`.trim()}
            imageUrl={leader.profile_photo}
            size={48}
          />
          <View style={styles.memberInfo}>
            <View style={styles.memberNameRow}>
              <Text style={styles.memberName}>
                {leader.first_name} {leader.last_name}
              </Text>
              <Badge variant="primary" size="small">
                Leader
              </Badge>
            </View>
            {leader.email && (
              <Text style={styles.memberEmail}>{leader.email}</Text>
            )}
          </View>
        </View>
      ))}
    </Card>
  );
}

const styles = StyleSheet.create({
  section: {
    marginTop: 12,
    marginHorizontal: 12,
    padding: 20,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: "#333",
    marginBottom: 16,
  },
  memberItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#f0f0f0",
  },
  memberInfo: {
    flex: 1,
    marginLeft: 12,
  },
  memberNameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 4,
  },
  memberName: {
    fontSize: 16,
    fontWeight: "600",
    color: "#333",
  },
  memberEmail: {
    fontSize: 14,
    color: "#666",
  },
});

