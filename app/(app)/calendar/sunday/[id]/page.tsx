import Link from "next/link";
import { notFound } from "next/navigation";
import { SundayEditor } from "@/app/(app)/calendar/sunday/[id]/SundayEditor";
import { ConductingLabel } from "@/components/calendar/ConductingLabel";
import { SundayTypeBadge } from "@/components/calendar/SundayTypeBadge";
import { Card } from "@/components/ui/Card";
import { NotPermitted } from "@/components/ui/NotPermitted";
import { can, resolveRoleAccess } from "@/lib/auth/permissions";
import { requireSessionUser } from "@/lib/auth/session";
import { formatSundayLabel, monthOf } from "@/lib/calendar/dates";
import {
  conductingNameMap,
  getSunday,
  listBishopricUsers,
} from "@/lib/calendar/queries";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { SUNDAY_TYPE_LABELS } from "@/types/domain";

// params is a Promise in Next 16, typed explicitly rather than with the generated PageProps
// helper — that only exists after a build (plans/retros/foundation-a-scaffold.md).
export type SundayDetailPageProps = {
  params: Promise<{ id: string }>;
};

export default async function SundayDetailPage({ params }: SundayDetailPageProps) {
  const user = await requireSessionUser();
  const supabase = await createServerSupabaseClient();
  const roleAccess = await resolveRoleAccess(supabase, user.wardId);

  // can() rather than assertCan(), for the reason recorded in plans/retros/auth-b-invites-admin.md.
  if (!can(user, "calendar.view", roleAccess)) {
    return <NotPermitted detail="The ward calendar is limited to ward leadership." />;
  }

  const { id } = await params;
  const sunday = await getSunday(user.wardId, id, supabase);

  // A Sunday in another ward and a Sunday RLS refused are indistinguishable here, and both mean
  // "not yours" (plans/retros/foundation-c-services.md).
  if (!sunday) notFound();

  const canManage = can(user, "calendar.manage", roleAccess);
  const canSeeSpeakers = can(user, "talks.view", roleAccess);

  const bishopricUsers = await listBishopricUsers(user.wardId, supabase);
  const bishopricNames = conductingNameMap(bishopricUsers);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link
          href={`/calendar?month=${monthOf(sunday.date)}`}
          className="text-sm text-primary underline underline-offset-4"
        >
          Back to the calendar
        </Link>
        <div className="mt-2 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <h1 className="text-xl font-semibold text-foreground">
            {formatSundayLabel(sunday.date)}
          </h1>
          <SundayTypeBadge type={sunday.type} />
        </div>
      </div>

      <Card>
        <dl className="flex flex-col gap-3">
          <div className="flex flex-col gap-0.5 md:flex-row md:gap-3">
            <dt className="text-sm text-muted md:w-40">Type</dt>
            <dd className="text-sm text-foreground">{SUNDAY_TYPE_LABELS[sunday.type]}</dd>
          </div>

          <div className="flex flex-col gap-0.5 md:flex-row md:gap-3">
            <dt className="text-sm text-muted md:w-40">Conducting</dt>
            <dd className="text-sm">
              <ConductingLabel
                conductingUserId={sunday.conductingUserId}
                names={bishopricNames}
              />
            </dd>
          </div>

          <div className="flex flex-col gap-0.5 md:flex-row md:gap-3">
            <dt className="text-sm text-muted md:w-40">Speaking slots</dt>
            <dd className="text-sm text-foreground">{sunday.speakingSlots}</dd>
          </div>

          <div className="flex flex-col gap-0.5 md:flex-row md:gap-3">
            <dt className="text-sm text-muted md:w-40">Presiding</dt>
            <dd className="text-sm text-foreground">
              {sunday.presidingOverride ?? "The bishopric member conducting"}
            </dd>
          </div>

          <div className="flex flex-col gap-0.5 md:flex-row md:gap-3">
            <dt className="text-sm text-muted md:w-40">Fast Sunday pin</dt>
            <dd className="text-sm text-foreground">
              {sunday.fastSundayPinned ? "Pinned" : "Not pinned"}
            </dd>
          </div>

          {/* The full text lives here; the grid clamps it to two lines. */}
          <div className="flex flex-col gap-0.5 md:flex-row md:gap-3">
            <dt className="text-sm text-muted md:w-40">Notes</dt>
            <dd className="text-sm text-foreground">{sunday.notes ?? "None"}</dd>
          </div>
        </dl>
      </Card>

      {canManage && (
        <Card>
          <h2 className="mb-3 text-base font-semibold text-foreground">Edit this Sunday</h2>
          <SundayEditor
            sunday={sunday}
            bishopricUsers={bishopricUsers}
            bishopricNames={bishopricNames}
          />
        </Card>
      )}

      {/* Gated on talks.view from the start, so the section is bishopric-only now rather than
          being narrowed later — exactly what roster-a did with the assignment-history tab. An
          explicit "not built yet" also beats an empty box that reads as "nobody is speaking". */}
      {canSeeSpeakers && (
        <Card>
          <h2 className="text-base font-semibold text-foreground">Speakers</h2>
          <p className="mt-2 text-sm text-muted">
            The talk pipeline arrives in Phase 4.
          </p>
        </Card>
      )}
    </div>
  );
}
