// @vitest-environment node
//
// Who may read and write `visit_appointment_companions`, and the one read widening it brings to
// `visit_appointments` (ITER-055 bv6, migration 104).
//
// An invited leader outside the owning organization reads their own invite and THAT ONE
// appointment — never another appointment, never the visit log. Declining takes the appointment
// off their screens; their own invite row stays readable. No authenticated client writes a
// companion row, the bishop included: lib/visits/companions.ts on the service role is the only
// writer. A refused UPDATE is a zero-row success, so it is proven by RE-READING (CLAUDE.md §8).

import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asRole } from "@/tests/helpers/asRole";
import { seedFixtures, type Fixtures } from "@/tests/helpers/seed";
import type { Database } from "@/types/database";

type Client = SupabaseClient<Database>;

describe("visit_appointment_companions (migration 104)", () => {
  let fixtures: Fixtures;
  let bishop: Client;
  let eqPresident: Client;
  let rsPresident: Client;
  let wardBBishop: Client;
  let wardId: string;
  let invitedAppointmentId: string;
  let otherAppointmentId: string;
  let visitLogId: string;
  let inviteId: string;
  let recordedId: string;

  const appointmentIds = async (client: Client): Promise<string[]> => {
    const { data, error } = await client.from("visit_appointments").select("id");
    if (error) throw new Error(error.message);
    return (data ?? []).map((row) => row.id);
  };

  const companionIds = async (client: Client): Promise<string[]> => {
    const { data, error } = await client.from("visit_appointment_companions").select("id");
    if (error) throw new Error(error.message);
    return (data ?? []).map((row) => row.id);
  };

  const storedStatus = async (id: string): Promise<string | null> => {
    const { data, error } = await fixtures.service
      .from("visit_appointment_companions")
      .select("status")
      .eq("id", id)
      .single();
    if (error) throw new Error(error.message);
    return data.status;
  };

  beforeAll(async () => {
    fixtures = await seedFixtures(["bishop", "eqPresident", "rsPresident", "wardBBishop"]);
    wardId = fixtures.wardAId;
    [bishop, eqPresident, rsPresident, wardBBishop] = await Promise.all([
      asRole(fixtures, "bishop"),
      asRole(fixtures, "eqPresident"),
      asRole(fixtures, "rsPresident"),
      asRole(fixtures, "wardBBishop"),
    ]);

    const { data: household, error: householdError } = await fixtures.service
      .from("households")
      .insert({ ward_id: wardId, family_name: `Companion ${fixtures.runId}` })
      .select("id")
      .single();
    if (householdError) throw new Error(householdError.message);

    // Two bishopric appointments (org_id null), so "that ONE appointment" can be told apart.
    const { data: appointments, error: appointmentError } = await fixtures.service
      .from("visit_appointments")
      .insert([
        {
          ward_id: wardId,
          org_id: null,
          household_id: household.id,
          scheduled_for: "2099-04-01T01:00:00.000Z",
          made_by: fixtures.user("bishop").id,
        },
        {
          ward_id: wardId,
          org_id: null,
          household_id: household.id,
          scheduled_for: "2099-05-01T01:00:00.000Z",
          made_by: fixtures.user("bishop").id,
        },
      ])
      .select("id, scheduled_for")
      .order("scheduled_for");
    if (appointmentError) throw new Error(appointmentError.message);
    [invitedAppointmentId, otherAppointmentId] = appointments.map((row) => row.id);

    const { data: visit, error: visitError } = await fixtures.service
      .from("visit_logs")
      .insert({
        ward_id: wardId,
        org_id: null,
        household_id: household.id,
        visit_date: "2026-01-05",
        visit_type: "in_home",
        recorded_by: fixtures.user("bishop").id,
      })
      .select("id")
      .single();
    if (visitError) throw new Error(visitError.message);
    visitLogId = visit.id;

    const { data: companions, error: companionError } = await fixtures.service
      .from("visit_appointment_companions")
      .insert([
        {
          ward_id: wardId,
          appointment_id: invitedAppointmentId,
          user_id: fixtures.user("eqPresident").id,
          status: "pending",
        },
        { ward_id: wardId, appointment_id: invitedAppointmentId, label: "A neighbour" },
      ])
      .select("id, user_id");
    if (companionError) throw new Error(companionError.message);
    inviteId = companions.find((row) => row.user_id !== null)!.id;
    recordedId = companions.find((row) => row.user_id === null)!.id;
  }, 120_000);

  afterAll(async () => {
    await fixtures?.cleanup();
  });

  it("lets an invited leader outside the bishopric read their invite and that one appointment", async () => {
    expect(await companionIds(eqPresident)).toEqual(expect.arrayContaining([inviteId, recordedId]));

    const visible = await appointmentIds(eqPresident);
    expect(visible).toContain(invitedAppointmentId);
    expect(visible).not.toContain(otherAppointmentId);
  });

  it("never shows the invited leader the visit log", async () => {
    const { data, error } = await eqPresident.from("visit_logs").select("id").eq("id", visitLogId);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("shows nothing to a leader who was not invited, or to another ward", async () => {
    expect(await companionIds(rsPresident)).toEqual([]);
    expect(await appointmentIds(rsPresident)).not.toContain(invitedAppointmentId);
    expect(await companionIds(wardBBishop)).toEqual([]);
    expect(await appointmentIds(wardBBishop)).not.toContain(invitedAppointmentId);
  });

  it("lets the bishopric read every companion on its appointments", async () => {
    expect(await companionIds(bishop)).toEqual(expect.arrayContaining([inviteId, recordedId]));
  });

  it("refuses an insert from any authenticated client, the bishop included", async () => {
    const { error } = await bishop.from("visit_appointment_companions").insert({
      ward_id: wardId,
      appointment_id: otherAppointmentId,
      label: "Somebody",
    });
    expect(error).not.toBeNull();
  });

  it("refuses the invitee answering their own invite directly", async () => {
    await eqPresident
      .from("visit_appointment_companions")
      .update({ status: "accepted", responded_at: new Date().toISOString() })
      .eq("id", inviteId);
    expect(await storedStatus(inviteId)).toBe("pending");
  });

  it("refuses the invitee changing the appointment they can read", async () => {
    await eqPresident
      .from("visit_appointments")
      .update({ status: "cancelled" })
      .eq("id", invitedAppointmentId);
    const { data, error } = await fixtures.service
      .from("visit_appointments")
      .select("status")
      .eq("id", invitedAppointmentId)
      .single();
    if (error) throw new Error(error.message);
    expect(data.status).toBe("scheduled");
  });

  it("takes the appointment away after a decline, and leaves the invite readable", async () => {
    const { error } = await fixtures.service
      .from("visit_appointment_companions")
      .update({ status: "declined", responded_at: new Date().toISOString() })
      .eq("id", inviteId);
    if (error) throw new Error(error.message);

    expect(await appointmentIds(eqPresident)).not.toContain(invitedAppointmentId);
    expect(await companionIds(eqPresident)).toEqual([inviteId]);
  });

  it("refuses a recorded companion with a status, and an invited one without", async () => {
    const { error: labelled } = await fixtures.service.from("visit_appointment_companions").insert({
      ward_id: wardId,
      appointment_id: otherAppointmentId,
      label: "A neighbour",
      status: "pending",
    });
    expect(labelled?.code).toBe("23514");

    const { error: invited } = await fixtures.service.from("visit_appointment_companions").insert({
      ward_id: wardId,
      appointment_id: otherAppointmentId,
      user_id: fixtures.user("rsPresident").id,
    });
    expect(invited?.code).toBe("23514");
  });
});
