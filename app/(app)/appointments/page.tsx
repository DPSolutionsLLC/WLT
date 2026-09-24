import { AppointmentList } from "@/app/(app)/appointments/AppointmentList";
import { CalendarSyncCard } from "@/app/(app)/appointments/CalendarSyncCard";
import { ContextualBackLink } from "@/components/layout/ContextualBackLink";
import { NotPermitted } from "@/components/ui/NotPermitted";
import { parseAppointmentsView } from "@/lib/appointments/appointmentsView";
import { buildMyAppointments } from "@/lib/appointments/myAppointments";
import { listMyAppointmentSources } from "@/lib/appointments/queries";
import { can, resolveRoleAccess } from "@/lib/auth/permissions";
import { requireSessionUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { readPageView } from "@/lib/users/userSettings";
import { wardDateOnly } from "@/lib/ward/wardDate";
import { readWardTimezone } from "@/lib/ward/wardTimezone";

// My Appointments — everything this leader has said they will be at (P5 slice c).
//
// GROUPED BY DAY, EACH DAY COLLAPSIBLE, WITH EXPAND ALL / COLLAPSE ALL AND A "SHOW PAST" TOGGLE —
// the user's decision walking scenario 077, which changed module-map §6.5's "flat list + showPast"
// on 2026-09-24. Not a jump target, so no single-open state and no month navigation.
//
// IT OPENS AS IT WAS LEFT: the saved view is read here, on the server, so the first paint is
// already right rather than expanding and then collapsing.
//
// THE CLOCK AND THE ZONE ENTER ONCE, HERE, and are handed down, so the server's first render and
// the browser's agree about which items are past and what time each one reads (rule 12). A
// client component is server-rendered first; formatting in "the reader's zone" there is the UTC
// server's zone, which is the production defect CLAUDE.md §9 records.
//
// can() rather than assertCan(): a ForbiddenError escaping a Server Component is a 500 whose
// message Next.js strips in production (plans/retros/auth-b-invites-admin.md).

type AppointmentsPageProps = {
  // A Promise in Next 16.
  searchParams: Promise<{ from?: string }>;
};

export default async function AppointmentsPage({ searchParams }: AppointmentsPageProps) {
  const user = await requireSessionUser();
  const supabase = await createServerSupabaseClient();
  const roleAccess = await resolveRoleAccess(supabase, user.wardId, user.orgType);

  if (!can(user, "personal_tools.use", roleAccess)) {
    return <NotPermitted detail="My Appointments is available to the ward's leaders." />;
  }

  const params = await searchParams;
  const wardZone = await readWardTimezone(user.wardId, supabase);
  const asOf = new Date();
  const sources = await listMyAppointmentSources(supabase, user.wardId, user.id, asOf);
  const { upcoming, past } = buildMyAppointments(sources, asOf, wardZone);
  const initialView = parseAppointmentsView(await readPageView(user.id, "appointments", supabase));

  return (
    <div className="flex flex-col gap-6">
      <ContextualBackLink from={params.from} />

      <div className="min-w-0">
        <h1 className="text-xl font-semibold text-foreground">My Appointments</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted">
          Everything you have said you will be at, in one list: visits you booked, to-dos you
          scheduled and youth events you signed up for.
        </p>
      </div>

      <AppointmentList
        upcoming={upcoming}
        past={past}
        wardZone={wardZone}
        today={wardDateOnly(asOf, wardZone)}
        asOf={asOf.toISOString()}
        initialView={initialView}
        // Cancelling runs PATCH /api/visit-appointments/[id], which asserts `visits.create`. The
        // control is offered only where the route would allow it.
        canCancelVisits={can(user, "visits.create", roleAccess)}
      />

      <CalendarSyncCard />
    </div>
  );
}
