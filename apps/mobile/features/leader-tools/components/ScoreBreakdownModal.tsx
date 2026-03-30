import React from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Pressable,
  Modal,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@hooks/useTheme";

export type ScoreBreakdownData = {
  memberId: string;
  memberName: string;
  scores: Array<{ id: string; name: string; slot: string; value: number }>;
};

type Props = {
  data: ScoreBreakdownData | null;
  onClose: () => void;
};

function getScoreDescription(id: string): string {
  if (id === "sys_togather") {
    return "Measures how well leaders are connecting with this person. Use this to triage who needs outreach \u2014 lower scores mean someone needs attention.";
  }
  if (id === "sys_attendance") {
    return "Percentage of weeks with at least one attendance across all groups in the last 60 days.";
  }
  return "Serving frequency from Planning Center in the past 2 months. 20 points per service, max 100.";
}

function getScoreFormula(id: string): string {
  if (id === "sys_togather") {
    return "Attendance (up to 70 pts):\nBased on the percentage of meeting weeks attended. Only weeks that had meetings count \u2014 weeks with no events don\u2019t count against anyone.\n\nExample: Attended 4 out of 6 weeks = 67% \u2192 attendance portion is 47 out of 70.\n\nFollow-up (fills the rest):\nThe remaining points (up to 100) are filled by the most recent follow-up:\n\u2022 In-person visit \u2192 fills 100% of remaining\n\u2022 Phone call \u2192 fills 75%\n\u2022 Text message \u2192 fills 50%\n\nFollow-ups fade over time. In-person lasts ~100 days, calls ~85 days, texts ~70 days. If someone has zero attendance, follow-ups fade twice as fast.\n\nThe less someone attends, the more follow-up matters. Someone who never attends but had a coffee chat today still scores 100.";
  }
  if (id === "sys_attendance") {
    return "Weeks attended out of total weeks in the last 60 days.\nAdjusted for join date \u2014 new members aren\u2019t penalized for weeks before they joined.";
  }
  return "20 points per service in the past 2 months, up to 100.\nBased on Planning Center serving data.";
}

export function ScoreBreakdownModal({ data, onClose }: Props) {
  const { colors } = useTheme();

  return (
    <Modal
      visible={!!data}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable
        style={[styles.overlay, { backgroundColor: colors.overlay }]}
        onPress={onClose}
      >
        <Pressable
          style={[styles.card, { backgroundColor: colors.modalBackground }]}
          onPress={() => undefined}
        >
          <View style={styles.header}>
            <Text style={[styles.title, { color: colors.text }]}>
              Score Breakdown
            </Text>
            <TouchableOpacity onPress={onClose}>
              <Ionicons name="close" size={22} color={colors.icon} />
            </TouchableOpacity>
          </View>
          <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
            {data?.memberName}
          </Text>

          <ScrollView style={styles.scroll}>
            {data?.scores.map((score) => {
              const scoreColor =
                score.value >= 70
                  ? colors.success
                  : score.value >= 40
                    ? colors.warning
                    : colors.destructive;

              return (
                <View
                  key={score.id}
                  style={[styles.item, { borderColor: colors.borderLight }]}
                >
                  <View style={styles.itemHeader}>
                    <Text style={[styles.scoreName, { color: colors.text }]}>
                      {score.name}
                    </Text>
                    <View
                      style={[styles.badge, { backgroundColor: scoreColor }]}
                    >
                      <Text style={styles.badgeText}>{score.value}%</Text>
                    </View>
                  </View>
                  <Text
                    style={[
                      styles.description,
                      { color: colors.textSecondary },
                    ]}
                  >
                    {getScoreDescription(score.id)}
                  </Text>
                  <View
                    style={[
                      styles.formulaBox,
                      {
                        backgroundColor: colors.surfaceSecondary,
                        borderColor: colors.borderLight,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.formulaLabel,
                        { color: colors.textTertiary },
                      ]}
                    >
                      How it works
                    </Text>
                    <Text style={[styles.formula, { color: colors.text }]}>
                      {getScoreFormula(score.id)}
                    </Text>
                  </View>
                  <View
                    style={[
                      styles.bar,
                      { backgroundColor: colors.borderLight },
                    ]}
                  >
                    <View
                      style={[
                        styles.barFill,
                        {
                          width: `${Math.max(2, score.value)}%`,
                          backgroundColor: scoreColor,
                        },
                      ]}
                    />
                  </View>
                </View>
              );
            })}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  card: {
    borderRadius: 14,
    maxHeight: "80%",
    paddingVertical: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 12,
    elevation: 6,
    width: 440,
    maxWidth: "92%",
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    marginBottom: 2,
  },
  title: {
    fontSize: 16,
    fontWeight: "700",
  },
  subtitle: {
    fontSize: 13,
    paddingHorizontal: 16,
    marginBottom: 8,
  },
  scroll: {
    paddingHorizontal: 16,
    marginTop: 8,
  },
  item: {
    borderBottomWidth: 1,
    paddingBottom: 14,
    marginBottom: 14,
  },
  itemHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 6,
  },
  scoreName: {
    fontSize: 15,
    fontWeight: "700",
  },
  badge: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  badgeText: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "700",
  },
  description: {
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 8,
  },
  formulaBox: {
    borderRadius: 8,
    borderWidth: 1,
    padding: 10,
    marginBottom: 8,
  },
  formulaLabel: {
    fontSize: 10,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  formula: {
    fontSize: 12,
    lineHeight: 18,
  },
  bar: {
    height: 6,
    borderRadius: 3,
    overflow: "hidden",
  },
  barFill: {
    height: "100%",
    borderRadius: 3,
  },
});
