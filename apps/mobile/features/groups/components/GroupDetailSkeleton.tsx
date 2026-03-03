import React from "react";
import { View, StyleSheet, Dimensions, ScrollView } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Skeleton, SkeletonAvatar, SkeletonText } from "@components/ui";

const { width: SCREEN_WIDTH } = Dimensions.get("window");
// Match GroupHeader.tsx which uses SCREEN_WIDTH * 0.6
const HERO_HEIGHT = SCREEN_WIDTH * 0.6;

/**
 * Loading skeleton for the group detail page.
 * Matches the structure of the actual GroupDetailScreen layout.
 */
export function GroupDetailSkeleton() {
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Hero Image Area with overlay */}
        <View style={styles.heroSection}>
        <Skeleton
          width={SCREEN_WIDTH}
          height={HERO_HEIGHT}
          borderRadius={0}
        />
        {/* Overlay content on hero */}
        <View style={styles.heroOverlay}>
          {/* Back button placeholder */}
          <View style={styles.heroNav}>
            <Skeleton width={36} height={36} variant="circular" />
            <Skeleton width={36} height={36} variant="circular" />
          </View>
          {/* Group name and schedule badge */}
          <View style={styles.heroContent}>
            <Skeleton width={200} height={28} borderRadius={4} style={styles.titleSkeleton} />
            <Skeleton width={120} height={20} borderRadius={10} style={styles.badgeSkeleton} />
          </View>
        </View>
      </View>

        {/* Description Section */}
        <View style={styles.descriptionSection}>
          <SkeletonText lines={2} />
        </View>

        {/* Chat Card Section */}
        <View style={styles.cardSection}>
          <View style={styles.chatCard}>
            <Skeleton width={44} height={44} variant="circular" />
            <View style={styles.chatCardContent}>
              <Skeleton width={100} height={16} />
              <Skeleton width={180} height={12} style={{ marginTop: 6 }} />
            </View>
            <Skeleton width={20} height={20} borderRadius={4} />
          </View>
        </View>

        {/* Map Section */}
        <View style={styles.mapSection}>
          <Skeleton width="100%" height={120} borderRadius={12} />
          <View style={styles.mapAddress}>
            <Skeleton width={24} height={24} variant="circular" />
            <View style={styles.mapAddressText}>
              <Skeleton width={180} height={14} />
              <Skeleton width={140} height={12} style={{ marginTop: 4 }} />
            </View>
          </View>
        </View>

        {/* Next Event Section */}
        <View style={styles.eventSection}>
          <Skeleton width={100} height={14} style={styles.sectionLabel} />
          <View style={styles.eventCard}>
            <View style={styles.eventDate}>
              <Skeleton width={40} height={16} />
              <Skeleton width={30} height={28} style={{ marginTop: 4 }} />
            </View>
            <View style={styles.eventDetails}>
              <Skeleton width={150} height={16} />
              <Skeleton width={100} height={12} style={{ marginTop: 6 }} />
            </View>
          </View>
        </View>

        {/* Members Row */}
        <View style={styles.membersSection}>
          <Skeleton width={80} height={14} style={styles.sectionLabel} />
          <View style={styles.membersRow}>
            {[...Array(6)].map((_, index) => (
              <SkeletonAvatar key={index} size={48} style={styles.memberAvatar} />
            ))}
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#fff",
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
  },
  heroSection: {
    position: "relative",
    height: HERO_HEIGHT,
  },
  heroOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "space-between",
    padding: 16,
  },
  heroNav: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  heroContent: {
    alignItems: "flex-start",
  },
  titleSkeleton: {
    marginBottom: 8,
  },
  badgeSkeleton: {
    opacity: 0.9,
  },
  descriptionSection: {
    backgroundColor: "#F5F5F5",
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  cardSection: {
    backgroundColor: "#F5F5F5",
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  chatCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 12,
  },
  chatCardContent: {
    flex: 1,
    marginLeft: 12,
  },
  mapSection: {
    backgroundColor: "#F5F5F5",
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  mapAddress: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 12,
  },
  mapAddressText: {
    marginLeft: 12,
    flex: 1,
  },
  eventSection: {
    backgroundColor: "#F5F5F5",
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  sectionLabel: {
    marginBottom: 12,
  },
  eventCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 16,
  },
  eventDate: {
    alignItems: "center",
    marginRight: 16,
  },
  eventDetails: {
    flex: 1,
  },
  membersSection: {
    backgroundColor: "#F5F5F5",
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  membersRow: {
    flexDirection: "row",
  },
  memberAvatar: {
    marginRight: 8,
  },
});
