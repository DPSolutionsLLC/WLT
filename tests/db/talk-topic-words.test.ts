// @vitest-environment node
//
// Migration 086's backfill, checked against the database rather than against a fixture — the
// pattern tests/db/hymn-seed.test.ts uses, because no test can run the migration's SQL itself.
//
// A talk's topic became its words (`assignments.topic_title`), and every talk that named a library
// topic before then had that topic's title copied onto it. If one did not, that talk silently lost
// its topic on every screen: nothing reads `topic_id` any more.
//
// Only talks created BEFORE the cutoff are checked. Nothing writes `topic_id` after migration 086,
// so a newer row carrying one would be a test fixture, not something the backfill was owed.

import { describe, expect, it } from "vitest";
import { createServiceSupabaseClient } from "@/lib/supabase/service";

const MIGRATION_086_APPLIED_BY = "2026-09-29T00:00:00Z";

describe("migration 086 — a talk's topic is its words", () => {
  it("copied every library topic's title onto the talk that named it", async () => {
    const supabase = createServiceSupabaseClient();
    const { data, error } = await supabase
      .from("assignments")
      .select("id, topic_title, topic:topics!assignments_topic_id_ward_id_fkey (title)")
      .not("topic_id", "is", null)
      .lt("created_at", MIGRATION_086_APPLIED_BY);

    if (error) throw new Error(`Could not read the talks: ${error.message}`);

    const missed = (data ?? []).filter((row) => row.topic_title !== row.topic?.title);
    expect(missed.map((row) => row.id)).toEqual([]);
  });
});
