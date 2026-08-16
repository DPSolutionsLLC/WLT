// @vitest-environment node

import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asRole } from "@/tests/helpers/asRole";
import { seedFixtures, type Fixtures } from "@/tests/helpers/seed";

// The table list is derived from the migrations rather than hand-written, so a table added in
// a later phase is covered by this suite the moment its migration lands.

type ParsedTable = { name: string; hasWardId: boolean };

async function parseMigrationTables(): Promise<ParsedTable[]> {
  const directory = path.join(process.cwd(), "supabase", "migrations");
  const files = (await readdir(directory)).filter((file) => file.endsWith(".sql")).sort();

  const tables: ParsedTable[] = [];

  for (const file of files) {
    const sql = await readFile(path.join(directory, file), "utf8");
    const pattern = /create table (?:if not exists )?(\w+)\s*\(([\s\S]*?)\n\);/gi;

    let match: RegExpExecArray | null;
    while ((match = pattern.exec(sql)) !== null) {
      tables.push({ name: match[1], hasWardId: /\bward_id\b/.test(match[2]) });
    }
  }

  return tables;
}

describe("ward isolation", () => {
  let fixtures: Fixtures;
  let bishopA: SupabaseClient;
  let allTables: ParsedTable[];
  let wardScopedTables: string[];

  const wardBRows = {
    householdId: "",
    memberId: "",
    visitLogId: "",
  };

  beforeAll(async () => {
    allTables = await parseMigrationTables();
    wardScopedTables = allTables.filter((table) => table.hasWardId).map((table) => table.name);

    fixtures = await seedFixtures(["bishop", "wardBBishop"]);
    bishopA = (await asRole(fixtures, "bishop")) as unknown as SupabaseClient;

    const { data: household, error: householdError } = await fixtures.service
      .from("households")
      .insert({ ward_id: fixtures.wardBId, family_name: `WardB ${fixtures.runId}` })
      .select("id")
      .single();
    if (householdError) throw new Error(householdError.message);
    wardBRows.householdId = household.id;

    const { data: member, error: memberError } = await fixtures.service
      .from("members")
      .insert({
        ward_id: fixtures.wardBId,
        household_id: household.id,
        first_name: "Ward",
        last_name: "Bee",
      })
      .select("id")
      .single();
    if (memberError) throw new Error(memberError.message);
    wardBRows.memberId = member.id;

    const { data: visitLog, error: visitLogError } = await fixtures.service
      .from("visit_logs")
      .insert({
        ward_id: fixtures.wardBId,
        org_id: fixtures.wardBOrgId,
        household_id: household.id,
        visit_date: "2026-03-01",
        shared_notes: "ward B only",
      })
      .select("id")
      .single();
    if (visitLogError) throw new Error(visitLogError.message);
    wardBRows.visitLogId = visitLog.id;
  });

  afterAll(async () => {
    await fixtures?.cleanup();
  });

  it("parses a table list from the migrations", () => {
    expect(allTables.length).toBeGreaterThan(40);
  });

  // Two tables carry no ward_id, for two different reasons: `wards` IS the ward and is keyed
  // by `id`, and `hymns` is the documented single exception to CLAUDE.md rule 1. Both are
  // covered by their own assertions below rather than by the generic sweep. If a future
  // migration adds a third, this fails rather than letting the table quietly join the skip
  // list and go untested forever.
  it("has exactly two deliberately ward-less tables", () => {
    const wardless = allTables.filter((table) => !table.hasWardId).map((table) => table.name);
    expect(wardless.sort()).toEqual(["hymns", "wards"]);
  });

  it("does not leak the ward row itself across wards", async () => {
    const { data, error } = await bishopA.from("wards").select("id").eq("id", fixtures.wardBId);

    expect(error).toBeNull();
    expect(data ?? []).toEqual([]);

    const { data: own } = await bishopA.from("wards").select("id").eq("id", fixtures.wardAId);
    expect(own?.map((row: { id: string }) => row.id)).toEqual([fixtures.wardAId]);
  });

  it("cannot rename another ward", async () => {
    const { data: updated, error } = await bishopA
      .from("wards")
      .update({ name: "tampered" })
      .eq("id", fixtures.wardBId)
      .select("id");

    expect(error).toBeNull();
    expect(updated ?? []).toEqual([]);

    const { data: after } = await fixtures.service
      .from("wards")
      .select("name")
      .eq("id", fixtures.wardBId)
      .single();

    expect(after?.name).toContain("ward B");
  });

  it("covers every ward-scoped table in the sweep", () => {
    expect(wardScopedTables).toContain("members");
    expect(wardScopedTables).toContain("visit_private_notes");
    expect(wardScopedTables).not.toContain("hymns");
    expect(wardScopedTables).not.toContain("wards");
  });

  it("returns no ward B rows to a ward A user, on every ward-scoped table", async () => {
    const leaks: string[] = [];

    for (const table of wardScopedTables) {
      const { data, error } = await bishopA
        .from(table)
        .select("ward_id")
        .eq("ward_id", fixtures.wardBId);

      if (error) {
        throw new Error(`Selecting from "${table}" as a ward A user errored: ${error.message}`);
      }

      if ((data ?? []).length > 0) leaks.push(table);
    }

    expect(leaks).toEqual([]);
  });

  it("rejects an insert addressed to another ward", async () => {
    const { error: householdError } = await bishopA
      .from("households")
      .insert({ ward_id: fixtures.wardBId, family_name: `Intruder ${fixtures.runId}` });
    expect(householdError).not.toBeNull();

    const { error: memberError } = await bishopA.from("members").insert({
      ward_id: fixtures.wardBId,
      first_name: "In",
      last_name: "Truder",
    });
    expect(memberError).not.toBeNull();

    const { error: notificationError } = await bishopA.from("notifications").insert({
      ward_id: fixtures.wardBId,
      recipient_user_id: fixtures.user("wardBBishop").id,
      trigger_key: "admin_setting_changed",
      title: "Intruder",
      body: "Should never land",
    });
    expect(notificationError).not.toBeNull();
  });

  // RLS makes a disallowed UPDATE or DELETE affect zero rows rather than raise, so the
  // assertion has to be that the row is still there and unchanged — not merely that no error
  // came back.
  it("cannot update a ward B row", async () => {
    const { data: updated, error } = await bishopA
      .from("visit_logs")
      .update({ shared_notes: "tampered" })
      .eq("id", wardBRows.visitLogId)
      .select("id");

    expect(error).toBeNull();
    expect(updated ?? []).toEqual([]);

    const { data: after } = await fixtures.service
      .from("visit_logs")
      .select("shared_notes")
      .eq("id", wardBRows.visitLogId)
      .single();

    expect(after?.shared_notes).toBe("ward B only");
  });

  it("cannot delete a ward B row", async () => {
    const { data: deleted, error } = await bishopA
      .from("members")
      .delete()
      .eq("id", wardBRows.memberId)
      .select("id");

    expect(error).toBeNull();
    expect(deleted ?? []).toEqual([]);

    const { data: after } = await fixtures.service
      .from("members")
      .select("id")
      .eq("id", wardBRows.memberId)
      .maybeSingle();

    expect(after?.id).toBe(wardBRows.memberId);
  });

  it("cannot read another ward's household even by id", async () => {
    const { data } = await bishopA
      .from("households")
      .select("id")
      .eq("id", wardBRows.householdId);

    expect(data ?? []).toEqual([]);
  });
});
