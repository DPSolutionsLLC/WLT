// @vitest-environment node
//
// Runs in node, not jsdom: createServiceSupabaseClient() throws when it sees a `window`,
// and jsdom provides one.
//
// This is the highest-leverage test in the phase. Postgres defaults RLS off, so a table
// added in any future phase without `enable row level security` is readable by every
// authenticated user in every ward, with no error to hint at it. This test fails the moment
// that happens.
//
// Read-only, which is what makes it safe against the shared hosted database (CLAUDE.md §9).

import { describe, expect, it } from "vitest";
import { createServiceSupabaseClient } from "@/lib/supabase/service";

describe("row level security", () => {
  it("is enabled on every table in the public schema", async () => {
    const supabase = createServiceSupabaseClient();

    const { data, error } = await supabase.rpc("tables_without_rls");

    if (error) {
      throw new Error(
        `Could not read RLS state from the database: ${error.message}. ` +
          "Check that migration 019 has been applied and that SUPABASE_SERVICE_ROLE_KEY is set.",
      );
    }

    const unprotectedTables = (data ?? []).map((row) => row.table_name);

    expect(unprotectedTables).toEqual([]);
  });
});
