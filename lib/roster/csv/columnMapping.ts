// Mapping is by NORMALIZED HEADER TEXT, never by column position. 02-roster.md §Pitfalls opens
// with the reason: LCR column order changes between exports, so a positional mapping silently
// imports phone numbers into the address column the first time the export format moves.

export const IMPORT_FIELDS = [
  "firstName",
  "lastName",
  "familyName",
  "address",
  "category",
  "gender",
  "phone",
] as const;

export type ImportField = (typeof IMPORT_FIELDS)[number];

export const REQUIRED_IMPORT_FIELDS: readonly ImportField[] = [
  "firstName",
  "lastName",
  "familyName",
];

export type ColumnMapping = Partial<Record<ImportField, number>>;

export const FIELD_LABELS: Record<ImportField, string> = {
  firstName: "First name",
  lastName: "Last name",
  familyName: "Household name",
  address: "Address",
  category: "Category",
  gender: "Gender",
  phone: "Phone",
};

// Seeded from real LCR export headers. This table is a guess until a real export has been
// through it — record which headers it missed in the retro rather than widening it blind.
//
// "family name" appears under BOTH lastName and familyName on purpose. It is genuinely
// ambiguous in real exports, and the resolution rule below is what stops a silent guess.
const FIELD_ALIASES: Record<ImportField, readonly string[]> = {
  firstName: ["preferred name", "first name", "given name", "firstname"],
  lastName: ["last name", "surname", "family name (last)", "family name", "lastname"],
  familyName: ["household name", "family name", "head of household", "household"],
  address: ["address", "street address", "home address", "mailing address"],
  category: ["age category", "category", "member type"],
  gender: ["gender", "sex"],
  phone: [
    "phone",
    "phone number",
    "individual phone",
    "household phone",
    "mobile phone",
  ],
};

// An export carrying the whole name in one column. Never split it — guessing at name splitting
// is how a roster ends up with people called "Van". These headers are recognised only so the
// blocking message can say what to do instead of listing two fields as merely missing.
const SINGLE_NAME_ALIASES = ["name", "full name", "member name", "individual name"];

function normalizeHeader(header: string): string {
  return header.toLowerCase().replace(/[^a-z0-9]/g, "");
}

const NORMALIZED_ALIASES = new Map<ImportField, ReadonlySet<string>>(
  IMPORT_FIELDS.map((field) => [
    field,
    new Set(FIELD_ALIASES[field].map(normalizeHeader)),
  ]),
);

const NORMALIZED_SINGLE_NAME_ALIASES = new Set(SINGLE_NAME_ALIASES.map(normalizeHeader));

function fieldsMatching(header: string): ImportField[] {
  const normalized = normalizeHeader(header);
  return IMPORT_FIELDS.filter((field) =>
    NORMALIZED_ALIASES.get(field)?.has(normalized) ?? false,
  );
}

// Two passes, and the order matters. An unambiguous header claims its field first, so a file
// carrying both "Last Name" and "Family Name" cannot have the household column claimed by
// lastName purely because it appears further left.
//
// An ambiguous header is then offered to its highest-priority match in IMPORT_FIELDS order —
// lastName before familyName — and to nothing else. If that field is already taken the header
// stays unmapped and the user has to choose. Leaving familyName blank costs one select; a wrong
// silent guess mis-groups the entire ward into households named after individuals.
export function suggestMapping(headers: readonly string[]): ColumnMapping {
  const mapping: ColumnMapping = {};
  const usedColumns = new Set<number>();

  const claim = (field: ImportField, index: number): void => {
    if (mapping[field] !== undefined) return;
    if (usedColumns.has(index)) return;
    mapping[field] = index;
    usedColumns.add(index);
  };

  const matchesByIndex = headers.map((header) => fieldsMatching(header));

  matchesByIndex.forEach((matches, index) => {
    if (matches.length === 1) claim(matches[0], index);
  });

  matchesByIndex.forEach((matches, index) => {
    if (matches.length > 1) claim(matches[0], index);
  });

  return mapping;
}

export function missingRequiredFields(mapping: ColumnMapping): ImportField[] {
  return REQUIRED_IMPORT_FIELDS.filter((field) => mapping[field] === undefined);
}

export function hasSingleNameColumn(headers: readonly string[]): boolean {
  return headers.some((header) =>
    NORMALIZED_SINGLE_NAME_ALIASES.has(normalizeHeader(header)),
  );
}

// Built as explicit named messages rather than left to Zod's default text. A mapping refusal
// that says "Invalid input" names nothing the user can act on
// (plans/retros/auth-b-invites-admin.md).
export function describeMissingFields(
  missing: readonly ImportField[],
  headers: readonly string[],
): string {
  if (missing.length === 0) return "";

  const needsBothNames =
    missing.includes("firstName") && missing.includes("lastName");

  if (needsBothNames && hasSingleNameColumn(headers)) {
    return (
      "This export has names in a single column. Split Name into First Name and Last Name " +
      "before importing."
    );
  }

  const labels = missing.map((field) => FIELD_LABELS[field]);

  return labels.length === 1
    ? `Choose a column for ${labels[0]} before continuing.`
    : `Choose a column for ${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]} before continuing.`;
}
