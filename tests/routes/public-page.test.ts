// @vitest-environment node
//
// The page itself, rendered with NO SESSION, against the real database.
//
// The node environment is required, not cosmetic: tests/helpers/seed.ts uses the service-role
// client, and lib/supabase/service.ts THROWS when `window` is defined so the key can never reach
// browser code. react-dom/server renders happily without a DOM.
//
// ---------------------------------------------------------------------------------------------
// WHY THERE IS NO MOCK IN THIS FILE
// ---------------------------------------------------------------------------------------------
// tests/helpers/routeClient.ts exists because createServerSupabaseClient() reads next/headers for
// a session cookie. This page HAS no session and never calls that factory — it uses
// createAnonSupabaseClient(), which takes the anon key and no cookies at all. So there is nothing
// to mock: the page is an async function, calling it is an ordinary call, and every query it runs
// goes over the network as a genuine unauthenticated visitor.
//
// That is the whole value of this suite. A mocked client would prove the JSX renders; this proves
// that the grants, the view's WHERE clause and the page's own branching agree with each other.
//
// ---------------------------------------------------------------------------------------------
// notFound() IS A THROW
// ---------------------------------------------------------------------------------------------
// next/navigation's notFound() raises an error carrying a `digest` of "NEXT_HTTP_ERROR_FALLBACK;404"
// rather than returning anything, so a 404 is asserted by catching it. Asserting only that the
// call rejects would also pass when the page crashed for some unrelated reason, so the digest is
// checked too.

import type { SupabaseClient } from "@supabase/supabase-js";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import PublicSlugPage from "@/app/public/[slug]/page";
import type { ProgramDraft } from "@/lib/program/draft";
import { toPublicProgram } from "@/lib/program/publicProjection";
import { seedFixtures, type Fixtures } from "@/tests/helpers/seed";

const NOT_FOUND_DIGEST = "NEXT_HTTP_ERROR_FALLBACK;404";

const MEMBER_SURNAME = "Whitfield";
const MEMBER_PHONE = "555-0142";
const HOUSEHOLD_ADDRESS = "2201 Canyon Road";
const CONTACT_PHONE = "555-0100";

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
      { slotNumber: 3, kind: "empty", printedName: null, publicName: null, topic: null },
    ],
    closingHymn: { number: 152, title: "God Be with You Till We Meet Again" },
    benediction: null,
    announcements: "Ward temple night is on the 14th.",
    leadershipContacts: [{ role: "Bishop", name: "Mark Andersen", phone: CONTACT_PHONE }],
    missionaries: `Elder Kim — ${HOUSEHOLD_ADDRESS}`,
    missing: ["organist", "chorister"],
  };
}

async function renderSlug(slug: string): Promise<string> {
  const element = await PublicSlugPage({ params: Promise.resolve({ slug }) });
  return renderToStaticMarkup(element);
}

async function digestOf(slug: string): Promise<string | undefined> {
  try {
    await renderSlug(slug);
    return undefined;
  } catch (error) {
    return (error as { digest?: string }).digest;
  }
}

describe("/public/[slug]", () => {
  let fixtures: Fixtures;
  let service: SupabaseClient;

  let liveSlug: string;
  let inactiveSlug: string;
  let undistributedWardSlug: string;
  let assignmentsSlug: string;
  let liveProgramId: string;

  beforeAll(async () => {
    fixtures = await seedFixtures([]);
    service = fixtures.service as unknown as SupabaseClient;

    liveSlug = `page-live-${fixtures.runId}`;
    inactiveSlug = `page-off-${fixtures.runId}`;
    // Ward B carries the not-yet-distributed case. A slug matches every distributed program in
    // ITS OWN ward, so "this ward has published nothing" is the only way to seed it — putting an
    // undistributed program in ward A beside a distributed one would prove nothing.
    undistributedWardSlug = `page-pending-${fixtures.runId}`;
    assignmentsSlug = `page-assign-${fixtures.runId}`;

    const { data: household, error: householdError } = await service
      .from("households")
      .insert({
        ward_id: fixtures.wardAId,
        family_name: MEMBER_SURNAME,
        address: HOUSEHOLD_ADDRESS,
      })
      .select("id")
      .single();
    if (householdError) throw new Error(householdError.message);

    const { data: member, error: memberError } = await service
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

    const { data: sundayA, error: sundayAError } = await service
      .from("sundays")
      .insert({ ward_id: fixtures.wardAId, date: "2026-05-03" })
      .select("id")
      .single();
    if (sundayAError) throw new Error(sundayAError.message);

    const { data: sundayB, error: sundayBError } = await service
      .from("sundays")
      .insert({ ward_id: fixtures.wardBId, date: "2026-05-03" })
      .select("id")
      .single();
    if (sundayBError) throw new Error(sundayBError.message);

    const { data: liveProgram, error: liveError } = await service
      .from("programs")
      .insert({
        ward_id: fixtures.wardAId,
        sunday_id: sundayA.id,
        status: "distributed",
        draft_data: draftFor("2026-05-03"),
        public_data: toPublicProgram(draftFor("2026-05-03")),
        distributed_at: "2026-05-03T18:00:00Z",
      })
      .select("id")
      .single();
    if (liveError) throw new Error(liveError.message);
    liveProgramId = liveProgram.id;

    const { error: pendingError } = await service.from("programs").insert({
      ward_id: fixtures.wardBId,
      sunday_id: sundayB.id,
      status: "approved",
      draft_data: draftFor("2026-05-03"),
      public_data: toPublicProgram(draftFor("2026-05-03")),
    });
    if (pendingError) throw new Error(pendingError.message);

    const { error: pageError } = await service.from("public_pages").insert([
      {
        ward_id: fixtures.wardAId,
        page_type: "program",
        slug: liveSlug,
        is_active: true,
      },
      {
        ward_id: fixtures.wardAId,
        page_type: "program",
        slug: inactiveSlug,
        is_active: false,
      },
      {
        ward_id: fixtures.wardBId,
        page_type: "program",
        slug: undistributedWardSlug,
        is_active: true,
      },
      {
        ward_id: fixtures.wardAId,
        page_type: "sacrament_assignments",
        slug: assignmentsSlug,
        is_active: true,
      },
    ]);
    if (pageError) throw new Error(pageError.message);

    // public_sacrament_assignments only returns rows when there IS an assignment behind the slug,
    // and hasPublicAssignmentsPage() asks that view whether the slug is known. Without this row
    // the assignments slug would 404 and the phase-10 branch would never be exercised.
    const { error: assignmentError } = await service.from("sacrament_assignments").insert({
      ward_id: fixtures.wardAId,
      sunday_id: sundayA.id,
      assignment_type: "bread_blessing",
      member_ids: [member.id],
    });
    if (assignmentError) throw new Error(assignmentError.message);
  });

  afterAll(async () => {
    await fixtures?.cleanup();
  });

  describe("a distributed program", () => {
    it("renders with no session at all", async () => {
      const html = await renderSlug(liveSlug);

      expect(html).toContain("Sacrament Meeting");
      expect(html).toContain("May 3, 2026");
      expect(html).toContain("We Thank Thee, O God, for a Prophet");
      expect(html).toContain("Ward temple night is on the 14th.");
    });

    // Everybody named in full, end to end, on one rendered page — the ward member and the
    // visiting speaker alike (product decision, 2026-08-24).
    it("names the member and the visiting speaker in full alike", async () => {
      const html = await renderSlug(liveSlug);

      expect(html).toContain(`Sarah ${MEMBER_SURNAME}`);
      expect(html).toContain("President Mark Andersen");
    });

    // The assertion this suite exists for. It scans the RENDERED HTML rather than the props, so a
    // field reaching the page through any route at all — a widened view, a widened prop, a
    // component reading something it should not — fails here.
    it("puts no phone, address or leadership contact in the HTML", async () => {
      const html = await renderSlug(liveSlug);

      expect(html).not.toContain(MEMBER_PHONE);
      expect(html).not.toContain(CONTACT_PHONE);
      expect(html).not.toContain(HOUSEHOLD_ADDRESS);
      expect(html).not.toContain("Elder Kim");
      expect(html).not.toContain("Bishop");
    });

    // A GAP KEEPS ITS LINE AND SAYS IT IS EMPTY. Reversed on 2026-08-24 walking scenario 032: a
    // slot that vanished looked correct, so nobody could tell "this meeting has two speakers" from
    // "nobody filled in the third", and nothing ever prompted the bishopric to fix the Sunday's
    // slot count.
    it("keeps an empty meeting-order line and marks it empty", async () => {
      const html = await renderSlug(liveSlug);

      // The fixture has no organist and no chorister.
      expect(html).toContain("Organist");
      expect(html).toContain("Chorister");
      expect(html).toContain("Nobody yet");
    });

    it("keeps an empty speaking slot rather than dropping it", async () => {
      const html = await renderSlug(liveSlug);

      // Slot 3 is `kind: "empty"` in the fixture.
      expect(html).toContain("Third speaker");
    });

    // Still true, and still the rule: a placeholder baked into the DATA would be printed by
    // program-d as though somebody had typed it. The markers above are screen-only.
    it("invents no placeholder text in the stored projection", async () => {
      const html = await renderSlug(liveSlug);

      for (const placeholder of ["TBD", "Not yet assigned"]) {
        expect(html).not.toContain(placeholder);
      }
    });

    // The optional blocks are a DIFFERENT rule from the fixed lines and are still omitted when
    // empty — nothing stands open waiting for them.
    it("omits an optional block that is empty", async () => {
      const html = await renderSlug(liveSlug);

      expect(html).not.toContain("Musical number");
      expect(html).not.toContain("Ward business");
      expect(html).toContain("Announcements");
    });

    it("offers no way into the app and no sign-in prompt", async () => {
      const html = await renderSlug(liveSlug);

      expect(html).not.toContain("Sign in");
      expect(html).not.toContain("/login");
      expect(html).not.toContain("/dashboard");
    });
  });

  // Four different facts, one indistinguishable answer. A response that told them apart would let
  // somebody with a word list work out which slugs exist and which wards have a program pending.
  describe("every way of not existing is the same 404", () => {
    it("404s an unknown slug", async () => {
      expect(await digestOf(`no-such-slug-${fixtures.runId}`)).toBe(NOT_FOUND_DIGEST);
    });

    it("404s a deactivated slug", async () => {
      expect(await digestOf(inactiveSlug)).toBe(NOT_FOUND_DIGEST);
    });

    it("404s a ward whose program is approved but not distributed", async () => {
      expect(await digestOf(undistributedWardSlug)).toBe(NOT_FOUND_DIGEST);
    });

    it("404s when the stored projection cannot be parsed", async () => {
      const { error } = await service
        .from("programs")
        .update({ public_data: { version: 99, nonsense: true } })
        .eq("id", liveProgramId);
      if (error) throw new Error(error.message);

      try {
        expect(await digestOf(liveSlug)).toBe(NOT_FOUND_DIGEST);
      } finally {
        const { error: restoreError } = await service
          .from("programs")
          .update({ public_data: toPublicProgram(draftFor("2026-05-03")) })
          .eq("id", liveProgramId);
        if (restoreError) throw new Error(restoreError.message);
      }
    });
  });

  // Phase 10's branch. An active assignments slug is a page somebody was given a link to, so it
  // says "not ready" rather than "does not exist" — and it must not accidentally render a program.
  it("tells an assignments slug that it is not available yet", async () => {
    const html = await renderSlug(assignmentsSlug);

    expect(html).toContain("Not available yet");
    expect(html).not.toContain("Sacrament Meeting");
  });
});
