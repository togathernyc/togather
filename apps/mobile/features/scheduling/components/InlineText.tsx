/**
 * InlineText
 *
 * A spreadsheet-style inline-editable text cell (ADR-026 run sheet). Edits save
 * automatically with the same debounce + blur-flush + unmount-flush + no-op
 * guard the `EventEditorScreen` title field uses, so a row's title / duration /
 * description / song key can be edited in place without a modal.
 *
 * `format`/`parse` let a cell present a number (e.g. minutes) while saving the
 * canonical value; pass them for numeric cells.
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  TextInput,
  StyleSheet,
  type StyleProp,
  type TextStyle,
  type KeyboardTypeOptions,
} from "react-native";
import { useTheme } from "@hooks/useTheme";

export function InlineText({
  value,
  onSave,
  placeholder,
  style,
  multiline,
  keyboardType,
  maxLength,
  autoFocus,
  accessibilityLabel,
  required,
  borderless,
}: {
  value: string;
  onSave: (text: string) => void | Promise<void>;
  placeholder?: string;
  style?: StyleProp<TextStyle>;
  multiline?: boolean;
  keyboardType?: KeyboardTypeOptions;
  maxLength?: number;
  autoFocus?: boolean;
  accessibilityLabel?: string;
  /**
   * When true, an empty (whitespace-only) value is never persisted — the
   * backend rejects it (e.g. a run sheet item title). While the user is
   * mid-edit we leave the field empty so they can retype; on blur/unmount
   * we snap back to the last saved value instead of saving "".
   */
  required?: boolean;
  /**
   * Opt-in "reads as text" look (run-sheet numeric cells): the field is
   * borderless with a transparent background at rest and only reveals a subtle
   * border + faint fill on focus. Off by default so every other caller keeps
   * its own bordered styling untouched.
   */
  borderless?: boolean;
}) {
  const { colors } = useTheme();
  const [draft, setDraft] = useState(value);
  const [focused, setFocused] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<string | null>(null);

  // Keep the draft in sync when the upstream value changes and we have no
  // un-flushed local edit (e.g. another device edited the same field).
  useEffect(() => {
    if (pending.current == null) setDraft(value);
  }, [value]);

  const flush = useCallback(
    (revertIfEmpty = false) => {
      if (timer.current) {
        clearTimeout(timer.current);
        timer.current = null;
      }
      const next = pending.current;
      if (next == null || next === value) {
        pending.current = null;
        return;
      }
      if (required && next.trim() === "") {
        // Never persist an empty required cell. On blur/unmount, snap the
        // field back to the last saved value so the row keeps its title.
        // During typing (debounced flush) keep the empty edit *pending* — if
        // we cleared it here, a later blur would see nothing to revert and
        // leave the field showing an unsaved blank.
        if (revertIfEmpty) {
          pending.current = null;
          setDraft(value);
        }
        return;
      }
      pending.current = null;
      void onSave(next);
    },
    [onSave, value, required],
  );

  const handleChange = useCallback(
    (text: string) => {
      setDraft(text);
      pending.current = text;
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => flush(false), 600);
    },
    [flush],
  );

  // Flush any pending edit when the cell unmounts (navigation away, reorder).
  const flushRef = useRef(flush);
  flushRef.current = flush;
  useEffect(() => () => flushRef.current(), []);

  // Text-like resting state that only shows its frame on focus. Applied LAST so
  // it wins over the caller's `style`, but only when `borderless` is opted in.
  const borderlessStyle: TextStyle | null = borderless
    ? {
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: focused ? colors.border : "transparent",
        backgroundColor: focused ? colors.surfaceSecondary : "transparent",
      }
    : null;

  return (
    <TextInput
      value={draft}
      onChangeText={handleChange}
      onFocus={() => setFocused(true)}
      onBlur={() => {
        setFocused(false);
        flush(true);
      }}
      placeholder={placeholder}
      placeholderTextColor={colors.inputPlaceholder}
      multiline={multiline}
      keyboardType={keyboardType}
      maxLength={maxLength}
      autoFocus={autoFocus}
      accessibilityLabel={accessibilityLabel}
      style={[styles.base, { color: colors.text }, style, borderlessStyle]}
    />
  );
}

const styles = StyleSheet.create({
  base: {
    paddingVertical: 2,
    paddingHorizontal: 0,
    fontSize: 15,
  },
});
