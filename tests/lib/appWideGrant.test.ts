import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  acceptAppWideGrantForWard,
  withholdAppWideGrantFromExistingWards,
} from "@/lib/access/appWideGrant";
import {
  clearPermissionOverride,
  grantPermission,
  withholdPermission,
  withholdsPermission,
  type WardSettings,
} from "@/lib/access/roleAccessDeltas";
import { mergeRoleAccess } from "@/lib/auth/permissions";
import type { Database } from "@/types/database";

// PURE, WITH NO DATABASE. The fan-out is the most dangerous thing in this phase — it writes to
// EVERY WARD IN THE APP — and it is exactly the kind of operation that is impractical to exercise
// against the hosted project, because the assertion that matters is "no ward's OTHER settings
// moved" across a whole table.
//
// So the client is stubbed and every write is captured. That is the same move
// tests/lib/permissions.test.ts makes for resolveRoleAccess, and it is what makes the
// overwrite assertion possible at all.

type CapturedWrite = { wardId: string; settings: WardSettings };

// A stub standing in for the two calls the module makes: `select("id, settings")` over every
// ward, and `update({ settings }).eq("id", …)` per ward. `failFor` makes one ward's write fail so
// the not-swallowed path can be asserted.
function stubWardsClient(
  wards: { id: string; settings: unknown }[],
  options: { failFor?: string } = {},
): { client: SupabaseClient<Database>; writes: CapturedWrite[] } {
  const writes: CapturedWrite[] = [];

  const client = {
    from: () => ({
      select: (_columns: string) => {
        const result = {
          data: wards,
          error: null,
          // The single-ward read path used by acceptAppWideGrantForWard.
          eq: (_column: string, value: string) => ({
            maybeSingle: async () => ({
              data: wards.find((ward) => ward.id === value) ?? null,
              error: null,
            }),
          }),
          then: undefined,
        };
        return Object.assign(Promise.resolve({ data: wards, error: null }), result);
      },
      update: (payload: { settings: WardSettings }) => ({
        eq: async (_column: string, value: string) => {
          if (options.failFor === value) {
            return { error: { message: "connection reset" } };
          }
          writes.push({ wardId: value, settings: payload.settings });
          return { error: null };
        },
      }),
    }),
  } as unknown as SupabaseClient<Database>;

  return { client, writes };
}

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// THE DELTA EDITS THEMSELVES
// ---------------------------------------------------------------------------
describe("role access deltas", () => {
  // THE ASSERTION THIS WHOLE FILE EXISTS FOR. `wards.settings` also holds the timezone, the
  // cross-org visibility switch, the speaking slots and the home venues, and `role_access` holds
  // every OTHER role's override. A wholesale write would delete all of it.
  it("leaves every unrelated setting and every other role untouched", () => {
    const settings: WardSettings = {
      timezone: "America/Denver",
      cross_org_visibility: true,
      default_speaking_slots: 3,
      home_venues: ["lincoln high school"],
      role_access: {
        music_coordinator: { remove: ["music.manage"] },
        ward_council_member: { add: ["agendas.manage"] },
      },
    };

    const next = withholdPermission(settings, "org_president", "visits.view");

    expect(next.timezone).toBe("America/Denver");
    expect(next.cross_org_visibility).toBe(true);
    expect(next.default_speaking_slots).toBe(3);
    expect(next.home_venues).toEqual(["lincoln high school"]);

    const roleAccess = next.role_access as Record<string, unknown>;
    expect(roleAccess.music_coordinator).toEqual({ remove: ["music.manage"] });
    expect(roleAccess.ward_council_member).toEqual({ add: ["agendas.manage"] });
    expect(roleAccess.org_president).toEqual({ remove: ["visits.view"] });
  });

  // The input object is never mutated. The fan-out reads a ward's settings and writes a new
  // object; mutating in place would make a failed write leave a half-edited object behind in
  // whatever else held a reference to it.
  it("does not mutate the settings object it was given", () => {
    const settings: WardSettings = { role_access: { org_president: { add: ["visits.view"] } } };
    const snapshot = JSON.parse(JSON.stringify(settings));

    withholdPermission(settings, "org_president", "visits.view");
    grantPermission(settings, "org_secretary", "goals.manage");
    clearPermissionOverride(settings, "org_president", "visits.view");

    expect(settings).toEqual(snapshot);
  });

  it("is idempotent in both directions", () => {
    const once = withholdPermission({}, "org_president", "visits.view");
    const twice = withholdPermission(once, "org_president", "visits.view");

    expect(twice).toEqual(once);

    const granted = grantPermission({}, "org_president", "visits.view");
    expect(grantPermission(granted, "org_president", "visits.view")).toEqual(granted);
  });

  // A ward that had turned something OFF and has now been granted it ends up with it ON. The
  // ordering rule lives in applyDelta — remove is subtracted, then add is applied, so a
  // permission in both lists is granted — and this asserts the delta editor cooperates with it
  // rather than restating it.
  it("grants a permission the ward had previously withheld", () => {
    const withheld = withholdPermission({}, "org_president", "visits.view");
    const granted = grantPermission(withheld, "org_president", "visits.view");

    expect(withholdsPermission(granted, "org_president", "visits.view")).toBe(false);

    const resolved = mergeRoleAccess(granted.role_access);
    expect(resolved.org_president).toContain("visits.view");
  });

  // "Turn it on for my ward" must leave NO override at all, rather than an add that cancels a
  // remove. The stored shape is what a later admin screen renders, and "nothing configured" and
  // "two entries that cancel out" read very differently to a person.
  it("clears back to no override at all", () => {
    const withheld = withholdPermission(
      { timezone: "America/Denver" },
      "org_president",
      "visits.view",
    );
    const cleared = clearPermissionOverride(withheld, "org_president", "visits.view");

    expect(cleared.role_access).toBeUndefined();
    expect(cleared.timezone).toBe("America/Denver");
  });

  // A ward configured by hand may hold anything. A malformed delta must not be propagated into
  // the object being written, and must not throw.
  it("survives a malformed existing delta", () => {
    const settings: WardSettings = {
      role_access: { org_president: "everything", org_secretary: { add: [1, "goals.view"] } },
    };

    const next = withholdPermission(settings, "org_president", "visits.view");
    const roleAccess = next.role_access as Record<string, unknown>;

    expect(roleAccess.org_president).toEqual({ remove: ["visits.view"] });
    // The malformed sibling is left exactly as it was — this function edits one role and must
    // not quietly rewrite another, even to tidy it.
    expect(roleAccess.org_secretary).toEqual({ add: [1, "goals.view"] });
  });
});

// ---------------------------------------------------------------------------
// THE FAN-OUT
// ---------------------------------------------------------------------------
describe("the app-wide grant fan-out", () => {
  it("writes a remove-delta into every ward that does not have one", async () => {
    const { client, writes } = stubWardsClient([
      { id: "ward-a", settings: { timezone: "America/Denver" } },
      { id: "ward-b", settings: {} },
      { id: "ward-c", settings: null },
    ]);

    const result = await withholdAppWideGrantFromExistingWards(
      "org_president",
      "visits.view",
      client,
    );

    expect(result.writtenCount).toBe(3);
    expect(result.failedCount).toBe(0);
    expect(writes).toHaveLength(3);

    for (const write of writes) {
      expect(
        withholdsPermission(write.settings, "org_president", "visits.view"),
        `ward ${write.wardId} did not get an off-override`,
      ).toBe(true);
    }

    // And the unrelated setting survived the fan-out.
    expect(writes.find((write) => write.wardId === "ward-a")?.settings.timezone).toBe(
      "America/Denver",
    );
  });

  // RE-RUNNING IS THE DOCUMENTED RECOVERY from a partial failure, so it has to cost nothing.
  it("skips a ward that already withholds it, and writes nothing for it", async () => {
    const already = withholdPermission({}, "org_president", "visits.view");
    const { client, writes } = stubWardsClient([
      { id: "ward-a", settings: already },
      { id: "ward-b", settings: {} },
    ]);

    const result = await withholdAppWideGrantFromExistingWards(
      "org_president",
      "visits.view",
      client,
    );

    expect(result.skippedCount).toBe(1);
    expect(result.writtenCount).toBe(1);
    expect(writes.map((write) => write.wardId)).toEqual(["ward-b"]);
  });

  // A WARD THAT SILENTLY MISSED ITS OFF-OVERRIDE IS A WARD THAT SILENTLY GAINED A PERMISSION.
  // The failure is recorded and returned, the loop continues, and nothing is swallowed
  // (CLAUDE.md rule 7).
  it("records a per-ward failure, keeps going, and does not throw", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});

    const { client, writes } = stubWardsClient(
      [
        { id: "ward-a", settings: {} },
        { id: "ward-b", settings: {} },
        { id: "ward-c", settings: {} },
      ],
      { failFor: "ward-b" },
    );

    const result = await withholdAppWideGrantFromExistingWards(
      "org_president",
      "visits.view",
      client,
    );

    expect(result.failedCount).toBe(1);
    expect(result.writtenCount).toBe(2);

    const failed = result.outcomes.find((outcome) => outcome.status === "failed");
    expect(failed?.wardId).toBe("ward-b");
    expect(failed?.message).toMatch(/connection reset/);

    // It did NOT stop at the failure — ward-c was still protected.
    expect(writes.map((write) => write.wardId)).toEqual(["ward-a", "ward-c"]);
  });

  it("turns the grant on for one ward by deleting that ward's override", async () => {
    const withheld = withholdPermission(
      { timezone: "America/Denver" },
      "org_president",
      "visits.view",
    );
    const { client, writes } = stubWardsClient([{ id: "ward-a", settings: withheld }]);

    await acceptAppWideGrantForWard("ward-a", "org_president", "visits.view", client);

    expect(writes).toHaveLength(1);
    expect(writes[0].settings.role_access).toBeUndefined();
    expect(writes[0].settings.timezone).toBe("America/Denver");
  });
});
