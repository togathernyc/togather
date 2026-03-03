import React from "react";
import { render, act, waitFor, fireEvent } from "@testing-library/react-native";

import { ProgrammaticTextInput } from "@components/ui/ProgrammaticTextInput";

describe("ProgrammaticTextInput", () => {
  it("propagates programmatic changes triggered via input events", async () => {
    const changes: string[] = [];

    function Wrapper() {
      const [value, setValue] = React.useState("");

      const handleChange = React.useCallback((text: string) => {
        changes.push(text);
        setValue(text);
      }, []);

      return (
        <ProgrammaticTextInput
          testID="programmatic-input"
          placeholder="Programmatic"
          value={value}
          onChangeText={handleChange}
          programmaticCheckInterval={0}
          autoCapitalize="none"
        />
      );
    }

    const { getByTestId } = render(<Wrapper />);
    const input = getByTestId("programmatic-input");

    // Use changeText which works on all platforms
    act(() => {
      fireEvent.changeText(input, "Programmatic value");
    });

    await waitFor(
      () => {
        expect(changes).toContain("Programmatic value");
      },
      { timeout: 2000 }
    );

    await waitFor(() => {
      expect(getByTestId("programmatic-input").props.value).toBe(
        "Programmatic value"
      );
    });
  });

  it("handles native onChange events consistently", async () => {
    const changes: string[] = [];

    function Wrapper() {
      const [value, setValue] = React.useState("");

      const handleChange = (text: string) => {
        changes.push(text);
        setValue(text);
      };

      return (
        <ProgrammaticTextInput
          testID="native-input"
          placeholder="Native"
          value={value}
          onChangeText={handleChange}
          programmaticCheckInterval={0}
        />
      );
    }

    const { getByTestId } = render(<Wrapper />);
    const input = getByTestId("native-input");

    act(() => {
      input.props.onChange?.({ nativeEvent: { text: "Native event" } });
    });

    await waitFor(() => {
      expect(changes).toContain("Native event");
    });

    await waitFor(() => {
      expect(getByTestId("native-input").props.value).toBe("Native event");
    });
  });
});
