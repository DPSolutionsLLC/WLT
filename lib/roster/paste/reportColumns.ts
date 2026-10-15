// The columns of the LCR custom ward list report, and how a pasted header row is matched to them.
// Matching is by HEADER TEXT, in any order, so a leader can arrange their report however they
// like. Browser-safe: the paste box runs this before posting.

export type ReportColumnKey =
  | "preferredName"
  | "fullName"
  | "birthDate"
  | "household"
  | "gender"
  | "phone"
  | "email"
  | "address"
  | "classAssignment"
  | "callings"
  | "callingsSustained"
  | "callingsSetApart"
  | "ministeringBrothers"
  | "ministeringSisters"
  | "hasMinisteringBrothers"
  | "hasMinisteringSisters"
  | "age";

export type ReportColumnKind = "reviewed" | "silent" | "derived";

export type ReportColumn = {
  key: ReportColumnKey;
  lcrHeader: string;
  required: boolean;
  kind: ReportColumnKind;
};

// `age` is recognised so it is not reported as ignored, and never read: age comes from birth date.
export const REPORT_COLUMNS: readonly ReportColumn[] = [
  { key: "preferredName", lcrHeader: "Preferred Name", required: true, kind: "reviewed" },
  { key: "fullName", lcrHeader: "Full Name", required: true, kind: "reviewed" },
  { key: "birthDate", lcrHeader: "Birth Date", required: true, kind: "reviewed" },
  { key: "household", lcrHeader: "Head of House and Spouse", required: true, kind: "reviewed" },
  { key: "gender", lcrHeader: "Gender", required: false, kind: "reviewed" },
  { key: "phone", lcrHeader: "Individual Phone", required: false, kind: "reviewed" },
  { key: "email", lcrHeader: "Individual E-mail", required: false, kind: "reviewed" },
  { key: "address", lcrHeader: "Address - Street 1", required: false, kind: "reviewed" },
  { key: "classAssignment", lcrHeader: "Class Assignment", required: false, kind: "silent" },
  { key: "callings", lcrHeader: "Callings", required: false, kind: "silent" },
  {
    key: "callingsSustained",
    lcrHeader: "Callings with Date Sustained",
    required: false,
    kind: "silent",
  },
  {
    key: "callingsSetApart",
    lcrHeader: "Callings with Date Sustained and Set Apart",
    required: false,
    kind: "silent",
  },
  { key: "ministeringBrothers", lcrHeader: "Ministering Brothers", required: false, kind: "silent" },
  { key: "ministeringSisters", lcrHeader: "Ministering Sisters", required: false, kind: "silent" },
  {
    key: "hasMinisteringBrothers",
    lcrHeader: "Has Ministering Brothers",
    required: false,
    kind: "silent",
  },
  {
    key: "hasMinisteringSisters",
    lcrHeader: "Has Ministering Sisters",
    required: false,
    kind: "silent",
  },
  { key: "age", lcrHeader: "Age", required: false, kind: "derived" },
];

export type ColumnIndex = Partial<Record<ReportColumnKey, number>>;

export type ColumnMatch = {
  columnIndex: ColumnIndex;
  missing: ReportColumn[];
  ignored: string[];
  duplicates: string[];
};

// "Birth Date (1 Jan 1990)" → "birthdate", "Individual E-mail" → "individualemail".
export function normalizeHeader(header: string): string {
  return header
    .replace(/\([^)]*\)/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

const COLUMNS_BY_NORMALIZED_HEADER = new Map(
  REPORT_COLUMNS.map((column) => [normalizeHeader(column.lcrHeader), column]),
);

// Whole-string matches only, so "Callings" never swallows "Callings with Date Sustained".
export function matchReportColumns(headers: readonly string[]): ColumnMatch {
  const columnIndex: ColumnIndex = {};
  const ignored: string[] = [];
  const duplicates: string[] = [];

  headers.forEach((header, index) => {
    const column = COLUMNS_BY_NORMALIZED_HEADER.get(normalizeHeader(header));

    if (!column) {
      if (header.trim() !== "") ignored.push(header.trim());
      return;
    }

    if (columnIndex[column.key] !== undefined) {
      duplicates.push(header.trim());
      return;
    }

    columnIndex[column.key] = index;
  });

  const missing = REPORT_COLUMNS.filter(
    (column) => column.required && columnIndex[column.key] === undefined,
  );

  return { columnIndex, missing, ignored, duplicates };
}

export function describeMissingColumns(missing: readonly ReportColumn[]): string[] {
  return missing.map(
    (column) =>
      `The paste has no "${column.lcrHeader}" column. In LCR, open your custom report, add ` +
      `${column.lcrHeader} to its columns, run it, and copy the whole table again.`,
  );
}

export function describeDuplicateColumns(duplicates: readonly string[]): string[] {
  return duplicates.map(
    (header) =>
      `The paste has the "${header}" column twice. Remove one copy from the report in LCR and ` +
      "copy the whole table again.",
  );
}

// Optional columns this paste does not carry. They are left unchanged, never cleared.
export function columnsNotSupplied(columnIndex: ColumnIndex): string[] {
  return REPORT_COLUMNS.filter(
    (column) =>
      !column.required && column.kind !== "derived" && columnIndex[column.key] === undefined,
  ).map((column) => column.lcrHeader);
}
