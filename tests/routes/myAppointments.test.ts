// @vitest-environment node
//
// My Appointments' three reads (P5 slice c), against the hosted project as a genuinely
// authenticated user.
//
// No test imports a page, so this is where the embed hints and the per-person filters are proved:
// a wrong constraint name in a select only fails at runtime, and a missing `made_by` / `user_id`
// filter would put another leader's commitments on this leader's list with nothing failing.
//
// Everything is seeded under the fixtures' ward A, whose deletion in cleanup cascades to it.

import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { buildMyAppointments } from "@/lib/appointments/myAppointments";
import { listMyAppointmentSources } from "@/lib/appointments/queries";
import { createServiceSupabaseClient } from "@/lib/supabase/service";
import { actAs } from "@/tests/helpers/routeClient";
import { seedFixtures, type Fixtures } from "@/tests/helpers/seed";

vi.mock("@/lib/supabase/server", async () => {
  const { serverClientMock } = await import("@/tests/helpers/routeClient");
  return serverClientMock();
});

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

async function insertOne(
  service: SupabaseClient,
  table: string,
  row: Record<string, unknown>,
): Promise<string> {
  const { data, error } = await service.from(table).insert(row).select("id").single();
  if (error) throw new Error(`Could not seed ${table}: ${error.message}`);
  return (data as { id: string }).id;
}

describe("My Appointments sources", () => {
  let fixtures: Fixtures;
  let service: SupabaseClient;
  const now = Date.now();
  const seeded: Record<string, string> = {};

  beforeAll(async () => {
    fixtures = await seedFixtures(["eqPresident", "bishop"]);
    service = createServiceSupabaseClient();

    const wardId = fixtures.wardAId;
    const president = fixtures.user("eqPresident");
    const bishop = fixtures.user("bishop");

    const householdId = await insertOne(service, "households", {
      ward_id: wardId,
      family_name: `Fixture${fixtures.runId}`,
    });

    const visit = (madeBy: string, offset: number, status: string) =>
      insertOne(service, "visit_appointments", {
        ward_id: wardId,
        org_id: president.orgId,
        household_id: householdId,
        made_by: madeBy,
        scheduled_for: new Date(now + offset).toISOString(),
        status,
      });

    seeded.visitTomorrow = await visit(president.id, DAY, "scheduled");
    seeded.visitLastWeek = await visit(president.id, -7 * DAY, "kept");
    seeded.visitCancelled = await visit(president.id, 2 * DAY, "cancelled");
    seeded.visitByBishop = await visit(bishop.id, DAY, "scheduled");

    seeded.todoScheduled = await insertOne(service, "todos", {
      ward_id: wardId,
      user_id: president.id,
      title: "Scheduled to-do",
      scheduled_for: new Date(now + 2 * DAY).toISOString(),
    });
    seeded.todoUnscheduled = await insertOne(service, "todos", {
      ward_id: wardId,
      user_id: president.id,
      title: "Never scheduled",
    });

    const event = (title: string, offset: number, status: string) =>
      insertOne(service, "activity_events", {
        ward_id: wardId,
        title,
        event_date: new Date(now + offset).toISOString(),
        status,
      });

    const gameId = await event("Friday game", 3 * DAY, "upcoming");
    const cancelledGameId = await event("Rained out", 4 * DAY, "cancelled");
    const bishopsGameId = await event("Only the bishop", 5 * DAY, "upcoming");

    const attend = (eventId: string, userId: string) =>
      insertOne(service, "activity_attendees", { ward_id: wardId, event_id: eventId, user_id: userId });

    seeded.youthGame = await attend(gameId, president.id);
    seeded.youthCancelled = await attend(cancelledGameId, president.id);
    seeded.youthBishop = await attend(bishopsGameId, bishop.id);
  });

  afterAll(async () => {
    await fixtures?.cleanup();
  });

  it("reads the caller's own commitments from all three modules, and nobody else's", async () => {
    await actAs(fixtures, "eqPresident");
    const { createServerSupabaseClient } = await import("@/lib/supabase/server");
    const supabase = await createServerSupabaseClient();
    const president = fixtures.user("eqPresident");

    const sources = await listMyAppointmentSources(
      supabase,
      fixtures.wardAId,
      president.id,
      new Date(now),
    );
    const found = new Set(sources.map((source) => `${source.kind}:${source.id}`));

    expect(found).toEqual(
      new Set([
        `visit:${seeded.visitTomorrow}`,
        `visit:${seeded.visitLastWeek}`,
        `todo:${seeded.todoScheduled}`,
        `youth:${seeded.youthGame}`,
      ]),
    );

    const visit = sources.find((source) => source.id === seeded.visitTomorrow);
    expect(visit?.title).toBe(`Visit — Fixture${fixtures.runId} family`);

    const youth = sources.find((source) => source.id === seeded.youthGame);
    expect(youth?.title).toBe("Friday game");
    expect(youth?.href).toMatch(/^\/youth\/events\//);

    const { upcoming, past } = buildMyAppointments(sources, new Date(now), "America/Denver");
    expect(past.map((source) => source.id)).toEqual([seeded.visitLastWeek]);
    expect(upcoming.map((source) => source.id)).toEqual([
      seeded.visitTomorrow,
      seeded.todoScheduled,
      seeded.youthGame,
    ]);
  });

  it("does not show the bishop the president's scheduled to-do", async () => {
    await actAs(fixtures, "bishop");
    const { createServerSupabaseClient } = await import("@/lib/supabase/server");
    const supabase = await createServerSupabaseClient();
    const bishop = fixtures.user("bishop");

    const sources = await listMyAppointmentSources(
      supabase,
      fixtures.wardAId,
      bishop.id,
      new Date(now),
    );
    const ids = sources.map((source) => source.id);

    // Anchor: the bishop's own commitments ARE found, so an empty list cannot pass by accident.
    expect(ids).toContain(seeded.visitByBishop);
    expect(ids).toContain(seeded.youthBishop);
    expect(ids).not.toContain(seeded.todoScheduled);
  });
});
