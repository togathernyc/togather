import React, { useEffect, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  Modal,
  TouchableWithoutFeedback,
  Animated,
  Platform,
  Dimensions,
} from "react-native";
import { format, parseISO } from "date-fns";
import { Button } from "@components/ui";
import { Group, RSVPStatus } from "../types";
import { useCommunityTheme } from "@hooks/useCommunityTheme";

const { height: SCREEN_HEIGHT } = Dimensions.get("window");

interface RSVPModalProps {
  visible: boolean;
  group: Group | null;
  currentRSVP: RSVPStatus;
  onClose: () => void;
  onRSVP: (mode: number) => void;
  isPending?: boolean;
}

export function RSVPModal({
  visible,
  group,
  currentRSVP,
  onClose,
  onRSVP,
  isPending = false,
}: RSVPModalProps) {
  const { primaryColor } = useCommunityTheme();
  const slideAnim = useRef(new Animated.Value(SCREEN_HEIGHT)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      // Reset animation values when opening
      slideAnim.setValue(SCREEN_HEIGHT);
      fadeAnim.setValue(0);

      Animated.parallel([
        Animated.timing(slideAnim, {
          toValue: 0,
          duration: 300,
          useNativeDriver: true,
        }),
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: 300,
          useNativeDriver: true,
        }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(slideAnim, {
          toValue: SCREEN_HEIGHT,
          duration: 300,
          useNativeDriver: true,
        }),
        Animated.timing(fadeAnim, {
          toValue: 0,
          duration: 300,
          useNativeDriver: true,
        }),
      ]).start();
    }
  }, [visible, slideAnim, fadeAnim]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <TouchableWithoutFeedback onPress={onClose}>
          <Animated.View style={[styles.backdrop, { opacity: fadeAnim }]} />
        </TouchableWithoutFeedback>
        <Animated.View
          style={[
            styles.bottomSheet,
            {
              transform: [{ translateY: slideAnim }],
            },
          ]}
        >
          <View style={styles.handle} />
          <View style={styles.rsvpModalContent}>
            {group?.title || group?.name ? (
              <Text style={styles.rsvpTitle}>{group.title || group.name}</Text>
            ) : null}
            {(() => {
              const meetingDate = group?.date || group?.next_meeting_date;
              if (!meetingDate) return null;

              try {
                const formattedDate = format(
                  parseISO(meetingDate),
                  "EEE, MMM d 'at' h:mm a"
                );
                return (
                  <View style={styles.rsvpDateContainer}>
                    <Text style={styles.rsvpDateText}>{formattedDate}</Text>
                  </View>
                );
              } catch (error) {
                // If date parsing fails, try to display the raw date
                return (
                  <View style={styles.rsvpDateContainer}>
                    <Text style={styles.rsvpDateText}>{meetingDate}</Text>
                  </View>
                );
              }
            })()}

            <View style={styles.rsvpButtonsContainer}>
              <Button
                onPress={() => onRSVP(1)}
                disabled={isPending}
                style={[styles.rsvpModalButton, { backgroundColor: primaryColor }]}
                textStyle={styles.rsvpButtonTextGoing}
              >
                I'll Be There
              </Button>

              <Button
                onPress={() => onRSVP(0)}
                disabled={isPending}
                variant="secondary"
                style={[styles.rsvpModalButton, styles.rsvpButtonNotGoing]}
                textStyle={styles.rsvpButtonTextNotGoing}
              >
                Not Going
              </Button>
            </View>

            {isPending && (
              <View style={styles.rsvpLoaderContainer}>
                <ActivityIndicator size="small" />
              </View>
            )}
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: "flex-end",
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
  },
  bottomSheet: {
    backgroundColor: "#fff",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingTop: 12,
    paddingBottom: Platform.OS === "ios" ? 34 : 24,
    paddingHorizontal: 24,
    maxHeight: "80%",
    ...Platform.select({
      ios: {
        shadowColor: "#000",
        shadowOffset: { width: 0, height: -2 },
        shadowOpacity: 0.1,
        shadowRadius: 8,
      },
      android: {
        elevation: 8,
      },
    }),
  },
  handle: {
    width: 40,
    height: 4,
    backgroundColor: "#D1D1D6",
    borderRadius: 2,
    alignSelf: "center",
    marginBottom: 20,
  },
  rsvpModalContent: {
    alignItems: "center",
  },
  rsvpTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: "#333",
    marginBottom: 12,
    textAlign: "center",
  },
  rsvpDateContainer: {
    marginBottom: 24,
  },
  rsvpDateText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#333",
  },
  rsvpButtonsContainer: {
    width: "100%",
    gap: 12,
  },
  rsvpModalButton: {
    width: "100%",
    shadowColor: "transparent",
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0,
    shadowRadius: 0,
    elevation: 0,
    ...Platform.select({
      web: {
        boxShadow: "none",
      },
    }),
  },
  rsvpButtonNotGoing: {
    backgroundColor: "#E0E0E0",
  },
  rsvpButtonTextGoing: {
    color: "#fff",
  },
  rsvpButtonTextNotGoing: {
    color: "#333",
  },
  rsvpLoaderContainer: {
    marginTop: 16,
  },
});
