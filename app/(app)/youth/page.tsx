import { ActivityProfileList } from "@/app/(app)/youth/ActivityProfileList";
import { EventList } from "@/app/(app)/youth/EventList";
import { ManualEventForm } from "@/app/(app)/youth/ManualEventForm";
import { Card } from "@/components/ui/Card";
import { NotPermitted } from "@/components/ui/NotPermitted";
import { listWardOrganizations } from "@/lib/auth/adminUsers";
import { BISHOPRIC_ROLES, can, resolveRoleAccess } from "@/lib/auth/permissions";
import { requireSessionUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { listActivityEvents, listActivityProfiles } from "@/lib/youth/queries";

// Youth activity support, at /youth — where lib/auth/navigation.ts has linked
// `youth_activities.view` holders since auth-a, and where nothing has existed until now. Four
// roles have had a navigation item that 404s; this page is what makes that link honest. No change
// to navigation.ts is needed, and adding one would be wrong.
//
// ---------------------------------------------------------------------------
// THIS IS NOT app/(youth)/ — AND THE TWO ARE UNRELATED
// ---------------------------------------------------------------------------
// `app/(youth)/` already exists and is the SACRAMENT MANAGER'S PIN-ONLY SHELL: a different
// feature, for a different kind of account, reachable at /sacrament. This page lives at
// `app/(app)/youth/` inside the ordinary authenticated shell. The URLs do not collide, but the
// directory names read as though they should, and a future reader will assume a connection that
// is not there.
//
// ---------------------------------------------------------------------------
// READS ARE WARD-WIDE; WRITES ARE ORG-SCOPED
// ---------------------------------------------------------------------------
// Everybody with `youth_activities.view` sees EVERY activity in the ward, whichever organization
// owns it — FEATURES.md §Module 10 gives the ward council the full calendar, and seeing across
// the organizations is the entire reason the ward council exists. Which of those a person may
// CHANGE is decided by migration 054d, in the database, not by a filter here (CLAUDE.md rule 2).
//
// can() rather than assertCan(): a ForbiddenError escaping a Server Component becomes a 500 whose
// message Next.js strips in production (plans/retros/auth-b-invites-admin.md).
//
// THIS PAGE DOES NOT IMPORT lib/youth/privateNotes OR ANYTHING THAT READS
// `activity_private_notes` — no such module exists yet, and slice D must not make this page the
// first. A private note belongs to its author and appears in no list, ever (CLAUDE.md rule 5).

export default async function YouthActivitiesPage() {
  const user = await requireSessionUser();
  const supabase = await createServerSupabaseClient();
  const roleAccess = await resolveRoleAccess(supabase, user.wardId);

  if (!can(user, "youth_activities.view", roleAccess)) {
    return (
      <NotPermitted detail="Youth activity support is limited to ward and organization leadership." />
    );
  }

  const canManage = can(user, "youth_activities.manage", roleAccess);
  const isBishopric = (BISHOPRIC_ROLES as readonly string[]).includes(user.role);

  // The clock enters ONCE and is handed down, so every event in this render is judged against the
  // same instant rather than against a fresh Date per query.
  const asOf = new Date();

  const [profiles, events, organizations] = await Promise.all([
    listActivityProfiles(user.wardId, supabase),
    listActivityEvents(user.wardId, { asOf }, supabase),
    listWardOrganizations(user.wardId, supabase),
  ]);

  const organizationOptions = organizations.map((organization) => ({
    id: organization.id,
    label: organization.name,
  }));

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Youth activities</h1>
        <p className="mt-1 text-sm text-muted">
          The teams, choirs and clubs the ward&rsquo;s young people belong to, and what is coming
          up. Everybody here sees every organization&rsquo;s activities; you can change your
          own.
        </p>
      </div>

      <ActivityProfileList
        initialProfiles={profiles}
        user={user}
        canManage={canManage}
        organizations={organizationOptions}
        // Only the bishopric is asked which organization. Everybody else has theirs stamped from
        // the session by the route, so a control would be offering a decision that is not theirs.
        canChooseOrganization={isBishopric}
      />

      {/* Both of these take `profiles` to SEED a shared client query rather than as a standing
          answer. A Server Component prop never refetches, so passing derived lists straight into
          them left the event form and the schedule stale after any activity change — that was
          defect youth-a-D2. app/(app)/youth/youthQueries.ts owns the key they share. */}
      <EventList
        initialEvents={events}
        initialProfiles={profiles}
        canManage={canManage}
      />

      {canManage ? (
        <div className="flex flex-col gap-3">
          <h2 className="text-base font-semibold text-foreground">Add an event</h2>
          <ManualEventForm initialProfiles={profiles} />
        </div>
      ) : (
        // ABSENT rather than present-and-refusing, with a sentence saying why. An org secretary
        // holds `youth_activities.view` and `.log` but not `.manage`, and a form that fails on
        // submit is worse than no form (ITER-007).
        <Card>
          <p className="text-sm text-muted">
            You can read the ward&rsquo;s youth activities. Adding or changing one is done by an
            organization presidency or the bishopric.
          </p>
        </Card>
      )}
    </div>
  );
}
