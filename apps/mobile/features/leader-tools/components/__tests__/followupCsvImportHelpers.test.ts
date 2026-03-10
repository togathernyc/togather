import {
  buildCsvImportRowsPayload,
  getDefaultCsvImportMapping,
  getDefaultCustomFieldMapping,
  type CsvImportMapping,
} from "../followupCsvImportHelpers";

describe("getDefaultCsvImportMapping", () => {
  it("auto-maps common header aliases", () => {
    const mapping = getDefaultCsvImportMapping([
      "Date Added",
      "First Name",
      "Last Name",
      "Phone Number",
      "E-mail",
      "ZIP",
      "DOB",
      "Notes",
      "Assignee",
      "Status",
    ]);

    expect(mapping).toEqual({
      addedAt: "Date Added",
      firstName: "First Name",
      lastName: "Last Name",
      phone: "Phone Number",
      email: "E-mail",
      zipCode: "ZIP",
      dateOfBirth: "DOB",
      notes: "Notes",
      assignee: "Assignee",
      status: "Status",
    });
  });

  it("leaves unmatched fields unmapped", () => {
    const mapping = getDefaultCsvImportMapping(["Given", "Family"]);

    expect(mapping.phone).toBeNull();
    expect(mapping.email).toBeNull();
    expect(mapping.notes).toBeNull();
    expect(mapping.status).toBeNull();
    expect(mapping.assignee).toBeNull();
    expect(mapping.addedAt).toBeNull();
  });
});

describe("getDefaultCustomFieldMapping", () => {
  it("auto-maps custom fields by display name", () => {
    const mapping = getDefaultCustomFieldMapping(
      ["Neighborhood", "Volunteer Level", "Prayer Requests"],
      [
        { slot: "customText1", name: "Neighborhood", type: "text" },
        { slot: "customNum1", name: "Volunteer Level", type: "number" },
        { slot: "customText2", name: "Prayer Requests", type: "text" },
      ]
    );

    expect(mapping).toEqual({
      customText1: "Neighborhood",
      customNum1: "Volunteer Level",
      customText2: "Prayer Requests",
    });
  });

  it("sets null when no matching custom header exists", () => {
    const mapping = getDefaultCustomFieldMapping(
      ["Neighborhood"],
      [
        { slot: "customText1", name: "Neighborhood", type: "text" },
        { slot: "customBool1", name: "Wants Prayer", type: "boolean" },
      ]
    );

    expect(mapping).toEqual({
      customText1: "Neighborhood",
      customBool1: null,
    });
  });
});

describe("buildCsvImportRowsPayload", () => {
  const mapping: CsvImportMapping = {
    addedAt: "Added Date",
    firstName: "First Name",
    lastName: "Last Name",
    phone: "Phone",
    email: "Email",
    zipCode: "ZIP",
    dateOfBirth: null,
    notes: "Notes",
    assignee: "Assignee",
    status: "Status",
  };

  it("builds canonical rows from selected mapped fields", () => {
    const rows = buildCsvImportRowsPayload(
      [
        {
          "Added Date": "1/4/2026",
          "First Name": " Ada ",
          "Last Name": "Lovelace",
          Phone: "(202) 555-0111",
          Email: "Ada@Example.com",
          ZIP: "10001",
          Notes: "new guest",
          Assignee: "Rachel",
          Status: "Orange",
        },
      ],
      mapping,
      new Set([
        "addedAt",
        "firstName",
        "lastName",
        "phone",
        "email",
        "zipCode",
        "notes",
        "assignee",
        "status",
      ])
    );

    expect(rows).toEqual([
      {
        rowNumber: 2,
        addedAt: "1/4/2026",
        firstName: "Ada",
        lastName: "Lovelace",
        phone: "(202) 555-0111",
        email: "Ada@Example.com",
        zipCode: "10001",
        notes: "new guest",
        assignee: "Rachel",
        status: "Orange",
      },
    ]);
  });

  it("ignores unselected fields and empty values", () => {
    const rows = buildCsvImportRowsPayload(
      [
        {
          "First Name": "Grace",
          "Last Name": "",
          Phone: "   ",
          Email: "grace@example.com",
          Notes: null,
        },
      ],
      mapping,
      new Set(["firstName", "lastName", "phone", "email", "notes"])
    );

    expect(rows).toEqual([
      {
        rowNumber: 2,
        firstName: "Grace",
        email: "grace@example.com",
      },
    ]);
  });

  it("includes selected custom slot values", () => {
    const rows = buildCsvImportRowsPayload(
      [
        {
          "First Name": "Ben",
          Phone: "202-555-0100",
          Neighborhood: "South",
          "Volunteer Level": "2",
          "Wants Prayer": "yes",
          "Connection Point": "Team, Dinner Party",
        },
      ],
      mapping,
      new Set(["firstName", "phone"]),
      {
        customText1: "Neighborhood",
        customNum1: "Volunteer Level",
        customBool1: "Wants Prayer",
        customText3: "Connection Point",
      },
      new Set(["customText1", "customNum1", "customBool1", "customText3"])
    );

    expect(rows).toEqual([
      {
        rowNumber: 2,
        firstName: "Ben",
        phone: "202-555-0100",
        customFieldValues: {
          customText1: "South",
          customNum1: "2",
          customBool1: "yes",
          customText3: "Team, Dinner Party",
        },
      },
    ]);
  });
});

