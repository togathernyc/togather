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
}) {
  const { colors } = useTheme();
  const [draft, setDraft] = useState(value);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<string | null>(null);

  // Keep the draft in sync when the upstream value changes and we have no
  // un-flushed local edit (e.g. another device edited the same field).
  useEffect(() => {
    if (pending.current == null) setDraft(value);
  }, [value]);

  const flush = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    const next = pending.current;
    pending.current = null;
    if (next == null || next === value) return;
    void onSave(next);
  }, [onSave, value]);

  const handleChange = useCallback(
    (text: string) => {
      setDraft(text);
      pending.current = text;
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(flush, 600);
    },
    [flush],
  );

  // Flush any pending edit when the cell unmounts (navigation away, reorder).
  const flushRef = useRef(flush);
  flushRef.current = flush;
  useEffect(() => () => flushRef.current(), []);

  return (
    <TextInput
      value={draft}
      onChangeText={handleChange}
      onBlur={flush}
      placeholder={placeholder}
      placeholderTextColor={colors.inputPlaceholder}
      multiline={multiline}
      keyboardType={keyboardType}
      maxLength={maxLength}
      autoFocus={autoFocus}
      accessibilityLabel={accessibilityLabel}
      style={[styles.base, { color: colors.text }, style]}
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
