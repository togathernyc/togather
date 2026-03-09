import { normalizeSubtitleVariableIds } from "../followupShared";

describe("normalizeSubtitleVariableIds", () => {
  it("trims, filters unknown ids, and preserves valid order", () => {
    const result = normalizeSubtitleVariableIds(
      " missed_count, unknown_key,last_attended , consecutive_missed "
    );

    expect(result).toEqual(["missed_count", "last_attended", "consecutive_missed"]);
  });

  it("deduplicates repeated variables", () => {
    const result = normalizeSubtitleVariableIds(
      "last_followup,last_followup, last_followup ,missed_count,missed_count"
    );

    expect(result).toEqual(["last_followup", "missed_count"]);
  });

  it("returns empty array for blank values", () => {
    expect(normalizeSubtitleVariableIds(" , , ")).toEqual([]);
    expect(normalizeSubtitleVariableIds(undefined)).toEqual([]);
  });
});
