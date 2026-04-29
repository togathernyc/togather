/**
 * UpcomingEventsSection
 *
 * Horizontal scroll list of upcoming events for a group on the group page.
 * Sits between MEMBERS and CHANNELS. Mirrors the card aesthetic of
 * EventsList.tsx (leader-tools) but stripped down to "future events only,
 * tap to open the event."
 *
 * Hidden when there are no upcoming events so we don't render an empty band.
 */
import React from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
} from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { format, isToday, isTomorrow } from "date-fns";
import { useQuery, api } from "@services/api/convex";
import type { Id } from "@services/api/convex";
import { useTheme } from "@hooks/useTheme";
import { AppImage } from "@components/ui";

interface Props {
  groupId: string;
}

export function UpcomingEventsSection({ groupId }: Props) {
  const router = useRouter();
  const { colors } = useTheme();

  const meetingsData = useQuery(
    api.functions.meetings.index.listByGroup,
    groupId
      ? {
          groupId: groupId as Id<"groups">,
          includeCompleted: false,
          includeCancelled: false,
        }
      : "skip",
  );

  if (meetingsData === undefined) return null;

  const now = Date.now();
  const upcoming = (meetingsData ?? [])
    .filter((m: any) => typeof m.scheduledAt === "number" && m.scheduledAt >= now)
    .sort((a: any, b: any) => a.scheduledAt - b.scheduledAt)
    .slice(0, 12);

  if (upcoming.length === 0) return null;

  return (
    <View style={styles.section}>
      <Text style={[styles.header, { color: colors.textSecondary }]}>
        UPCOMING EVENTS
      </Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        {upcoming.map((event: any) => {
          const date = new Date(event.scheduledAt);
          const dateLabel = isToday(date)
            ? `Today · ${format(date, "h:mm a")}`
            : isTomorrow(date)
              ? `Tomorrow · ${format(date, "h:mm a")}`
              : format(date, "EEE, MMM d · h:mm a");
          return (
            <Pressable
              key={event._id}
              onPress={() => router.push(`/events/${event._id}` as any)}
              style={({ pressed }) => [
                styles.card,
                {
                  backgroundColor: colors.surfaceSecondary,
                  borderColor: colors.border,
                },
                pressed && { opacity: 0.85 },
              ]}
            >
              {event.coverImage ? (
                <AppImage
                  source={event.coverImage}
                  style={styles.cardImage}
                  optimizedWidth={400}
                />
              ) : (
                <View
                  style={[
                    styles.cardImagePlaceholder,
                    { backgroundColor: colors.border },
                  ]}
                >
                  <Ionicons
                    name="calendar-outline"
                    size={28}
                    color={colors.textTertiary}
                  />
                </View>
              )}
              <View style={styles.cardBody}>
                <Text
                  style={[styles.cardTitle, { color: colors.text }]}
                  numberOfLines={2}
                >
                  {event.title || "Event"}
                </Text>
                <Text
                  style={[styles.cardDate, { color: colors.textSecondary }]}
                  numberOfLines={1}
                >
                  {dateLabel}
                </Text>
              </View>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    marginTop: 24,
    gap: 8,
  },
  header: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.6,
    paddingHorizontal: 16,
  },
  scrollContent: {
    paddingHorizontal: 12,
    gap: 12,
  },
  card: {
    width: 200,
    borderRadius: 12,
    overflow: "hidden",
    borderWidth: StyleSheet.hairlineWidth,
  },
  cardImage: {
    width: "100%",
    height: 110,
  },
  cardImagePlaceholder: {
    width: "100%",
    height: 110,
    alignItems: "center",
    justifyContent: "center",
  },
  cardBody: {
    padding: 12,
    gap: 4,
  },
  cardTitle: {
    fontSize: 14,
    fontWeight: "600",
    lineHeight: 18,
  },
  cardDate: {
    fontSize: 12,
  },
});
