import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Card, Button, Badge } from "@components/ui";
import { useCommunityTheme } from "@hooks/useCommunityTheme";
import { formatDateDisplay } from "../utils";
import { Group, RSVPStatus } from "../types";

interface RSVPSectionProps {
  group: Group;
  currentRSVP: RSVPStatus;
  onRSVPPress: () => void;
  isPending?: boolean;
}

export function RSVPSection({
  group,
  currentRSVP,
  onRSVPPress,
  isPending = false,
}: RSVPSectionProps) {
  const { primaryColor } = useCommunityTheme();

  if (!group?.date) return null;

  return (
    <Card style={styles.rsvpCard}>
      <View style={styles.rsvpHeader}>
        <Ionicons name="calendar" size={24} color={primaryColor} />
        <Text style={styles.rsvpCardTitle}>Next Meeting</Text>
      </View>
      <Text style={styles.dateDisplayText}>
        {formatDateDisplay(group.date)}
      </Text>
      {currentRSVP !== null && (
        <View style={styles.rsvpStatusContainer}>
          <Text style={styles.rsvpStatusLabel}>Your RSVP:</Text>
          <Badge
            variant={
              currentRSVP === 0
                ? "success"
                : currentRSVP === 1
                ? "warning"
                : currentRSVP === 2
                ? "danger"
                : "secondary"
            }
            size="medium"
          >
            {currentRSVP === 0
              ? "Going"
              : currentRSVP === 1
              ? "Maybe"
              : currentRSVP === 2
              ? "Not Going"
              : "Not Set"}
          </Badge>
        </View>
      )}
      <Button
        onPress={onRSVPPress}
        disabled={isPending}
        variant="primary"
        style={styles.rsvpButton}
      >
        {currentRSVP === null ? "RSVP" : "Update RSVP"}
      </Button>
    </Card>
  );
}

const styles = StyleSheet.create({
  rsvpCard: {
    marginTop: 12,
    marginHorizontal: 12,
    padding: 20,
  },
  rsvpHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 12,
  },
  rsvpCardTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: "#333",
    marginLeft: 12,
  },
  dateDisplayText: {
    fontSize: 16,
    color: "#666",
    marginBottom: 16,
    fontWeight: "500",
  },
  rsvpStatusContainer: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 16,
    gap: 8,
  },
  rsvpStatusLabel: {
    fontSize: 14,
    color: "#666",
    fontWeight: "500",
  },
  rsvpButton: {
    width: "100%",
  },
});

