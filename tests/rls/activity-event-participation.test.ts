// @vitest-environment node
//
// Migration 062f's policies on `activity_event_participation`, asserted from the database rather
// than from the route.
//
// ---------------------------------------------------------------------------
// WHY THIS TABLE'S READ MUST BE WARD-WIDE, AND WHY THAT IS NOT AN OVERSIGHT
// ---------------------------------------------------------------------------
// COVERAGE IS COMPUTED FROM IT. A game everybody on the roster is marked absent for resolves to
// `not_expected` at every distance from the clock — so if one reader could see participation rows
// another could not, THE SAME GAME WOULD READ COVERED TO ONE LEADER AND UNCOVERED TO ANOTHER from
// the same data at the same instant, and neither of them would be wrong.
//
// That is migration 056c's uniform-evaluability rule, which 062f's third reason restates for this
// table by name, and it is the same argument that keeps `activity_attendees`' ward-wide SELECT
// untouched since migration 019.
//
// ---------------------------------------------------------------------------
// AND WHY THE WRITE IS WARD-WIDE TOO
// ---------------------------------------------------------------------------
// Migration 061 says in as many words that recording this fact is "an ORDINARY UPDATE on
// `activity_events`, which keeps migration 019's ward-wide write policies… the same boundary
// `Cancel` already runs under". Moving the fact to a new table had to move NO boundary, or
// migration 062 would not be the purely structural change it claims to be. The cross-organization
// write below asserts that, so a future narrowing breaks a test rather than silently removing the
// feature (youth-g's pattern).
//
// ---------------------------------------------------------------------------
// THE THIRD STATE IS THE ABSENCE OF THE ROW, AND CLEARING IS A DELETE
// ---------------------------------------------------------------------------
// Asserted from the database side, because it is the storage decision the whole exception-shaped
// control rests on: `taking_part` is `not null`, so "nobody has said" cannot be spelled as a
// value — it is spelled as no row.
//
// A REFUSED UPDATE OR DELETE IS A ZERO-ROW SUCCESS, NOT AN ERROR. Only INSERT raises.

import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asRole } from "@/tests/helpers/asRole";
import { seedFixtures, type Fixtures } from "@/tests/helpers/seed";
import type { Database } from "@/types/database";

describe("activity event participation scoping", () => {
  let fixtures: Fixtures;

  let eqPresident: SupabaseClient<Database>;
  let rsPresident: SupabaseClient<Database>;
  let bishop: SupabaseClient<Database>;
  let wardBBishop: SupabaseClient<Database>;

  let wardAYouthId: string;
  let wardBYouthId: string;

  let rsEventId: string;
  let wardBEventId: string;

  let rsParticipationId: string;
  let wardBParticipationId: string;

  const seedTeamWithEvent = async (
    orgId: string | null,
    wardId: string,
    memberId: string,
    name: string,
  ): Promise<string> => {
    const { data: profile, error: profileError } = await fixtures.service
      .from("youth_activity_profiles")
      .insert({
        ward_id: wardId,
        org_id: orgId,
        activity_name: `${name} ${fixtures.runId}`,
        activity_type: "sport",
      })
      .select("id")
      .single();
    if (profileError) throw new Error(profileError.message);

    const { error: rosterError } = await fixtures.service.from("activity_roster").insert({
      ward_id: wardId,
      profile_id: profile.id,
      member_id: memberId,
    });
    if (rosterError) throw new Error(rosterError.message);

    const { data: event, error: eventError } = await fixtures.service
      .from("activity_events")
      .insert({
        ward_id: wardId,
        profile_id: profile.id,
        title: `${name} game ${fixtures.runId}`,
        event_date: "2027-01-16T02:30:00.000Z",
        event_type: "home",
        status: "upcoming",
      })
      .select("id")
      .single();
    if (eventError) throw new Error(eventError.message);

    return event.id;
  };

  const seedParticipation = async (
    wardId: string,
    eventId: string,
    memberId: string,
    takingPart: boolean,
  ): Promise<string> => {
    const { data, error } = await fixtures.service
      .from("activity_event_participation")
      .insert({
        ward_id: wardId,
        event_id: eventId,
        member_id: memberId,
        taking_part: takingPart,
      })
      .select("id")
      .single();

    if (error) throw new Error(error.message);
    return data.id;
  };

  // The service client bypasses RLS, so this is the ground truth a refused write is measured
  // against. `undefined` means the row is gone; `null` is not a value this column can hold.
  const storedTakingPart = async (id: string): Promise<boolean | undefined> => {
    const { data, error } = await fixtures.service
      .from("activity_event_participation")
      .select("taking_part")
      .eq("id", id)
      .maybeSingle();

    if (error) throw new Error(error.message);
    return data === null ? undefined : data.taking_part;
  };

  const readableIds = async (client: SupabaseClient<Database>): Promise<Set<string>> => {
    const { data, error } = await client.from("activity_event_participation").select("id");

    expect(error).toBeNull();
    return new Set((data ?? []).map((row) => row.id));
  };

  beforeAll(async () => {
    fixtures = await seedFixtures(["bishop", "eqPresident", "rsPresident", "wardBBishop"]);

    [eqPresident, rsPresident, bishop, wardBBishop] = await Promise.all([
      asRole(fixtures, "eqPresident"),
      asRole(fixtures, "rsPresident"),
      asRole(fixtures, "bishop"),
      asRole(fixtures, "wardBBishop"),
    ]);

    const { data: members, error: memberError } = await fixtures.service
      .from("members")
      .insert([
        {
          ward_id: fixtures.wardAId,
          first_name: "Ada",
          last_name: `PartA${fixtures.runId}`,
          category: "youth",
          status: "active",
        },
        {
          ward_id: fixtures.wardBId,
          first_name: "Bo",
          last_name: `PartB${fixtures.runId}`,
          category: "youth",
          status: "active",
        },
      ])
      .select("id, ward_id");
    if (memberError) throw new Error(memberError.message);

    wardAYouthId = members!.find((row) => row.ward_id === fixtures.wardAId)!.id;
    wardBYouthId = members!.find((row) => row.ward_id === fixtures.wardBId)!.id;

    // OWNED BY THE RELIEF SOCIETY, so the Elders Quorum president is genuinely writing across an
    // organization boundary below.
    rsEventId = await seedTeamWithEvent(
      fixtures.reliefSocietyId,
      fixtures.wardAId,
      wardAYouthId,
      "RS choir",
    );
    wardBEventId = await seedTeamWithEvent(
      fixtures.wardBOrgId,
      fixtures.wardBId,
      wardBYouthId,
      "Ward B track",
    );

    rsParticipationId = await seedParticipation(
      fixtures.wardAId,
      rsEventId,
      wardAYouthId,
      false,
    );
    wardBParticipationId = await seedParticipation(
      fixtures.wardBId,
      wardBEventId,
      wardBYouthId,
      false,
    );
  }, 60_000);

  afterAll(async () => {
    await fixtures.cleanup();
  });

  describe("ward isolation", () => {
    it("hides another ward's participation rows", async () => {
      const readable = await readableIds(bishop);

      expect(readable.has(rsParticipationId)).toBe(true);
      expect(readable.has(wardBParticipationId)).toBe(false);
    });

    it("hides ward A's participation rows from ward B", async () => {
      const readable = await readableIds(wardBBishop);

      expect(readable.has(wardBParticipationId)).toBe(true);
      expect(readable.has(rsParticipationId)).toBe(false);
    });

    it("refuses an insert carrying another ward's id", async () => {
      const { error } = await eqPresident.from("activity_event_participation").insert({
        ward_id: fixtures.wardBId,
        event_id: wardBEventId,
        member_id: wardBYouthId,
        taking_part: false,
      });

      expect(error).not.toBeNull();
    });

    it("cannot update another ward's participation row", async () => {
      const { error } = await eqPresident
        .from("activity_event_participation")
        .update({ taking_part: true })
        .eq("id", wardBParticipationId);

      // A ZERO-ROW SUCCESS. Asserting on `error` alone would pass against a policy that permits
      // everything, which is why the row is re-read.
      expect(error).toBeNull();
      expect(await storedTakingPart(wardBParticipationId)).toBe(false);
    });

    it("cannot delete another ward's participation row", async () => {
      const { error } = await eqPresident
        .from("activity_event_participation")
        .delete()
        .eq("id", wardBParticipationId);

      expect(error).toBeNull();
      expect(await storedTakingPart(wardBParticipationId)).toBe(false);
    });
  });

  describe("across organizations, inside one ward", () => {
    it("lets an Elders Quorum president READ a Relief Society team's participation", async () => {
      const readable = await readableIds(eqPresident);

      expect(readable.has(rsParticipationId)).toBe(true);
    });

    // THE ONE THAT WILL SURPRISE A READER. Migration 061 already put this exact fact under
    // ward-wide writes; 062 had to move no boundary. A leader from another organization marking a
    // young person as not taking part is the same trust level as calling off their game, which
    // this app already permits.
    it("lets an Elders Quorum president WRITE on a Relief Society team's event", async () => {
      const { error } = await eqPresident
        .from("activity_event_participation")
        .update({ taking_part: true })
        .eq("id", rsParticipationId);

      expect(error).toBeNull();
      expect(await storedTakingPart(rsParticipationId)).toBe(true);

      await fixtures.service
        .from("activity_event_participation")
        .update({ taking_part: false })
        .eq("id", rsParticipationId);
    });

    // THE UNIQUE INDEX, from the database side: one answer per (event, young person). It is what
    // makes setParticipation() an upsert rather than a read-then-write, so a double tap on a slow
    // phone writes one row.
    it("refuses a second row for the same (event, young person)", async () => {
      const { error } = await rsPresident.from("activity_event_participation").insert({
        ward_id: fixtures.wardAId,
        event_id: rsEventId,
        member_id: wardAYouthId,
        taking_part: true,
      });

      expect(error?.code).toBe("23505");
    });
  });

  // ---------------------------------------------------------------------------
  // THE THIRD STATE IS THE ABSENCE OF THE ROW
  // ---------------------------------------------------------------------------
  describe("three states, and the third is no row", () => {
    // `taking_part` IS `not null`, AND THAT IS THE CONTRAST WITH MIGRATION 061 rather than a
    // departure from it. 061 needed a nullable column because the fact lived on a row that always
    // exists; here the row is created only when somebody answers, so a nullable column would be a
    // SECOND way to spell the same third state.
    it("refuses a null answer at the column level", async () => {
      const { error } = await fixtures.service
        .from("activity_event_participation")
        .insert({
          ward_id: fixtures.wardAId,
          event_id: rsEventId,
          member_id: wardAYouthId,
          // @ts-expect-error — proving the column refuses it. `taking_part` is `not null`, so
          // "nobody has said" has no spelling as a value, which is the whole design.
          taking_part: null,
        });

      expect(error).not.toBeNull();
    });

    // CLEARING DELETES THE ROW, AND THAT BREAKS NO RULE. Migration 060a's "never a delete"
    // protects a record somebody WROTE; this row holds no text, no account and no author's words
    // — it is a marker, and removing it is precisely "nobody has said".
    it("lets a leader clear an answer back to nobody-has-said", async () => {
      const id = await seedParticipation(fixtures.wardAId, rsEventId, wardAYouthId, true).catch(
        async () => {
          // The (event, member) pair above is already taken by the fixture, so clear it first and
          // reuse the same pair — the unique index is doing its job.
          await fixtures.service
            .from("activity_event_participation")
            .delete()
            .eq("id", rsParticipationId);

          return seedParticipation(fixtures.wardAId, rsEventId, wardAYouthId, true);
        },
      );

      const { error } = await rsPresident
        .from("activity_event_participation")
        .delete()
        .eq("id", id);

      expect(error).toBeNull();
      expect(await storedTakingPart(id)).toBeUndefined();

      // Restore the fixture for any later run of this file.
      rsParticipationId = await seedParticipation(
        fixtures.wardAId,
        rsEventId,
        wardAYouthId,
        false,
      );
    });
  });

  // An event has no meaning for a participation row once it is gone, so this cascade is correct
  // and is asserted rather than assumed — it is what makes "delete the event entered by mistake"
  // leave nothing behind.
  describe("deleting an event", () => {
    it("cascades to its participation rows", async () => {
      const eventId = await seedTeamWithEvent(
        fixtures.reliefSocietyId,
        fixtures.wardAId,
        wardAYouthId,
        "Doomed fixture",
      );
      const id = await seedParticipation(fixtures.wardAId, eventId, wardAYouthId, false);

      await fixtures.service.from("activity_events").delete().eq("id", eventId);

      expect(await storedTakingPart(id)).toBeUndefined();
    });
  });
});
