import React from "react";
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  FlatList,
  ScrollView,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { format } from "date-fns";
import { Avatar } from "@components/ui/Avatar";

interface RSVPMember {
  id: number;
  first_name: string;
  last_name: string;
  profile_photo?: string | null;
  role?: string | number;
  rsvp_status?: "going" | "not_going" | "not_answered";
}

interface RSVPListProps {
  visible: boolean;
  onClose: () => void;
  eventDate: string;
  groupTitle: string;
  members: RSVPMember[];
  rsvpMode?: "going" | "not_going" | "not_answered";
}

export function RSVPList({
  visible,
  onClose,
  eventDate,
  groupTitle,
  members,
  rsvpMode = "going",
}: RSVPListProps) {
  const getStatusLabel = () => {
    switch (rsvpMode) {
      case "going":
        return "Going";
      case "not_going":
        return "Not Going";
      case "not_answered":
        return "Not Answered";
      default:
        return "RSVPs";
    }
  };

  const getStatusColor = (status?: string) => {
    switch (status) {
      case "going":
        return "#4CAF50";
      case "not_going":
        return "#F44336";
      case "not_answered":
        return "#FF9800";
      default:
        return "#9E9E9E";
    }
  };

  const getStatusIcon = (status?: string) => {
    switch (status) {
      case "going":
        return "checkmark-circle";
      case "not_going":
        return "close-circle";
      case "not_answered":
        return "help-circle";
      default:
        return "ellipse-outline";
    }
  };

  const renderMember = ({ item }: { item: RSVPMember }) => {
    const status = item.rsvp_status || rsvpMode;
    const statusColor = getStatusColor(status);
    const statusIcon = getStatusIcon(status);

    return (
      <View style={styles.memberItem}>
        <View style={styles.memberInfo}>
          <Avatar
            name={`${item.first_name || ""} ${item.last_name || ""}`}
            imageUrl={item.profile_photo || null}
            size={48}
          />
          <View style={styles.memberDetails}>
            <Text style={styles.memberName}>
              {item.first_name} {item.last_name}
            </Text>
            {item.role && (
              <Text style={styles.memberRole}>
                {typeof item.role === "string"
                  ? item.role.charAt(0).toUpperCase() + item.role.slice(1)
                  : item.role === 2
                  ? "Leader"
                  : "Member"}
              </Text>
            )}
          </View>
        </View>
        <View style={[styles.statusBadge, { borderColor: statusColor }]}>
          <Ionicons name={statusIcon} size={20} color={statusColor} />
          <Text style={[styles.statusText, { color: statusColor }]}>
            {getStatusLabel()}
          </Text>
        </View>
      </View>
    );
  };

  return (
    <Modal
      visible={visible}
      transparent={true}
      animationType="slide"
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <TouchableOpacity
          style={styles.backdrop}
          activeOpacity={1}
          onPress={onClose}
        />
        <View style={styles.modalContent}>
          <View style={styles.header}>
            <View style={styles.headerContent}>
              <Text style={styles.headerTitle}>
                {format(new Date(eventDate), "MMM dd, yyyy")}
              </Text>
              <Text style={styles.groupTitle}>{groupTitle}</Text>
            </View>
            <TouchableOpacity onPress={onClose} style={styles.closeButton}>
              <Ionicons name="close" size={24} color="#333" />
            </TouchableOpacity>
          </View>

          <View style={styles.modeContainer}>
            <Text style={styles.modeLabel}>{getStatusLabel()} RSVPs</Text>
          </View>

          {members.length > 0 ? (
            <FlatList
              data={members}
              renderItem={renderMember}
              keyExtractor={(item) => item.id.toString()}
              style={styles.list}
              contentContainerStyle={styles.listContent}
              ListEmptyComponent={
                <View style={styles.emptyContainer}>
                  <Text style={styles.emptyText}>No RSVPs</Text>
                </View>
              }
            />
          ) : (
            <View style={styles.emptyContainer}>
              <Ionicons name="people-outline" size={48} color="#bdbdc1" />
              <Text style={styles.emptyText}>RSVP list is empty</Text>
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    justifyContent: "flex-end",
  },
  backdrop: {
    flex: 1,
  },
  modalContent: {
    backgroundColor: "#fff",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: "90%",
    paddingBottom: 16,
  },
  header: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: "#e0e0e0",
  },
  headerContent: {
    flex: 1,
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: "800",
    color: "#222224",
    marginBottom: 4,
  },
  groupTitle: {
    fontSize: 16,
    color: "#7f7f82",
    marginTop: 4,
  },
  closeButton: {
    padding: 4,
    marginLeft: 12,
  },
  modeContainer: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#e0e0e0",
  },
  modeLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: "#bdbdc1",
    textTransform: "uppercase",
    letterSpacing: 0.04,
  },
  list: {
    flex: 1,
  },
  listContent: {
    padding: 16,
  },
  memberItem: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: "#f0f0f0",
  },
  memberInfo: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
  },
  memberDetails: {
    marginLeft: 12,
    flex: 1,
  },
  memberName: {
    fontSize: 14,
    fontWeight: "600",
    color: "#222224",
    marginBottom: 2,
  },
  memberRole: {
    fontSize: 14,
    color: "#bdbdc1",
    textTransform: "capitalize",
  },
  statusBadge: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 2,
    borderRadius: 20,
    marginLeft: 12,
  },
  statusText: {
    fontSize: 12,
    fontWeight: "600",
    marginLeft: 6,
  },
  emptyContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 48,
  },
  emptyText: {
    fontSize: 14,
    fontWeight: "600",
    color: "#7f7f82",
    marginTop: 16,
  },
});
