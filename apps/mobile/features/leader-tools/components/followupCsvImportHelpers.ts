export type CsvImportField =
  | "addedAt"
  | "firstName"
  | "lastName"
  | "phone"
  | "email"
  | "zipCode"
  | "dateOfBirth"
  | "notes"
  | "assignee"
  | "status";

export type CsvImportMapping = Record<CsvImportField, string | null>;

export type CsvImportSourceRow = Record<string, unknown>;

export type CsvImportCustomFieldDef = {
  slot: string;
  name: string;
  type: "text" | "number" | "boolean" | "dropdown" | "multiselect";
  options?: string[];
};

export type CsvImportRowPayload = {
  rowNumber: number;
  addedAt?: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  email?: string;
  zipCode?: string;
  dateOfBirth?: string;
  notes?: string;
  assignee?: string;
  status?: string;
  customFieldValues?: Record<string, string>;
};

const FIELD_ALIASES: Record<CsvImportField, string[]> = {
  addedAt: [
    "date",
    "date added",
    "added at",
    "created at",
    "import date",
    "followup date",
    "follow-up date",
  ],
  firstName: ["first name", "firstname", "first", "given name", "given_name"],
  lastName: ["last name", "lastname", "last", "surname", "family name", "family_name"],
  phone: ["phone", "phone number", "phone_number", "mobile", "mobile phone", "cell", "cell phone"],
  email: ["email", "email address", "email_address", "e-mail"],
  zipCode: ["zip", "zip code", "zipcode", "postal code", "postal_code"],
  dateOfBirth: ["date of birth", "dob", "birthday", "birth date", "birth_date"],
  notes: ["notes", "note", "comment", "comments"],
  assignee: ["assignee", "owner", "assigned to", "follow-up owner", "followup owner"],
  status: ["status", "follow-up status", "followup status"],
};

function normalizeHeader(header: string): string {
  return header
    .trim()
    .toLowerCase()
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ");
}

const STANDARD_FIELDS: CsvImportField[] = [
  "addedAt",
  "firstName",
  "lastName",
  "phone",
  "email",
  "zipCode",
  "dateOfBirth",
  "notes",
  "assignee",
  "status",
];

export function getDefaultCsvImportMapping(headers: string[]): CsvImportMapping {
  const normalizedHeaders = headers.map((header) => ({
    raw: header,
    normalized: normalizeHeader(header),
  }));

  const mapping: CsvImportMapping = {
    addedAt: null,
    firstName: null,
    lastName: null,
    phone: null,
    email: null,
    zipCode: null,
    dateOfBirth: null,
    notes: null,
    assignee: null,
    status: null,
  };

  const usedHeaders = new Set<string>();

  for (const field of STANDARD_FIELDS) {
    const aliases = new Set(FIELD_ALIASES[field].map(normalizeHeader));
    const exactMatch = normalizedHeaders.find(
      (candidate) =>
        !usedHeaders.has(candidate.raw) &&
        aliases.has(candidate.normalized)
    );
    if (exactMatch) {
      mapping[field] = exactMatch.raw;
      usedHeaders.add(exactMatch.raw);
    }
  }

  return mapping;
}

export function getDefaultCustomFieldMapping(
  headers: string[],
  customFields: CsvImportCustomFieldDef[]
): Record<string, string | null> {
  const normalizedHeaders = headers.map((header) => ({
    raw: header,
    normalized: normalizeHeader(header),
  }));

  const usedHeaders = new Set<string>();
  const mapping: Record<string, string | null> = {};

  for (const field of customFields) {
    const target = normalizeHeader(field.name);
    const match = normalizedHeaders.find(
      (candidate) => !usedHeaders.has(candidate.raw) && candidate.normalized === target
    );
    mapping[field.slot] = match?.raw ?? null;
    if (match) usedHeaders.add(match.raw);
  }

  return mapping;
}

export function buildCsvImportRowsPayload(
  sourceRows: CsvImportSourceRow[],
  mapping: CsvImportMapping,
  selectedFields: Set<CsvImportField>,
  customFieldMapping: Record<string, string | null> = {},
  selectedCustomSlots: Set<string> = new Set()
): CsvImportRowPayload[] {
  return sourceRows.map((row, index) => {
    const payload: CsvImportRowPayload = { rowNumber: index + 2 };

    for (const field of STANDARD_FIELDS) {
      if (!selectedFields.has(field)) continue;
      const header = mapping[field];
      if (!header) continue;
      const rawValue = row[header];
      if (rawValue === undefined || rawValue === null) continue;
      const str = String(rawValue).trim();
      if (!str) continue;
      payload[field] = str;
    }

    const customFieldValues: Record<string, string> = {};
    for (const slot of selectedCustomSlots) {
      const header = customFieldMapping[slot];
      if (!header) continue;
      const rawValue = row[header];
      if (rawValue === undefined || rawValue === null) continue;
      const str = String(rawValue).trim();
      if (!str) continue;
      customFieldValues[slot] = str;
    }
    if (Object.keys(customFieldValues).length > 0) {
      payload.customFieldValues = customFieldValues;
    }

    return payload;
  });
}

