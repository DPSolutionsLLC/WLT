import Link from "next/link";
import { AgendaBuilder } from "@/app/(app)/agendas/[id]/AgendaBuilder";
import { NotPermitted } from "@/components/ui/NotPermitted";
import { can, resolveRoleAccess } from "@/lib/auth/permissions";
import { requireSessionUser } from "@/lib/auth/session";
import { getAgenda, listActionItems } from "@/lib/agendas/queries";
import { formatMeetingDateLabel } from "@/lib/calendar/dates";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { MEETING_TYPE_LABELS } from "@/types/domain";

// One meeting: its sections, its action items, and the controls that publish it.

export default async function AgendaDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireSessionUser();
  const supabase = await createServerSupabaseClient();
  const roleAccess = await resolveRoleAccess(supabase, user.wardId);

  if (!can(user, "agendas.view", roleAccess)) {
    return (
      <NotPermitted detail="Meeting agendas are limited to the bishopric, the ward secretaries and the ward council." />
    );
  }

  const { id } = await params;

  const agenda = await getAgenda(user.wardId, id, supabase);

  // A row in another ward is invisible to this query by RLS, so "not found" and "not yours" are
  // the same answer here — which is the answer a reader is entitled to.
  if (agenda === null) {
    return (
      <div className="flex flex-col gap-4">
        <Link href="/agendas" className="text-sm text-primary underline underline-offset-4">
          Back to the agendas
        </Link>
        <p className="text-sm text-muted">That agenda could not be found.</p>
      </div>
    );
  }

  const actionItems = await listActionItems(user.wardId, id, supabase);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/agendas" className="text-sm text-primary underline underline-offset-4">
          Back to the agendas
        </Link>
        <h1 className="mt-2 text-xl font-semibold text-foreground">
          {MEETING_TYPE_LABELS[agenda.meetingType]}
        </h1>
        <p className="mt-1 text-sm text-muted">{formatMeetingDateLabel(agenda.meetingDate)}</p>
      </div>

      <AgendaBuilder
        initialAgenda={agenda}
        initialActionItems={actionItems}
        canManage={can(user, "agendas.manage", roleAccess)}
        canPublish={can(user, "agendas.publish", roleAccess)}
      />
    </div>
  );
}
