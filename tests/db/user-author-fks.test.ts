// @vitest-environment node
//
// Runs in node, not jsdom: createServiceSupabaseClient() throws when it sees a `window`, and
// jsdom provides one.
//
// ---------------------------------------------------------------------------
// WHAT THIS PROTECTS, AND WHY NO OTHER TEST CAN
// ---------------------------------------------------------------------------
// Migration 002 established an idiom — a composite foreign key `(author, ward_id)` against
// `users (id, ward_id)`, asserting that whoever wrote a row belongs to that row's ward. Under the
// calling model (migration 068) that is FALSE for exactly the people the model exists for, and it
// fails as SQLSTATE 23503 — a 500, not a refusal. Migration 069 narrowed all forty-eight.
//
// A FUTURE MIGRATION RE-ADDING ONE WOULD SILENTLY RE-BREAK SECOND-WARD WRITES on that one table.
// No route test would catch it unless it happened to write there as somebody acting away from
// home, and tests/rls/ward-callings-write.test.ts covers three tables out of twenty-seven. This
// catches every table at once, from the catalog, and it is the only thing that does.
//
// Read-only, which is what makes it safe against the shared hosted database (CLAUDE.md §9).

import { describe, expect, it } from "vitest";
import { createServiceSupabaseClient } from "@/lib/supabase/service";

describe("foreign keys referencing users", () => {
  it("has no composite (author, ward_id) key left anywhere", async () => {
    const supabase = createServiceSupabaseClient();

    const { data, error } = await supabase.rpc("composite_user_author_fks");

    if (error) {
      throw new Error(
        `Could not read foreign keys from the database: ${error.message}. ` +
          "Check that migration 069 has been applied and that SUPABASE_SERVICE_ROLE_KEY is set.",
      );
    }

    // Named rather than counted, so a failure says WHICH table to look at. A bare
    // `toHaveLength(0)` would report "expected 1 to be 0" and leave the reader to find it.
    const survivors = (data ?? []).map(
      (row) => `${row.table_name}.${row.constraint_name}`,
    );

    expect(survivors).toEqual([]);
  });

  // THE ANCHOR, and it is needed. An empty result can mean two very different things: "069 ran
  // and narrowed all forty-eight", or "069 was never applied and the function does not exist / is
  // looking at the wrong catalog". The first is the pass; the second would make the assertion
  // above green and useless, which is the one way this file could ship worthless.
  //
  // The same reasoning as tests/lib/permissions.test.ts's ANCHOR_ROLE: prove the mechanism
  // actually ran before believing what it says.
  it("is asserting against a database that has migration 069 applied", async () => {
    const supabase = createServiceSupabaseClient();

    const { data, error } = await supabase.rpc("applied_migration_versions");
    expect(error).toBeNull();

    const applied = (data ?? []).map((row) => row.version);

    expect(applied).toContain("068");
    expect(applied).toContain("069");
  });
});
