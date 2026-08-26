// @vitest-environment node
//
// `read-state-per-user` (07-visits.md §Tests).
//
// THE ASSERTION THE WHOLE FEATURE TURNS ON: one leader reading a report leaves it unread for
// everybody else. It is held by migration 008's `unique (user_id, report_type, report_id)` —
// note the user_id in that index, without which two leaders could not hold different states for
// the same report — plus migration 019's four own-rows-only policies.
//
// Everything negative is asserted with an AUTHENTICATED client. Asserting with the service-role
// client would prove nothing: it bypasses RLS entirely, which is the single easiest way to write
// a suite that passes while the app leaks.
//
// A refused UPDATE is a ZERO-ROW SUCCESS rather than an error
// (plans/retros/route-tests-and-realtime.md), so every write refusal below is proven by
// RE-READING the row with the service client afterwards. Only INSERT raises.
//
// Runs over the network against the shared hosted project (CLAUDE.md §9), so every row it writes
// is cleaned up by id in afterAll.

import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asRole } from "@/tests/helpers/asRole";
import { seedFixtures, type Fixtures } from "@/tests/helpers/seed";
import type { Database } from "@/types/database";

const REPORT_TYPE = "visit_log";

describe("report_read_status isolation", () => {
  let fixtures: Fixtures;

  // Two leaders in the SAME organization, so nothing below can pass because of org isolation.
  // The isolation being tested is between two people who see exactly the same reports.
  let userA: SupabaseClient<Database>;
  let userB: SupabaseClient<Database>;
  let wardBUser: SupabaseClient<Database>;

  let wardId: string;
  let sharedLogId: string;
  let secondLogId: string;

  const readOwnRows = async (
    client: SupabaseClient<Database>,
    reportId: string,
  ): Promise<{ read_at: string | null; flagged: boolean }[]> => {
    // Ward-wide, with NO user filter. A filtered read would pass even if a permissive policy had
    // survived and was letting the other person's rows through (plans/retros/talks-d).
    const { data, error } = await client
      .from("report_read_status")
      .select("read_at, flagged")
      .eq("report_type", REPORT_TYPE)
      .eq("report_id", reportId)
      .order("id", { ascending: true });

    if (error) throw new Error(error.message);
    return data ?? [];
  };

  const serviceRowFor = async (
    userId: string,
    reportId: string,
  ): Promise<{ read_at: string | null; flagged: boolean } | null> => {
    const { data, error } = await fixtures.service
      .from("report_read_status")
      .select("read_at, flagged")
      .eq("user_id", userId)
      .eq("report_type", REPORT_TYPE)
      .eq("report_id", reportId)
      .maybeSingle();

    if (error) throw new Error(error.message);
    return data;
  };

  beforeAll(async () => {
    fixtures = await seedFixtures([
      "eqPresident",
      "eqCounselor",
      "wardBEqPresident",
    ]);
    wardId = fixtures.wardAId;

    userA = await asRole(fixtures, "eqPresident");
    userB = await asRole(fixtures, "eqCounselor");
    wardBUser = await asRole(fixtures, "wardBEqPresident");

    const { data: logs, error: logError } = await fixtures.service
      .from("visit_logs")
      .insert([
        {
          ward_id: wardId,
          org_id: fixtures.eldersQuorumId,
          recorded_by: fixtures.user("eqPresident").id,
          visit_date: "2026-04-05",
          visit_type: "in_home",
          shared_notes: "Shared: brought a meal round.",
        },
        {
          ward_id: wardId,
          org_id: fixtures.eldersQuorumId,
          recorded_by: fixtures.user("eqPresident").id,
          visit_date: "2026-04-12",
          visit_type: "in_home",
          shared_notes: "Shared: helped with a move.",
        },
      ])
      .select("id, visit_date");
    if (logError) throw new Error(logError.message);

    sharedLogId = logs.find((row) => row.visit_date === "2026-04-05")!.id;
    secondLogId = logs.find((row) => row.visit_date === "2026-04-12")!.id;

    // Written through A's OWN authenticated client, so the INSERT policy is exercised rather than
    // only SELECT — and so "A has read it" is a fact the app could actually have produced.
    const { error: insertError } = await userA.from("report_read_status").insert({
      ward_id: wardId,
      user_id: fixtures.user("eqPresident").id,
      report_type: REPORT_TYPE,
      report_id: sharedLogId,
      read_at: new Date().toISOString(),
    });
    if (insertError) throw new Error(insertError.message);
  }, 60_000);

  afterAll(async () => {
    await fixtures?.cleanup();
  });

  it("shows user A their own read row", async () => {
    const rows = await readOwnRows(userA, sharedLogId);

    expect(rows).toHaveLength(1);
    expect(rows[0]?.read_at).not.toBeNull();
  });

  // THE LINE THE WHOLE FEATURE TURNS ON.
  it("shows user B ZERO rows for a report user A has read", async () => {
    expect(await readOwnRows(userB, sharedLogId)).toHaveLength(0);
  });

  // A `unique (report_type, report_id)` index would refuse this insert outright. The user_id in
  // migration 008's index is what makes "A read, B unread" a representable state at all.
  it("lets user B hold their own independent row for the same report", async () => {
    const { error } = await userB.from("report_read_status").insert({
      ward_id: wardId,
      user_id: fixtures.user("eqCounselor").id,
      report_type: REPORT_TYPE,
      report_id: sharedLogId,
      flagged: true,
    });

    expect(error).toBeNull();

    const bRows = await readOwnRows(userB, sharedLogId);
    expect(bRows).toHaveLength(1);
    // B bookmarked it without reading it — read_at null and flagged true coexist, which is why
    // isRead is a question about the timestamp rather than about the row.
    expect(bRows[0]?.read_at).toBeNull();
    expect(bRows[0]?.flagged).toBe(true);

    // And A's row is untouched by any of it.
    const aRows = await readOwnRows(userA, sharedLogId);
    expect(aRows).toHaveLength(1);
    expect(aRows[0]?.read_at).not.toBeNull();
    expect(aRows[0]?.flagged).toBe(false);
  });

  // Zero rows updated is a SUCCESS. The proof is the re-read, not the error.
  it("changes nothing when user B updates user A's row", async () => {
    const before = await serviceRowFor(fixtures.user("eqPresident").id, sharedLogId);

    const { error } = await userB
      .from("report_read_status")
      .update({ flagged: true, read_at: null })
      .eq("user_id", fixtures.user("eqPresident").id)
      .eq("report_id", sharedLogId);

    expect(error).toBeNull();

    const after = await serviceRowFor(fixtures.user("eqPresident").id, sharedLogId);
    expect(after?.flagged).toBe(before?.flagged);
    expect(after?.read_at).toBe(before?.read_at);
  });

  it("changes nothing when user B deletes user A's row", async () => {
    const { error } = await userB
      .from("report_read_status")
      .delete()
      .eq("user_id", fixtures.user("eqPresident").id)
      .eq("report_id", sharedLogId);

    expect(error).toBeNull();
    expect(await serviceRowFor(fixtures.user("eqPresident").id, sharedLogId)).not.toBeNull();
  });

  // An INSERT is the one operation RLS refuses with an error rather than silently, so this one
  // needs no re-read.
  it("raises when user B inserts a row carrying user A's id", async () => {
    const { error } = await userB.from("report_read_status").insert({
      ward_id: wardId,
      user_id: fixtures.user("eqPresident").id,
      report_type: REPORT_TYPE,
      report_id: secondLogId,
      read_at: new Date().toISOString(),
    });

    expect(error).not.toBeNull();
    expect(await serviceRowFor(fixtures.user("eqPresident").id, secondLogId)).toBeNull();
  });

  // ward_id = current_ward_id() is on every one of the four policies, so a report id guessed from
  // another ward reads nothing even though the row genuinely exists.
  it("shows a user in ward B none of ward A's read rows", async () => {
    const { data, error } = await wardBUser
      .from("report_read_status")
      .select("id")
      .eq("report_type", REPORT_TYPE)
      .in("report_id", [sharedLogId, secondLogId]);

    expect(error).toBeNull();
    expect(data ?? []).toHaveLength(0);
  });

  it("raises when a ward B user writes a row into ward A", async () => {
    const { error } = await wardBUser.from("report_read_status").insert({
      ward_id: wardId,
      user_id: fixtures.user("wardBEqPresident").id,
      report_type: REPORT_TYPE,
      report_id: sharedLogId,
      read_at: new Date().toISOString(),
    });

    expect(error).not.toBeNull();
  });
});
