import { TodoList } from "@/app/(app)/todos/TodoList";
import { ContextualBackLink } from "@/components/layout/ContextualBackLink";
import { NotPermitted } from "@/components/ui/NotPermitted";
import { can, resolveRoleAccess } from "@/lib/auth/permissions";
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
      />
    </div>
  );
}
