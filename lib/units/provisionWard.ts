import type { SupabaseClient } from "@supabase/supabase-js";
import { NOTIFICATION_TRIGGER_DEFAULTS } from "@/lib/notifications/triggerDefaults";
import { createServiceSupabaseClient } from "@/lib/supabase/service";
import type { Database } from "@/types/database";
import type { OrganizationType } from "@/types/domain";

// PROVISIONING THE WARD BEHIND A WARD UNIT (ITER-041 slice a).
//
// Until this existed, "Add a unit → Ward" on Stakes & Wards made a `units` row and nothing else.
// A unit is the structure; the `wards` row is what every policy, every calling and the ward
// switcher read — so a ward created on that screen could not be held a calling in or switched to.
// This creates what supabase/seed/ward.sql gives the development ward, minus the people: the ward,
// its organizations and its notification settings.
//
// THE SERVICE-ROLE CLIENT, for the reason lib/units/writeUnit.ts gives: `wards` has no INSERT
// policy, and the route's super-admin check is the boundary in front of this. The caller has
// already been proved to be one.
//
// NEVER TOUCHES MEMBERS, HOUSEHOLDS OR ANY MODULE TABLE. The roster arrives by a paste of the LCR
// report (ITER-040), and a ward with nobody in it is the honest starting state.
//
// NO TRANSACTION EXISTS IN supabase-js, so a failure after the ward insert deletes the ward —
// organizations and notification settings cascade from it — and rethrows. A half-made ward is
// worse than none: it would be switchable, and every notification in it would silently not fire.

export type ProvisionWardParams = {
  unitId: string;
  name: string;
  // America/Denver, as the seed ward has. There is no editor for a ward's zone yet (P12).
  timezone?: string;
};

const DEFAULT_TIMEZONE = "America/Denver";

const PROVISIONED_ORGANIZATIONS: readonly { type: OrganizationType; name: string }[] = [
  { type: "bishopric", name: "Bishopric" },
  { type: "elders_quorum", name: "Elders Quorum" },
  { type: "relief_society", name: "Relief Society" },
  { type: "young_men", name: "Young Men" },
  { type: "young_women", name: "Young Women" },
  { type: "primary", name: "Primary" },
  { type: "sunday_school", name: "Sunday School" },
];

export async function provisionWard(
  params: ProvisionWardParams,
  client?: SupabaseClient<Database>,
): Promise<{ wardId: string }> {
  const service = client ?? createServiceSupabaseClient();

  const { data: ward, error: wardError } = await service
    .from("wards")
    .insert({
      name: params.name.trim(),
      unit_id: params.unitId,
      settings: {
        cross_org_visibility: false,
        timezone: params.timezone ?? DEFAULT_TIMEZONE,
      },
    })
    .select("id")
    .single();

  if (wardError) {
    console.error(`Could not create the ward — ${wardError.message}`, {
      unitId: params.unitId,
    });
    throw new Error(`Could not create the ward: ${wardError.message}`);
  }

  const wardId = ward.id;

  try {
    const { error: organizationError } = await service.from("organizations").insert(
      PROVISIONED_ORGANIZATIONS.map((organization) => ({
        ward_id: wardId,
        name: organization.name,
        type: organization.type,
      })),
    );
    if (organizationError) {
      throw new Error(`Could not create the organizations: ${organizationError.message}`);
    }

    const { error: settingsError } = await service.from("notification_settings").insert(
      NOTIFICATION_TRIGGER_DEFAULTS.map((trigger) => ({
        ward_id: wardId,
        trigger_key: trigger.triggerKey,
        default_roles: [...trigger.defaultRoles],
        is_globally_enabled: true,
      })),
    );
    if (settingsError) {
      throw new Error(`Could not create the notification settings: ${settingsError.message}`);
    }
  } catch (error) {
    await removeProvisionedWard(wardId, service);
    console.error("Could not finish setting up the ward, so it was removed", {
      wardId,
      unitId: params.unitId,
      cause: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }

  return { wardId };
}

// The undo, used here and by the route when a step AFTER provisioning fails. A failed undo is
// logged loudly rather than thrown over the original error, which is the one the caller needs.
export async function removeProvisionedWard(
  wardId: string,
  client?: SupabaseClient<Database>,
): Promise<void> {
  const service = client ?? createServiceSupabaseClient();
  const { error } = await service.from("wards").delete().eq("id", wardId);

  if (error) {
    console.error(`Could not remove a half-made ward — delete it by hand: ${error.message}`, {
      wardId,
    });
  }
}
