// A SYNTHETIC LCR ward list paste. Fake names only. It reproduces the real copy's SHAPE (verified
// against a real paste by counts only): CRLF line endings, a blank line and then each header on its
// own line followed by a blank line, then tab-separated rows whose multi-line cells (the callings)
// are embedded RAW, with no quoting. Never paste lines from a real report into this file.

export const LCR_HEADERS = [
  "Preferred Name",
  "Full Name",
  "Age",
  "Individual Phone",
  "Individual E-mail",
  "Address - Street 1",
  "Birth Date (1 Jan 1990)",
  "Gender",
  "Class Assignment",
  "Head of House and Spouse",
  "Callings",
  "Callings with Date Sustained",
  "Callings with Date Sustained and Set Apart",
  "Ministering Brothers",
  "Ministering Sisters",
  "Has Ministering Sisters",
  "Has Ministering Brothers",
] as const;

export type SyntheticPerson = {
  preferredName: string;
  fullName: string;
  age?: string;
  phone?: string;
  email?: string;
  address?: string;
  birthDate: string;
  gender?: string;
  classAssignment?: string;
  household: string;
  callings?: string;
  callingsSustained?: string;
  callingsSetApart?: string;
  ministeringBrothers?: string;
  ministeringSisters?: string;
  hasMinisteringSisters?: string;
  hasMinisteringBrothers?: string;
};

export const LCR_HEADERS_BLOCK = `\r\n${LCR_HEADERS.map((header) => `${header}\r\n\r\n`).join("")}`;

export function toLcrRow(person: SyntheticPerson): string[] {
  return [
    person.preferredName,
    person.fullName,
    person.age ?? "",
    person.phone ?? "",
    person.email ?? "",
    person.address ?? "",
    person.birthDate,
    person.gender ?? "",
    person.classAssignment ?? "",
    person.household,
    person.callings ?? "",
    person.callingsSustained ?? "",
    person.callingsSetApart ?? "",
    person.ministeringBrothers ?? "",
    person.ministeringSisters ?? "",
    person.hasMinisteringSisters ?? "No",
    person.hasMinisteringBrothers ?? "No",
  ];
}

// Rows tab-joined with CRLF between them. A `\n` inside a cell is written as a raw CRLF line break,
// which is exactly what splits an LCR row across several lines.
export function buildPaste(rows: readonly (readonly string[])[], headersBlock = LCR_HEADERS_BLOCK): string {
  const body = rows.map((cells) => cells.join("\t").replace(/\n/g, "\r\n")).join("\r\n");
  return `${headersBlock}${body}\r\n`;
}

export const SAMPLE_PEOPLE: readonly SyntheticPerson[] = [
  {
    preferredName: "Example, Ann",
    fullName: "Example, Ann Marie",
    age: "40",
    phone: "555-0101",
    email: "ann@example.com",
    address: "1 Test Lane",
    birthDate: "13 Jun 1986",
    gender: "F",
    classAssignment: "Relief Society",
    household: "Example, Bo & Ann",
    callings: "Primary Teacher\nWard Activities Committee Member",
    callingsSustained: "Primary Teacher (2 Feb 2025)\nWard Activities Committee Member (9 Mar 2025)",
    callingsSetApart: "Primary Teacher (2 Feb 2025, 9 Feb 2025)\nWard Activities Committee Member (9 Mar 2025, 16 Mar 2025)",
    hasMinisteringSisters: "Yes",
  },
  {
    preferredName: "Example, Bo",
    fullName: "Example, Bo James",
    age: "42",
    phone: "555-0102",
    address: "1 Test Lane",
    birthDate: "2 Jan 1984",
    gender: "M",
    classAssignment: "Elders Quorum",
    household: "Example, Bo & Ann",
    hasMinisteringBrothers: "Yes",
  },
  {
    preferredName: "Sample, Cy",
    fullName: "Sample, Cy",
    age: "15",
    address: "22 Fake Street",
    birthDate: "30 Sep 2010",
    gender: "M",
    classAssignment: "Aaronic Priesthood",
    household: "Sample, Dee",
  },
];
