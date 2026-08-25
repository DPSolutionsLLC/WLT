import Link from "next/link";
import { ProgramStatusBadge } from "@/components/program/ProgramStatusBadge";
import { SundayTypeBadge } from "@/components/calendar/SundayTypeBadge";
import { Card } from "@/components/ui/Card";
import { NotPermitted } from "@/components/ui/NotPermitted";
import { can, resolveRoleAccess } from "@/lib/auth/permissions";
import { requireSessionUser } from "@/lib/auth/session";
import { addDaysUtc, formatDateOnly, formatSundayLabel } from "@/lib/calendar/dates";
import { listSundays } from "@/lib/calendar/queries";
import { missingItems, missingSummary } from "@/lib/program/missingMessages";
import { listProgramsBySundays } from "@/lib/program/queries";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { holdsSacramentMeeting } from "@/types/domain";

// Which Sundays need a program, and how far along each one is.
//
// SUNDAYS THAT HOLD NO SACRAMENT MEETING ARE ABSENT FROM THIS LIST ENTIRELY — not greyed out
// and not disabled. There is no program for a meeting that is not held, and a disabled row reads
// as "this is coming" when the truth is that it is not coming at all (talks-b's waiver
// reasoning, and the same rule POST /api/programs enforces with a 422).
//
// A Server Component reads through lib/program/queries.ts directly. It does not fetch its own
// API route (conventions.md §Data Access).

// Eight weeks. Far enough ahead that a bishopric planning a month can see the whole of it plus
// the next, short enough that the list stays a list rather than a year of Sundays.
const HORIZON_SUNDAYS = 8;
const HORIZON_DAYS = HORIZON_SUNDAYS * 7;

export default async function ProgramListPage() {
  const user = await requireSessionUser();
  const supabase = await createServerSupabaseClient();
  const roleAccess = await resolveRoleAccess(supabase, user.wardId);

  // can() rather than assertCan(): a ForbiddenError escaping a Server Component becomes a 500
  // whose message Next.js strips in production (plans/retros/auth-b-invites-admin.md).
  if (!can(user, "program.view", roleAccess)) {
    return <NotPermitted detail="Sacrament programs are limited to ward leadership." />;
  }

  const today = formatDateOnly(new Date());
  const sundays = await listSundays(
    user.wardId,
    { from: today, to: addDaysUtc(today, HORIZON_DAYS) },
    supabase,
  );

  const meetingSundays = sundays.filter((sunday) => holdsSacramentMeeting(sunday.type));

  const programs = await listProgramsBySundays(
    user.wardId,
    meetingSundays.map((sunday) => sunday.id),
    supabase,
  );

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Sacrament programs</h1>
        {/* "The next 1 Sunday" is not a sentence anybody writes. The singular drops the count
            entirely rather than printing it — the plural bug scenario 031 exists to catch, found
            on this very page while walking it (plans/retros/ai-b-knowledge-and-retrieval.md). */}
        <p className="mt-1 text-sm text-muted">
          {meetingSundays.length === 1
            ? "The next Sunday that holds a sacrament meeting."
            : `The next ${meetingSundays.length} Sundays that hold a sacrament meeting.`}
        </p>
      </div>

      {meetingSundays.length === 0 ? (
        <Card>
          <p className="text-sm text-muted">
            There are no sacrament meetings on the calendar for the next {HORIZON_SUNDAYS}{" "}
            weeks. Open the month on the calendar first — a member of the bishopric or the ward
            secretary creates a month by viewing it.
          </p>
        </Card>
      ) : (
        <ul className="flex flex-col gap-3">
          {meetingSundays.map((sunday) => {
            const program = programs.get(sunday.id) ?? null;
            // missingItems() rather than `missing.length`: the stored array is jsonb an edit
            // could have put a duplicate key into, and two counts of the same gap is a wrong
            // number rather than a cosmetic one.
            const missingCount = program?.draft ? missingItems(program.draft).length : 0;

            return (
              <li key={sunday.id}>
                <Card>
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-base font-semibold text-foreground">
                        {formatSundayLabel(sunday.date)}
                      </h2>
                      <SundayTypeBadge type={sunday.type} />
                      {program && <ProgramStatusBadge status={program.status} />}
                    </div>

                    <Link
                      href={`/program/${sunday.id}`}
                      className="text-sm text-primary underline underline-offset-4"
                    >
                      {program ? "Open the program" : "Build the program"}
                      <span className="sr-only"> for {formatSundayLabel(sunday.date)}</span>
                    </Link>
                  </div>

                  <p className="mt-2 text-sm text-muted">
                    {/* A gap is work remaining, never a failure. A program with nothing missing
                        says so; one that has not been built says THAT, which is a different
                        state from a built program with no gaps. */}
                    {program === null
                      ? "Not built yet."
                      : program.draftError !== null
                        ? program.draftError
                        : missingCount === 0
                          ? "Nothing still needed."
                          : missingSummary(missingCount)}
                  </p>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
