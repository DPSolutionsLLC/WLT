// @vitest-environment node

import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asRole } from "@/tests/helpers/asRole";
import { seedFixtures, type Fixtures } from "@/tests/helpers/seed";
import type { Database } from "@/types/database";
import type { FixtureHandle } from "@/tests/helpers/seed";

const EXCLUDED_HANDLES: FixtureHandle[] = [
  "wardSecretary",
  "executiveSecretary",
  "eqPresident",
];

describe("tithing access", () => {
  let fixtures: Fixtures;
  let bishop: SupabaseClient<Database>;

  let sessionId: string;
  let entryId: string;

  beforeAll(async () => {
    fixtures = await seedFixtures(["bishop", ...EXCLUDED_HANDLES]);
    bishop = await asRole(fixtures, "bishop");

    const { data: session, error: sessionError } = await fixtures.service
      .from("tithing_sessions")
      .insert({
        ward_id: fixtures.wardAId,
        session_date: "2026-03-01",
        created_by: fixtures.user("bishop").id,
      })
      .select("id")
      .single();
    if (sessionError) throw new Error(sessionError.message);
    sessionId = session.id;

    const { data: entry, error: entryError } = await fixtures.service
      .from("tithing_entries")
      .insert({
        ward_id: fixtures.wardAId,
        session_id: sessionId,
        entry_number: 1,
        bills_20: 3,
        coins_quarter: 2,
      })
      .select("id")
      .single();
    if (entryError) throw new Error(entryError.message);
    entryId = entry.id;
  });

  afterAll(async () => {
    await fixtures?.cleanup();
  });

  it("lets the bishopric read the session and its entries", async () => {
    const { data: sessions, error: sessionError } = await bishop
      .from("tithing_sessions")
      .select("id")
      .eq("id", sessionId);

    expect(sessionError).toBeNull();
    expect(sessions?.map((row) => row.id)).toEqual([sessionId]);

    const { data: entries, error: entryError } = await bishop
      .from("tithing_entries")
      .select("id")
      .eq("id", entryId);

    expect(entryError).toBeNull();
    expect(entries?.map((row) => row.id)).toEqual([entryId]);
  });

  it("lets the bishopric write an entry", async () => {
    const { data, error } = await bishop
      .from("tithing_entries")
      .insert({
        ward_id: fixtures.wardAId,
        session_id: sessionId,
        entry_number: 2,
        bills_5: 4,
      })
      .select("id");

    expect(error).toBeNull();
    expect(data?.length).toBe(1);
  });

  for (const handle of EXCLUDED_HANDLES) {
    describe(handle, () => {
      it("reads zero tithing sessions", async () => {
        const client = await asRole(fixtures, handle);
        const { data, error } = await client
          .from("tithing_sessions")
          .select("id")
          .eq("id", sessionId);

        expect(error).toBeNull();
        expect(data ?? []).toEqual([]);
      });

      it("reads zero tithing entries", async () => {
        const client = await asRole(fixtures, handle);
        const { data, error } = await client
          .from("tithing_entries")
          .select("id")
          .eq("id", entryId);

        expect(error).toBeNull();
        expect(data ?? []).toEqual([]);
      });

      it("cannot create a tithing session", async () => {
        const client = await asRole(fixtures, handle);
        const { error } = await client.from("tithing_sessions").insert({
          ward_id: fixtures.wardAId,
          session_date: "2026-03-08",
        });

        expect(error).not.toBeNull();
      });

      it("cannot update an entry", async () => {
        const client = await asRole(fixtures, handle);
        const { data: updated, error } = await client
          .from("tithing_entries")
          .update({ bills_100: 99 })
          .eq("id", entryId)
          .select("id");

        expect(error).toBeNull();
        expect(updated ?? []).toEqual([]);

        const { data: after } = await fixtures.service
          .from("tithing_entries")
          .select("bills_100")
          .eq("id", entryId)
          .single();

        expect(after?.bills_100).toBe(0);
      });
    });
  }

  // CLAUDE.md rule 10. A single member-linking column turns a disposable counting worksheet
  // into a permanent record of who paid what, which is exactly what the design prevents.
  it("has no column linking tithing data to members", async () => {
    const { data: session } = await fixtures.service
      .from("tithing_sessions")
      .select("*")
      .eq("id", sessionId)
      .single();

    const { data: entry } = await fixtures.service
      .from("tithing_entries")
      .select("*")
      .eq("id", entryId)
      .single();

    const columns = [...Object.keys(session ?? {}), ...Object.keys(entry ?? {})];
    const linking = columns.filter((column) =>
      /member|donor|payer|household|first_name|last_name/i.test(column),
    );

    expect(linking).toEqual([]);
  });
});
