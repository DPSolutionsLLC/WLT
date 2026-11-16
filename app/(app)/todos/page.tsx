import { TodoList } from "@/app/(app)/todos/TodoList";
import { ContextualBackLink } from "@/components/layout/ContextualBackLink";
import { NotPermitted } from "@/components/ui/NotPermitted";
import { listWardUsers } from "@/lib/auth/adminUsers";
import { BISHOPRIC_ROLES, can, resolveRoleAccess } from "@/lib/auth/permissions";
import { listBishopricUsers } from "@/lib/calendar/queries";
import { listHouseholds } from "@/lib/roster/queries";
import { orderCompanionLeaders } from "@/lib/visits/companionText";
import { requireSessionUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { listTodos } from "@/lib/todos/queries";
import { wardDateOnly } from "@/lib/ward/wardDate";
import { readWardTimezone } from "@/lib/ward/wardTimezone";

// To Do — a leader's own list (P5).
//
// OWNER-ONLY. Nobody else's to-dos can reach this page: migration 081's policies admit only the
// owner, and the bishop is not an exception (D2).
//
// can() rather than assertCan(): a ForbiddenError escaping a Server Component becomes a 500 whose
// message Next.js strips in production (plans/retros/auth-b-invites-admin.md).
//
// THE CLOCK AND THE ZONE ENTER ONCE, HERE. `today` is the WARD's date — never
// `new Date().toISOString().slice(0, 10)`, which is UTC and after 6pm Mountain calls every item due
// today overdue — and it is handed down so every card is judged against the same day, on the
// server and in the browser alike (rule 12).

type TodosPageProps = {
  // A Promise in Next 16.
  searchParams: Promise<{ from?: string }>;
};

export default async function TodosPage({ searchParams }: TodosPageProps) {
  const user = await requireSessionUser();
  const supabase = await createServerSupabaseClient();
  const roleAccess = await resolveRoleAccess(supabase, user.wardId, user.orgType);

  if (!can(user, "personal_tools.use", roleAccess)) {
    return <NotPermitted detail="To Do is available to the ward's leaders." />;
  }

  const params = await searchParams;
  const wardZone = await readWardTimezone(user.wardId, supabase);
  const today = wardDateOnly(new Date(), wardZone);
  const openTodos = await listTodos(user.wardId, { status: "open" }, supabase);

  // Only the bishopric is ever given a "Visit the ___ family" to-do (ITER-055 bv5), so only they
  // need what booking one with companions offers (bv6). Read through the caller's own client.
  const isBishopric = (BISHOPRIC_ROLES as readonly string[]).includes(user.role);
  const visitBooking = isBishopric ? await readVisitBookingOptions(user.wardId, user.id) : null;

  return (
    <div className="flex flex-col gap-6">
      <ContextualBackLink from={params.from} />

      <div className="min-w-0">
        <h1 className="text-xl font-semibold text-foreground">To Do</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted">
          Your own list. Nobody else can see it — not the bishopric, and not whoever asked you to do
          something.
        </p>
      </div>

      <TodoList
        initialOpenTodos={openTodos}
        today={today}
        wardZone={wardZone}
        user={user}
        canPickMember={can(user, "roster.view", roleAccess)}
        visitBooking={visitBooking}
      />
    </div>
  );
}

async function readVisitBookingOptions(wardId: string, userId: string) {
  const supabase = await createServerSupabaseClient();
  const [wardUsers, bishopric, households] = await Promise.all([
    listWardUsers(wardId, supabase),
    listBishopricUsers(wardId, supabase),
    listHouseholds(wardId, undefined, supabase),
  ]);

  const leaders = wardUsers
    .filter((wardUser) => wardUser.isActive)
    .map((wardUser) => ({
      id: wardUser.id,
      label: `${wardUser.firstName ?? ""} ${wardUser.lastName ?? ""}`.trim() || "A leader",
    }));

  return {
    leaders: orderCompanionLeaders(
      leaders,
      bishopric.map((member) => member.id),
      userId,
    ),
    memberNames: Object.fromEntries(
      households.flatMap((household) =>
        household.members.map((member) => [
          member.id,
          `${member.firstName} ${member.lastName}`.trim(),
        ]),
      ),
    ),
  };
}
