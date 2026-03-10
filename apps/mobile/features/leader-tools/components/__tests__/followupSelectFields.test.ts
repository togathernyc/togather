import {
  buildSelectOptionsBySlot,
  parseMultiSelectValues,
  serializeMultiSelectValues,
  toggleMultiSelectValue,
} from "../followupSelectFields";

describe("followupSelectFields", () => {
  it("parses semicolon values with trimming and dedupe", () => {
    expect(parseMultiSelectValues("Call; Text ;Call;  ; In-Person")).toEqual([
      "Call",
      "Text",
      "In-Person",
    ]);
  });

  it("serializes selected values with a stable delimiter", () => {
    expect(serializeMultiSelectValues(["Call", "Text"])).toBe("Call; Text");
    expect(serializeMultiSelectValues([])).toBeUndefined();
  });

  it("toggles a multi-select option on and off", () => {
    expect(toggleMultiSelectValue("Call; Text", "Email")).toBe("Call; Text; Email");
    expect(toggleMultiSelectValue("Call; Text", "Text")).toBe("Call");
    expect(toggleMultiSelectValue("Call", "Call")).toBeUndefined();
  });

  it("prefers configured options and infers when options are missing", () => {
    const optionsBySlot = buildSelectOptionsBySlot(
      [
        { slot: "customText1", type: "multiselect", options: ["A", " B ", "A"] },
        { slot: "customText2", type: "multiselect" },
        { slot: "customText3", type: "dropdown" },
      ],
      [
        { customText1: "ignored", customText2: "Call; Text", customText3: "Morning" },
        { customText2: "Text; Email", customText3: " Evening " },
      ]
    );

    expect(optionsBySlot.get("customText1")).toEqual(["A", "B"]);
    expect(optionsBySlot.get("customText2")).toEqual(["Call", "Text", "Email"]);
    expect(optionsBySlot.get("customText3")).toEqual(["Morning", "Evening"]);
  });
});
