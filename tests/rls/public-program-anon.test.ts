// @vitest-environment node
//
// The database half of the public-page boundary. tests/lib/publicProjection.test.ts proves the
// projection is safe; this proves the DATABASE only ever hands out that projection, and only for a
// program that has actually been published.
//
// Every assertion here goes through the ANON client — the same key a stranger's browser holds, no
// session attached. Asserting with the service client would prove nothing at all: it bypasses RLS
// and holds every grant, so a suite written that way passes while the page leaks.

import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ProgramDraft } from "@/lib/program/draft";
import { toPublicProgram } from "@/lib/program/publicProjection";
import { anonClient } from "@/tests/helpers/asRole";
import { seedFixtures, type Fixtures } from "@/tests/helpers/seed";

const MEMBER_SURNAME = "Whitfield";
const MEMBER_PHONE = "555-0142";
const HOUSEHOLD_ADDRESS = "2201 Canyon Road";
const CONTACT_PHONE = "555-0100";

// The same shape program-a assembles, with the three forbidden fields populated so a view that
// exposed draft_data would be caught by the string scan below rather than by a column-name check
// somebody has to remember to update.
function draftFor(date: string): ProgramDraft {
  return {
    version: 1,
    heading: null,
    date,
    sundayType: "standard",
    presiding: { printedName: "Mark Andersen", publicName: "Mark Andersen" },
    conducting: { printedName: "Peter Lindqvist", publicName: "Peter Lindqvist" },
    organist: null,
    chorister: null,
    openingHymn: { number: 19, title: "We Thank Thee, O God, for a Prophet" },
    invocation: { printedName: "David Brooks", publicName: "David Brooks" },
    wardBusiness: null,
    sacramentHymn: { number: 193, title: "I Stand All Amazed" },
    specialNotes: null,
    musicalNumber: null,
    speakers: [
      {
        slotNumber: 1,
        kind: "member",
        printedName: `Sarah ${MEMBER_SURNAME}`,
        publicName: `Sarah ${MEMBER_SURNAME}`,
        topic: "Charity Never Faileth",
      },
      {
        slotNumber: 2,
        kind: "external",
        printedName: "President Mark Andersen",
        publicName: "President Mark Andersen",
        topic: null,
      },
    ],
    closingHymn: { number: 152, title: "God Be with You Till We Meet Again" },
    benediction: null,
    announcements: "Ward temple night is on the 14th.",
    leadershipContacts: [{ role: "Bishop", name: "Mark Andersen", phone: CONTACT_PHONE }],
    missionaries: `Elder Kim — ${HOUSEHOLD_ADDRESS}`,
    missing: ["organist", "chorister"],
  };
}

describe("the public program view, read as anon", () => {
  let fixtures: Fixtures;
  let anon: SupabaseClient;

  let publishedSlug: string;
  let inactiveSlug: string;
  let memberId: string;
  let publishedProgramId: string;

  beforeAll(async () => {
    fixtures = await seedFixtures([]);
    anon = anonClient() as unknown as SupabaseClient;

    publishedSlug = `program-live-${fixtures.runId}`;
    inactiveSlug = `program-inactive-${fixtures.runId}`;

    // A member with a phone number and an address, so "nothing leaked" has something to leak.
    const { data: household, error: householdError } = await fixtures.service
      .from("households")
      .insert({
        ward_id: fixtures.wardAId,
        family_name: MEMBER_SURNAME,
        address: HOUSEHOLD_ADDRESS,
      })
      .select("id")
      .single();
    if (householdError) throw new Error(householdError.message);

    const { data: member, error: memberError } = await fixtures.service
      .from("members")
      .insert({
        ward_id: fixtures.wardAId,
        household_id: household.id,
        first_name: "Sarah",
        last_name: MEMBER_SURNAME,
        phone: MEMBER_PHONE,
        category: "adult",
      })
      .select("id")
      .single();
    if (memberError) throw new Error(memberError.message);
    memberId = member.id;

    const { data: sundays, error: sundayError } = await fixtures.service
      .from("sundays")
      .insert([
        { ward_id: fixtures.wardAId, date: "2026-04-05" },
        { ward_id: fixtures.wardAId, date: "2026-04-12" },
        { ward_id: fixtures.wardAId, date: "2026-04-19" },
      ])
      .select("id, date");
    if (sundayError) throw new Error(sundayError.message);

    const sundayIdFor = (date: string): string => {
      const match = (sundays ?? []).find((sunday) => sunday.date === date);
      if (!match) throw new Error(`Seeded Sunday ${date} is missing.`);
      return match.id;
    };

    // Three programs on three Sundays in ONE ward: two distributed, one approved and never
    // distributed. Two distributed programs rather than one is deliberate — with a single one,
    // "the view returns the ward's published programs" and "the view returns the program for this
    // slug" are the same observation, and the second is false
    // (plans/retros/ai-b-knowledge-and-retrieval.md: a fixture whose design hides the bug).
    const { data: programs, error: programError } = await fixtures.service
      .from("programs")
      .insert([
        {
          ward_id: fixtures.wardAId,
          sunday_id: sundayIdFor("2026-04-05"),
          status: "distributed",
          draft_data: draftFor("2026-04-05") as never,
          public_data: toPublicProgram(draftFor("2026-04-05")) as never,
          distributed_at: "2026-04-05T18:00:00Z",
        },
        {
          ward_id: fixtures.wardAId,
          sunday_id: sundayIdFor("2026-04-12"),
          status: "approved",
          draft_data: draftFor("2026-04-12") as never,
          public_data: toPublicProgram(draftFor("2026-04-12")) as never,
        },
        {
          ward_id: fixtures.wardAId,
          sunday_id: sundayIdFor("2026-04-19"),
          status: "distributed",
          draft_data: draftFor("2026-04-19") as never,
          public_data: toPublicProgram(draftFor("2026-04-19")) as never,
          distributed_at: "2026-04-19T18:00:00Z",
        },
      ])
      .select("id, sunday_id");
    if (programError) throw new Error(programError.message);
    publishedProgramId = programs[0].id;

    // is_active is spelled out on EVERY row. A PostgREST bulk insert builds one column list from
    // the union of the objects and sends NULL where a key is absent, so a row relying on the
    // column default alongside a row that sets it fails the NOT NULL constraint.
    const { error: pageError } = await fixtures.service.from("public_pages").insert([
      {
        ward_id: fixtures.wardAId,
        page_type: "program",
        slug: publishedSlug,
        is_active: true,
      },
      {
        ward_id: fixtures.wardAId,
        page_type: "program",
        slug: inactiveSlug,
        is_active: false,
      },
    ]);
    if (pageError) throw new Error(pageError.message);
  });

  afterAll(async () => {
    await fixtures?.cleanup();
  });

  it("hands anon the projection for a distributed program", async () => {
    const { data, error } = await anon
      .from("public_program")
      .select("slug, sunday_date, ward_name, public_data, pdf_url, distributed_at")
      .eq("slug", publishedSlug)
      .eq("sunday_date", "2026-04-05");

    expect(error).toBeNull();
    expect(data?.length).toBe(1);
    expect(data?.[0]?.ward_name).toBeTruthy();
    expect(data?.[0]?.public_data?.version).toBe(1);
    expect(data?.[0]?.public_data?.speakers?.[0]?.name).toBe(`Sarah ${MEMBER_SURNAME}`);
  });

  // Names survive the round trip through jsonb intact. Asserted at the database boundary and not
  // only in the pure function, because the projection is stored and re-read rather than recomputed
  // — a serialisation that mangled a name would never show up in a unit test.
  it("keeps every name in full through the round trip", async () => {
    const { data } = await anon
      .from("public_program")
      .select("public_data")
      .eq("slug", publishedSlug)
      .eq("sunday_date", "2026-04-05");

    const projection = data?.[0]?.public_data;
    const speakers = projection?.speakers ?? [];

    expect(speakers[0]?.name).toBe(`Sarah ${MEMBER_SURNAME}`);
    expect(speakers[1]?.name).toBe("President Mark Andersen");
    expect(projection?.presiding).toBe("Mark Andersen");
  });

  // The scan, at the view instead of at the function. It is the assertion that keeps working when
  // somebody widens the view's column list without touching any TypeScript.
  //
  // The SURNAME is deliberately not in this list any more — names are published in full as of
  // 2026-08-24 (lib/program/publicProjection.ts). Everything that was ever the larger exposure is
  // still here: two phone numbers, a street address, the missionary block and the contacts array.
  it("leaks no phone, address or missionary detail through the view", async () => {
    const { data } = await anon.from("public_program").select("*").eq("slug", publishedSlug);

    const serialised = JSON.stringify(data);

    expect(serialised).not.toContain(MEMBER_PHONE);
    expect(serialised).not.toContain(CONTACT_PHONE);
    expect(serialised).not.toContain(HOUSEHOLD_ADDRESS);
    expect(serialised).not.toContain("Elder Kim");
    expect(serialised).not.toContain("leadershipContacts");
    expect(serialised).not.toContain("printedName");
  });

  it("never exposes draft_data as a column", async () => {
    const { data } = await anon.from("public_program").select("*").eq("slug", publishedSlug);

    const columns = Object.keys(data?.[0] ?? {});

    expect(columns.sort()).toEqual(
      ["distributed_at", "pdf_url", "public_data", "slug", "sunday_date", "ward_name"].sort(),
    );
  });

  // -------------------------------------------------------------------------------------------
  // A SLUG IDENTIFIES A WARD'S PROGRAM PAGE, NOT A PROGRAM
  // -------------------------------------------------------------------------------------------
  // The view joins public_pages to programs on ward_id alone — inherited from migration 019 and
  // kept by 039. So an active program slug matches EVERY distributed program in that ward, and the
  // page picks one (lib/program/publicQueries.ts orders by sunday_date descending and takes the
  // first). There is no such thing as "the slug for the 12th of April".
  //
  // This is why the gate is asserted as an ABSENCE FROM THE SET rather than as an empty result for
  // a per-program slug: the question the database answers is "which of this ward's programs are
  // published", and an approved-but-undistributed one must not be among them.
  describe("the gate", () => {
    it("returns every distributed program in the ward for an active slug", async () => {
      const { data, error } = await anon
        .from("public_program")
        .select("sunday_date")
        .eq("slug", publishedSlug)
        .order("sunday_date", { ascending: false });

      expect(error).toBeNull();
      expect(data?.map((row: { sunday_date: string }) => row.sunday_date)).toEqual([
        "2026-04-19",
        "2026-04-05",
      ]);
    });

    // The whole point of the `status = 'distributed'` clause. An approved program is a document
    // the bishopric has signed off and NOT yet handed to anybody.
    it("omits a program that is approved but not yet distributed", async () => {
      const { data, error } = await anon
        .from("public_program")
        .select("sunday_date")
        .eq("slug", publishedSlug);

      expect(error).toBeNull();
      expect(data?.map((row: { sunday_date: string }) => row.sunday_date)).not.toContain(
        "2026-04-12",
      );
    });

    it("hides every program behind a deactivated slug", async () => {
      const { data, error } = await anon
        .from("public_program")
        .select("slug")
        .eq("slug", inactiveSlug);

      expect(error).toBeNull();
      expect(data).toEqual([]);
    });

    // The belt-and-braces clause in migration 039. A distributed program whose projection is
    // missing must drop out rather than render a header with an empty program under it.
    it("hides a distributed program whose projection was never written", async () => {
      const { error: clearError } = await fixtures.service
        .from("programs")
        .update({ public_data: null })
        .eq("id", publishedProgramId);
      if (clearError) throw new Error(clearError.message);

      const { data } = await anon
        .from("public_program")
        .select("sunday_date")
        .eq("slug", publishedSlug);

      expect(data?.map((row: { sunday_date: string }) => row.sunday_date)).not.toContain(
        "2026-04-05",
      );

      const { error: restoreError } = await fixtures.service
        .from("programs")
        .update({ public_data: toPublicProgram(draftFor("2026-04-05")) as never })
        .eq("id", publishedProgramId);
      if (restoreError) throw new Error(restoreError.message);
    });

    it("gives anon nothing for a slug that does not exist", async () => {
      const { data, error } = await anon
        .from("public_program")
        .select("slug")
        .eq("slug", `no-such-slug-${fixtures.runId}`);

      expect(error).toBeNull();
      expect(data).toEqual([]);
    });
  });

  // anon holds a grant on two views and nothing else (migration 019, reasserted by 039). If any of
  // these ever comes back with a row, the view's projection has stopped being the boundary because
  // there is a way around it.
  describe("base tables stay closed", () => {
    const cases: Array<{ table: string; seededId: () => string }> = [
      { table: "programs", seededId: () => publishedProgramId },
      { table: "members", seededId: () => memberId },
      { table: "sundays", seededId: () => "" },
      { table: "wards", seededId: () => "" },
      { table: "households", seededId: () => "" },
      { table: "public_pages", seededId: () => "" },
    ];

    for (const { table, seededId } of cases) {
      it(`gives anon nothing from ${table}`, async () => {
        const { data, error } = await anon.from(table).select("*");

        // A permission error is the expected outcome, because anon has no grant at all. An empty
        // result is also acceptable; a seeded row coming back is not.
        if (error) {
          expect(error.message).toBeTruthy();
          return;
        }

        const rows = data ?? [];
        const id = seededId();
        if (id) {
          expect(rows.map((row: { id?: string }) => row.id)).not.toContain(id);
        }
        expect(rows).toEqual([]);
      });
    }
  });
});
