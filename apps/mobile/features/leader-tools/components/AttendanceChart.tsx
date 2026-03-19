import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { format } from "date-fns";
import { useTheme } from "@hooks/useTheme";

interface AttendanceStat {
  date?: string;
  date_of_meeting?: string;
  attendance?: {
    date_of_meeting?: string;
  };
  present_count?: number;
  presentCount?: number;
  id?: number;
}

interface AttendanceChartProps {
  attendanceStats: AttendanceStat[];
}

export function AttendanceChart({ attendanceStats }: AttendanceChartProps) {
  const { colors } = useTheme();
  if (!attendanceStats || attendanceStats.length === 0) {
    return null;
  }

  // Reverse the array so oldest is on the left and newest (most recent) is on the right
  // Backend returns newest first, so we reverse to show chronological order left-to-right
  const sortedStats = [...attendanceStats].reverse();

  const highestAttendance = Math.max(
    ...sortedStats.map((stat) => stat.present_count || stat.presentCount || 0),
    1
  );

  const maxBarHeight = 100;

  return (
    <View style={styles.container}>
      <View style={styles.chartContainer}>
        {sortedStats.map((stat, index) => {
          const presentCount = stat.present_count || stat.presentCount || 0;
          const height = (presentCount / highestAttendance) * maxBarHeight;
          const dateValue =
            stat.date ||
            stat.date_of_meeting ||
            stat.attendance?.date_of_meeting ||
            "";

          let dateStr = "";
          if (dateValue) {
            try {
              const parsedDate = new Date(dateValue);
              if (!isNaN(parsedDate.getTime())) {
                dateStr = format(parsedDate, "MM/dd");
              }
            } catch (error) {
              console.warn("Invalid date value:", dateValue, error);
            }
          }

          return (
            <View key={stat.id || index} style={styles.barContainer}>
              <View style={styles.barWrapper}>
                <View
                  style={[
                    styles.bar,
                    {
                      height: Math.max(height, 20), // Minimum height for visibility
                      backgroundColor: colors.border,
                    },
                  ]}
                >
                  <View style={[styles.barCircle, { backgroundColor: colors.text }]}>
                    <Text style={[styles.barText, { color: colors.textInverse }]}>
                      {stat.present_count || stat.presentCount || 0}
                    </Text>
                  </View>
                </View>
              </View>
              <Text style={[styles.dateText, { color: colors.textSecondary }]}>{dateStr}</Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginTop: 8,
  },
  chartContainer: {
    flexDirection: "row",
    justifyContent: "space-around",
    alignItems: "flex-end",
    height: 120,
    paddingHorizontal: 8,
  },
  barContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "flex-end",
  },
  barWrapper: {
    width: "100%",
    alignItems: "center",
    justifyContent: "flex-end",
    height: 100,
  },
  bar: {
    width: "80%",
    borderTopLeftRadius: 8,
    borderTopRightRadius: 8,
    alignItems: "center",
    justifyContent: "flex-start",
    paddingTop: 4,
    minHeight: 20,
  },
  barCircle: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  barText: {
    fontSize: 10,
    fontWeight: "600",
  },
  dateText: {
    fontSize: 12,
    marginTop: 8,
    textAlign: "center",
  },
});
