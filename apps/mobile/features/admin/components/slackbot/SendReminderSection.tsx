import React, { useCallback, useState } from "react";
import { ActivityIndicator, Text, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useCommunityTheme } from "@hooks/useCommunityTheme";
import { useTheme } from "@hooks/useTheme";
import { URGENCY_LEVELS, urgencyColor } from "./constants";
import { Card, ChipSelect, Section } from "./primitives";
import { styles } from "./styles";

/**
 * Fire a reminder right now instead of waiting for the schedule. Only running
 * campuses are offered: the backend treats an explicit location as a deliberate
 * override and would nag a paused campus.
 */
export function SendReminderSection({
  runningLocations,
  onSend,
}: {
  runningLocations: string[];
  onSend: (location: string, urgency: string) => Promise<unknown>;
}) {
  const { colors } = useTheme();
  const { primaryColor } = useCommunityTheme();
  const [location, setLocation] = useState<string>(runningLocations[0] ?? "");
  const [urgency, setUrgency] = useState<string>("direct");
  const [isSending, setIsSending] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  // A campus paused while this screen is open must not stay selected.
  const effectiveLocation = runningLocations.includes(location)
    ? location
    : (runningLocations[0] ?? null);

  const handleSend = useCallback(async () => {
    if (!effectiveLocation) return;
    setIsSending(true);
    setResult(null);
    try {
      await onSend(effectiveLocation, urgency);
      setResult({ ok: true, message: `Reminder sent to the ${effectiveLocation} thread.` });
    } catch (error) {
      setResult({
        ok: false,
        message: `Failed: ${error instanceof Error ? error.message : "Unknown error"}`,
      });
    } finally {
      setIsSending(false);
    }
  }, [effectiveLocation, urgency, onSend]);

  return (
    <Section title="Send a reminder now" subtitle="Post a follow-up in this week's thread right away">
      <Card>
        {runningLocations.length === 0 ? (
          <Text style={[styles.emptyCardText, { color: colors.textTertiary }]}>
            Every campus is paused.
          </Text>
        ) : (
          <>
            <Text style={[styles.fieldLabel, { color: colors.textTertiary, marginBottom: 8 }]}>Campus</Text>
            <ChipSelect
              small
              options={runningLocations.map((value) => ({ value, label: value }))}
              isSelected={(l) => l === effectiveLocation}
              onPress={setLocation}
            />
            <Text style={[styles.fieldLabel, { color: colors.textTertiary, marginTop: 14, marginBottom: 8 }]}>
              Tone
            </Text>
            <ChipSelect
              small
              options={URGENCY_LEVELS.map((value) => ({ value, label: value }))}
              isSelected={(u) => u === urgency}
              onPress={setUrgency}
              activeColor={(u) => urgencyColor(u, colors)}
            />
            <TouchableOpacity
              style={[
                styles.primaryButton,
                { backgroundColor: primaryColor, marginTop: 16 },
                isSending && { opacity: 0.6 },
              ]}
              onPress={handleSend}
              disabled={isSending}
            >
              {isSending ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <>
                  <Ionicons name="megaphone-outline" size={18} color="#fff" />
                  <Text style={styles.primaryButtonText}>Send reminder</Text>
                </>
              )}
            </TouchableOpacity>
            {result && (
              <Text
                style={[
                  styles.rowDetail,
                  { marginTop: 10, textAlign: "center", color: result.ok ? colors.success : colors.error },
                ]}
              >
                {result.message}
              </Text>
            )}
          </>
        )}
      </Card>
    </Section>
  );
}
