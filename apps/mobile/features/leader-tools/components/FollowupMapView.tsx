import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import Constants from "expo-constants";
import { Ionicons } from "@expo/vector-icons";
import { ExploreMap, MapBounds } from "@features/explore/components/ExploreMap";
import type { Group } from "@features/groups/types";
import { useCommunityTheme } from "@hooks/useCommunityTheme";
import { computeMemberMapPlacements } from "../utils/memberMapPlacement";

const mapboxToken =
  Constants.expoConfig?.extra?.mapboxAccessToken ||
  process.env.EXPO_PUBLIC_MAPBOX_TOKEN ||
  "";

export const FOLLOWUP_MAP_VIEW_ID = "__followup_map__";

export interface FollowupMapMember {
  groupMemberId: string;
  firstName: string;
  lastName: string;
  avatarUrl?: string | null;
  zipCode?: string | null;
  status?: string;
  groupName?: string;
}

type MarkerGroup = Group & {
  _memberId: string;
  _groupName?: string;
};

interface FollowupMapViewProps {
  members: FollowupMapMember[];
  onOpenMember: (memberId: string) => void;
  loading?: boolean;
  emptyText?: string;
  allMembers?: FollowupMapMember[];
  onLoadAll?: () => void;
  isLoadingAll?: boolean;
}

function toNumericId(input: string): number {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash << 5) - hash + input.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash) || 1;
}

function getMemberName(member: FollowupMapMember): string {
  return `${member.firstName} ${member.lastName}`.trim() || "Member";
}

export function FollowupMapView({
  members,
  onOpenMember,
  loading = false,
  emptyText = "No members with ZIP codes are available for map view.",
  allMembers,
  onLoadAll,
  isLoadingAll = false,
}: FollowupMapViewProps) {
  const { primaryColor } = useCommunityTheme();
  const [selectedMemberId, setSelectedMemberId] = useState<string | null>(null);
  const [visibleMemberIds, setVisibleMemberIds] = useState<Set<string>>(new Set());
  const [placementsLoading, setPlacementsLoading] = useState(false);
  const [markerGroups, setMarkerGroups] = useState<MarkerGroup[]>([]);

  const effectiveMembers = allMembers && allMembers.length > 0 ? allMembers : members;

  useEffect(() => {
    let cancelled = false;
    const membersWithZip = effectiveMembers.filter((member) => member.zipCode?.trim());

    if (membersWithZip.length === 0) {
      setMarkerGroups([]);
      setVisibleMemberIds(new Set());
      return;
    }

    setPlacementsLoading(true);

    computeMemberMapPlacements(
      membersWithZip.map((member) => ({
        id: member.groupMemberId,
        zipCode: member.zipCode,
      })),
    )
      .then((placements) => {
        if (cancelled) return;

        const nextMarkers: MarkerGroup[] = membersWithZip
          .map((member) => {
            const placement = placements.get(member.groupMemberId);
            if (!placement) return null;

            return {
              _id: member.groupMemberId,
              id: toNumericId(member.groupMemberId),
              uuid: member.groupMemberId,
              name: getMemberName(member),
              title: getMemberName(member),
              preview: member.avatarUrl ?? null,
              image_url: member.avatarUrl ?? null,
              group_type: 1,
              group_type_name: member.groupName ?? "Member",
              latitude: placement.latitude,
              longitude: placement.longitude,
              zip_code: placement.zipCode,
              _memberId: member.groupMemberId,
              _groupName: member.groupName,
            } as MarkerGroup;
          })
          .filter(Boolean) as MarkerGroup[];

        setMarkerGroups(nextMarkers);
        setVisibleMemberIds(new Set(nextMarkers.map((marker) => marker._memberId)));
      })
      .finally(() => {
        if (!cancelled) {
          setPlacementsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [effectiveMembers]);

  const mappedMembers = useMemo(() => {
    const markerMemberIds = new Set(markerGroups.map((marker) => marker._memberId));
    return effectiveMembers.filter((member) => markerMemberIds.has(member.groupMemberId));
  }, [markerGroups, effectiveMembers]);

  const visibleMembers = useMemo(() => {
    if (visibleMemberIds.size === 0) return mappedMembers;
    return mappedMembers.filter((member) => visibleMemberIds.has(member.groupMemberId));
  }, [mappedMembers, visibleMemberIds]);

  const selectedMember = useMemo(
    () => mappedMembers.find((member) => member.groupMemberId === selectedMemberId) ?? null,
    [mappedMembers, selectedMemberId],
  );

  const markerByMemberId = useMemo(
    () => new Map(markerGroups.map((marker) => [marker._memberId, marker])),
    [markerGroups],
  );
  const selectedMarkerId = markerByMemberId.get(selectedMemberId ?? "")?.id;

  const handleGroupSelect = useCallback((group: Group | null) => {
    const selected = group as MarkerGroup | null;
    setSelectedMemberId(selected?._memberId ?? null);
  }, []);

  const handleBoundsChange = useCallback((_bounds: MapBounds, visibleGroups: Group[]) => {
    const nextVisibleIds = new Set(
      (visibleGroups as MarkerGroup[]).map((group) => group._memberId),
    );
    setVisibleMemberIds(nextVisibleIds);
  }, []);

  const loadingState = loading || placementsLoading;
  const unmappedCount = effectiveMembers.length - mappedMembers.length;
  const isDesktopWeb = Platform.OS === "web";

  return (
    <View style={styles.container}>
      <View style={styles.summaryRow}>
        <View style={styles.summaryChip}>
          <Ionicons name="location-outline" size={14} color="#475569" />
          <Text style={styles.summaryText}>
            {mappedMembers.length} mapped
            {unmappedCount > 0 ? `, ${unmappedCount} missing ZIP` : ""}
          </Text>
        </View>
        <View style={styles.summaryChip}>
          <Ionicons name="eye-outline" size={14} color="#475569" />
          <Text style={styles.summaryText}>{visibleMembers.length} visible</Text>
        </View>
        {onLoadAll && !allMembers && (
          <TouchableOpacity
            onPress={onLoadAll}
            disabled={isLoadingAll}
            style={[
              styles.summaryChip,
              { backgroundColor: primaryColor, borderColor: primaryColor },
              isLoadingAll && { opacity: 0.6 },
            ]}
          >
            {isLoadingAll ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <Ionicons name="globe-outline" size={14} color="#FFFFFF" />
            )}
            <Text style={[styles.summaryText, { color: "#FFFFFF" }]}>
              {isLoadingAll ? "Loading..." : "Load all ZIP codes"}
            </Text>
          </TouchableOpacity>
        )}
      </View>

      <View style={[styles.contentRow, isDesktopWeb ? styles.contentRowDesktop : null]}>
        <View style={styles.mapColumn}>
          <View style={styles.mapCard}>
            <ExploreMap
              groups={markerGroups}
              selectedGroupId={typeof selectedMarkerId === "number" ? selectedMarkerId : null}
              onGroupSelect={handleGroupSelect}
              onBoundsChange={handleBoundsChange}
              mapboxToken={mapboxToken}
            />
            {loadingState ? (
              <View style={styles.overlayContainer}>
                <ActivityIndicator size="large" color={primaryColor} />
                <Text style={styles.loadingText}>Loading map…</Text>
              </View>
            ) : markerGroups.length === 0 ? (
              <View style={styles.overlayContainer}>
                <Ionicons name="map-outline" size={36} color="#94A3B8" />
                <Text style={styles.emptyText}>{emptyText}</Text>
              </View>
            ) : null}
          </View>

          {!isDesktopWeb && selectedMember ? (
            <Pressable
              style={styles.selectedCard}
              onPress={() => onOpenMember(selectedMember.groupMemberId)}
            >
              <View style={styles.selectedCardText}>
                <Text style={styles.selectedTitle}>{getMemberName(selectedMember)}</Text>
                <Text style={styles.selectedSubtitle}>
                  {selectedMember.groupName
                    ? `${selectedMember.groupName} • ${selectedMember.zipCode ?? ""}`
                    : selectedMember.zipCode ?? ""}
                </Text>
              </View>
              <Ionicons name="arrow-forward-circle" size={22} color={primaryColor} />
            </Pressable>
          ) : null}
        </View>

        <View style={[styles.listCard, isDesktopWeb ? styles.listCardDesktop : null]}>
          <Text style={styles.listTitle}>Visible members</Text>
          {isDesktopWeb && selectedMember ? (
            <Pressable
              style={styles.selectedCard}
              onPress={() => onOpenMember(selectedMember.groupMemberId)}
            >
              <View style={styles.selectedCardText}>
                <Text style={styles.selectedTitle}>{getMemberName(selectedMember)}</Text>
                <Text style={styles.selectedSubtitle}>
                  {selectedMember.groupName
                    ? `${selectedMember.groupName} • ${selectedMember.zipCode ?? ""}`
                    : selectedMember.zipCode ?? ""}
                </Text>
              </View>
              <Ionicons name="arrow-forward-circle" size={22} color={primaryColor} />
            </Pressable>
          ) : null}
          <ScrollView contentContainerStyle={styles.listContent}>
            {visibleMembers.length === 0 ? (
              <Text style={styles.listEmptyText}>Move the map to load members in view.</Text>
            ) : (
              visibleMembers.map((member) => {
                const isSelected = member.groupMemberId === selectedMemberId;
                return (
                  <Pressable
                    key={member.groupMemberId}
                    style={[styles.memberRow, isSelected && styles.memberRowSelected]}
                    onPress={() => setSelectedMemberId(member.groupMemberId)}
                    onLongPress={() => onOpenMember(member.groupMemberId)}
                  >
                    <View style={styles.memberRowText}>
                      <Text style={styles.memberName}>{getMemberName(member)}</Text>
                      <Text style={styles.memberMeta}>
                        {member.groupName ? `${member.groupName} • ` : ""}
                        {member.zipCode ?? ""}
                      </Text>
                    </View>
                    <Pressable
                      style={styles.openButton}
                      onPress={() => onOpenMember(member.groupMemberId)}
                    >
                      <Text style={[styles.openButtonText, { color: primaryColor }]}>Open</Text>
                    </Pressable>
                  </Pressable>
                );
              })
            )}
          </ScrollView>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    gap: 12,
  },
  summaryRow: {
    flexDirection: "row",
    gap: 8,
    flexWrap: "wrap",
  },
  summaryChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#F8FAFC",
    borderWidth: 1,
    borderColor: "#E2E8F0",
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  summaryText: {
    fontSize: 13,
    fontWeight: "500",
    color: "#334155",
  },
  mapCard: {
    flex: 1,
    minHeight: 320,
    borderRadius: 18,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "#E2E8F0",
    backgroundColor: "#FFFFFF",
  },
  contentRow: {
    flex: 1,
    gap: 12,
  },
  contentRowDesktop: {
    flexDirection: "row",
    alignItems: "stretch",
  },
  mapColumn: {
    flex: 1,
    gap: 12,
  },
  overlayContainer: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.85)",
    gap: 12,
    zIndex: 10,
  },
  loadingText: {
    fontSize: 14,
    color: "#64748B",
  },
  emptyContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
    gap: 12,
  },
  emptyText: {
    fontSize: 14,
    color: "#64748B",
    textAlign: "center",
  },
  selectedCard: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 14,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#DBEAFE",
  },
  selectedCardText: {
    flex: 1,
    marginRight: 12,
  },
  selectedTitle: {
    fontSize: 15,
    fontWeight: "600",
    color: "#0F172A",
  },
  selectedSubtitle: {
    marginTop: 2,
    fontSize: 13,
    color: "#64748B",
  },
  listCard: {
    maxHeight: 220,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    backgroundColor: "#FFFFFF",
    overflow: "hidden",
  },
  listCardDesktop: {
    width: 320,
    maxHeight: "100%",
    minHeight: 320,
  },
  listTitle: {
    fontSize: 14,
    fontWeight: "600",
    color: "#0F172A",
    paddingHorizontal: 14,
    paddingTop: 14,
    paddingBottom: 8,
  },
  listContent: {
    paddingHorizontal: 10,
    paddingBottom: 10,
    gap: 8,
  },
  listEmptyText: {
    fontSize: 13,
    color: "#64748B",
    paddingHorizontal: 4,
    paddingBottom: 8,
  },
  memberRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: "#F8FAFC",
  },
  memberRowSelected: {
    backgroundColor: "#EFF6FF",
  },
  memberRowText: {
    flex: 1,
    marginRight: 12,
  },
  memberName: {
    fontSize: 14,
    fontWeight: "600",
    color: "#0F172A",
  },
  memberMeta: {
    marginTop: 2,
    fontSize: 12,
    color: "#64748B",
  },
  openButton: {
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  openButtonText: {
    fontSize: 13,
    fontWeight: "600",
  },
});
