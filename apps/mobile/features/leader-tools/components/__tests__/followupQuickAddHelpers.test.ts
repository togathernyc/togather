import {
  buildQuickAddCustomFieldValues,
  validateQuickAddRequiredFields,
} from "../followupQuickAddHelpers";

describe("validateQuickAddRequiredFields", () => {
  it("returns missing required labels", () => {
    expect(validateQuickAddRequiredFields(" ", "")).toEqual([
      "first name",
      "phone number",
    ]);
  });

  it("returns empty when required values are present", () => {
    expect(validateQuickAddRequiredFields("Ada", "202-555-0101")).toEqual([]);
  });
});

describe("buildQuickAddCustomFieldValues", () => {
  const customFields = [
    { slot: "customText1", name: "Neighborhood", type: "text" as const },
    { slot: "customNum1", name: "Volunteer Level", type: "number" as const },
    { slot: "customBool1", name: "Wants Prayer", type: "boolean" as const },
    { slot: "customText2", name: "Contact Preference", type: "dropdown" as const },
    { slot: "customText3", name: "Interests", type: "multiselect" as const },
  ];

  it("builds canonical custom field string values", () => {
    const payload = buildQuickAddCustomFieldValues(customFields, {
      customText1: " South ",
      customNum1: " 3 ",
      customBool1: true,
      customText2: "Email",
      customText3: ["Music", " Tech ", ""],
    });

    expect(payload).toEqual({
      customText1: "South",
      customNum1: "3",
      customBool1: "true",
      customText2: "Email",
      customText3: "Music; Tech",
    });
  });

  it("omits empty / unset custom values", () => {
    const payload = buildQuickAddCustomFieldValues(customFields, {
      customText1: "   ",
      customText2: "",
      customText3: [],
    });

    expect(payload).toBeUndefined();
  });
});
