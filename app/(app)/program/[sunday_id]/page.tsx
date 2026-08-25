import Link from "next/link";
import { notFound } from "next/navigation";
import { BuildProgramButton } from "@/app/(app)/program/[sunday_id]/BuildProgramButton";
import { ProgramBuilder } from "@/app/(app)/program/[sunday_id]/ProgramBuilder";
import { SundayTypeBadge } from "@/components/calendar/SundayTypeBadge";
import { Card } from "@/components/ui/Card";
import { NotPermitted } from "@/components/ui/NotPermitted";
import { can, resolveRoleAccess } from "@/lib/auth/permissions";
import { requireSessionUser } from "@/lib/auth/session";
import { formatSundayLabelWithYear } from "@/lib/calendar/dates";
import { getSunday } from "@/lib/calendar/queries";
import { getProgramBySunday } from "@/lib/program/queries";
import { programSundayIdSchema } from "@/lib/validation/program";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { SUNDAY_TYPE_LABELS, holdsSacramentMeeting } from "@/types/domain";

// One Sunday's program. The shell: it guards, it loads, and it hands the whole draft to the
// client editor. Every decision about what a field says lives below this file.
//
// A Server Component reads through lib/program/queries.ts directly rather than fetching its own
// API route (conventions.md §Data Access). ProgramBuilder then owns the same data as a TanStack
// Query cache seeded from this render.
//
// params is a Promise in Next 16, typed explicitly rather than with the generated PageProps
// helper — that only exists after a build (plans/retros/foundation-a-scaffold.md).

export type ProgramPageProps = {
  params: Promise<{ sunday_id: string }>;
};

export default async function ProgramPage({ params }: ProgramPageProps) {
  const user = await requireSessionUser();
  const supabase = await createServerSupabaseClient();
  const roleAccess = await resolveRoleAccess(supabase, user.wardId);

  // can() rather than assertCan(), for the reason recorded in plans/retros/auth-b-invites-admin.md.
  if (!can(user, "program.view", roleAccess)) {
    return <NotPermitted detail="Sacrament programs are limited to ward leadership." />;
  }

  const { sunday_id: rawSundayId } = await params;

  // Parsed rather than trusted. A malformed id would otherwise reach Postgres as a uuid cast
  // error, which surfaces as a 500 rather than as the 404 it actually is.
  const parsed = programSundayIdSchema.safeParse(rawSundayId);
  if (!parsed.success) notFound();

  const sunday = await getSunday(user.wardId, parsed.data, supabase);

  // A Sunday in another ward and a Sunday RLS refused are indistinguishable here, and both mean
  // "not yours" (plans/retros/foundation-c-services.md).
  if (!sunday) notFound();

  const sundayLabel = formatSundayLabelWithYear(sunday.date);
  const canBuild = can(user, "program.build", roleAccess);

  const heading = (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-xl font-semibold text-foreground">{sundayLabel}</h1>
        <SundayTypeBadge type={sunday.type} />
      </div>
      <Link
        href="/program"
        className="text-sm text-primary underline underline-offset-4"
      >
        All programs
      </Link>
    </div>
  );

  // The same rule POST /api/programs enforces with a 422, one layer up: there is no program for
  // a meeting that is not held. Said as a sentence rather than offered as a disabled button.
  if (!holdsSacramentMeeting(sunday.type)) {
    return (
      <div className="flex flex-col gap-6">
        {heading}
        <Card>
          <p className="text-sm text-muted">
            This Sunday is {SUNDAY_TYPE_LABELS[sunday.type]}, so there is no sacrament meeting
            and no program to build.
          </p>
        </Card>
      </div>
    );
  }

  const program = await getProgramBySunday(user.wardId, parsed.data, supabase);

  // A Sunday with no program row yet gets ONE action, not an empty form. An editor with every
  // field blank looks like a program that failed to load.
  if (program === null) {
    return (
      <div className="flex flex-col gap-6">
        {heading}
        <Card>
          <p className="text-sm text-muted">
            No program has been built for this Sunday yet. Building one takes the speakers,
            prayers and hymns as they stand today and copies them onto a program you can edit.
          </p>
          {canBuild ? (
            <div className="mt-4">
              <BuildProgramButton sundayId={sunday.id} />
            </div>
          ) : (
            <p className="mt-4 text-sm text-muted">
              A member of the bishopric or the ward secretary builds the program.
            </p>
          )}
        </Card>
      </div>
    );
  }

  // draftError is SURFACED, never swallowed (CLAUDE.md rule 7). A program whose stored jsonb no
  // longer parses is unusable, and opening it as a blank editor would look like a program that
  // was never written rather than one that was corrupted.
  if (program.draft === null) {
    return (
      <div className="flex flex-col gap-6">
        {heading}
        <Card>
          <p role="alert" className="text-sm text-danger">
            {program.draftError ??
              "This program has no draft yet. Build it before editing it."}
          </p>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {heading}
      <ProgramBuilder
        sundayId={sunday.id}
        sundayLabel={sundayLabel}
        programId={program.id}
        initialStatus={program.status}
        initialDraft={program.draft}
        canBuild={canBuild}
      />
    </div>
  );
}
