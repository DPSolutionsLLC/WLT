import Link from "next/link";
import { RosterFilters } from "@/app/(app)/roster/RosterFilters";
import { RosterViewToggle } from "@/app/(app)/roster/RosterViewToggle";
import { HouseholdForm } from "@/components/roster/HouseholdForm";
import { HouseholdList } from "@/components/roster/HouseholdList";
import { MemberForm } from "@/components/roster/MemberForm";
import { MemberList } from "@/components/roster/MemberList";
import { Card } from "@/components/ui/Card";
import { NotPermitted } from "@/components/ui/NotPermitted";
import { can, resolveRoleAccess } from "@/lib/auth/permissions";
import { requireSessionUser } from "@/lib/auth/session";
import {
  listHouseholds,
  listMembers,
  ROSTER_BROWSE_STATUSES,
  type HouseholdWithMembers,
} from "@/lib/roster/queries";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import {
  MEMBER_CATEGORIES,
  MEMBER_STATUSES,
  ROSTER_VIEW_MODES,
  type MemberCategory,
  type MemberStatus,
  type RosterViewMode,
} from "@/types/domain";

// searchParams is a Promise in Next 16, typed explicitly rather than with the generated
// PageProps helper — that only exists after a build (plans/retros/foundation-a-scaffold.md).
export type RosterPageProps = {
  searchParams: Promise<{
    view?: string;
    search?: string;
    category?: string;
    status?: string;
  }>;
};

function toViewMode(value: string | undefined): RosterViewMode {
  return (ROSTER_VIEW_MODES as readonly string[]).includes(value ?? "")
    ? (value as RosterViewMode)
    : "household";
}

function toCategory(value: string | undefined): MemberCategory | "" {
  return (MEMBER_CATEGORIES as readonly string[]).includes(value ?? "")
    ? (value as MemberCategory)
    : "";
}

function toStatus(value: string | undefined): MemberStatus | "" {
  return (MEMBER_STATUSES as readonly string[]).includes(value ?? "")
    ? (value as MemberStatus)
    : "";
}

function householdNameMap(households: HouseholdWithMembers[]): Record<string, string> {
  return Object.fromEntries(
    households.map((household) => [household.id, household.familyName]),
  );
}

export default async function RosterPage({ searchParams }: RosterPageProps) {
  const user = await requireSessionUser();
  const supabase = await createServerSupabaseClient();
  const roleAccess = await resolveRoleAccess(supabase, user.wardId);

  // can() rather than assertCan(): a ForbiddenError escaping a Server Component becomes a 500
  // whose message Next.js strips in production (plans/retros/auth-b-invites-admin.md).
  if (!can(user, "roster.view", roleAccess)) {
    return <NotPermitted detail="The ward roster is limited to ward leadership." />;
  }

  const canManage = can(user, "roster.manage", roleAccess);

  const params = await searchParams;
  const view = toViewMode(params.view);
  const search = params.search ?? "";
  const category = toCategory(params.category);
  const status = toStatus(params.status);

  // ROSTER_BROWSE_STATUSES is passed explicitly, never left to the library default. This is a
  // browse surface rather than a calculation, and a do-not-contact member is still in the ward
  // — but moved_out stays an explicit choice.
  const statuses: readonly MemberStatus[] = status === "" ? ROSTER_BROWSE_STATUSES : [status];

  const query: Record<string, string> = {};
  if (search.trim() !== "") query.search = search.trim();
  if (category !== "") query.category = category;
  if (status !== "") query.status = status;

  // The household list is read in both views: the flat list needs family names to show beside
  // each member, and the add-member form needs them for its household select.
  const [households, members] = await Promise.all([
    listHouseholds(
      user.wardId,
      view === "household"
        ? { search: search || undefined, statuses, category: category || undefined }
        : { statuses },
      supabase,
    ),
    view === "list"
      ? listMembers(
          user.wardId,
          {
            search: search || undefined,
            category: category || undefined,
            statuses,
          },
          supabase,
        )
      : Promise.resolve([]),
  ]);

  const isFiltered = search.trim() !== "" || category !== "" || status !== "";
  const resultCount = view === "household" ? households.length : members.length;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Roster</h1>
          <p className="mt-1 text-sm text-muted">
            {view === "household"
              ? `${households.length} ${households.length === 1 ? "household" : "households"}`
              : `${members.length} ${members.length === 1 ? "member" : "members"}`}
          </p>
        </div>

        <RosterViewToggle
          view={view}
          hasViewParam={params.view !== undefined}
          query={query}
        />
      </div>

      <Card>
        <RosterFilters view={view} search={search} category={category} status={status} />
      </Card>

      {/* Stacked at 375px; list beside the management panel from md up. */}
      <div className="flex flex-col gap-6 md:grid md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] md:items-start">
        <section className="flex flex-col gap-3">
          {resultCount === 0 ? (
            <Card>
              {isFiltered ? (
                <p className="text-sm text-muted">
                  No results for that search. Try a different name, or clear the filters.
                </p>
              ) : (
                <div className="text-sm text-muted">
                  <p>No members yet.</p>
                  <p className="mt-2">
                    <Link
                      href="/roster/import"
                      className="text-primary underline underline-offset-4"
                    >
                      Import your roster
                    </Link>{" "}
                    from an LCR export, or add a household below.
                  </p>
                </div>
              )}
            </Card>
          ) : view === "household" ? (
            <HouseholdList households={households} canManage={canManage} />
          ) : (
            <MemberList members={members} householdNames={householdNameMap(households)} />
          )}
        </section>

        {canManage && (
          <aside className="flex flex-col gap-3">
            <Card>
              <details>
                <summary className="min-h-11 cursor-pointer list-none text-sm font-semibold text-foreground">
                  Add household
                </summary>
                <div className="mt-3 border-t border-border pt-3">
                  <HouseholdForm />
                </div>
              </details>
            </Card>

            <Card>
              <details>
                <summary className="min-h-11 cursor-pointer list-none text-sm font-semibold text-foreground">
                  Add member
                </summary>
                <div className="mt-3 border-t border-border pt-3">
                  <MemberForm households={households} />
                </div>
              </details>
            </Card>
          </aside>
        )}
      </div>
    </div>
  );
}
