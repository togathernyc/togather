/**
 * EditScopeModal
 *
 * Asks which events an edit or cancel should apply to (this one, all groups on
 * this date, or the whole series).
 *
 * This used to be an imperative `ActionSheetIOS` / `Alert.alert` prompt. Both
 * are unreliable here: `Alert.alert` is a no-op on React Native Web, and the
 * native action sheet is presented from the root view controller while every
 * `(user)` screen — including Edit Event — is itself inside a `presentation:
 * "modal"` stack. When the sheet fails to appear the caller is left waiting on
 * a callback that never fires, so "Save Changes" silently does nothing forever.
 *
 * Rendering the picker in the React tree removes that whole failure class, and
 * matches `ActionMenuSheet`'s existing role as the in-app replacement for
 * iOS-only action sheets. Callers own the `visible` state.
 */
import React from "react";
import { ActionMenuSheet, type MenuAction } from "./ActionMenuSheet";

export type EditScope = "this_only" | "this_date_all_groups" | "all_in_series";

interface EditScopeModalProps {
  visible: boolean;
  isCommunityWide: boolean;
  isInSeries: boolean;
  /** "Edit" or "Cancel" — used for the title and destructive styling. */
  actionLabel?: string;
  onSelect: (scope: EditScope) => void;
  onCancel: () => void;
}

export function EditScopeModal({
  visible,
  isCommunityWide,
  isInSeries,
  actionLabel = "Edit",
  onSelect,
  onCancel,
}: EditScopeModalProps) {
  const isCancelAction = actionLabel === "Cancel";

  const actions: MenuAction[] = [
    {
      label: "This event only",
      onPress: () => onSelect("this_only"),
      destructive: isCancelAction,
    },
  ];

  if (isCommunityWide) {
    actions.push({
      label: "All groups on this date",
      onPress: () => onSelect("this_date_all_groups"),
      destructive: isCancelAction,
    });
  }

  if (isInSeries) {
    actions.push({
      label: "All events in this series",
      onPress: () => onSelect("all_in_series"),
      destructive: isCancelAction,
    });
  }

  return (
    <ActionMenuSheet
      visible={visible}
      title={`${actionLabel} which events?`}
      actions={actions}
      onClose={onCancel}
    />
  );
}
