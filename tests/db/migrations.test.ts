// @vitest-environment node
//
// Catches a migration that was written but never pushed — the file sits in the repo, the
// remote does not have it, and every later phase builds on a schema that does not exist.
//
// This deliberately does NOT apply migrations to an empty database. There is no local
// database (CLAUDE.md §9) and a test run must never wipe the shared hosted one. That check
// is `npm run db:reset`, run deliberately by a human.

import { readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createServiceSupabaseClient } from "@/lib/supabase/service";

const MIGRATIONS_DIRECTORY = path.resolve(process.cwd(), "supabase/migrations");

function localMigrationVersions(): string[] {
  return readdirSync(MIGRATIONS_DIRECTORY)
    .filter((fileName) => fileName.endsWith(".sql"))
    .map((fileName) => fileName.split("_")[0])
    .sort();
}

describe("migrations", () => {
  it("has at least one migration on disk", () => {
    expect(localMigrationVersions().length).toBeGreaterThan(0);
  });

  it("has applied every local migration to the remote database", async () => {
    const supabase = createServiceSupabaseClient();

    const { data, error } = await supabase.rpc("applied_migration_versions");

    if (error) {
      throw new Error(
        `Could not read applied migrations from the database: ${error.message}. ` +
          "Check that migration 019 has been applied and that SUPABASE_SERVICE_ROLE_KEY is set.",
      );
    }

    const appliedVersions = new Set((data ?? []).map((row) => row.version));
    const unappliedVersions = localMigrationVersions().filter(
      (version) => !appliedVersions.has(version),
    );

    expect(unappliedVersions).toEqual([]);
  });
});
