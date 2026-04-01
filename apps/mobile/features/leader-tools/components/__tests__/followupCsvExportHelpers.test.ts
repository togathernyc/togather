import {
  cellValueForColumn,
  generateFollowupPeopleCsv,
  headerLabelForColumn,
} from "../followupCsvExportHelpers";
import type { CustomFieldDef } from "../ColumnPickerModal";
import type { LeaderInfo } from "../followupGridHelpers";

describe("followupCsvExportHelpers", () => {
  const leaderMap = new Map<string, LeaderInfo>([
    ["u1", { firstName: "Ada", lastName: "Lovelace" }],
  ]);

  const customFields: CustomFieldDef[] = [
    { slot: "customText1", name: "Dept", type: "text" },
    { slot: "customBool1", name: "VIP", type: "boolean" },
    { slot: "customText2", name: "Tags", type: "multiselect" },
  ];

  const baseMember = {
    userId: "user-a",
    groupMemberId: "gm-a",
    firstName: "Bob",
    lastName: "Smith",
    email: "bob@example.com",
    phone: "+15551234",
    zipCode: "10001",
    score1: 10,
    score2: 20,
    score3: 30,
    status: "green",
    assigneeIds: ["u1"],
    addedAt: 1_736_942_400_000,
    lastFollowupAt: 1_736_942_400_000,
    latestNote: 'He said "hello"',
    alerts: ["a", "b"],
    customText1: "Eng",
    customBool1: true,
    customText2: "alpha; beta",
  };

  it("headerLabelForColumn uses system score names", () => {
    expect(headerLabelForColumn("score1", {})).toBe("Service");
    expect(headerLabelForColumn("score2", {})).toBe("Attendance");
    expect(headerLabelForColumn("score3", {})).toBe("Connection");
  });

  it("cellValueForColumn formats assignees and multiselect", () => {
    expect(
      cellValueForColumn("assignee", baseMember, {
        leaderMap,
        tasksByMember: new Map(),
        customFields,
      }),
    ).toBe("Ada Lovelace");

    expect(
      cellValueForColumn("customText2", baseMember, {
        leaderMap,
        tasksByMember: new Map(),
        customFields,
      }),
    ).toBe("alpha; beta");
  });

  it("generateFollowupPeopleCsv escapes quotes in notes", () => {
    const csv = generateFollowupPeopleCsv(
      [baseMember],
      ["firstName", "notes"],
      { firstName: "First Name", notes: "Notes" },
      leaderMap,
      new Map(),
      customFields,
    );
    expect(csv).toContain('"He said ""hello"""');
  });
});
