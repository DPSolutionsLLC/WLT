import type { SupabaseClient } from "@supabase/supabase-js";
import { isReleasedModuleKey, type ReleasedModuleKey } from "@/lib/access/releasedModules";
import { createServiceSupabaseClient } from "@/lib/supabase/service";
import type { Database } from "@/types/database";

// READING AND WRITING `ward_release_settings` (migration 091).
//
// THE SERVICE-ROLE CLIENT, because the table has a SELECT policy and NO WRITE POLICY (the shape of
// access_requests and sunday_music): only the super admin changes a ward's list, so the route's
// is_super_admin check is the boundary in front of every write here and can never be skipped.
// The read is service-role too because Stakes & Wards lists every ward, and the page is already
// gated on super admin.
//
// NO AUDIT ROW IS WRITTEN HERE. The route writes it (conventions.md §Route Handler Shape).

// Postgres foreign-key violation: the ward named does not exist.
const FOREIGN_KEY_VIOLATION = "23503";

export class UnknownWardError extends Error {
  constructor() {
    super("That ward is not there any more. Reload the page and try again.");
    this.name = "UnknownWardError";
  }
}

function resolveClient(client?: SupabaseClient<Database>): SupabaseClient<Database> {
  return client ?? createServiceSupabaseClient();
}

// Every ward that HAS a list, keyed by ward id. A ward missing from the map has none, which means
// everything is released.
export async function listReleasedModulesByWard(
  client?: SupabaseClient<Database>,
): Promise<Map<string, ReleasedModuleKey[]>> {
  const { data, error } = await resolveClient(client)
    .from("ward_release_settings")
    .select("ward_id, released_modules");

  if (error) {
    console.error(`Could not read the released modules — ${error.message}`);
    throw new Error(`Could not read the released modules: ${error.message}`);
  }

  return new Map(
    (data ?? []).map((row) => [row.ward_id, row.released_modules.filter(isReleasedModuleKey)]),
  );
}

// NULL REMOVES THE ROW, which is what "everything" is. Anything else replaces the list whole —
// there is one list per ward and nothing else lives in the row, so a merge would have nothing to
// preserve.
export async function writeReleasedModules(
  params: { wardId: string; modules: readonly ReleasedModuleKey[] | null; updatedBy: string },
  client?: SupabaseClient<Database>,
): Promise<void> {
  const service = resolveClient(client);

  if (params.modules === null) {
    const { error } = await service
      .from("ward_release_settings")
      .delete()
      .eq("ward_id", params.wardId);

    if (error) {
      console.error(`Could not clear the released modules — ${error.message}`, {
        wardId: params.wardId,
      });
      throw new Error(`Could not clear the released modules: ${error.message}`);
    }
    return;
  }

  const { error } = await service.from("ward_release_settings").upsert(
    {
      ward_id: params.wardId,
      released_modules: [...new Set(params.modules)],
      updated_by: params.updatedBy,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "ward_id" },
  );

  if (error) {
    if (error.code === FOREIGN_KEY_VIOLATION) throw new UnknownWardError();
    console.error(`Could not save the released modules — ${error.message}`, {
      wardId: params.wardId,
    });
    throw new Error(`Could not save the released modules: ${error.message}`);
  }
}
