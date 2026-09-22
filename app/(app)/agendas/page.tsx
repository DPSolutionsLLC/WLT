import { AgendaList } from "@/app/(app)/agendas/AgendaList";
import { NotPermitted } from "@/components/ui/NotPermitted";
import { can, resolveRoleAccess } from "@/lib/auth/permissions";
import { requireSessionUser } from "@/lib/auth/session";
import { listActionItemsForAgendas, listAgendas } from "@/lib/agendas/queries";
import { createServerSupabaseClient } from "@/lib/supabase/server";

// Meeting agendas — the screen that closes one of the three dead sidebar links.
//
// `lib/auth/navigation.ts` has offered "/agendas" to everybody holding `agendas.view` since
// Phase 1, and until now it answered 404. CLAUDE.md §9 records that as a standing cost: the nav
// gates on the PERMISSION a reader holds, never on whether the page exists, so every phase that
// ships a permission before its page repeats it. This is the first of the three to be paid off.
//
// can() rather than assertCan(): a ForbiddenError escaping a Server Component becomes a 500 whose
// message Next.js strips in production (plans/retros/auth-b-invites-admin.md).

export default async function AgendasPage() {
  const user = await requireSessionUser();
  const supabase = await createServerSupabaseClient();
  const roleAccess = await resolveRoleAccess(supabase, user.wardId, user.orgType);

  if (!can(user, "agendas.view", roleAccess)) {
    return (
      <NotPermitted detail="Meeting agendas are limited to the bishopric, the ward secretaries and the ward council." />
    );
  }

  // §Step A4: "Bishopric can build and publish without the secretary — never gate on the secretary
  // role." Both of these resolve true for bishop and counselor as well as for the two secretaries,
  // which is what makes that instruction structural rather than remembered.
  const canManage = can(user, "agendas.manage", roleAccess);
  const canPublish = can(user, "agendas.publish", roleAccess);

  // The clock enters ONCE and is handed down, so the list and its action items describe the same
  // window rather than two.
  const asOf = new Date();

  const agendas = await listAgendas(user.wardId, { asOf }, supabase);
  const actionItems = await listActionItemsForAgendas(
    user.wardId,
    agendas.map((agenda) => agenda.id),
    supabase,
  );

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Meeting agendas</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted">
          Bishopric and ward council agendas. Flagged items and open action items are carried in
          for you when a new agenda is created.
        </p>
      </div>

      <AgendaList
        initialAgendas={agendas}
        initialActionItems={Object.fromEntries(actionItems)}
        canManage={canManage}
        canPublish={canPublish}
      />
    </div>
  );
}
