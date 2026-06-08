/**
 * AvailabilityGridScreen
 *
 * Leader matrix view: every active group member (rows) against the group's
 * upcoming event plans (columns, up to ~10), each cell showing that member's
 * availability — available / can't / no response. Built to scan a large roster
 * (50+) at a glance, primarily on web.
 *
 * UX:
 *  - Frozen header row (events) AND frozen name column, with two-axis scroll —
 *    the name + event labels stay put while you scan. On a wide screen the
 *    whole matrix fits with no horizontal scroll.
 *  - Color + icon per cell (not color alone) so it's legible for everyone.
 *  - Sort by "most available" (default — what you want when filling slots) or
 *    by name; optional "responded only" filter; per-event column tallies.
 *
 * Route: /rostering/[group_id]/availability-grid
 * Backend: scheduling.availability.availabilityMatrix
 */
import React, { useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  TouchableOpacity,
  ActivityIndicator,
  useWindowDimensions,
  type NativeSyntheticEvent,
  type NativeScrollEvent,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@hooks/useTheme";
import { EmptyState } from "@components/ui/EmptyState";
import { useAuthenticatedQuery, api } from "@services/api/convex";
import type { Id } from "@services/api/convex";

type CellStatus = "available" | "unavailable" | "no_response";

type MatrixEvent = {
  _id: Id<"eventPlans">;
  title: string;
  eventDate: number;
  times: Array<{ label: string; startsAt: number }>;
};

type MatrixMember = {
  userId: Id<"users">;
  userName: string;
  isLeader: boolean;
  availableCount: number;
  hasResponded: boolean;
  cells: Record<string, CellStatus>;
};

type Matrix = {
  events: MatrixEvent[];
  members: MatrixMember[];
  eventCounts: Record<
    string,
    { available: number; unavailable: number; noResponse: number }
  >;
  summary: { totalMembers: number; respondedMembers: number };
};

type SortMode = "available" | "name";

function weekday(ms: number): string {
  return new Date(ms).toLocaleDateString("en-US", { weekday: "short" });
}
function monthDay(ms: number): string {
  return new Date(ms).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

export function AvailabilityGridScreen() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { width } = useWindowDimensions();
  const { group_id } = useLocalSearchParams<{ group_id: string }>();
  const groupId = group_id as Id<"groups">;

  const isWide = width >= 700;
  const NAME_W = isWide ? 196 : 150;
  const CELL_W = isWide ? 84 : 76;
  const ROW_H = 52;
  const HEADER_H = 70;

  const data = useAuthenticatedQuery(
    api.functions.scheduling.availability.availabilityMatrix,
    groupId ? { groupId } : "skip",
  ) as Matrix | undefined;

  const [sortMode, setSortMode] = useState<SortMode>("available");
  const [respondedOnly, setRespondedOnly] = useState(false);

  // Synced scroll: the cells area is the only user-scrollable surface; it
  // drives the frozen header (x) and the frozen name column (y).
  const headerScrollRef = useRef<ScrollView>(null);
  const namesScrollRef = useRef<ScrollView>(null);
  const [bodyH, setBodyH] = useState(0);

  const members = useMemo(() => {
    if (!data) return [];
    let rows = data.members;
    if (respondedOnly) rows = rows.filter((m) => m.hasResponded);
    if (sortMode === "name") {
      rows = [...rows].sort((a, b) => a.userName.localeCompare(b.userName));
    }
    // server already returns availableCount-desc, name — keep for "available".
    return rows;
  }, [data, respondedOnly, sortMode]);

  const onCellsHScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    headerScrollRef.current?.scrollTo({
      x: e.nativeEvent.contentOffset.x,
      animated: false,
    });
  };
  const onCellsVScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    namesScrollRef.current?.scrollTo({
      y: e.nativeEvent.contentOffset.y,
      animated: false,
    });
  };

  const renderHeaderBar = () => (
    <View style={[styles.header, { borderBottomColor: colors.border }]}>
      <TouchableOpacity
        onPress={() => router.canGoBack() && router.back()}
        hitSlop={12}
        style={styles.back}
      >
        <Ionicons name="chevron-back" size={28} color={colors.text} />
      </TouchableOpacity>
      <View style={styles.headerTitleWrap}>
        <Text style={[styles.headerTitle, { color: colors.text }]}>
          Availability
        </Text>
        {data && (
          <Text style={[styles.headerSub, { color: colors.textSecondary }]}>
            {data.summary.respondedMembers} of {data.summary.totalMembers}{" "}
            responded
          </Text>
        )}
      </View>
      <View style={styles.back} />
    </View>
  );

  if (data === undefined) {
    return (
      <View style={[styles.container, { backgroundColor: colors.surface, paddingTop: insets.top }]}>
        {renderHeaderBar()}
        <View style={styles.centered}>
          <ActivityIndicator size="small" color={colors.text} />
        </View>
      </View>
    );
  }

  if (data.events.length === 0) {
    return (
      <View style={[styles.container, { backgroundColor: colors.surface, paddingTop: insets.top }]}>
        {renderHeaderBar()}
        <View style={styles.centered}>
          <EmptyState
            icon="calendar-outline"
            title="No upcoming events"
            message="Create event plans, then collect availability to see the grid."
          />
        </View>
      </View>
    );
  }

  const events = data.events;

  return (
    <View
      style={[
        styles.container,
        { backgroundColor: colors.surface, paddingTop: insets.top },
      ]}
    >
      {renderHeaderBar()}

      {/* Controls */}
      <View style={[styles.controls, { borderBottomColor: colors.border }]}>
        <View style={styles.segmented}>
          <SegBtn
            label="Most available"
            active={sortMode === "available"}
            onPress={() => setSortMode("available")}
            colors={colors}
          />
          <SegBtn
            label="Name"
            active={sortMode === "name"}
            onPress={() => setSortMode("name")}
            colors={colors}
          />
        </View>
        <Pressable
          onPress={() => setRespondedOnly((v) => !v)}
          style={[
            styles.filterChip,
            {
              borderColor: respondedOnly ? colors.link : colors.border,
              backgroundColor: respondedOnly ? colors.link + "18" : "transparent",
            },
          ]}
        >
          <Ionicons
            name={respondedOnly ? "checkbox" : "square-outline"}
            size={15}
            color={respondedOnly ? colors.link : colors.textSecondary}
          />
          <Text
            style={[
              styles.filterChipText,
              { color: respondedOnly ? colors.link : colors.textSecondary },
            ]}
          >
            Responded only
          </Text>
        </Pressable>
      </View>

      {/* Legend */}
      <View style={styles.legend}>
        <LegendItem icon="checkmark" color={colors.success} label="Available" />
        <LegendItem icon="close" color={colors.destructive} label="Can't" />
        <LegendItem icon="remove" color={colors.textTertiary} label="No response" />
      </View>

      {/* ===== Matrix ===== */}
      {/* Frozen header row */}
      <View style={[styles.matrixHeaderRow, { borderBottomColor: colors.border }]}>
        <View
          style={[
            styles.corner,
            { width: NAME_W, height: HEADER_H, backgroundColor: colors.surface },
          ]}
        >
          <Text style={[styles.cornerText, { color: colors.textSecondary }]}>
            {members.length} {members.length === 1 ? "person" : "people"}
          </Text>
        </View>
        <ScrollView
          ref={headerScrollRef}
          horizontal
          scrollEnabled={false}
          showsHorizontalScrollIndicator={false}
        >
          <View style={styles.row}>
            {events.map((ev) => {
              const c = data.eventCounts[ev._id];
              return (
                <View
                  key={ev._id}
                  style={[
                    styles.headerCell,
                    { width: CELL_W, height: HEADER_H, borderLeftColor: colors.border },
                  ]}
                >
                  <Text
                    style={[styles.headerCellTitle, { color: colors.textSecondary }]}
                    numberOfLines={1}
                  >
                    {ev.title}
                  </Text>
                  <Text style={[styles.headerCellWk, { color: colors.textSecondary }]}>
                    {weekday(ev.eventDate)}
                  </Text>
                  <Text style={[styles.headerCellDate, { color: colors.text }]}>
                    {monthDay(ev.eventDate)}
                  </Text>
                  <View style={styles.headerCellTally}>
                    <Ionicons name="checkmark" size={11} color={colors.success} />
                    <Text style={[styles.headerCellTallyText, { color: colors.success }]}>
                      {c?.available ?? 0}
                    </Text>
                  </View>
                </View>
              );
            })}
          </View>
        </ScrollView>
      </View>

      {/* Body: frozen name column + scrollable cells */}
      <View
        style={styles.matrixBody}
        onLayout={(e) => setBodyH(e.nativeEvent.layout.height)}
      >
        {members.length === 0 ? (
          <View style={styles.centered}>
            <Text style={{ color: colors.textSecondary }}>
              No one to show.
            </Text>
          </View>
        ) : (
          <>
            {/* Frozen names column (driven vertically by the cells scroll) */}
            <ScrollView
              ref={namesScrollRef}
              scrollEnabled={false}
              showsVerticalScrollIndicator={false}
              style={{ width: NAME_W }}
            >
              {members.map((m, i) => (
                <View
                  key={m.userId}
                  style={[
                    styles.nameCell,
                    {
                      width: NAME_W,
                      height: ROW_H,
                      backgroundColor:
                        i % 2 === 0 ? colors.surface : colors.surfaceSecondary,
                      borderBottomColor: colors.border,
                    },
                  ]}
                >
                  <View style={styles.nameTextWrap}>
                    <Text
                      style={[styles.nameText, { color: colors.text }]}
                      numberOfLines={1}
                    >
                      {m.userName}
                    </Text>
                    {m.isLeader && (
                      <Text style={[styles.leaderTag, { color: colors.textTertiary }]}>
                        Leader
                      </Text>
                    )}
                  </View>
                  <Text style={[styles.nameCount, { color: colors.textSecondary }]}>
                    {m.availableCount}/{events.length}
                  </Text>
                </View>
              ))}
            </ScrollView>

            {/* Scrollable cells (the one surface the user scrolls) */}
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator
              onScroll={onCellsHScroll}
              scrollEventThrottle={16}
            >
              <ScrollView
                style={{ height: bodyH }}
                showsVerticalScrollIndicator
                onScroll={onCellsVScroll}
                scrollEventThrottle={16}
              >
                {members.map((m, i) => (
                  <View key={m.userId} style={styles.row}>
                    {events.map((ev) => (
                      <Cell
                        key={ev._id}
                        status={m.cells[ev._id] ?? "no_response"}
                        width={CELL_W}
                        height={ROW_H}
                        striped={i % 2 !== 0}
                        colors={colors}
                      />
                    ))}
                  </View>
                ))}
              </ScrollView>
            </ScrollView>
          </>
        )}
      </View>
    </View>
  );
}

function Cell({
  status,
  width,
  height,
  striped,
  colors,
}: {
  status: CellStatus;
  width: number;
  height: number;
  striped: boolean;
  colors: ReturnType<typeof useTheme>["colors"];
}) {
  const base = striped ? colors.surfaceSecondary : colors.surface;
  let bg = base;
  let icon: keyof typeof Ionicons.glyphMap = "remove";
  let tint = colors.textTertiary;
  if (status === "available") {
    bg = colors.success + "22";
    icon = "checkmark";
    tint = colors.success;
  } else if (status === "unavailable") {
    bg = colors.destructive + "22";
    icon = "close";
    tint = colors.destructive;
  }
  return (
    <View
      style={[
        styles.cell,
        { width, height, backgroundColor: bg, borderColor: colors.border },
      ]}
    >
      <Ionicons name={icon} size={status === "no_response" ? 12 : 16} color={tint} />
    </View>
  );
}

function SegBtn({
  label,
  active,
  onPress,
  colors,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  colors: ReturnType<typeof useTheme>["colors"];
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.segBtn,
        {
          backgroundColor: active ? colors.surface : "transparent",
        },
        active && styles.segBtnActive,
      ]}
    >
      <Text
        style={[
          styles.segBtnText,
          { color: active ? colors.text : colors.textSecondary },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function LegendItem({
  icon,
  color,
  label,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
  label: string;
}) {
  const { colors } = useTheme();
  return (
    <View style={styles.legendItem}>
      <Ionicons name={icon} size={13} color={color} />
      <Text style={[styles.legendText, { color: colors.textSecondary }]}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  back: { width: 36, padding: 4 },
  headerTitleWrap: { flex: 1, alignItems: "center" },
  headerTitle: { fontSize: 17, fontWeight: "600" },
  headerSub: { fontSize: 12, marginTop: 1 },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  controls: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  segmented: {
    flexDirection: "row",
    borderRadius: 9,
    padding: 2,
    backgroundColor: "rgba(120,120,128,0.12)",
  },
  segBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 7 },
  segBtnActive: {
    shadowColor: "#000",
    shadowOpacity: 0.12,
    shadowRadius: 2,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  segBtnText: { fontSize: 13, fontWeight: "600" },
  filterChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
  },
  filterChipText: { fontSize: 12, fontWeight: "600" },
  legend: {
    flexDirection: "row",
    gap: 16,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 4 },
  legendText: { fontSize: 11 },
  matrixHeaderRow: {
    flexDirection: "row",
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  corner: { justifyContent: "flex-end", paddingHorizontal: 12, paddingBottom: 8 },
  cornerText: { fontSize: 12, fontWeight: "600" },
  row: { flexDirection: "row" },
  headerCell: {
    alignItems: "center",
    justifyContent: "flex-end",
    paddingBottom: 6,
    paddingHorizontal: 2,
    borderLeftWidth: StyleSheet.hairlineWidth,
    gap: 1,
  },
  headerCellTitle: { fontSize: 9, maxWidth: "100%" },
  headerCellWk: { fontSize: 10 },
  headerCellDate: { fontSize: 13, fontWeight: "700" },
  headerCellTally: { flexDirection: "row", alignItems: "center", gap: 2, marginTop: 1 },
  headerCellTallyText: { fontSize: 11, fontWeight: "700" },
  matrixBody: { flex: 1, flexDirection: "row" },
  nameCell: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 6,
  },
  nameTextWrap: { flex: 1, minWidth: 0 },
  nameText: { fontSize: 14, fontWeight: "500" },
  leaderTag: { fontSize: 10, marginTop: 1 },
  nameCount: { fontSize: 12, fontWeight: "600" },
  cell: {
    alignItems: "center",
    justifyContent: "center",
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
});
