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

// ---------------------------------------------------------------------------
// DELIBERATELY HELD BACK, AND THEREFORE NOT A FAILURE
// ---------------------------------------------------------------------------
// The CONTRACT half of an expand-and-contract pair. Such a migration drops the columns the
// currently-deployed build still reads, so applying it before the new code deploys takes the app
// down — the file exists, is reviewed, and waits.
//
// This list is the difference between "held back on purpose" and "written and forgotten", which
// is the only thing the assertion below can actually distinguish. Adding a version here is a
// deliberate act with a deploy step attached:
//
//   1. `npm run db:push` applies the EXPAND migration; the running build is unaffected.
//   2. Deploy the application.
//   3. Apply the contract migration, and DELETE its version from this list in the same change.
//
// A version left here after step 3 makes this test blind to that migration for ever, so an entry
// that has outlived its deploy is itself the bug. Every entry names its pair and its reason.
// Empty is the normal state. ITER-018's 051 was the first entry and was removed on 2026-08-27,
// once the new build was live and the migration applied — which is the entry doing its job rather
// than being forgotten.
const HELD_BACK_UNTIL_DEPLOYED: Record<string, string> = {
  "063":
    "youth-j's contract half. 062 created activity_roster and activity_event_participation and " +
    "backfilled both; 063 drops youth_activity_profiles.member_id and " +
    "activity_events.youth_attended, both of which the RUNNING build still selects through " +
    "ACTIVITY_PROFILE_COLUMNS and ACTIVITY_EVENT_COLUMNS — so applying it early answers every " +
    "youth screen 400. Apply after the new build is live, then remove this entry in the same " +
    "change: an entry that has outlived its deploy makes this test blind to 063 for ever.",
};

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
      (version) =>
        !appliedVersions.has(version) && HELD_BACK_UNTIL_DEPLOYED[version] === undefined,
    );

    expect(unappliedVersions).toEqual([]);
  });

  // The other half of the allowlist, and the reason it is safe to have one. An entry that has
  // already been applied has outlived its purpose and is now hiding that migration from the
  // assertion above — so it fails here rather than sitting there silently.
  it("holds back no migration that has already been applied", async () => {
    const heldBack = Object.keys(HELD_BACK_UNTIL_DEPLOYED);
    if (heldBack.length === 0) return;

    const supabase = createServiceSupabaseClient();
    const { data, error } = await supabase.rpc("applied_migration_versions");

    if (error) {
      throw new Error(
        `Could not read applied migrations from the database: ${error.message}.`,
      );
    }

    const appliedVersions = new Set((data ?? []).map((row) => row.version));
    const staleEntries = heldBack.filter((version) => appliedVersions.has(version));

    expect(staleEntries).toEqual([]);
  });

  it("holds back no migration that is not on disk", () => {
    const onDisk = new Set(localMigrationVersions());
    const missing = Object.keys(HELD_BACK_UNTIL_DEPLOYED).filter(
      (version) => !onDisk.has(version),
    );

    expect(missing).toEqual([]);
  });
});
