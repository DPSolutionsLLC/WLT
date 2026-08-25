// @vitest-environment node
//
// The guard on the application's only unauthenticated surface. Assertions here are on the
// COLUMN LIST as well as the row count, because a leak arrives as a new column, not a new row
// (CLAUDE.md §9: every field added to a public page is a privacy decision).

import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { anonClient } from "@/tests/helpers/asRole";
import { seedFixtures, type Fixtures } from "@/tests/helpers/seed";

describe("public views", () => {
  let fixtures: Fixtures;
  let anon: SupabaseClient;

  let assignmentsSlug: string;
  let programSlug: string;
  let memberId: string;
  let programId: string;
  let sacramentAssignmentId: string;

  beforeAll(async () => {
    fixtures = await seedFixtures([]);
    anon = anonClient() as unknown as SupabaseClient;

    assignmentsSlug = `assignments-${fixtures.runId}`;
    programSlug = `program-${fixtures.runId}`;

    const { error: pageError } = await fixtures.service.from("public_pages").insert([
      {
        ward_id: fixtures.wardAId,
        page_type: "sacrament_assignments",
        slug: assignmentsSlug,
      },
      { ward_id: fixtures.wardAId, page_type: "program", slug: programSlug },
    ]);
    if (pageError) throw new Error(pageError.message);

    const { data: sunday, error: sundayError } = await fixtures.service
      .from("sundays")
      .insert({ ward_id: fixtures.wardAId, date: "2026-03-01" })
      .select("id")
      .single();
    if (sundayError) throw new Error(sundayError.message);

    const { data: member, error: memberError } = await fixtures.service
      .from("members")
      .insert({
        ward_id: fixtures.wardAId,
        first_name: "Ethan",
        last_name: "Andersen",
        phone: "555-0100",
        category: "youth",
      })
      .select("id")
      .single();
    if (memberError) throw new Error(memberError.message);
    memberId = member.id;

    const { data: assignment, error: assignmentError } = await fixtures.service
      .from("sacrament_assignments")
      .insert({
        ward_id: fixtures.wardAId,
        sunday_id: sunday.id,
        assignment_type: "bread_blessing",
        member_ids: [member.id],
      })
      .select("id")
      .single();
    if (assignmentError) throw new Error(assignmentError.message);
    sacramentAssignmentId = assignment.id;

    const { data: program, error: programError } = await fixtures.service
      .from("programs")
      .insert({
        ward_id: fixtures.wardAId,
        sunday_id: sunday.id,
        status: "distributed",
        pdf_url: `https://example.test/${fixtures.runId}.pdf`,
        distributed_at: "2026-03-01T18:00:00Z",
        draft_data: { secret: "should never be public" },
        // Migration 039 added `public_data is not null` to the view, so a distributed program
        // with no projection is now invisible. The value is a MINIMAL hand-written object rather
        // than a real projection: this suite is about the view's column list and its grant, and
        // building a whole ProgramDraft here would make it about the projector instead
        // (tests/rls/public-program-anon.test.ts owns that).
        public_data: { version: 1, date: "2026-03-01", speakers: [] },
      })
      .select("id")
      .single();
    if (programError) throw new Error(programError.message);
    programId = program.id;
  });

  afterAll(async () => {
    await fixtures?.cleanup();
  });

  it("lets anon read the sacrament assignments view", async () => {
    const { data, error } = await anon
      .from("public_sacrament_assignments")
      .select("*")
      .eq("slug", assignmentsSlug);

    expect(error).toBeNull();
    expect(data?.length).toBe(1);
    expect(data?.[0]?.first_name).toBe("Ethan");
    expect(data?.[0]?.last_initial).toBe("A");
  });

  it("exposes a last initial and never a full surname", async () => {
    const { data } = await anon
      .from("public_sacrament_assignments")
      .select("*")
      .eq("slug", assignmentsSlug);

    const columns = Object.keys(data?.[0] ?? {});

    expect(columns).toContain("last_initial");
    expect(columns).not.toContain("last_name");
    expect(columns.filter((column) => /phone|address|note|email/i.test(column))).toEqual([]);
    expect(JSON.stringify(data)).not.toContain("555-0100");
    expect(JSON.stringify(data)).not.toContain("Andersen");
  });

  it("lets anon read the program view", async () => {
    const { data, error } = await anon
      .from("public_program")
      .select("*")
      .eq("slug", programSlug);

    expect(error).toBeNull();
    expect(data?.length).toBe(1);
    expect(data?.[0]?.pdf_url).toBe(`https://example.test/${fixtures.runId}.pdf`);
  });

  // The two columns migration 039 added. `ward_name` is a new join, and a join is the way a
  // future column arrives on this surface without anybody editing the select list they were
  // looking at — so it is named here as well as in the view.
  it("exposes the ward name and the projection, and only those two new columns", async () => {
    const { data } = await anon.from("public_program").select("*").eq("slug", programSlug);

    const columns = Object.keys(data?.[0] ?? {});

    expect(columns.sort()).toEqual(
      ["distributed_at", "pdf_url", "public_data", "slug", "sunday_date", "ward_name"].sort(),
    );
    expect(data?.[0]?.ward_name).toBeTruthy();
    expect(data?.[0]?.public_data).toEqual({
      version: 1,
      date: "2026-03-01",
      speakers: [],
    });
  });

  // draft_data is an unstructured snapshot that carries full names, leadership phone numbers and
  // missionary information. Phase 6 published an explicit named projection beside it
  // (lib/program/publicProjection.ts) and left draft_data exactly where it was: withheld.
  it("withholds draft_data from the program view", async () => {
    const { data } = await anon.from("public_program").select("*").eq("slug", programSlug);

    const columns = Object.keys(data?.[0] ?? {});

    expect(columns).not.toContain("draft_data");
    expect(JSON.stringify(data)).not.toContain("should never be public");
  });

  describe("base tables", () => {
    const cases: Array<{ table: string; id: () => string }> = [
      { table: "members", id: () => memberId },
      { table: "programs", id: () => programId },
      { table: "sacrament_assignments", id: () => sacramentAssignmentId },
      { table: "visit_logs", id: () => "" },
      { table: "households", id: () => "" },
      { table: "users", id: () => "" },
    ];

    for (const { table, id } of cases) {
      it(`gives anon nothing from ${table}`, async () => {
        const { data, error } = await anon.from(table).select("*");

        // anon has no grant on any base table, so the expected outcome is a permission
        // error. An empty result is also acceptable; a seeded row coming back is not.
        if (!error) {
          const rows = data ?? [];
          const seededId = id();
          if (seededId) {
            expect(rows.map((row: { id?: string }) => row.id)).not.toContain(seededId);
          }
          expect(rows).toEqual([]);
        } else {
          expect(error.message).toBeTruthy();
        }
      });
    }
  });
});
