import { describe, expect, it } from "vitest";
import {
  HYMNBOOK_SIZE,
  MAX_IMPORT_HYMN_NUMBER,
  buildPlaceholderRows,
  isPlaceholderTitle,
  parseHymnImport,
  placeholderTitle,
} from "@/lib/music/hymnSource";

// Task 0's gate, tested without a database.
//
// supabase/seed/hymns.sql forbids padding the hymn table with plausible-looking entries, because
// a wrong hymn number prints on a program a congregation then sings from. These rules are how
// that instruction is honoured rather than waived: the gap is filled with rows nobody could
// mistake for a hymn, and an import cannot launder one back in under the `authoritative` label.

describe("placeholderTitle", () => {
  it("produces a title nobody could mistake for a hymn", () => {
    expect(placeholderTitle(43)).toBe("[Placeholder] Hymn 43");
  });

  it("round-trips through isPlaceholderTitle", () => {
    expect(isPlaceholderTitle(placeholderTitle(1))).toBe(true);
    expect(isPlaceholderTitle(placeholderTitle(341))).toBe(true);
  });

  it("does not flag a real hymn title", () => {
    expect(isPlaceholderTitle("The Spirit of God")).toBe(false);
    expect(isPlaceholderTitle("Come, Listen to a Prophet's Voice")).toBe(false);
  });

  it("still recognises a title with leading whitespace", () => {
    expect(isPlaceholderTitle("  [Placeholder] Hymn 7")).toBe(true);
  });
});

describe("buildPlaceholderRows", () => {
  it("fills every number the hymnbook holds when nothing exists yet", () => {
    const rows = buildPlaceholderRows([]);
    expect(rows).toHaveLength(HYMNBOOK_SIZE);
    expect(rows[0].number).toBe(1);
    expect(rows[rows.length - 1].number).toBe(HYMNBOOK_SIZE);
  });

  // It CANNOT overwrite a verified row, because a number that exists is simply not in the output.
  it("omits numbers that already exist", () => {
    const rows = buildPlaceholderRows([2, 19, 301]);
    const numbers = rows.map((row) => row.number);

    expect(rows).toHaveLength(HYMNBOOK_SIZE - 3);
    expect(numbers).not.toContain(2);
    expect(numbers).not.toContain(19);
    expect(numbers).not.toContain(301);
  });

  it("is harmless to run twice", () => {
    const first = buildPlaceholderRows([]);
    const second = buildPlaceholderRows(first.map((row) => row.number));
    expect(second).toEqual([]);
  });

  it("marks every row as a placeholder", () => {
    expect(buildPlaceholderRows([]).every((row) => row.source === "placeholder")).toBe(true);
  });

  // A synthetic tag would make topic search LOOK populated while returning meaningless results,
  // which is worse for testing than an honestly empty result.
  it("gives placeholders no topic tags", () => {
    expect(buildPlaceholderRows([]).every((row) => row.topicTags.length === 0)).toBe(true);
  });
});

describe("parseHymnImport — JSON", () => {
  it("reads an array of hymns", () => {
    const { rows, problems } = parseHymnImport(
      JSON.stringify([
        { number: 2, title: "The Spirit of God", topicTags: ["restoration", "temple"] },
        { number: 3, title: "Now Let Us Rejoice" },
      ]),
    );

    expect(problems).toEqual([]);
    expect(rows).toEqual([
      { number: 2, title: "The Spirit of God", topicTags: ["restoration", "temple"] },
      { number: 3, title: "Now Let Us Rejoice", topicTags: [] },
    ]);
  });

  it("accepts snake_case tags too", () => {
    const { rows } = parseHymnImport(
      JSON.stringify([{ number: 2, title: "The Spirit of God", topic_tags: ["temple"] }]),
    );
    expect(rows[0].topicTags).toEqual(["temple"]);
  });

  it("reports unreadable JSON as a whole-file problem", () => {
    const { rows, problems } = parseHymnImport("[{ not json");
    expect(rows).toEqual([]);
    expect(problems[0].rowNumber).toBe(0);
    expect(problems[0].message).toContain("JSON");
  });

  it("refuses a single object rather than an array", () => {
    const { rows, problems } = parseHymnImport(JSON.stringify({ number: 2, title: "X" }));
    expect(rows).toEqual([]);
    expect(problems[0].message).toContain("ARRAY");
  });
});

describe("parseHymnImport — CSV", () => {
  it("reads a header row and the hymns under it", () => {
    const { rows, problems } = parseHymnImport(
      "number,title,topic_tags\n2,The Spirit of God,restoration;temple\n3,Now Let Us Rejoice,joy\n",
    );

    expect(problems).toEqual([]);
    expect(rows).toEqual([
      { number: 2, title: "The Spirit of God", topicTags: ["restoration", "temple"] },
      { number: 3, title: "Now Let Us Rejoice", topicTags: ["joy"] },
    ]);
  });

  it("accepts alternative header names", () => {
    const { rows } = parseHymnImport("Hymn No,Name\n2,The Spirit of God\n");
    expect(rows).toEqual([{ number: 2, title: "The Spirit of God", topicTags: [] }]);
  });

  it("names the columns it found when the required ones are missing", () => {
    const { rows, problems } = parseHymnImport("first,second\n1,2\n");
    expect(rows).toEqual([]);
    expect(problems[0].message).toContain("first, second");
  });

  it("survives a quoted title containing a comma and an apostrophe", () => {
    const { rows } = parseHymnImport(
      "number,title\n21,\"Come, Listen to a Prophet's Voice\"\n",
    );
    expect(rows[0].title).toBe("Come, Listen to a Prophet's Voice");
  });

  // parsed.rowNumbers, not an index. Blank records are dropped by the parser, so after the first
  // dropped one an index names the wrong line to a person looking at the file.
  it("names the row in the FILE, not its index after blank rows were dropped", () => {
    const { problems } = parseHymnImport("number,title\n2,The Spirit of God\n\n,No Number\n");
    expect(problems).toHaveLength(1);
    expect(problems[0].rowNumber).toBe(4);
  });
});

describe("parseHymnImport — validation", () => {
  // roster-c's rule: a file is normally 99% fine, and refusing all of it means somebody hand-edits
  // a spreadsheet in the dark.
  it("reports every bad row and still loads the good ones", () => {
    const { rows, problems } = parseHymnImport(
      JSON.stringify([
        { number: 2, title: "The Spirit of God" },
        { number: "not a number", title: "Broken" },
        { number: 3, title: "" },
        { number: 19, title: "We Thank Thee, O God, for a Prophet" },
      ]),
    );

    expect(rows.map((row) => row.number)).toEqual([2, 19]);
    expect(problems).toHaveLength(2);
  });

  it("accepts a number written as a string, as a CSV always gives it", () => {
    const { rows } = parseHymnImport(JSON.stringify([{ number: " 27 ", title: "Praise" }]));
    expect(rows[0].number).toBe(27);
  });

  it("refuses a number outside the sane range", () => {
    const { rows, problems } = parseHymnImport(
      JSON.stringify([{ number: MAX_IMPORT_HYMN_NUMBER + 1, title: "Too High" }]),
    );
    expect(rows).toEqual([]);
    expect(problems[0].message).toContain("outside");
  });

  it("allows a number beyond the current hymnbook size, so a new book does not need a code change", () => {
    const { rows, problems } = parseHymnImport(
      JSON.stringify([{ number: HYMNBOOK_SIZE + 1, title: "A Hymn in the New Book" }]),
    );
    expect(problems).toEqual([]);
    expect(rows[0].number).toBe(HYMNBOOK_SIZE + 1);
  });

  // The exact confusion migration 042's column exists to prevent: an unverifiable title written
  // back wearing the badge that means "safe to print".
  it("refuses a row whose title is one of our own placeholders", () => {
    const { rows, problems } = parseHymnImport(
      JSON.stringify([
        { number: 43, title: placeholderTitle(43) },
        { number: 2, title: "The Spirit of God" },
      ]),
    );

    expect(rows.map((row) => row.number)).toEqual([2]);
    expect(problems[0].message).toContain("placeholder");
    expect(problems[0].message).toContain("real hymnbook");
  });

  it("refuses a duplicate number and names the row it first appeared on", () => {
    const { rows, problems } = parseHymnImport(
      "number,title\n2,The Spirit of God\n2,Something Else\n",
    );

    expect(rows).toHaveLength(1);
    expect(problems[0].message).toContain("more than once");
    expect(problems[0].message).toContain("row 2");
  });

  it("turns an empty file into a problem rather than a silent clean import", () => {
    const { rows, problems } = parseHymnImport(JSON.stringify([]));
    expect(rows).toEqual([]);
    expect(problems[0].message).toContain("holds no hymns");
  });

  it("normalises tags to lowercase snake_case and de-duplicates them", () => {
    const { rows } = parseHymnImport(
      JSON.stringify([
        { number: 2, title: "The Spirit of God", topicTags: ["Second Coming", "temple", "TEMPLE"] },
      ]),
    );

    expect(rows[0].topicTags).toEqual(["second_coming", "temple"]);
  });
});
