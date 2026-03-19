import React from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { UserRoute } from "@components/guards/UserRoute";
import { Ionicons } from "@expo/vector-icons";
import { RecentAttendance } from "./RecentAttendance";
import { useGroupLeaderTools } from "../hooks/useGroupLeaderTools";
import { LeaderToolsPage, BottomBarType } from "../types";
import { DragHandle } from "@components/ui/DragHandle";
import { useTheme } from "@hooks/useTheme";

// Helper function to get page title
function getPageTitle(page: LeaderToolsPage): string {
  switch (page) {
    case LeaderToolsPage.MEMBERS:
      return "Members";
    case LeaderToolsPage.EVENTS:
      return "Events";
    case LeaderToolsPage.EVENT_STATS:
      return "Event Stats";
    case LeaderToolsPage.ATTENDANCE_DETAILS:
      return "Attendance";
    case LeaderToolsPage.NOTIFICATIONS:
      return "Notifications";
    default:
      return "Leader Tools";
  }
}

// Helper function to get group type name
function getGroupTypeName(type: number): string {
  // TODO: Get actual type names from community settings
  switch (type) {
    case 1:
      return "Dinner Party";
    case 2:
      return "Team";
    case 3:
      return "Public Group";
    case 4:
      return "Table";
    default:
      return "Group";
  }
}

export function GroupLeaderToolsScreen() {
  const { colors } = useTheme();
  const { group_id } = useLocalSearchParams<{ group_id: string }>();
  const router = useRouter();
  const {
    group,
    isLoadingGroup,
    groupError,
    activePage,
    showBottomBar,
    bottomBarType,
    handlePageChange,
    handleBack,
    handleGroupChat,
    handleAttendanceNavigation,
  } = useGroupLeaderTools(group_id || "");

  if (isLoadingGroup) {
    return (
      <UserRoute>
        <View style={[styles.container, { backgroundColor: colors.surfaceSecondary }]}>
          <DragHandle />
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" />
            <Text style={[styles.loadingText, { color: colors.textSecondary }]}>Loading...</Text>
          </View>
        </View>
      </UserRoute>
    );
  }

  if (groupError || !group) {
    return (
      <UserRoute>
        <View style={[styles.container, { backgroundColor: colors.surfaceSecondary }]}>
          <DragHandle />
          <View style={styles.errorContainer}>
            <Text style={[styles.errorText, { color: colors.textSecondary }]}>Group not found</Text>
            <TouchableOpacity
              style={styles.backButton}
              onPress={() => {
                if (router.canGoBack()) {
                  router.back();
                } else {
                  router.push("/(user)/leader-tools");
                }
              }}
            >
              <Text style={[styles.errorText, { color: colors.textSecondary }]}>Go Back</Text>
            </TouchableOpacity>
          </View>
        </View>
      </UserRoute>
    );
  }

  return (
    <UserRoute>
      <DragHandle />
      {/* Header */}
      <View style={[styles.header, { backgroundColor: colors.surface, borderBottomColor: colors.border }]}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => {
            if (activePage === LeaderToolsPage.DEFAULT) {
              // Navigate back to previous screen when on default page
              if (router.canGoBack()) {
                router.back();
              } else {
                // Fallback to leader tools list if can't go back
                router.push("/(user)/leader-tools");
              }
            } else {
              // Use handleBack for internal page navigation
              handleBack();
            }
          }}
        >
          <Ionicons name="arrow-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <View style={styles.headerContent}>
          <Text style={[styles.headerTitle, { color: colors.text }]}>
            {activePage === LeaderToolsPage.DEFAULT
              ? group.name || "Leader Tools"
              : getPageTitle(activePage)}
          </Text>
          {group.group_type_name && (
            <Text style={[styles.headerSubtitle, { color: colors.textSecondary }]}>
              {group.group_type_name}
            </Text>
          )}
        </View>
        {activePage === LeaderToolsPage.DEFAULT && (
          <TouchableOpacity
            style={styles.notificationButton}
            onPress={() => handlePageChange(LeaderToolsPage.NOTIFICATIONS)}
          >
            <Ionicons name="notifications-outline" size={24} color={colors.text} />
            {/* TODO: Add unread indicator */}
          </TouchableOpacity>
        )}
      </View>

      {/* Content Area */}
      <ScrollView
        style={styles.content}
        contentContainerStyle={styles.contentContainer}
      >
        {activePage === LeaderToolsPage.DEFAULT && (
          <RecentAttendance
            groupId={group_id || ""}
            group={group}
            onPageChange={(page: string) =>
              handlePageChange(page as LeaderToolsPage)
            }
            onGroupChat={handleGroupChat}
            onNotifications={() =>
              handlePageChange(LeaderToolsPage.NOTIFICATIONS)
            }
          />
        )}

        {/* Members page is now a separate route - removed from here */}
        {/* Customize/Pin Channels is now a separate route at /pin-channels */}
        {/* Events page is now a separate route - navigation handled in handlePageChange */}

        {activePage === LeaderToolsPage.EVENT_STATS && (
          <View style={styles.pageContent}>
            <Text style={[styles.placeholderText, { color: colors.textSecondary }]}>
              Event Stats page will go here
            </Text>
          </View>
        )}

        {/* Attendance Details is now a separate route */}

        {activePage === LeaderToolsPage.NOTIFICATIONS && (
          <View style={styles.pageContent}>
            <Text style={[styles.placeholderText, { color: colors.textSecondary }]}>
              Notifications page will go here
            </Text>
          </View>
        )}
      </ScrollView>

      {/* Bottom Action Bar */}
      {showBottomBar && (
        <View style={[styles.bottomBar, { backgroundColor: colors.surface, borderTopColor: colors.border }]}>
          {bottomBarType === BottomBarType.HOME &&
            activePage === LeaderToolsPage.DEFAULT && (
              <>
                <TouchableOpacity
                  style={[styles.bottomBarButton, { backgroundColor: colors.surfaceSecondary }]}
                  onPress={handleAttendanceNavigation}
                >
                  <Text style={[styles.bottomBarButtonText, { color: colors.text }]}>Attendance</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.bottomBarButton,
                    { backgroundColor: colors.buttonPrimary },
                  ]}
                  onPress={handleGroupChat}
                >
                  <Text
                    style={[
                      styles.bottomBarButtonText,
                      { color: colors.textInverse },
                    ]}
                  >
                    Group Chat
                  </Text>
                </TouchableOpacity>
              </>
            )}

        </View>
      )}
    </UserRoute>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  loadingText: {
    marginTop: 12,
    fontSize: 16,
  },
  errorContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  errorText: {
    fontSize: 18,
    marginBottom: 20,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    padding: 16,
    borderBottomWidth: 1,
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
  },
  headerSubtitle: {
    fontSize: 14,
    marginTop: 2,
  },
  notificationButton: {
    padding: 4,
  },
  content: {
    flex: 1,
  },
  contentContainer: {
    padding: 16,
    paddingBottom: 100,
  },
  defaultContent: {
    padding: 20,
  },
  pageContent: {
    padding: 20,
  },
  placeholderText: {
    fontSize: 16,
    textAlign: "center",
    marginVertical: 8,
  },
  bottomBar: {
    flexDirection: "row",
    padding: 16,
    borderTopWidth: 1,
    gap: 12,
  },
  bottomBarButton: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  bottomBarButtonPrimary: {},
  bottomBarButtonDisabled: {
    opacity: 0.5,
  },
  bottomBarButtonText: {
    fontSize: 16,
    fontWeight: "600",
  },
  bottomBarButtonTextPrimary: {},
});
