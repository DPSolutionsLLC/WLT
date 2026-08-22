import { MonthPlannerBoard } from "@/app/(app)/assignments/MonthPlannerBoard";
import { MonthNavigation } from "@/app/(app)/calendar/MonthNavigation";
import { Card } from "@/components/ui/Card";
import { NotPermitted } from "@/components/ui/NotPermitted";
import {
  countApprovalsFor,
  listAssignments,
  listTopicOptions,
} from "@/lib/assignments/queries";
import { can, resolveRoleAccess } from "@/lib/auth/permissions";
import { requireSessionUser } from "@/lib/auth/session";
import {
  formatDateOnly,
  lastDayOfMonth,
  monthLabel,
  monthStart,
  parseMonthParam,
} from "@/lib/calendar/dates";
import { listBishopricUsers, listSundays } from "@/lib/calendar/queries";
import { listMembers } from "@/lib/roster/queries";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { MEMBER_STATUSES } from "@/types/domain";

// The PRIMARY surface of the talk pipeline. Nine stages, one screen — a bishopric plans a whole
// Sunday here without leaving the month, and the per-Sunday page is where the long-form work
// happens afterwards. Nine screens, one per stage, is 04-talks-pipeline.md's last and most
// expensive pitfall.
//
// searchParams is a Promise in Next 16, typed explicitly rather than with the generated PageProps
// helper — that only exists after a build (plans/retros/foundation-a-scaffold.md).
export type AssignmentsPageProps = {
  searchParams: Promise<{ month?: string }>;
};

export default async function AssignmentsPage({ searchParams }: AssignmentsPageProps) {
  const user = await requireSessionUser();
  const supabase = await createServerSupabaseClient();
  const roleAccess = await resolveRoleAccess(supabase, user.wardId);

  // can() rather than assertCan(): a ForbiddenError escaping a Server Component becomes a 500
  // whose message Next.js strips in production (plans/retros/auth-b-invites-admin.md).
  if (!can(user, "talks.view", roleAccess)) {
    return <NotPermitted detail="Speaking assignments are limited to ward leadership." />;
  }

  const canPlan = can(user, "talks.plan", roleAccess);

  const today = formatDateOnly(new Date());
  const params = await searchParams;
  const month = parseMonthParam(params.month, today);
  const range = { from: month, to: lastDayOfMonth(month) };

  // Reads only. Generating a month is a calendar WRITE and stays on the calendar page — a
  // planner that quietly creates Sundays is a surprise, and the two pages would race each other
  // to do it (calendar-c's half-generated months).
  const sundays = await listSundays(user.wardId, range, supabase);

  const [assignments, topics, bishopricUsers, members] = await Promise.all([
    listAssignments(user.wardId, range, supabase),
    listTopicOptions(user.wardId, supabase),
    listBishopricUsers(user.wardId, supabase),
    // Every status, not only the active ones: an assignment can name somebody who has since
    // moved out, and dropping their name would render the slot as open.
    listMembers(user.wardId, { statuses: MEMBER_STATUSES }, supabase),
  ]);

  // The approval COUNT for the whole month in one query, never the rows. Who approved and what
  // they said belongs on the detail page; shipping it here would put every approval comment in
  // every response (talks-a).
  const approvalCounts = await countApprovalsFor(
    user.wardId,
    assignments.map((assignment) => assignment.id),
    supabase,
  );

  const memberNames = Object.fromEntries(
    members.map((member) => [member.id, `${member.firstName} ${member.lastName}`.trim()]),
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-xl font-semibold text-foreground">
            Speakers — {monthLabel(month)}
          </h1>
          <p className="mt-1 text-sm text-muted">
            {sundays.length} {sundays.length === 1 ? "Sunday" : "Sundays"}
          </p>
        </div>

        <MonthNavigation
          monthStart={month}
          currentMonthStart={monthStart(today)}
          basePath="/assignments"
        />
      </div>

      {sundays.length === 0 ? (
        <Card>
          <p className="text-sm text-muted">
            This month is not on the calendar yet. Open it on the calendar first — a member of
            the bishopric or the ward secretary creates a month by viewing it.
          </p>
        </Card>
      ) : (
        <MonthPlannerBoard
          user={user}
          month={month}
          sundays={sundays}
          initialAssignments={assignments}
          approvalCounts={Object.fromEntries(approvalCounts)}
          memberNames={memberNames}
          topics={topics}
          bishopricCount={bishopricUsers.length}
          canPlan={canPlan}
        />
      )}
    </div>
  );
}
