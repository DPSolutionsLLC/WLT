// @vitest-environment node
import { describe, expect, it } from "vitest";
import { RELEASED_MODULES } from "@/lib/access/releasedModules";
import { createServiceSupabaseClient } from "@/lib/supabase/service";

// THE DATABASE'S RELEASE POLICIES EQUAL THE CATALOG'S `tables`, IN BOTH DIRECTIONS (ITER-041).
//
// One mapping, table → module, is written twice: in migration 091's `do` block and in
// lib/access/releasedModules.ts. A table on the catalog with no policy is a module whose data
// stays readable when it is unreleased; a policy the catalog does not know is a table refused for
// a module nobody can see the reason for. Both are silent, so this reads the policies back from
// pg_policies and compares — a list nobody recounts is the notification-trigger-drift shape.

// The module named inside a policy's predicate: `ward_module_released('agendas'::text)`.
function moduleInQual(qual: string): string | null {
  return /ward_module_released\('([a-z_]+)'/.exec(qual)?.[1] ?? null;
}

async function readPolicies(): Promise<Map<string, string | null>> {
  const { data, error } = await createServiceSupabaseClient().rpc("module_release_policies");
  if (error) {
    throw new Error(
      `Could not read the release policies: ${error.message}. Check that migration 091 is applied.`,
    );
  }
  return new Map((data ?? []).map((row) => [row.table_name, moduleInQual(row.policy_qual)]));
}

const catalog = new Map<string, string>(
  RELEASED_MODULES.flatMap((module) =>
    (module.tables as readonly string[]).map((table) => [table, module.key] as const),
  ),
);

describe("module release policies", () => {
  // Proves the reader parsed something: an empty map would make both directions pass.
  it("finds the anchor policy on agendas, naming the agendas module", async () => {
    expect((await readPolicies()).get("agendas")).toBe("agendas");
  });

  it("has a policy for every table the catalog lists, naming the same module", async () => {
    const policies = await readPolicies();
    const missingOrWrong = [...catalog]
      .filter(([table, module]) => policies.get(table) !== module)
      .map(([table, module]) => `${table} → expected ${module}, found ${policies.get(table)}`);

    expect(missingOrWrong).toEqual([]);
  });

  it("has no policy for a table the catalog does not list", async () => {
    const policies = await readPolicies();
    expect([...policies.keys()].filter((table) => !catalog.has(table))).toEqual([]);
  });
});
