import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
} from "react";
import {
  Platform,
  TextInput,
  TextInputProps,
  NativeSyntheticEvent,
  TextInputChangeEventData,
} from "react-native";

export interface ProgrammaticTextInputProps extends TextInputProps {
  /**
   * Minimum length before a programmatic change will be emitted.
   * Defaults to 1 so empty strings are ignored unless explicitly cleared by the user.
   */
  minProgrammaticLength?: number;
  /**
   * Interval used (web only) to detect programmatic changes that do not fire events.
   * Set to 0 to disable polling behaviour.
   */
  programmaticCheckInterval?: number;
  /**
   * Web-specific input event handler
   */
  onInput?: (event: any) => void;
}

function getDomValue(node: any): string {
  if (!node) return "";
  if (typeof node.value === "string") return node.value;
  if (node._lastNativeText) return node._lastNativeText;
  return "";
}

export const ProgrammaticTextInput = forwardRef<
  TextInput,
  ProgrammaticTextInputProps
>(function ProgrammaticTextInput(
  {
    onChange,
    onInput,
    onChangeText,
    value,
    minProgrammaticLength = 1,
    programmaticCheckInterval = 500,
    ...rest
  },
  forwardedRef
) {
  const internalRef = useRef<TextInput>(null);
  const lastEmittedRef = useRef<string | undefined>(undefined);

  useImperativeHandle(forwardedRef, () => internalRef.current as TextInput);

  useEffect(() => {
    lastEmittedRef.current = value as string | undefined;
  }, [value]);

  // Direct user input handler - always emits regardless of minProgrammaticLength
  const handleUserInput = useCallback(
    (text: string) => {
      if (typeof text !== "string") return;
      lastEmittedRef.current = text;
      onChangeText?.(text);
    },
    [onChangeText]
  );

  // Programmatic change handler - respects minProgrammaticLength
  const handleProgrammaticChange = useCallback(
    (text: string) => {
      if (typeof text !== "string") return;
      if (minProgrammaticLength > 0 && text.length < minProgrammaticLength) {
        return;
      }
      if (text === lastEmittedRef.current) {
        return; // Already emitted
      }
      lastEmittedRef.current = text;
      onChangeText?.(text);
    },
    [minProgrammaticLength, onChangeText]
  );

  const handleChange = useCallback(
    (event: NativeSyntheticEvent<TextInputChangeEventData>) => {
      onChange?.(event);
      const text = event?.nativeEvent?.text;
      if (typeof text === "string") {
        handleUserInput(text);
      }
    },
    [handleUserInput, onChange]
  );

  const handleInput = useCallback(
    (event: any) => {
      onInput?.(event);
      const nextValue =
        (event?.target && typeof event.target.value === "string"
          ? event.target.value
          : undefined) ?? event?.nativeEvent?.text;
      if (typeof nextValue === "string") {
        handleUserInput(nextValue);
      }
    },
    [handleUserInput, onInput]
  );

  useEffect(() => {
    if (Platform.OS !== "web") {
      return;
    }

    if (!programmaticCheckInterval || programmaticCheckInterval <= 0) {
      return;
    }

    if (typeof window === "undefined") {
      return;
    }

    const interval = window.setInterval(() => {
      const node: any = internalRef.current;
      const domValue = getDomValue(node);
      const currentValue = typeof value === "string" ? value : "";

      if (
        typeof domValue === "string" &&
        domValue !== currentValue &&
        domValue !== lastEmittedRef.current
      ) {
        handleProgrammaticChange(domValue);
      }
    }, programmaticCheckInterval);

    return () => window.clearInterval(interval);
  }, [handleProgrammaticChange, programmaticCheckInterval, value]);

  return (
    <TextInput
      ref={internalRef}
      value={value}
      onChange={handleChange}
      {...(Platform.OS === "web" ? { onInput: handleInput } : {})}
      onChangeText={handleUserInput}
      {...rest}
    />
  );
});

ProgrammaticTextInput.displayName = "ProgrammaticTextInput";


