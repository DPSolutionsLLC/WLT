// @vitest-environment node
//
// The state of the hymn table, checked against the database rather than against a fixture.
//
// ---------------------------------------------------------------------------
// WHY THIS SUITE EXISTS
// ---------------------------------------------------------------------------
// supabase/seed/hymns.sql holds 42 hand-verified hymns and forbids padding the rest with
// plausible-looking entries — a wrong hymn number prints on a program a congregation then sings
// from. Migration 042 and `npm run hymns:placeholders` fill the remaining 299 numbers with rows
// nobody could mistake for a hymn, and record which is which in `hymns.source`.
//
// Everything in program-e depends on that being true: search needs 341 reachable numbers,
// hymnCandidates.ts must be able to tell a real hymn from a synthetic one, and the printed
// programme must never carry a number nobody verified. This suite is what notices if it stops
// being true — most likely because somebody ran `npm run hymns:reset` and did not re-run
// placeholders, or because an import wrote a placeholder title under the authoritative label.
//
// `hymns` is the ONE table with no ward_id (migration 006), so this reads it directly with the
// service client and seeds nothing. There is no fixture to clean up.

import { describe, expect, it } from "vitest";
import { HYMNBOOK_SIZE, isPlaceholderTitle } from "@/lib/music/hymnSource";
import { createServiceSupabaseClient } from "@/lib/supabase/service";

// Five known pairs, spread across the book. If any of these has drifted, something rewrote the
// verified rows and the whole table is suspect.
const KNOWN_HYMNS: { number: number; title: string }[] = [
  { number: 2, title: "The Spirit of God" },
  { number: 19, title: "We Thank Thee, O God, for a Prophet" },
  { number: 27, title: "Praise to the Man" },
  { number: 136, title: "I Know That My Redeemer Lives" },
  { number: 301, title: "I Am a Child of God" },
];

const VERIFIED_HYMN_COUNT = 42;

describe("the hymn table", () => {
  it(`holds all ${HYMNBOOK_SIZE} numbers`, async () => {
    const supabase = createServiceSupabaseClient();
    const { data, error } = await supabase.from("hymns").select("number");

    if (error) throw new Error(`Could not read the hymns table: ${error.message}`);

    expect(data).toHaveLength(HYMNBOOK_SIZE);
  });

  it("has no duplicate numbers", async () => {
    const supabase = createServiceSupabaseClient();
    const { data, error } = await supabase.from("hymns").select("number");

    if (error) throw new Error(`Could not read the hymns table: ${error.message}`);

    const numbers = (data ?? []).map((row) => row.number);
    expect(new Set(numbers).size).toBe(numbers.length);
  });

  it("covers 1 through the hymnbook size with no gaps", async () => {
    const supabase = createServiceSupabaseClient();
    const { data, error } = await supabase.from("hymns").select("number");

    if (error) throw new Error(`Could not read the hymns table: ${error.message}`);

    const present = new Set((data ?? []).map((row) => row.number));
    const missing: number[] = [];

    for (let hymnNumber = 1; hymnNumber <= HYMNBOOK_SIZE; hymnNumber += 1) {
      if (!present.has(hymnNumber)) missing.push(hymnNumber);
    }

    // Named rather than counted, so the failure says which numbers to go and look at.
    expect(missing).toEqual([]);
  });

  it("still holds the five known number and title pairs", async () => {
    const supabase = createServiceSupabaseClient();
    const { data, error } = await supabase
      .from("hymns")
      .select("number, title, source")
      .in(
        "number",
        KNOWN_HYMNS.map((hymn) => hymn.number),
      );

    if (error) throw new Error(`Could not read the hymns table: ${error.message}`);

    const byNumber = new Map((data ?? []).map((row) => [row.number, row]));

    for (const known of KNOWN_HYMNS) {
      const row = byNumber.get(known.number);
      expect(row?.title).toBe(known.title);
      // Verified rows must never be relabelled as placeholders, and a placeholder must never
      // wear the authoritative label. Both directions matter; this is the one that would let a
      // real hymn quietly vanish from the AI candidate list.
      expect(row?.source).toBe("authoritative");
    }
  });

  it("keeps the 42 verified rows and fills the rest with placeholders", async () => {
    const supabase = createServiceSupabaseClient();
    const { data, error } = await supabase.from("hymns").select("source");

    if (error) throw new Error(`Could not read the hymns table: ${error.message}`);

    const rows = data ?? [];
    const authoritative = rows.filter((row) => row.source === "authoritative").length;
    const placeholder = rows.filter((row) => row.source === "placeholder").length;

    expect(authoritative).toBe(VERIFIED_HYMN_COUNT);
    expect(placeholder).toBe(HYMNBOOK_SIZE - VERIFIED_HYMN_COUNT);
  });

  // The column and the title must agree. A row labelled authoritative whose title reads
  // "[Placeholder] Hymn 43" is the exact confusion migration 042 exists to prevent, and it is
  // reachable through a bad import if parseHymnImport's refusal is ever removed.
  it("never labels a placeholder-titled row as authoritative", async () => {
    const supabase = createServiceSupabaseClient();
    const { data, error } = await supabase.from("hymns").select("number, title, source");

    if (error) throw new Error(`Could not read the hymns table: ${error.message}`);

    const mislabelled = (data ?? []).filter(
      (row) => isPlaceholderTitle(row.title) && row.source === "authoritative",
    );

    expect(mislabelled.map((row) => row.number)).toEqual([]);
  });

  it("never labels a real title as a placeholder", async () => {
    const supabase = createServiceSupabaseClient();
    const { data, error } = await supabase.from("hymns").select("number, title, source");

    if (error) throw new Error(`Could not read the hymns table: ${error.message}`);

    const mislabelled = (data ?? []).filter(
      (row) => !isPlaceholderTitle(row.title) && row.source === "placeholder",
    );

    expect(mislabelled.map((row) => row.number)).toEqual([]);
  });

  it("gives placeholders no topic tags, so topic search is not falsely populated", async () => {
    const supabase = createServiceSupabaseClient();
    const { data, error } = await supabase
      .from("hymns")
      .select("number, topic_tags")
      .eq("source", "placeholder");

    if (error) throw new Error(`Could not read the hymns table: ${error.message}`);

    const tagged = (data ?? []).filter((row) => row.topic_tags.length > 0);
    expect(tagged.map((row) => row.number)).toEqual([]);
  });

  it("refuses a source value the CHECK constraint does not know", async () => {
    const supabase = createServiceSupabaseClient();

    const { error } = await supabase
      .from("hymns")
      .insert({ number: 9001, title: "Not A Hymn", source: "made_up" });

    expect(error).not.toBeNull();
    expect(error?.message ?? "").toContain("hymns_source_check");
  });
});
