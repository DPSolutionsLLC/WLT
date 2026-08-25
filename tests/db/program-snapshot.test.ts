// @vitest-environment node
//
// THE SNAPSHOT RULE, PROVEN AGAINST THE DATABASE RATHER THAN REASONED ABOUT.
//
// The whole of Phase 6 rests on one claim: once a draft is written it stops tracking the calendar,
// the assignments and the prayers it came from. An approved program that silently changed after
// the bishop approved it is a trust problem, not a bug.
//
// That claim is easy to state and easy to break — one `getSunday()` call in a render path and the
// snapshot quietly becomes a view again, with no failing unit test anywhere, because a pure
// assembler will happily assemble twice and agree with itself. So this suite changes the UPSTREAM
// row in the database and re-reads the STORED draft, which is the only shape of test that can
// fail when somebody reintroduces a live read.
//
// Runs over the network against the shared hosted project (CLAUDE.md §9): every fixture is
// deleted in afterAll and nothing assumes an empty table.

import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asRole } from "@/tests/helpers/asRole";
import { seedFixtures, type Fixtures } from "@/tests/helpers/seed";
import { assembleDraft } from "@/lib/program/assembleDraft";
import { diffDrafts } from "@/lib/program/diff";
import { gatherProgramSources } from "@/lib/program/gather";
import { getProgramBySunday, upsertProgramDraft } from "@/lib/program/queries";
import type { Database } from "@/types/database";

const SUNDAY_DATE = "2027-06-06";

describe("the program draft is a snapshot, not a view", () => {
  let fixtures: Fixtures;
  let secretary: SupabaseClient<Database>;

  let sundayId = "";
  let sarahId = "";
  let ruthId = "";
  let assignmentId = "";

  beforeAll(async () => {
    fixtures = await seedFixtures(["bishop", "wardSecretary"]);
    secretary = await asRole(fixtures, "wardSecretary");

    const { data: sunday, error: sundayError } = await fixtures.service
      .from("sundays")
      .insert({
        ward_id: fixtures.wardAId,
        date: SUNDAY_DATE,
        type: "standard",
        speaking_slots: 2,
        conducting_user_id: fixtures.user("bishop").id,
      })
      .select("id")
      .single();
    if (sundayError) throw new Error(`Could not seed a Sunday: ${sundayError.message}`);
    sundayId = sunday.id;

    const { data: household, error: householdError } = await fixtures.service
      .from("households")
      .insert({ ward_id: fixtures.wardAId, family_name: "Whitfield" })
      .select("id")
      .single();
    if (householdError) throw new Error(householdError.message);

    const seedMember = async (firstName: string, lastName: string) => {
      const { data, error } = await fixtures.service
        .from("members")
        .insert({
          ward_id: fixtures.wardAId,
          household_id: household.id,
          first_name: firstName,
          last_name: lastName,
          status: "active",
          category: "adult",
        })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      return data.id;
    };

    sarahId = await seedMember("Sarah", "Whitfield");
    ruthId = await seedMember("Ruth", "Okonkwo");

    const { data: assignment, error: assignmentError } = await fixtures.service
      .from("assignments")
      .insert({
        ward_id: fixtures.wardAId,
        sunday_id: sundayId,
        member_id: sarahId,
        assignment_type: "sacrament_talk",
        slot_number: 1,
        pipeline_stage: "notify",
      })
      .select("id")
      .single();
    if (assignmentError) throw new Error(assignmentError.message);
    assignmentId = assignment.id;
  });

  afterAll(async () => {
    await fixtures.cleanup();
  });

  it("stores a draft naming the speaker who was assigned at the time", async () => {
    const sources = await gatherProgramSources(fixtures.wardAId, sundayId, secretary);
    expect(sources).not.toBeNull();

    const stored = await upsertProgramDraft(
      fixtures.wardAId,
      sundayId,
      assembleDraft(sources!),
      fixtures.user("wardSecretary").id,
      secretary,
    );

    expect(stored?.draft?.speakers[0]).toMatchObject({
      slotNumber: 1,
      kind: "member",
      printedName: "Sarah Whitfield",
      publicName: "Sarah Whitfield",
    });
    expect(stored?.draftError).toBeNull();
  });

  it("does NOT change when the assignment's speaker changes underneath it", async () => {
    const { error } = await fixtures.service
      .from("assignments")
      .update({ member_id: ruthId })
      .eq("id", assignmentId);
    if (error) throw new Error(`Could not change the speaker: ${error.message}`);

    const reread = await getProgramBySunday(fixtures.wardAId, sundayId, secretary);

    // The upstream row now says Ruth. The snapshot must still say Sarah.
    expect(reread?.draft?.speakers[0].printedName).toBe("Sarah Whitfield");
  });

  it("shows the change in a refresh diff while still writing nothing", async () => {
    const stored = await getProgramBySunday(fixtures.wardAId, sundayId, secretary);
    const sources = await gatherProgramSources(fixtures.wardAId, sundayId, secretary);

    const changes = diffDrafts(stored!.draft!, assembleDraft(sources!));

    expect(changes).toContainEqual({
      field: "speakers.1.printedName",
      label: "First speaker",
      before: "Sarah Whitfield",
      after: "Ruth Okonkwo",
    });

    // Computing the diff must not have written anything — this is `apply: false`.
    const afterDiff = await getProgramBySunday(fixtures.wardAId, sundayId, secretary);
    expect(afterDiff?.draft?.speakers[0].printedName).toBe("Sarah Whitfield");
  });

  it("takes the change only when the refresh is applied", async () => {
    const sources = await gatherProgramSources(fixtures.wardAId, sundayId, secretary);

    await upsertProgramDraft(
      fixtures.wardAId,
      sundayId,
      assembleDraft(sources!),
      fixtures.user("wardSecretary").id,
      secretary,
    );

    const reread = await getProgramBySunday(fixtures.wardAId, sundayId, secretary);
    expect(reread?.draft?.speakers[0].printedName).toBe("Ruth Okonkwo");
  });

  it("reports a stored draft that no longer parses instead of returning an empty one", async () => {
    // Once program-b's AI editor exists this is a real possibility, and a malformed draft that
    // read as "never built" would send a secretary to rebuild rather than to report a bug.
    const { error } = await fixtures.service
      .from("programs")
      .update({ draft_data: { version: 1, speakers: "not an array" } })
      .eq("ward_id", fixtures.wardAId)
      .eq("sunday_id", sundayId);
    if (error) throw new Error(error.message);

    const reread = await getProgramBySunday(fixtures.wardAId, sundayId, secretary);

    expect(reread?.draft).toBeNull();
    expect(reread?.draftError).toContain("could not be read");
  });
});
