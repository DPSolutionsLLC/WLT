import { StakesAndWards, type WardSummary } from "@/app/(app)/admin/stakes/StakesAndWards";
import { NotPermitted } from "@/components/ui/NotPermitted";
import { requireSessionUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createServiceSupabaseClient } from "@/lib/supabase/service";
import { isSuperAdmin, listUnits } from "@/lib/units/queries";

// STAKES & WARDS — a super admin's screen, and nobody else's.
//
// The gate is `super_admin` held in `unit_assignments`, NOT an `admin.*` permission: a ward has
// no standing to create the stake above itself, and every `admin.*` permission is a statement
// about a ward. POST /api/units asks exactly the same question, so the screen and the route
// cannot disagree.
//
// A WARD ADMIN SEES NO ENTRY ANYWHERE. The section index does not list it, and reaching it by URL
// answers with NotPermitted rather than a 404 — the page exists, this person may not use it, and
// saying so is more useful than pretending it is absent.
//
// can() is not used here at all, and there is no ForbiddenError: one escaping a Server Component
// becomes a 500 whose message Next.js strips in production
// (plans/retros/auth-b-invites-admin.md).

export default async function StakesPage() {
  // Called for its redirect, not for its value: this page reads nothing off the session, because
  // the gate below is structural rather than ward-scoped.
  await requireSessionUser();
  const supabase = await createServerSupabaseClient();

  if (!(await isSuperAdmin(supabase))) {
    return (
      <NotPermitted detail="Stakes and wards are managed by the application administrator." />
    );
  }

  const units = await listUnits(supabase);

  // THE WARD LIST COMES THROUGH THE SERVICE-ROLE CLIENT, deliberately. `wards_select`
  // (migration 019) is `id = current_ward_id()` — ONE ward row, the one you are standing in — so
  // a super admin reading through their own client would see a single ward and could never nest
  // another one. `switchable_wards()` solved the same problem for the ward switcher by adding a
  // definer function rather than widening that policy, and its header carries the argument:
  // "you may switch into this ward" is a far smaller promise than "you may read this ward's
  // settings".
  //
  // Here the caller has already been proved to be a super admin, and only the id, the name and
  // the unit link are read — never `settings`, which is where the ward's permission overrides and
  // its venues live.
  const service = createServiceSupabaseClient();
  const { data, error } = await service
    .from("wards")
    .select("id, name, unit_id")
    .order("name", { ascending: true });

  if (error) {
    throw new Error(`Could not load the wards: ${error.message}`);
  }

  const wards: WardSummary[] = (data ?? []).map((ward) => ({
    id: ward.id,
    name: ward.name,
    unitId: ward.unit_id ?? null,
  }));

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Stakes &amp; wards</h1>
        <p className="mt-1 text-sm text-muted">
          The structure above a ward. Unit numbers are assigned by the Church — leave one empty
          until you know it.
        </p>
      </div>

      <StakesAndWards initialUnits={units} wards={wards} canManage />
    </div>
  );
}
