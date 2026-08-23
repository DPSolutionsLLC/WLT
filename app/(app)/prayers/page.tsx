import { MonthNavigation } from "@/app/(app)/calendar/MonthNavigation";
import { PrayerBoard } from "@/app/(app)/prayers/PrayerBoard";
import { Card } from "@/components/ui/Card";
import { NotPermitted } from "@/components/ui/NotPermitted";
import { can, resolveRoleAccess } from "@/lib/auth/permissions";
import { requireSessionUser } from "@/lib/auth/session";
import {
  formatDateOnly,
  lastDayOfMonth,
  monthLabel,
  monthStart,
  parseMonthParam,
} from "@/lib/calendar/dates";
import { listSundays } from "@/lib/calendar/queries";
import { listLastPrayed, listPrayers } from "@/lib/prayers/queries";
import { listMembers } from "@/lib/roster/queries";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { MEMBER_STATUSES } from "@/types/domain";

// The prayer tracker: a month of Sundays, each with an invocation and a benediction, each moving
// through its own four stages.
//
// Prayers ride on `talks.view` and `talks.plan`. There is no `prayers.*` permission — a prayer is
// part of planning the meeting (04-talks-pipeline.md).
//
// searchParams is a Promise in Next 16, typed explicitly rather than with the generated PageProps
// helper — that only exists after a build (plans/retros/foundation-a-scaffold.md).
export type PrayersPageProps = {
  searchParams: Promise<{ month?: string }>;
};

export default async function PrayersPage({ searchParams }: PrayersPageProps) {
  const user = await requireSessionUser();
  const supabase = await createServerSupabaseClient();
  const roleAccess = await resolveRoleAccess(supabase, user.wardId);

  // can() rather than assertCan(): a ForbiddenError escaping a Server Component becomes a 500
  // whose message Next.js strips in production (plans/retros/auth-b-invites-admin.md).
  if (!can(user, "talks.view", roleAccess)) {
    return <NotPermitted detail="Prayer assignments are limited to ward leadership." />;
  }

  const canPlan = can(user, "talks.plan", roleAccess);

  const today = formatDateOnly(new Date());
  const params = await searchParams;
  const month = parseMonthParam(params.month, today);
  const range = { from: month, to: lastDayOfMonth(month) };

  // Reads only. Generating a month is a calendar WRITE and stays on the calendar page — a
  // tracker that quietly creates Sundays is a surprise, and the two pages would race each other
  // to do it (calendar-c's half-generated months).
  const sundays = await listSundays(user.wardId, range, supabase);

  const [prayers, members] = await Promise.all([
    listPrayers(user.wardId, range, supabase),
    // Every status, not only the active ones: a prayer can name somebody who has since moved
    // out, and dropping their name would render the slot as unassigned.
    listMembers(user.wardId, { statuses: MEMBER_STATUSES }, supabase),
  ]);

  // ONE query for the whole roster, not one per name. This is what annotates the picker with
  // "Last prayed March 2025" — and leaves a member with no history with no annotation at all
  // (lib/prayers/lastPrayed.ts on why "Never" is not an option).
  const lastPrayed = await listLastPrayed(
    user.wardId,
    members.map((member) => member.id),
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
            Prayers — {monthLabel(month)}
          </h1>
          <p className="mt-1 text-sm text-muted">
            {sundays.length} {sundays.length === 1 ? "Sunday" : "Sundays"}
          </p>
        </div>

        <MonthNavigation
          monthStart={month}
          currentMonthStart={monthStart(today)}
          basePath="/prayers"
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
        <PrayerBoard
          user={user}
          month={month}
          sundays={sundays}
          initialPrayers={prayers}
          memberNames={memberNames}
          lastPrayed={lastPrayed}
          canPlan={canPlan}
        />
      )}
    </div>
  );
}
