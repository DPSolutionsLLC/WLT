// @vitest-environment node
//
// `visit_participants` and `visit_appointments` under RLS, in both cross-org modes.
//
// The rule these two tables inherit from `visit_logs`: CROSS-ORG VISIBILITY WIDENS READS ONLY.
// With the ward setting on, an Elders Quorum leader reads who went on a Relief Society visit;
// they never gain the right to WRITE one, in either mode. Migration 046 puts
// `ward_allows_cross_org_visibility()` in the two SELECT policies and in none of the six write
// policies, and this suite is what proves that stayed true.
//
// WHY THIS SUITE HAD TO EXIST AT ALL. `visit_participants` is one line away from being in
// migration 019's ward-wide loop, where `member_organizations` sits — and in that loop an EQ
// leader would read who visited an RS household with visibility OFF. The read counts below are
// taken WARD-WIDE with no org filter, because a filtered count passes even when a permissive
// policy has survived and is letting the other organization through (plans/retros/talks-d).
//
// Every negative is asserted with an AUTHENTICATED client — the service-role client bypasses RLS
// and would prove nothing. A refused UPDATE is a ZERO-ROW SUCCESS rather than an error
// (plans/retros/route-tests-and-realtime.md), so each write refusal is proven by RE-READING the
// row with the service client afterwards.
//
// And in both modes, private notes do not move at all. Being on a visit together is not
// entitlement to somebody's private note (CLAUDE.md rule 5).
//
// Runs over the network against the shared hosted project (CLAUDE.md §9).

import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asRole } from "@/tests/helpers/asRole";
import { seedFixtures, type Fixtures } from "@/tests/helpers/seed";
import type { Database } from "@/types/database";

const EQ_LABEL = "EQ companion: a neighbour who came along";
const RS_LABEL = "RS companion: a neighbour who came along";
const EQ_PRIVATE = "EQ private: a confidence the family asked us to keep.";
const RS_PRIVATE = "RS private: a confidence the family asked us to keep.";

const EQ_APPOINTMENT = "2026-09-01T19:00:00.000Z";
const RS_APPOINTMENT = "2026-09-02T19:00:00.000Z";

describe("visit participants and appointments under RLS", () => {
  let fixtures: Fixtures;
  let eqPresident: SupabaseClient<Database>;
  let rsPresident: SupabaseClient<Database>;

  let wardId: string;
  let eqLogId: string;
  let rsLogId: string;
  let eqParticipantId: string;
  let rsParticipantId: string;
  let eqAppointmentId: string;
  let rsAppointmentId: string;

  // Flipped with the service client between phases rather than reseeded, so both halves assert
  // against the SAME rows — which is what makes "the same query, one setting apart" a real
  // comparison rather than two unrelated fixtures.
  const setCrossOrgVisibility = async (enabled: boolean): Promise<void> => {
    const { error } = await fixtures.service
      .from("wards")
      .update({ settings: { cross_org_visibility: enabled, timezone: "America/Denver" } })
      .eq("id", wardId);

    if (error) throw new Error(error.message);
  };

  const readParticipantIds = async (
    client: SupabaseClient<Database>,
  ): Promise<string[]> => {
    const { data, error } = await client
      .from("visit_participants")
      .select("id")
      .eq("ward_id", wardId)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true });

    if (error) throw new Error(error.message);
    return (data ?? []).map((row) => row.id);
  };

  const readAppointmentIds = async (
    client: SupabaseClient<Database>,
  ): Promise<string[]> => {
    const { data, error } = await client
      .from("visit_appointments")
      .select("id")
      .eq("ward_id", wardId)
      .order("scheduled_for", { ascending: true });

    if (error) throw new Error(error.message);
    return (data ?? []).map((row) => row.id);
  };

  const participantLabelOf = async (id: string): Promise<string | null> => {
    const { data, error } = await fixtures.service
      .from("visit_participants")
      .select("label")
      .eq("id", id)
      .single();

    if (error) throw new Error(error.message);
    return data.label;
  };

  const appointmentStatusOf = async (id: string): Promise<string> => {
    const { data, error } = await fixtures.service
      .from("visit_appointments")
      .select("status")
      .eq("id", id)
      .single();

    if (error) throw new Error(error.message);
    return data.status;
  };

  const countParticipantRows = async (visitLogId: string): Promise<number> => {
    const { data, error } = await fixtures.service
      .from("visit_participants")
      .select("id")
      .eq("visit_log_id", visitLogId);

    if (error) throw new Error(error.message);
    return (data ?? []).length;
  };

  beforeAll(async () => {
    fixtures = await seedFixtures(["eqPresident", "rsPresident"], {
      crossOrgVisibility: false,
    });
    wardId = fixtures.wardAId;

    eqPresident = await asRole(fixtures, "eqPresident");
    rsPresident = await asRole(fixtures, "rsPresident");

    const { data: logs, error: logError } = await fixtures.service
      .from("visit_logs")
      .insert([
        {
          ward_id: wardId,
          org_id: fixtures.eldersQuorumId,
          recorded_by: fixtures.user("eqPresident").id,
          visit_date: "2026-04-05",
          visit_type: "in_home",
        },
        {
          ward_id: wardId,
          org_id: fixtures.reliefSocietyId,
          recorded_by: fixtures.user("rsPresident").id,
          visit_date: "2026-04-12",
          visit_type: "in_home",
        },
      ])
      .select("id, org_id");
    if (logError) throw new Error(logError.message);

    eqLogId = logs.find((row) => row.org_id === fixtures.eldersQuorumId)!.id;
    rsLogId = logs.find((row) => row.org_id === fixtures.reliefSocietyId)!.id;

    // A LABEL participant on each visit, not a user one. A label is the kind that carries text a
    // leak would show verbatim, so a cross-org read either returns the sentence or it does not.
    const { data: participants, error: participantError } = await fixtures.service
      .from("visit_participants")
      .insert([
        {
          ward_id: wardId,
          org_id: fixtures.eldersQuorumId,
          visit_log_id: eqLogId,
          label: EQ_LABEL,
        },
        {
          ward_id: wardId,
          org_id: fixtures.reliefSocietyId,
          visit_log_id: rsLogId,
          label: RS_LABEL,
        },
      ])
      .select("id, org_id");
    if (participantError) throw new Error(participantError.message);

    eqParticipantId = participants.find(
      (row) => row.org_id === fixtures.eldersQuorumId,
    )!.id;
    rsParticipantId = participants.find(
      (row) => row.org_id === fixtures.reliefSocietyId,
    )!.id;

    const { data: appointments, error: appointmentError } = await fixtures.service
      .from("visit_appointments")
      .insert([
        {
          ward_id: wardId,
          org_id: fixtures.eldersQuorumId,
          scheduled_for: EQ_APPOINTMENT,
          made_by: fixtures.user("eqPresident").id,
        },
        {
          ward_id: wardId,
          org_id: fixtures.reliefSocietyId,
          scheduled_for: RS_APPOINTMENT,
          made_by: fixtures.user("rsPresident").id,
        },
      ])
      .select("id, org_id");
    if (appointmentError) throw new Error(appointmentError.message);

    eqAppointmentId = appointments.find(
      (row) => row.org_id === fixtures.eldersQuorumId,
    )!.id;
    rsAppointmentId = appointments.find(
      (row) => row.org_id === fixtures.reliefSocietyId,
    )!.id;

    // Each president writes their OWN private note through their OWN authenticated client, so
    // the participants half can be checked against an unmoved private-note boundary.
    const { error: eqNoteError } = await eqPresident.from("visit_private_notes").insert({
      ward_id: wardId,
      visit_log_id: eqLogId,
      user_id: fixtures.user("eqPresident").id,
      notes: EQ_PRIVATE,
    });
    if (eqNoteError) throw new Error(eqNoteError.message);

    const { error: rsNoteError } = await rsPresident.from("visit_private_notes").insert({
      ward_id: wardId,
      visit_log_id: rsLogId,
      user_id: fixtures.user("rsPresident").id,
      notes: RS_PRIVATE,
    });
    if (rsNoteError) throw new Error(rsNoteError.message);
  }, 60_000);

  afterAll(async () => {
    // Restored, because the setting is a ward-level row every other suite running against this
    // shared project reads too.
    await setCrossOrgVisibility(false);
    await fixtures?.cleanup();
  });

  describe("with cross-org visibility OFF", () => {
    beforeAll(async () => {
      await setCrossOrgVisibility(false);
    });

    it("shows the EQ president participants for exactly one visit across the whole ward", async () => {
      expect(await readParticipantIds(eqPresident)).toEqual([eqParticipantId]);
    });

    it("shows the EQ president exactly one appointment across the whole ward", async () => {
      expect(await readAppointmentIds(eqPresident)).toEqual([eqAppointmentId]);
    });

    it("hides the RS participant's text from the EQ president", async () => {
      const { data, error } = await eqPresident
        .from("visit_participants")
        .select("label")
        .eq("id", rsParticipantId)
        .maybeSingle();

      expect(error).toBeNull();
      expect(data).toBeNull();
      expect(JSON.stringify(data)).not.toContain(RS_LABEL);
    });
  });

  describe("with cross-org visibility ON", () => {
    beforeAll(async () => {
      await setCrossOrgVisibility(true);
    });

    it("shows the EQ president both visits' participants", async () => {
      const ids = await readParticipantIds(eqPresident);

      expect(ids).toHaveLength(2);
      expect(ids).toContain(eqParticipantId);
      expect(ids).toContain(rsParticipantId);
    });

    it("shows the EQ president both appointments", async () => {
      const ids = await readAppointmentIds(eqPresident);

      expect(ids).toHaveLength(2);
      expect(ids).toContain(eqAppointmentId);
      expect(ids).toContain(rsAppointmentId);
    });

    // The line the whole slice holds. Wider reads on who went do not widen private notes by even
    // one row — a participant is not entitled to another participant's confidence, and neither
    // is a leader who can now see the participant list.
    it("still shows the EQ president no private note but their own", async () => {
      const { data, error } = await eqPresident
        .from("visit_private_notes")
        .select("visit_log_id, notes")
        .eq("ward_id", wardId);

      expect(error).toBeNull();
      expect(data).toHaveLength(1);
      expect(data?.[0]?.visit_log_id).toBe(eqLogId);
      expect(JSON.stringify(data)).not.toContain(RS_PRIVATE);
    });
  });

  // BOTH MODES, because the write refusal must not depend on the setting at all. That is the
  // whole difference between a read policy and a write policy here.
  describe.each([
    ["OFF", false],
    ["ON", true],
  ])("writes with cross-org visibility %s", (_label, enabled) => {
    beforeAll(async () => {
      await setCrossOrgVisibility(enabled);
    });

    it("raises when the EQ president inserts a participant on the RS visit", async () => {
      const before = await countParticipantRows(rsLogId);

      const { error } = await eqPresident.from("visit_participants").insert({
        ward_id: wardId,
        org_id: fixtures.reliefSocietyId,
        visit_log_id: rsLogId,
        label: "should never exist",
      });

      // An INSERT is the one operation RLS refuses with an error rather than silently.
      expect(error).not.toBeNull();
      expect(await countParticipantRows(rsLogId)).toBe(before);
    });

    // THE ATTACK MIGRATION 048 CLOSES: claim your own organization, point at their visit. It
    // satisfies `org_id = current_org_id()` and satisfies the composite foreign key, which only
    // checks the WARD — so before 048 this INSERT succeeded and the Relief Society would read a
    // participant on their own visit that nobody in their organization put there.
    //
    // The route never produced that shape (lib/visits/participants.ts stamps org_id from the
    // PARENT visit), but a policy that holds only because the one caller is careful is not the
    // security boundary CLAUDE.md rule 2 asks for. Asserted with an authenticated client, and
    // proven by re-counting the RS visit's rows.
    it("refuses a participant pointed at the RS visit under the EQ's own org", async () => {
      const before = await countParticipantRows(rsLogId);

      const { error } = await eqPresident.from("visit_participants").insert({
        ward_id: wardId,
        org_id: fixtures.eldersQuorumId,
        visit_log_id: rsLogId,
        label: "smuggled in under the EQ's own org",
      });

      expect(error).not.toBeNull();
      expect(await countParticipantRows(rsLogId)).toBe(before);
    });

    it("changes nothing when the EQ president updates the RS participant", async () => {
      const { error } = await eqPresident
        .from("visit_participants")
        .update({ label: "overwritten" })
        .eq("id", rsParticipantId);

      // Zero rows updated is a SUCCESS. The proof is the re-read, not the error.
      expect(error).toBeNull();
      expect(await participantLabelOf(rsParticipantId)).toBe(RS_LABEL);
    });

    it("deletes nothing when the EQ president deletes the RS participant", async () => {
      const { error } = await eqPresident
        .from("visit_participants")
        .delete()
        .eq("id", rsParticipantId);

      expect(error).toBeNull();
      expect(await participantLabelOf(rsParticipantId)).toBe(RS_LABEL);
    });

    it("raises when the EQ president inserts an RS appointment", async () => {
      const { error } = await eqPresident.from("visit_appointments").insert({
        ward_id: wardId,
        org_id: fixtures.reliefSocietyId,
        scheduled_for: "2026-09-03T19:00:00.000Z",
      });

      expect(error).not.toBeNull();
    });

    it("changes nothing when the EQ president cancels the RS appointment", async () => {
      const { error } = await eqPresident
        .from("visit_appointments")
        .update({ status: "cancelled" })
        .eq("id", rsAppointmentId);

      expect(error).toBeNull();
      expect(await appointmentStatusOf(rsAppointmentId)).toBe("scheduled");
    });

    it("deletes nothing when the EQ president deletes the RS appointment", async () => {
      const { error } = await eqPresident
        .from("visit_appointments")
        .delete()
        .eq("id", rsAppointmentId);

      expect(error).toBeNull();
      expect(await appointmentStatusOf(rsAppointmentId)).toBe("scheduled");
    });
  });

  // The CHECK from migration 046, asserted through an authenticated client so it is proven where
  // a real write happens rather than only in the schema file.
  describe("the one-identity constraint", () => {
    beforeAll(async () => {
      await setCrossOrgVisibility(false);
    });

    it("refuses a participant carrying both a user and a label", async () => {
      const { error } = await eqPresident.from("visit_participants").insert({
        ward_id: wardId,
        org_id: fixtures.eldersQuorumId,
        visit_log_id: eqLogId,
        user_id: fixtures.user("eqPresident").id,
        label: "and also a neighbour",
      });

      expect(error).not.toBeNull();
    });

    it("refuses a participant carrying no identity at all", async () => {
      const { error } = await eqPresident.from("visit_participants").insert({
        ward_id: wardId,
        org_id: fixtures.eldersQuorumId,
        visit_log_id: eqLogId,
      });

      expect(error).not.toBeNull();
    });

    // A whitespace-only label is not an identity. The CHECK uses nullif(btrim(...)) precisely so
    // "  " cannot become a participant nobody can name.
    it("refuses a whitespace-only label", async () => {
      const { error } = await eqPresident.from("visit_participants").insert({
        ward_id: wardId,
        org_id: fixtures.eldersQuorumId,
        visit_log_id: eqLogId,
        label: "   ",
      });

      expect(error).not.toBeNull();
    });

    it("refuses the same leader on the same visit twice", async () => {
      const first = await eqPresident.from("visit_participants").insert({
        ward_id: wardId,
        org_id: fixtures.eldersQuorumId,
        visit_log_id: eqLogId,
        user_id: fixtures.user("eqPresident").id,
      });
      expect(first.error).toBeNull();

      const second = await eqPresident.from("visit_participants").insert({
        ward_id: wardId,
        org_id: fixtures.eldersQuorumId,
        visit_log_id: eqLogId,
        user_id: fixtures.user("eqPresident").id,
      });

      expect(second.error).not.toBeNull();

      await fixtures.service
        .from("visit_participants")
        .delete()
        .eq("visit_log_id", eqLogId)
        .eq("user_id", fixtures.user("eqPresident").id);
    });
  });

  // `on delete set null`, never cascade. Deleting a visit must not delete the record that an
  // appointment was made — that a ward arranged something is part of how it tried to reach a
  // household, whatever became of the visit row afterwards.
  describe("deleting a visit", () => {
    it("keeps the appointment and clears its link", async () => {
      const { data: log, error: logError } = await fixtures.service
        .from("visit_logs")
        .insert({
          ward_id: wardId,
          org_id: fixtures.eldersQuorumId,
          visit_date: "2026-04-19",
          visit_type: "in_home",
        })
        .select("id")
        .single();
      if (logError) throw new Error(logError.message);

      const { data: appointment, error: appointmentError } = await fixtures.service
        .from("visit_appointments")
        .insert({
          ward_id: wardId,
          org_id: fixtures.eldersQuorumId,
          scheduled_for: "2026-04-19T19:00:00.000Z",
          status: "kept",
          visit_log_id: log.id,
        })
        .select("id")
        .single();
      if (appointmentError) throw new Error(appointmentError.message);

      // ASSERTED, not assumed. Before migration 047 this DELETE was REFUSED outright — a bare
      // `on delete set null` on a composite foreign key nulls every referencing column, ward_id
      // included, and ward_id is not null. Swallowing this error is what let the bug survive its
      // first test run.
      const { error: deleteError } = await fixtures.service
        .from("visit_logs")
        .delete()
        .eq("id", log.id);

      expect(deleteError).toBeNull();

      const { data: after, error: afterError } = await fixtures.service
        .from("visit_appointments")
        .select("id, visit_log_id, status")
        .eq("id", appointment.id)
        .maybeSingle();

      expect(afterError).toBeNull();
      expect(after).not.toBeNull();
      expect(after?.visit_log_id).toBeNull();
    });

    // Participants DO cascade, unlike the appointment. A participant row is a fact about a visit
    // and means nothing without it, so it goes with it.
    it("takes its participants with it", async () => {
      const { data: log, error: logError } = await fixtures.service
        .from("visit_logs")
        .insert({
          ward_id: wardId,
          org_id: fixtures.eldersQuorumId,
          visit_date: "2026-04-26",
          visit_type: "in_home",
        })
        .select("id")
        .single();
      if (logError) throw new Error(logError.message);

      await fixtures.service.from("visit_participants").insert({
        ward_id: wardId,
        org_id: fixtures.eldersQuorumId,
        visit_log_id: log.id,
        label: "goes with the visit",
      });

      expect(await countParticipantRows(log.id)).toBe(1);

      await fixtures.service.from("visit_logs").delete().eq("id", log.id);

      expect(await countParticipantRows(log.id)).toBe(0);
    });
  });
});
