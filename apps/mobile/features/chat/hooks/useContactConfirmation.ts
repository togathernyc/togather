/**
 * useContactConfirmation
 *
 * AppState-based hook that detects when the user returns to the app after
 * opening a native contact action (call/text/email) and shows a confirmation
 * dialog before logging the action.
 *
 * This prevents accidental logging from mis-taps — the user must confirm
 * they actually completed the action.
 */

import { useRef, useEffect, useCallback } from "react";
import { AppState, Alert, type AppStateStatus } from "react-native";

type ContactType = "call" | "text" | "email";

interface PendingAction {
  type: ContactType;
  contactName: string;
}

const ACTION_LABELS: Record<ContactType, string> = {
  call: "call",
  text: "text",
  email: "email",
};

interface UseContactConfirmationOptions {
  onConfirm: (type: ContactType) => void;
}

export function useContactConfirmation({ onConfirm }: UseContactConfirmationOptions) {
  const pendingAction = useRef<PendingAction | null>(null);
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextState) => {
      // Detect returning to foreground with a pending action
      if (
        appStateRef.current.match(/inactive|background/) &&
        nextState === "active" &&
        pendingAction.current
      ) {
        const { type, contactName } = pendingAction.current;
        pendingAction.current = null;

        Alert.alert(
          `Did you ${ACTION_LABELS[type]} ${contactName}?`,
          "This will be recorded in the follow-up history.",
          [
            {
              text: "No",
              style: "cancel",
            },
            {
              text: "Yes",
              onPress: () => onConfirm(type),
            },
          ]
        );
      }
      appStateRef.current = nextState;
    });

    return () => subscription.remove();
  }, [onConfirm]);

  const setPendingAction = useCallback((type: ContactType, contactName: string) => {
    pendingAction.current = { type, contactName };
  }, []);

  return { setPendingAction };
}
