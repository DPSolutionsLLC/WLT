import { CalendarSettingsPanel } from "@/app/(app)/calendar/CalendarSettingsPanel";
import { ConductingRotationPanel } from "@/app/(app)/calendar/ConductingRotationPanel";
import { MonthNavigation } from "@/app/(app)/calendar/MonthNavigation";
import { MonthGrid } from "@/components/calendar/MonthGrid";
import { SundayCard } from "@/components/calendar/SundayCard";
import { Card } from "@/components/ui/Card";
import { NotPermitted } from "@/components/ui/NotPermitted";
import { can, resolveRoleAccess } from "@/lib/auth/permissions";
import { requireSessionUser } from "@/lib/auth/session";
import {
  addDaysUtc,
  firstSundayOnOrAfter,
  formatDateOnly,
  lastDayOfMonth,
  monthLabel,
  monthStart,
  parseMonthParam,
} from "@/lib/calendar/dates";
import {
  conductingNameMap,
  ensureMonthGenerated,
  listBishopricUsers,
  listConductingRotation,
  listSundays,
} from "@/lib/calendar/queries";
import { activeRotation } from "@/lib/calendar/resolveConductingUser";
import { readDefaultSpeakingSlots } from "@/lib/calendar/wardCalendarSettings";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { MAX_SPEAKING_SLOTS } from "@/lib/validation/calendar";

// searchParams is a Promise in Next 16, typed explicitly rather than with the generated PageProps
// helper — that only exists after a build (plans/retros/foundation-a-scaffold.md).
export type CalendarPageProps = {
  searchParams: Promise<{ month?: string }>;
};

export default async function CalendarPage({ searchParams }: CalendarPageProps) {
  const user = await requireSessionUser();
  const supabase = await createServerSupabaseClient();
  const roleAccess = await resolveRoleAccess(supabase, user.wardId);

  // can() rather than assertCan(): a ForbiddenError escaping a Server Component becomes a 500
  // whose message Next.js strips in production (plans/retros/auth-b-invites-admin.md).
  if (!can(user, "calendar.view", roleAccess)) {
    return <NotPermitted detail="The ward calendar is limited to ward leadership." />;
  }

  // Two different gates, not one (calendar-a Decision 5). A ward_secretary maintains the calendar;
  // only the bishopric decides who conducts and what a new Sunday starts with.
  const canManage = can(user, "calendar.manage", roleAccess);
  const canManageRotation = can(user, "admin.manage_ward", roleAccess);

  // Today in UTC, matching how every date in this module is read, and resolved HERE so the month
  // helpers stay pure and the client components never construct a date of their own.
  const today = formatDateOnly(new Date());
  const params = await searchParams;
  const month = parseMonthParam(params.month, today);
  const range = { from: month, to: lastDayOfMonth(month) };

  // Generation is a WRITE, so it only runs for somebody the route layer would let write. Migration
  // 019 grants UPDATE and INSERT on `sundays` to every authenticated member of the ward, so RLS
  // would happily let a music coordinator generate a month by opening it — and a read-only page
  // that quietly writes is a surprise nobody asked for. They see an empty month and who to ask.
  const sundays = canManage
    ? await ensureMonthGenerated(user.wardId, month, supabase)
    : await listSundays(user.wardId, range, supabase);

  const [rotation, bishopricUsers, defaultSpeakingSlots] = await Promise.all([
    listConductingRotation(user.wardId, supabase),
    listBishopricUsers(user.wardId, supabase),
    readDefaultSpeakingSlots(user.wardId, supabase),
  ]);

  const conductingNames = conductingNameMap(bishopricUsers);

  const currentRotation = activeRotation(
    rotation.map((entry) => ({
      position: entry.position,
      userId: entry.userId,
      effectiveFrom: entry.effectiveFrom,
    })),
    today,
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-xl font-semibold text-foreground">{monthLabel(month)}</h1>
          <p className="mt-1 text-sm text-muted">
            {sundays.length} {sundays.length === 1 ? "Sunday" : "Sundays"}
          </p>
        </div>

        <MonthNavigation monthStart={month} currentMonthStart={monthStart(today)} />
      </div>

      {sundays.length === 0 ? (
        <Card>
          <p className="text-sm text-muted">
            This month has not been added to the calendar yet. A member of the bishopric or the
            ward secretary can create it by opening this month.
          </p>
        </Card>
      ) : (
        <>
          {/* Same data, two layouts (03-calendar.md Step 5). A month grid at 375px is unusable. */}
          <div className="hidden md:block">
            <MonthGrid
              monthStart={month}
              sundays={sundays}
              conductingNames={conductingNames}
            />
          </div>

          <div className="flex flex-col gap-3 md:hidden">
            {sundays.map((sunday) => (
              <SundayCard
                key={sunday.id}
                sunday={sunday}
                conductingNames={conductingNames}
              />
            ))}
          </div>
        </>
      )}

      {/* Set-once controls, collapsed, like the roster's add-household panel. */}
      <div className="flex flex-col gap-3">
        {canManageRotation && (
          <Card>
            <details>
              <summary className="min-h-11 cursor-pointer list-none text-sm font-semibold text-foreground">
                Conducting rotation
              </summary>
              <div className="mt-3 border-t border-border pt-3">
                <ConductingRotationPanel
                  bishopricUsers={bishopricUsers}
                  bishopricNames={conductingNames}
                  activeRotation={currentRotation}
                  defaultEffectiveFrom={firstSundayOnOrAfter(addDaysUtc(today, 1))}
                />
              </div>
            </details>
          </Card>
        )}

        <Card>
          <details>
            <summary className="min-h-11 cursor-pointer list-none text-sm font-semibold text-foreground">
              Calendar settings
            </summary>
            <div className="mt-3 border-t border-border pt-3">
              <CalendarSettingsPanel
                defaultSpeakingSlots={defaultSpeakingSlots}
                maxSpeakingSlots={MAX_SPEAKING_SLOTS}
                canManage={canManageRotation}
              />
            </div>
          </details>
        </Card>
      </div>
    </div>
  );
}
