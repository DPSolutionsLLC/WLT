import type { SupabaseClient } from "@supabase/supabase-js";
import {
  clearPermissionOverride,
  withholdPermission,
  withholdsPermission,
  type WardSettings,
} from "@/lib/access/roleAccessDeltas";
import type { KnownPermission } from "@/lib/auth/permissions";
import { createServiceSupabaseClient } from "@/lib/supabase/service";
import type { Database, Json } from "@/types/database";
import type { Role } from "@/types/domain";

// ---------------------------------------------------------------------------
// AN APP-WIDE GRANT NEVER TURNS ON SILENTLY. THIS IS THE DANGEROUS ONE.
// ---------------------------------------------------------------------------
//
// Approving a request "app-wide" means changing a CODE DEFAULT in lib/auth/permissions.ts. That
// ships normally, and on the day it deploys every ward in the app would gain the permission at
// once, with nobody asked. For most permissions that is merely surprising; for one a ward had
// deliberately never had, it is a change to who can see other people's information, made on
// their behalf without their knowledge.
//
// So the grant is deliberately split in two:
//
//   1. THE DEFAULT CHANGES — an ordinary code change, reviewed and shipped.
//   2. EVERY EXISTING WARD GETS AN EXPLICIT OFF-OVERRIDE — this file — so no ward's EFFECTIVE
//      access moves on the day it lands.
//   3. EACH WARD IS NOTIFIED, with a one-tap "turn it on for my ward" that deletes its
//      off-override and lets the new default through.
//
// The result: the capability arrives everywhere, and every ward decides for itself when it
// starts applying. A ward that does nothing is exactly where it was.
//
// ---------------------------------------------------------------------------
// EVERY WRITE MERGES. NONE REPLACES.
// ---------------------------------------------------------------------------
// lib/access/roleAccessDeltas.ts owns that discipline and this file never touches the settings
// object directly. A wholesale write here would delete every ward's other overrides AND its
// timezone, venues and speaking slots — the worst possible side effect of flipping a default, and
// the exact warning writeCrossOrgVisibility() carries for this column.
//
// ---------------------------------------------------------------------------
// NOT ATOMIC ACROSS WARDS, AND IT CANNOT BE
// ---------------------------------------------------------------------------
// This is N separate UPDATEs against N ward rows. There is no transaction spanning them and
// PostgREST offers none, so a failure partway leaves some wards overridden and some not.
//
// THREE THINGS MAKE THAT SAFE RATHER THAN MERELY ACKNOWLEDGED:
//
//   * IT IS IDEMPOTENT. `withholdPermission` is a no-op on a ward that already has the override,
//     so re-running after a partial failure costs nothing and fixes the remainder. Re-running is
//     the documented recovery, not a risk.
//   * IT DOES NOT SWALLOW A PER-WARD FAILURE (CLAUDE.md rule 7). Each ward's outcome is recorded
//     and the failures are returned to the caller, which reports them. A ward that silently
//     missed its off-override is a ward that silently GAINED a permission — the one outcome this
//     whole mechanism exists to prevent — so a failure that is not surfaced is worse than the
//     grant never happening.
//   * IT LOGS PER WARD, so the server log names which ones landed even if the response is lost.
//
// It deliberately does NOT stop at the first failure. Stopping would leave the remaining wards
// unprotected for no gain: the operation is idempotent, so pressing on and reporting is strictly
// better than halting and reporting.

export type WardGrantOutcome = {
  wardId: string;
  // `skipped` means the ward already withheld it — not an error, and not a write.
  status: "written" | "skipped" | "failed";
  message?: string;
};

export type AppWideGrantResult = {
  permission: KnownPermission;
  role: Role;
  outcomes: WardGrantOutcome[];
  writtenCount: number;
  skippedCount: number;
  failedCount: number;
};

type WardSettingsRow = { id: string; settings: unknown };

function asSettings(value: unknown): WardSettings {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  return value as WardSettings;
}

async function readAllWardSettings(
  service: SupabaseClient<Database>,
): Promise<WardSettingsRow[]> {
  const { data, error } = await service.from("wards").select("id, settings");

  if (error) {
    // THROWS. If the ward list itself cannot be read there is nothing to iterate and no partial
    // state to report — failing here is the honest answer, and it happens BEFORE any write.
    console.error(`Could not list the wards for an app-wide grant — ${error.message}`);
    throw new Error(`Could not list the wards: ${error.message}`);
  }

  return (data ?? []) as WardSettingsRow[];
}

// WRITE AN OFF-OVERRIDE INTO EVERY EXISTING WARD.
//
// Runs through the SERVICE-ROLE client, necessarily: `wards_update` (migration 019) is
// bishopric-scoped to `current_ward_id()`, so no session on earth can write another ward's
// settings — which is correct, and is exactly why this operation cannot be done through a
// caller's own client. THE ROUTE'S `super_admin` CHECK IS THEREFORE THE ONLY BOUNDARY IN FRONT OF
// IT and can never be skipped.
export async function withholdAppWideGrantFromExistingWards(
  role: Role,
  permission: KnownPermission,
  client?: SupabaseClient<Database>,
): Promise<AppWideGrantResult> {
  const service = client ?? createServiceSupabaseClient();
  const wards = await readAllWardSettings(service);

  const outcomes: WardGrantOutcome[] = [];

  for (const ward of wards) {
    const settings = asSettings(ward.settings);

    // IDEMPOTENT, and this is the branch that makes a re-run cheap rather than merely harmless.
    if (withholdsPermission(settings, role, permission)) {
      outcomes.push({ wardId: ward.id, status: "skipped" });
      continue;
    }

    const next = withholdPermission(settings, role, permission);

    const { error } = await service
      .from("wards")
      .update({ settings: next as unknown as Json })
      .eq("id", ward.id);

    if (error) {
      // NOT SWALLOWED, NOT RETHROWN. Recorded, logged, and the loop continues — see the header.
      console.error(
        `Could not write the off-override for ward ${ward.id} — ${error.message}`,
        { role, permission },
      );
      outcomes.push({ wardId: ward.id, status: "failed", message: error.message });
      continue;
    }

    outcomes.push({ wardId: ward.id, status: "written" });
  }

  const result: AppWideGrantResult = {
    permission,
    role,
    outcomes,
    writtenCount: outcomes.filter((outcome) => outcome.status === "written").length,
    skippedCount: outcomes.filter((outcome) => outcome.status === "skipped").length,
    failedCount: outcomes.filter((outcome) => outcome.status === "failed").length,
  };

  if (result.failedCount > 0) {
    console.error(
      `An app-wide grant left ${result.failedCount} ward(s) without an off-override. ` +
        "Those wards will receive the new default as soon as it deploys. Re-run the grant — it " +
        "is idempotent.",
      { role, permission },
    );
  }

  return result;
}

// THE ONE-TAP "TURN IT ON FOR MY WARD". Deletes this ward's off-override so the new code default
// reaches it.
//
// Takes the ward id rather than reading it from a session because the caller has already resolved
// it, and because this must write exactly the ward the bishopric acted in and no other. It runs
// through the service-role client for symmetry with the fan-out above and because the settings
// object must be read and rewritten as a unit; `wards_update` would also permit it for the
// ward's own bishopric, and the route checks that permission before calling.
export async function acceptAppWideGrantForWard(
  wardId: string,
  role: Role,
  permission: KnownPermission,
  client?: SupabaseClient<Database>,
): Promise<void> {
  const service = client ?? createServiceSupabaseClient();

  const { data, error } = await service
    .from("wards")
    .select("settings")
    .eq("id", wardId)
    .maybeSingle();

  if (error) {
    console.error(`Could not read the ward's settings — ${error.message}`, { wardId });
    throw new Error(`Could not read the ward's settings: ${error.message}`);
  }

  const next = clearPermissionOverride(asSettings(data?.settings), role, permission);

  const { error: writeError } = await service
    .from("wards")
    .update({ settings: next as unknown as Json })
    .eq("id", wardId);

  if (writeError) {
    console.error(`Could not accept the grant — ${writeError.message}`, {
      wardId,
      role,
      permission,
    });
    throw new Error(`Could not turn that on for your ward: ${writeError.message}`);
  }
}
