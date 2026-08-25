import { describe, expect, it } from "vitest";
import { DEFAULT_SEARCH_LIMIT, matchHymns, normalizeForSearch } from "@/lib/music/hymnSearch";
import { placeholderTitle } from "@/lib/music/hymnSource";

// Pure. No database and no network — everything here is a function of its inputs, which is the
// whole reason lib/music/hymnSearch.ts holds no client.

type TestHymn = { number: number; title: string; topicTags: string[] };

// Real rows from supabase/seed/hymns.sql. Using invented titles here would let the suite pass
// over strings that never occur, and the apostrophe cases below are only interesting because
// they are genuinely in the seed.
const HYMNS: TestHymn[] = [
  { number: 2, title: "The Spirit of God", topicTags: ["restoration", "temple", "praise"] },
  { number: 3, title: "Now Let Us Rejoice", topicTags: ["joy", "restoration", "second_coming"] },
  { number: 19, title: "We Thank Thee, O God, for a Prophet", topicTags: ["prophets", "gratitude"] },
  {
    number: 21,
    title: "Come, Listen to a Prophet's Voice",
    topicTags: ["prophets", "revelation", "obedience"],
  },
  { number: 26, title: "Joseph Smith's First Prayer", topicTags: ["restoration", "prayer"] },
  { number: 116, title: "Come, Follow Me", topicTags: ["discipleship", "jesus_christ"] },
  { number: 169, title: "As Now We Take the Sacrament", topicTags: ["sacrament", "covenants"] },
  { number: 241, title: "Count Your Blessings", topicTags: ["gratitude", "trials", "hope"] },
  { number: 301, title: "I Am a Child of God", topicTags: ["children", "identity"] },
];

function numbersFor(query: string, hymns: TestHymn[] = HYMNS): number[] {
  return matchHymns(hymns, query).map((hymn) => hymn.number);
}

describe("normalizeForSearch", () => {
  it("folds every apostrophe variant to one character", () => {
    expect(normalizeForSearch("Prophet’s")).toBe(normalizeForSearch("Prophet's"));
    expect(normalizeForSearch("Prophet‘s")).toBe(normalizeForSearch("Prophet's"));
    expect(normalizeForSearch("Prophet´s")).toBe(normalizeForSearch("Prophet's"));
  });

  it("strips accents", () => {
    expect(normalizeForSearch("Prière")).toBe("priere");
  });

  it("collapses whitespace and lowercases", () => {
    expect(normalizeForSearch("  Come,   Follow  Me ")).toBe("come, follow me");
  });
});

describe("matchHymns — by number", () => {
  it("finds a hymn by its exact number", () => {
    expect(numbersFor("21")).toContain(21);
  });

  it("ranks the exact number first, ahead of a title that also matches", () => {
    // "2" is hymn 2's number and appears nowhere in a title, but the ranking rule is what is
    // under test: an exact number outranks everything.
    expect(numbersFor("2")[0]).toBe(2);
  });

  it("does not treat a number as a substring of other numbers", () => {
    // The bug this guards: "1" matching 116, 169 and 301 because their numbers contain a 1.
    expect(numbersFor("1")).toEqual([]);
  });
});

describe("matchHymns — by title", () => {
  it("finds a hymn by a substring of its title", () => {
    expect(numbersFor("blessings")).toEqual([241]);
  });

  it("is case-insensitive", () => {
    expect(numbersFor("SPIRIT OF GOD")).toEqual([2]);
  });

  // THE APOSTROPHE CASE. A phone's keyboard produces U+2019 by default, and the seed stores a
  // straight apostrophe. Without normalisation a coordinator typing the title they are reading
  // gets nothing back and concludes the hymn is not seeded.
  it("matches a curly apostrophe against a straight one in the data", () => {
    expect(numbersFor("Prophet’s Voice")).toEqual([21]);
    expect(numbersFor("Joseph Smith’s")).toEqual([26]);
  });

  it("matches a straight apostrophe typed against the same title", () => {
    expect(numbersFor("Prophet's Voice")).toEqual([21]);
  });

  it("ranks a title that STARTS with the query ahead of one that merely contains it", () => {
    // Hymn 116 begins "Come, Follow Me"; hymn 21 begins "Come, Listen…" — both are prefixes, so
    // they tie on rank and fall back to number order. Hymn 19 contains no "come" at all.
    expect(numbersFor("come")).toEqual([21, 116]);
  });
});

describe("matchHymns — by topic tag", () => {
  it("finds hymns by an exact tag", () => {
    expect(numbersFor("sacrament")).toEqual([169]);
  });

  it("finds hymns by a tag whose words are separated by underscores in the data", () => {
    expect(numbersFor("second coming")).toEqual([3]);
  });

  it("ranks a title match ahead of a tag match", () => {
    const gratitude: TestHymn[] = [
      { number: 50, title: "Gratitude Everlasting", topicTags: [] },
      { number: 10, title: "Some Other Hymn", topicTags: ["gratitude"] },
    ];
    expect(numbersFor("gratitude", gratitude)).toEqual([50, 10]);
  });
});

describe("matchHymns — placeholders", () => {
  const withPlaceholder: TestHymn[] = [
    ...HYMNS,
    { number: 43, title: placeholderTitle(43), topicTags: [] },
  ];

  // Searchable, not hidden. Hiding 299 of the 341 numbers would make them silently unfindable,
  // which is the "no such hymn" failure supabase/seed/hymns.sql warns about wearing a hat.
  it("finds a placeholder by its number", () => {
    expect(numbersFor("43", withPlaceholder)).toEqual([43]);
  });

  it("sorts a placeholder after a real hymn of the same rank", () => {
    const tied: TestHymn[] = [
      { number: 90, title: placeholderTitle(90), topicTags: [] },
      { number: 91, title: "Hymn of Real Praise", topicTags: [] },
    ];
    // Both titles contain "hymn", so both land on the same rank and only the placeholder rule
    // separates them — despite 90 sorting before 91 by number.
    expect(numbersFor("hymn", tied)).toEqual([91, 90]);
  });
});

describe("matchHymns — bounds", () => {
  it("returns nothing for an empty query", () => {
    expect(numbersFor("")).toEqual([]);
    expect(numbersFor("   ")).toEqual([]);
  });

  it("caps the result count at the default", () => {
    const many: TestHymn[] = Array.from({ length: 60 }, (unused, index) => ({
      number: index + 1,
      title: `Praise Number ${index + 1}`,
      topicTags: [],
    }));

    expect(matchHymns(many, "praise")).toHaveLength(DEFAULT_SEARCH_LIMIT);
  });

  it("honours an explicit limit", () => {
    const many: TestHymn[] = Array.from({ length: 60 }, (unused, index) => ({
      number: index + 1,
      title: `Praise Number ${index + 1}`,
      topicTags: [],
    }));

    expect(matchHymns(many, "praise", { limit: 5 })).toHaveLength(5);
  });

  it("returns the caller's own row type, not a narrowed copy", () => {
    const [first] = matchHymns(HYMNS, "21");
    expect(first.topicTags).toEqual(["prophets", "revelation", "obedience"]);
  });
});
