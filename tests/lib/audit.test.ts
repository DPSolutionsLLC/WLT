// @vitest-environment node

import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { writeAuditLog } from "@/lib/audit/writeAuditLog";
import { asRole } from "@/tests/helpers/asRole";
import { seedFixtures, type Fixtures } from "@/tests/helpers/seed";
import type { Database } from "@/types/database";

function failingClient(): SupabaseClient<Database> {
  return {
    from: () => ({
      insert: async () => ({ error: { message: "simulated database failure" } }),
    }),
  } as unknown as SupabaseClient<Database>;
}

function throwingClient(): SupabaseClient<Database> {
  return {
    from: () => {
      throw new Error("simulated client explosion");
    },
  } as unknown as SupabaseClient<Database>;
}

describe("writeAuditLog", () => {
  let fixtures: Fixtures;
  let bishop: SupabaseClient<Database>;

  beforeAll(async () => {
    fixtures = await seedFixtures(["bishop"]);
    bishop = await asRole(fixtures, "bishop");
  });

  afterAll(async () => {
    await fixtures?.cleanup();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("writes exactly one row with the right shape", async () => {
    const action = `visit_created_${fixtures.runId}`;

    await writeAuditLog(
      {
        wardId: fixtures.wardAId,
        userId: fixtures.user("bishop").id,
        action,
        module: "visits",
        detail: { visitId: "abc-123" },
      },
      bishop,
    );

    const { data, error } = await bishop
      .from("audit_log")
      .select("ward_id, user_id, action, module, detail")
      .eq("ward_id", fixtures.wardAId)
      .eq("action", action);

    expect(error).toBeNull();
    expect(data?.length).toBe(1);
    expect(data?.[0]).toMatchObject({
      ward_id: fixtures.wardAId,
      user_id: fixtures.user("bishop").id,
      action,
      module: "visits",
      detail: { visitId: "abc-123" },
    });
  });

  it("redacts secret-looking keys instead of persisting them verbatim", async () => {
    const action = `pin_reset_${fixtures.runId}`;

    await writeAuditLog(
      {
        wardId: fixtures.wardAId,
        userId: fixtures.user("bishop").id,
        action,
        module: "admin",
        detail: {
          targetUserId: "user-9",
          userPin: "4821",
          nested: { apiKey: "sk-live-should-not-persist" },
          privateNote: "family asked us not to share this",
        },
      },
      bishop,
    );

    const { data } = await bishop
      .from("audit_log")
      .select("detail")
      .eq("ward_id", fixtures.wardAId)
      .eq("action", action)
      .single();

    const serialised = JSON.stringify(data?.detail);

    expect(serialised).not.toContain("4821");
    expect(serialised).not.toContain("sk-live-should-not-persist");
    expect(serialised).not.toContain("family asked us not to share this");
    expect(serialised).toContain("user-9");
  });

  // One of exactly two sanctioned exceptions to CLAUDE.md rule 7. An audit failure must not
  // fail the user's action — but it must still be logged, not swallowed.
  it("does not throw when the insert fails, and logs the failure", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      writeAuditLog(
        {
          wardId: fixtures.wardAId,
          userId: fixtures.user("bishop").id,
          action: "will_fail",
          module: "visits",
        },
        failingClient(),
      ),
    ).resolves.toBeUndefined();

    expect(consoleError).toHaveBeenCalled();
    expect(JSON.stringify(consoleError.mock.calls)).toContain("simulated database failure");
  });

  it("does not throw when the client itself explodes", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      writeAuditLog(
        {
          wardId: fixtures.wardAId,
          userId: fixtures.user("bishop").id,
          action: "will_throw",
          module: "visits",
        },
        throwingClient(),
      ),
    ).resolves.toBeUndefined();

    expect(consoleError).toHaveBeenCalled();
  });

  it("is rejected by RLS when the user id is not the caller", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const action = `impersonated_${fixtures.runId}`;

    await writeAuditLog(
      {
        wardId: fixtures.wardAId,
        userId: "00000000-0000-4000-8000-0000000000ff",
        action,
        module: "admin",
      },
      bishop,
    );

    expect(consoleError).toHaveBeenCalled();

    const { data } = await fixtures.service
      .from("audit_log")
      .select("id")
      .eq("ward_id", fixtures.wardAId)
      .eq("action", action);

    expect(data ?? []).toEqual([]);
  });
});
