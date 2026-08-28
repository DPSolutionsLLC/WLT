// @vitest-environment node
//
// Migration 056c's read-wide / write-narrow split on `activity_attendees`, asserted from the
// database rather than from the routes.
//
// ---------------------------------------------------------------------------
// THE FIVE THINGS THIS SUITE EXISTS FOR
// ---------------------------------------------------------------------------
// 1. ANYBODY PUTS THEMSELVES DOWN. An org secretary — who holds `youth_activities.view` and
//    `.log` but not `.manage` — inserts a row naming themselves. 08-youth-activities.md §Step 4
//    says anyone self-adds, and that is the person most likely to turn up to a basketball game.
//
// 2. NOBODY PUTS SOMEBODY ELSE DOWN, EXCEPT THE BISHOPRIC. An org president cannot insert a row
//    naming another user. Only INSERT raises, which is why this one case can be asserted on the
//    error and the rest cannot.
//
// 3. READS STAY WARD-WIDE, AND THAT IS LOAD-BEARING RATHER THAN CONVENIENT. An Elders Quorum
//    president reads an attendee row on a Young Women event. Coverage is computed from an
//    attendee COUNT, so if one reader could see rows another could not, the same event would read
//    covered to one leader and uncovered to another FROM THE SAME DATA AT THE SAME INSTANT.
//    Migration 056c's header argues it; without this case the ward-wide select could be an
//    accident of the seed rather than a decision, and the first person to "tidy up" the policy
//    would find every test still green.
//
// 4. A REFUSED UPDATE OR DELETE IS A ZERO-ROW SUCCESS, NOT AN ERROR. Every refusal below is
//    asserted by RE-READING the row with the service client. Asserting on `error` alone would
//    pass against a policy that permits everything.
//
// 5. CROSS-WARD ISOLATION, BOTH WAYS.
//
// The suite runs over the network against the shared hosted project, so it cleans up after itself
// and never assumes an empty table (CLAUDE.md §9).

import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asRole } from "@/tests/helpers/asRole";
import { seedFixtures, type Fixtures } from "@/tests/helpers/seed";
import type { Database } from "@/types/database";

describe("activity attendee scoping", () => {
  let fixtures: Fixtures;

  let eqPresident: SupabaseClient<Database>;
  let eqSecretary: SupabaseClient<Database>;
  let rsPresident: SupabaseClient<Database>;
  let bishop: SupabaseClient<Database>;
  let wardBBishop: SupabaseClient<Database>;

  // One event owned by the Elders Quorum's profile and one by the Relief Society's, so a
  // cross-organization read has something real to find.
  let eqEventId: string;
  let rsEventId: string;
  let wardBEventId: string;
  // A third ward A event, untouched by every other case, so the unique-index test can prove that
  // the SAME person on a DIFFERENT event is allowed without colliding with a row an earlier test
  // in this file already wrote.
  let spareEventId: string;

  // Kept so a case that needs a FRESH event can make one. Migration 056b makes (event_id,
  // user_id) unique, so a test seeding a pair another case already wrote fails with a constraint
  // violation — which is the index working, and the reason the delete cases below each get their
  // own event rather than reusing one.
  let eqProfileId: string;
  const createdEvents: string[] = [];

  // Seeded rows, used as the targets of the refusal cases.
  let eqPresidentOwnRowId: string;
  let rsPresidentOwnRowId: string;
  let wardBRowId: string;

  const createdAttendees: string[] = [];

  const seedYouth = async (wardId: string, label: string): Promise<string> => {
    const { data, error } = await fixtures.service
      .from("members")
      .insert({
        ward_id: wardId,
        first_name: label,
        last_name: `Attendee${fixtures.runId}`,
        category: "youth",
        status: "active",
      })
      .select("id")
      .single();

    if (error) throw new Error(error.message);
    return data.id;
  };

  const seedProfile = async (
    wardId: string,
    orgId: string | null,
    memberId: string,
    name: string,
  ): Promise<string> => {
    const { data, error } = await fixtures.service
      .from("youth_activity_profiles")
      .insert({
        ward_id: wardId,
        org_id: orgId,
        member_id: memberId,
        activity_name: `${name} ${fixtures.runId}`,
        activity_type: "sport",
      })
      .select("id")
      .single();

    if (error) throw new Error(error.message);
    return data.id;
  };

  const seedEvent = async (
    wardId: string,
    profileId: string,
    title: string,
  ): Promise<string> => {
    const { data, error } = await fixtures.service
      .from("activity_events")
      .insert({
        ward_id: wardId,
        profile_id: profileId,
        title: `${title} ${fixtures.runId}`,
        event_type: "home",
        event_date: new Date(Date.now() + 86_400_000 * 30).toISOString(),
        status: "upcoming",
      })
      .select("id")
      .single();

    if (error) throw new Error(error.message);
    return data.id;
  };

  const seedAttendee = async (
    wardId: string,
    eventId: string,
    userId: string,
    assignedBy: string | null = null,
  ): Promise<string> => {
    const { data, error } = await fixtures.service
      .from("activity_attendees")
      .insert({ ward_id: wardId, event_id: eventId, user_id: userId, assigned_by: assignedBy })
      .select("id")
      .single();

    if (error) throw new Error(error.message);
    createdAttendees.push(data.id);
    return data.id;
  };

  // The service client bypasses RLS, so this is the ground truth a refused write is measured
  // against. A zero-row DELETE looks identical to a successful one from the caller's side.
  const rowExists = async (attendeeId: string): Promise<boolean> => {
    const { data, error } = await fixtures.service
      .from("activity_attendees")
      .select("id")
      .eq("id", attendeeId)
      .maybeSingle();

    if (error) throw new Error(error.message);
    return data !== null;
  };

  const storedConfirmed = async (attendeeId: string): Promise<boolean | null> => {
    const { data, error } = await fixtures.service
      .from("activity_attendees")
      .select("confirmed_attendance")
      .eq("id", attendeeId)
      .maybeSingle();

    if (error) throw new Error(error.message);
    return data?.confirmed_attendance ?? null;
  };

  const readableAttendeeIds = async (
    client: SupabaseClient<Database>,
  ): Promise<Set<string>> => {
    const { data, error } = await client.from("activity_attendees").select("id");

    expect(error).toBeNull();
    return new Set((data ?? []).map((row) => row.id));
  };

  beforeAll(async () => {
    fixtures = await seedFixtures([
      "bishop",
      "eqPresident",
      "eqSecretary",
      "rsPresident",
      "wardBBishop",
    ]);

    [eqPresident, eqSecretary, rsPresident, bishop, wardBBishop] = await Promise.all([
      asRole(fixtures, "eqPresident"),
      asRole(fixtures, "eqSecretary"),
      asRole(fixtures, "rsPresident"),
      asRole(fixtures, "bishop"),
      asRole(fixtures, "wardBBishop"),
    ]);

    const [wardAYouth, wardBYouth] = await Promise.all([
      seedYouth(fixtures.wardAId, "Ada"),
      seedYouth(fixtures.wardBId, "Bo"),
    ]);

    const [eqProfile, rsProfile, wardBProfile] = await Promise.all([
      seedProfile(fixtures.wardAId, fixtures.eldersQuorumId, wardAYouth, "EQ basketball"),
      seedProfile(fixtures.wardAId, fixtures.reliefSocietyId, wardAYouth, "RS choir"),
      seedProfile(fixtures.wardBId, fixtures.wardBOrgId, wardBYouth, "Ward B track"),
    ]);

    eqProfileId = eqProfile;

    [eqEventId, rsEventId, wardBEventId, spareEventId] = await Promise.all([
      seedEvent(fixtures.wardAId, eqProfile, "EQ game"),
      seedEvent(fixtures.wardAId, rsProfile, "RS concert"),
      seedEvent(fixtures.wardBId, wardBProfile, "Ward B meet"),
      seedEvent(fixtures.wardAId, eqProfile, "EQ second game"),
    ]);

    eqPresidentOwnRowId = await seedAttendee(
      fixtures.wardAId,
      eqEventId,
      fixtures.user("eqPresident").id,
    );

    // On the RELIEF SOCIETY'S event, deliberately — this is the row the cross-organization read
    // case looks for.
    rsPresidentOwnRowId = await seedAttendee(
      fixtures.wardAId,
      rsEventId,
      fixtures.user("rsPresident").id,
    );

    wardBRowId = await seedAttendee(
      fixtures.wardBId,
      wardBEventId,
      fixtures.user("wardBBishop").id,
    );
  }, 180_000);

  // A fresh event, so a delete case can seed an attendee pair no other case has written.
  const seedOwnEvent = async (title: string): Promise<string> => {
    const eventId = await seedEvent(fixtures.wardAId, eqProfileId, title);
    createdEvents.push(eventId);
    return eventId;
  };

  afterAll(async () => {
    if (createdAttendees.length > 0) {
      await fixtures.service.from("activity_attendees").delete().in("id", createdAttendees);
    }
    if (createdEvents.length > 0) {
      await fixtures.service.from("activity_events").delete().in("id", createdEvents);
    }
    await fixtures?.cleanup();
  });

  describe("reading is ward-wide, which is what makes coverage uniformly evaluable", () => {
    it("lets an Elders Quorum president read an attendee row on a Young Women event", () => {
      // The load-bearing case. If this ever narrows, two leaders reading the same event would
      // compute different coverage from the same data at the same instant — and a rule that is
      // not uniformly evaluable is not a rule (CLAUDE.md, the all-organizations unclaimed rule).
      return readableAttendeeIds(eqPresident).then((ids) => {
        expect(ids.has(rsPresidentOwnRowId)).toBe(true);
      });
    });

    it("lets an org secretary read them too", async () => {
      const ids = await readableAttendeeIds(eqSecretary);

      expect(ids.has(eqPresidentOwnRowId)).toBe(true);
      expect(ids.has(rsPresidentOwnRowId)).toBe(true);
    });

    it("hides another ward's rows from ward A", async () => {
      const ids = await readableAttendeeIds(bishop);

      expect(ids.has(eqPresidentOwnRowId)).toBe(true);
      expect(ids.has(wardBRowId)).toBe(false);
    });

    it("hides ward A's rows from ward B", async () => {
      const ids = await readableAttendeeIds(wardBBishop);

      expect(ids.has(wardBRowId)).toBe(true);
      expect(ids.has(eqPresidentOwnRowId)).toBe(false);
      expect(ids.has(rsPresidentOwnRowId)).toBe(false);
    });
  });

  describe("inserting", () => {
    it("lets an org secretary put themselves down", async () => {
      const { data, error } = await eqSecretary
        .from("activity_attendees")
        .insert({
          ward_id: fixtures.wardAId,
          event_id: eqEventId,
          user_id: fixtures.user("eqSecretary").id,
        })
        .select("id")
        .single();

      expect(error).toBeNull();
      expect(data).not.toBeNull();
      if (data) createdAttendees.push(data.id);
    });

    it("lets a leader put themselves down on ANOTHER organization's event", async () => {
      // Writes are narrowed by WHO the row names, not by whose event it is. `activity_events` has
      // no org_id (migration 054d), so an event's organization lives on its profile — and a
      // Young Men president turning up to a Young Women concert is coordination, not trespass.
      const { data, error } = await eqPresident
        .from("activity_attendees")
        .insert({
          ward_id: fixtures.wardAId,
          event_id: rsEventId,
          user_id: fixtures.user("eqPresident").id,
        })
        .select("id")
        .single();

      expect(error).toBeNull();
      if (data) createdAttendees.push(data.id);
    });

    // Only INSERT raises, so this is the one refusal that can be asserted on the error.
    it("refuses a leader naming another user", async () => {
      const { error } = await eqPresident.from("activity_attendees").insert({
        ward_id: fixtures.wardAId,
        event_id: eqEventId,
        user_id: fixtures.user("eqSecretary").id,
      });

      expect(error).not.toBeNull();
    });

    it("lets the bishopric name somebody else, and records who asked", async () => {
      const { data, error } = await bishop
        .from("activity_attendees")
        .insert({
          ward_id: fixtures.wardAId,
          event_id: rsEventId,
          user_id: fixtures.user("eqSecretary").id,
          assigned_by: fixtures.user("bishop").id,
        })
        .select("id, assigned_by")
        .single();

      expect(error).toBeNull();
      expect(data?.assigned_by).toBe(fixtures.user("bishop").id);
      if (data) createdAttendees.push(data.id);
    });

    it("refuses a row addressed to another ward", async () => {
      const { error } = await bishop.from("activity_attendees").insert({
        ward_id: fixtures.wardBId,
        event_id: wardBEventId,
        user_id: fixtures.user("wardBBishop").id,
      });

      expect(error).not.toBeNull();
    });

    // `assigned_by` IS NULL ON A SELF-ADD AND NO POLICY READS IT. A policy comparing against it
    // would be the talks-d hole in a third place: `assigned_by = auth.uid()` is NULL rather than
    // true for every self-added row, so a leader could not remove their own.
    it("lets a self-add carry a null assigned_by without the policy caring", async () => {
      const { data, error } = await rsPresident
        .from("activity_attendees")
        .insert({
          ward_id: fixtures.wardAId,
          event_id: eqEventId,
          user_id: fixtures.user("rsPresident").id,
          assigned_by: null,
        })
        .select("id")
        .single();

      expect(error).toBeNull();
      if (data) createdAttendees.push(data.id);
    });
  });

  describe("deleting", () => {
    it("lets a leader remove their own row", async () => {
      const rowId = await seedAttendee(
        fixtures.wardAId,
        await seedOwnEvent("EQ delete-own game"),
        fixtures.user("eqSecretary").id,
      );

      const { error } = await eqSecretary
        .from("activity_attendees")
        .delete()
        .eq("id", rowId);

      expect(error).toBeNull();
      expect(await rowExists(rowId)).toBe(false);
    });

    // A zero-row success, not an error — so the row is re-read rather than the error inspected.
    it("refuses a leader removing another user's row", async () => {
      const { error } = await eqPresident
        .from("activity_attendees")
        .delete()
        .eq("id", rsPresidentOwnRowId);

      expect(error).toBeNull();
      expect(await rowExists(rsPresidentOwnRowId)).toBe(true);
    });

    it("lets the bishopric withdraw somebody else's row", async () => {
      const rowId = await seedAttendee(
        fixtures.wardAId,
        await seedOwnEvent("EQ withdraw game"),
        fixtures.user("rsPresident").id,
        fixtures.user("bishop").id,
      );

      const { error } = await bishop.from("activity_attendees").delete().eq("id", rowId);

      expect(error).toBeNull();
      expect(await rowExists(rowId)).toBe(false);
    });

    it("refuses another ward's row", async () => {
      const { error } = await bishop.from("activity_attendees").delete().eq("id", wardBRowId);

      expect(error).toBeNull();
      expect(await rowExists(wardBRowId)).toBe(true);
    });
  });

  // NOTHING IN SLICE C WRITES `confirmed_attendance` — slice D does. The UPDATE policy is
  // narrowed now anyway, because leaving migration 019's ward-wide one in place until then would
  // let anybody in the ward confirm somebody else's attendance. Asserting it here is what stops
  // that being discovered a slice later.
  describe("updating, which slice D will need", () => {
    it("lets a leader confirm their own attendance", async () => {
      const { error } = await eqPresident
        .from("activity_attendees")
        .update({ confirmed_attendance: true })
        .eq("id", eqPresidentOwnRowId);

      expect(error).toBeNull();
      expect(await storedConfirmed(eqPresidentOwnRowId)).toBe(true);
    });

    it("refuses a leader confirming somebody else's", async () => {
      const { error } = await eqPresident
        .from("activity_attendees")
        .update({ confirmed_attendance: true })
        .eq("id", rsPresidentOwnRowId);

      expect(error).toBeNull();
      expect(await storedConfirmed(rsPresidentOwnRowId)).toBeNull();
    });

    it("lets the bishopric confirm anybody's", async () => {
      const { error } = await bishop
        .from("activity_attendees")
        .update({ confirmed_attendance: true })
        .eq("id", rsPresidentOwnRowId);

      expect(error).toBeNull();
      expect(await storedConfirmed(rsPresidentOwnRowId)).toBe(true);
    });
  });

  // Migration 056b. Without it, tapping "I'll go" twice on a slow phone — the whole context this
  // module runs in — writes two rows, and every coverage count reads two people going where one
  // is.
  describe("the unique index", () => {
    it("refuses a second row for the same person on the same event", async () => {
      const { error } = await eqPresident.from("activity_attendees").insert({
        ward_id: fixtures.wardAId,
        event_id: eqEventId,
        user_id: fixtures.user("eqPresident").id,
      });

      expect(error).not.toBeNull();
      expect(error?.code).toBe("23505");
    });

    it("allows the same person on a DIFFERENT event", async () => {
      const { data, error } = await eqPresident
        .from("activity_attendees")
        .insert({
          ward_id: fixtures.wardAId,
          event_id: spareEventId,
          user_id: fixtures.user("eqPresident").id,
        })
        .select("id")
        .single();

      expect(error).toBeNull();
      if (data) createdAttendees.push(data.id);
    });
  });
});
