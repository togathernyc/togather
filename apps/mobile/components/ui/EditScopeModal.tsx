import { Alert, Platform, ActionSheetIOS } from "react-native";

export type EditScope = "this_only" | "this_date_all_groups" | "all_in_series";

interface EditScopeOptions {
  isCommunityWide: boolean;
  isInSeries: boolean;
  actionLabel?: string; // "Edit" or "Cancel"
  onSelect: (scope: EditScope) => void;
  onCancel?: () => void;
}

/**
 * Show a scope selection prompt for editing/cancelling series or community-wide events.
 * Uses ActionSheetIOS on iOS, Alert on Android.
 */
export function showEditScopePrompt({
  isCommunityWide,
  isInSeries,
  actionLabel = "Edit",
  onSelect,
  onCancel,
}: EditScopeOptions) {
  const options: { label: string; scope: EditScope }[] = [
    { label: "This event only", scope: "this_only" },
  ];

  if (isCommunityWide) {
    options.push({
      label: "All groups on this date",
      scope: "this_date_all_groups",
    });
  }

  if (isInSeries) {
    options.push({
      label: "All events in this series",
      scope: "all_in_series",
    });
  }

  if (Platform.OS === "ios") {
    const labels = [...options.map((o) => o.label), "Cancel"];
    ActionSheetIOS.showActionSheetWithOptions(
      {
        title: `${actionLabel} which events?`,
        options: labels,
        cancelButtonIndex: labels.length - 1,
        destructiveButtonIndex: actionLabel === "Cancel" ? options.length - 1 : undefined,
      },
      (buttonIndex) => {
        if (buttonIndex < options.length) {
          onSelect(options[buttonIndex].scope);
        } else {
          onCancel?.();
        }
      }
    );
  } else {
    Alert.alert(
      `${actionLabel} which events?`,
      undefined,
      [
        ...options.map((o) => ({
          text: o.label,
          onPress: () => onSelect(o.scope),
        })),
        { text: "Cancel", style: "cancel" as const, onPress: onCancel },
      ]
    );
  }
}
