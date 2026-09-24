import { MonthNavigation } from "@/app/(app)/calendar/MonthNavigation";
import { SacramentCalendar } from "@/app/(app)/sacrament/SacramentCalendar";
import { ModuleShortcutRow } from "@/components/layout/ModuleShortcutRow";
import type { SundayCardProps } from "@/components/sacrament/SundayCard";
import { Card } from "@/components/ui/Card";
import { NotPermitted } from "@/components/ui/NotPermitted";
import { listAssignments } from "@/lib/assignments/queries";
import { shortcutNavigationItems } from "@/lib/auth/navigation";
import { can, resolveRoleAccess } from "@/lib/auth/permissions";
import { requireSessionUser } from "@/lib/auth/session";
import {
  formatDateOnly,
  lastDayOfMonth,
  monthLabel,
  monthStart,
  parseMonthParam,
} from "@/lib/calendar/dates";
import {
  conductingNameMap,
  listBishopricUsers,
  listSundays,
  referencesDecisionOf,
} from "@/lib/calendar/queries";
import { listSelections } from "@/lib/music/queries";
import { listPrayers } from "@/lib/prayers/queries";
import { countReferencesByAssignment } from "@/lib/references/queries";
import {
  sundayPillHrefs,
  sundayPills,
  type SundayStatusAssignment,
  type SundayStatusPrayer,
} from "@/lib/sacrament/sundayStatus";
import { createServerSupabaseClient } from "@/lib/supabase/server";

// ---------------------------------------------------------------------------
// THE SACRAMENT MEETING HUB — p4-sacrament-a
// ---------------------------------------------------------------------------
// A month of Sundays, each carrying a row of pills, each pill opening the module that owns it
// FOR THAT DATE. WLT already had all of this information; it was spread across /assignments,
// /prayers, /music and /program, four top-level routes that never referenced one another, so
// answering "is the 8th ready" meant opening four pages and holding the answer in your head.
//
// THE THREE MODULES BEHIND IT ARE UNTOUCHED. Nothing was deleted, no route handler changed, no
// RLS policy moved and there is no migration in this slice. They stop being entry points and
// become destinations; that is the whole of the re-skin.
//
// ---------------------------------------------------------------------------
// `/sacrament` MEANS THE MEETING HERE, NOT THE ORDINANCE
// ---------------------------------------------------------------------------
// The youth PIN screen held this URL until this slice and now lives at /ordinances
// (app/(youth)/ordinances/page.tsx, which carries the full note). P11's ADULT ordinance screen —
// who passes, blesses and prepares — lands at /sacrament/ordinances, nested under this hub.
//
// ---------------------------------------------------------------------------
// READS ONLY
// ---------------------------------------------------------------------------
// Generating a month is a calendar WRITE and stays on /calendar. A hub that quietly created
// Sundays would be a surprise, and it would race the planner and the prayer tracker to do it —
// calendar-c's half-generated months, which app/(app)/assignments/page.tsx records at its own
// listSundays call for the same reason.
//
// ---------------------------------------------------------------------------
// THE SHORTCUT ROW — p4-sacrament-b1
// ---------------------------------------------------------------------------
// The prototype's `.sac-nav`, a STANDING CONVENTION rather than a one-off (module-map.md §6.4).
// Its row is eight: Ward List, Conducting, Topics, Music, Messages, Assignments, Program, To-Do.
// Below is that order, narrowed to what WLT has a NAVIGATION_ITEMS row for — which is the whole
// reason this is a list of HREFS and not a list of labels and icons. Conducting, Messages and
// To-Do are P5's, P10's and the Conducting Sheet's; when one is built it gains a row in
// lib/auth/navigation.tsx and appears here with no edit to this constant beyond its href.
//
// ⚠️ `/assignments` IS ABSENT, AND IT IS THE ONE OMISSION WORTH EXPLAINING. p4-sacrament-a
// deliberately removed its NAVIGATION_ITEMS row — three tiles for one module is what this hub
// exists to undo — and shortcutNavigationItems() can only resolve an href that HAS a row, which
// is the constraint working rather than failing. Nothing became unreachable: every Sunday's
// Topics and Talks pills, a few centimetres below this row, open /assignments/[id] for that date.
// Whether the cross-month LIST at /assignments deserves a row of its own is a real question and
// belongs to a slice that can answer it, not to a shortcut row.
//
// ORDER IS THE PROTOTYPE'S, not NAVIGATION_ITEMS'. shortcutNavigationItems() preserves what it
// is given for exactly this reason.
const SACRAMENT_SHORTCUT_HREFS = [
  "/roster",
  "/talks/topics",
  "/music",
  "/program",
] as const;

// searchParams is a Promise in Next 16, typed explicitly rather than with the generated PageProps
// helper — that only exists after a build (plans/retros/foundation-a-scaffold.md).
export type SacramentPageProps = {
  searchParams: Promise<{ month?: string }>;
};

export default async function SacramentPage({ searchParams }: SacramentPageProps) {
  const user = await requireSessionUser();
  const supabase = await createServerSupabaseClient();

  // Resolved ONCE and passed to every can() below (CLAUDE.md rule 10). cache() does not dedupe
  // it in a route handler, and a second read could disagree with the first.
  const roleAccess = await resolveRoleAccess(supabase, user.wardId, user.orgType);

  // can() rather than assertCan(): a ForbiddenError escaping a Server Component becomes a 500
  // whose message Next.js strips in production (plans/retros/auth-b-invites-admin.md).
  //
  // `talks.view`, matching /assignments and /prayers — the two pages this hub is the entry point
  // for. Prayers deliberately have no permission of their own: a prayer is part of planning the
  // meeting (talks-c). An org_president does NOT hold talks.view, and a music_coordinator does;
  // the matrix in lib/auth/permissions.ts is the source of truth and it is not the intuitive
  // answer (CLAUDE.md §8).
  if (!can(user, "talks.view", roleAccess)) {
    return <NotPermitted detail="Sacrament meeting planning is limited to ward leadership." />;
  }

  const today = formatDateOnly(new Date());
  const params = await searchParams;
  const month = parseMonthParam(params.month, today);
  const range = { from: month, to: lastDayOfMonth(month) };

  const sundays = await listSundays(user.wardId, range, supabase);
  const sundayIds = sundays.map((sunday) => sunday.id);

  // `programs` is DELIBERATELY NOT READ any more. The programme left the pill row and became the
  // card's own destination, so this page no longer needs its status — and reading a table to
  // render nothing is how a query survives the feature that justified it.
  const [assignments, prayers, selections, bishopricUsers] = await Promise.all([
    listAssignments(user.wardId, range, supabase),
    listPrayers(user.wardId, range, supabase),
    listSelections(user.wardId, { sundayIds }, supabase),
    listBishopricUsers(user.wardId, supabase),
  ]);

  // Grouped once per table rather than filtered inside the map, so a month of five Sundays is
  // five passes over each list and not twenty-five.
  const assignmentsBySunday = groupBySunday(
    assignments,
    (assignment) => assignment.sundayId,
    ({ topicId, memberId, externalSpeakerName, stage }): SundayStatusAssignment => ({
      topicId,
      memberId,
      externalSpeakerName,
      stage,
    }),
  );

  const prayersBySunday = groupBySunday(
    prayers,
    (prayer) => prayer.sundayId,
    ({ memberId, prayerType }): SundayStatusPrayer => ({ memberId, prayerType }),
  );

  const selectionsBySunday = groupBySunday(
    selections,
    (selection) => selection.sundayId,
    () => true,
  );

  // `talks.plan`, which every References route asserts. Resolved once, like the two below.
  // Without it the References pill is not rendered at all (migration 080), so it is not counted.
  const canPlanTalks = can(user, "talks.plan", roleAccess);

  // AFTER the assignments, because it needs their ids. Only talks WITH a topic are counted — the
  // References modal lists only those, and the pill must count what the modal shows.
  const talksWithTopics = assignments.filter((assignment) => assignment.topicId !== null);
  const referenceCounts = canPlanTalks
    ? await countReferencesByAssignment(
        user.wardId,
        talksWithTopics.map((assignment) => assignment.id),
        supabase,
      )
    : new Map<string, number>();

  const referencesBySunday = new Map<string, number>();
  for (const assignment of talksWithTopics) {
    if (assignment.sundayId === null) continue;
    referencesBySunday.set(
      assignment.sundayId,
      (referencesBySunday.get(assignment.sundayId) ?? 0) +
        (referenceCounts.get(assignment.id) ?? 0),
    );
  }

  const conductingNames = conductingNameMap(bishopricUsers);

  // Resolved ONCE, outside the map, from the roleAccess already in hand (CLAUDE.md rule 10).
  const canOpenSundayEditor = can(user, "calendar.view", roleAccess);

  // `topics.manage`, which is BISHOPRIC-ONLY and is what the finalize route asserts. Resolved once
  // here rather than per card (CLAUDE.md rule 10), and gating on the permission the API checks is
  // youth-a-D1's rule: never hide a control the server would allow, never offer one it refuses.
  const canFinalizeTopics = can(user, "topics.manage", roleAccess);

  // FILTERED WITH THE SAME HELPER THE DASHBOARD USES, from the same roleAccess. This page gates on
  // `talks.view` and /talks/topics gates on `topics.view`, which is BISHOPRIC-ONLY — a
  // music_coordinator holds the first and not the second. Rendering the row unfiltered would
  // offer them a link that refuses on arrival, which is youth-a-D1 and p4-sacrament-a's
  // conducting link, both from the same direction.
  const shortcuts = shortcutNavigationItems(user, roleAccess, SACRAMENT_SHORTCUT_HREFS);

  const cards: SundayCardProps[] = sundays.map((sunday) => ({
    sundayId: sunday.id,
    date: sunday.date,
    type: sunday.type,
    // An id with no matching bishopric row reads as open rather than as the raw uuid. That is a
    // real state — a counselor released mid-month — and printing the id would be worse than
    // saying nobody is down for it (decisions.md §1.11).
    conductingName:
      sunday.conductingUserId === null
        ? null
        : (conductingNames[sunday.conductingUserId] ?? null),
    pills: sundayPills({
      speakingSlots: sunday.speakingSlots,
      assignments: assignmentsBySunday.get(sunday.id) ?? [],
      prayers: prayersBySunday.get(sunday.id) ?? [],
      hymnSelectionCount: (selectionsBySunday.get(sunday.id) ?? []).length,
      // The COLUMN answers this and nothing else does. Never
      // `countTopics(...) === sunday.speakingSlots` — decisions.md §1.15 forbids deriving it, and
      // lib/sacrament/sundayStatus.ts's own header says so at the field.
      topicsFinalized: sunday.topicsFinalizedAt !== null,
      references: {
        count: referencesBySunday.get(sunday.id) ?? 0,
        decision: referencesDecisionOf(sunday),
      },
    }),
    hrefs: sundayPillHrefs(sunday.id, sunday.date),
    // The whole card opens this Sunday's programme — there is no programme PILL any more
    // (components/sacrament/SundayCard.tsx records why).
    programHref: `/program/${sunday.id}`,
    // Withheld from anybody who could not open the Sunday editor. It gates on `calendar.view`,
    // which this page's own `talks.view` does not imply — a music_coordinator holds talks.view
    // and the two are genuinely separate grants. Offering a link that refuses on arrival is the
    // mirror of youth-a-D1, and the conservative direction is to render the name as plain text.
    conductingHref: canOpenSundayEditor ? `/calendar/sunday/${sunday.id}` : null,
    canFinalizeTopics,
    canPlanTalks,
  }));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="min-w-0">
          <h1 className="font-display text-xl font-semibold text-foreground">
            Sacrament — {monthLabel(month)}
          </h1>
          <p className="mt-1 text-sm text-muted">
            {sundays.length} {sundays.length === 1 ? "Sunday" : "Sundays"}
          </p>
        </div>

        <MonthNavigation
          monthStart={month}
          currentMonthStart={monthStart(today)}
          basePath="/sacrament"
        />
      </div>

      {/* Under the heading and above the calendar — the prototype's placement exactly. */}
      <ModuleShortcutRow items={shortcuts} label="Related modules" />

      {sundays.length === 0 ? (
        <Card>
          <p className="text-sm text-muted">
            This month is not on the calendar yet. Open it on the calendar first — a member of
            the bishopric or the ward secretary creates a month by viewing it.
          </p>
        </Card>
      ) : (
        <SacramentCalendar sundays={cards} />
      )}
    </div>
  );
}

// A row whose `sunday_id` is null is SKIPPED rather than bucketed under a sentinel. Every one of
// these tables allows it — an assignment can outlive the Sunday it was planned for — and such a
// row belongs to no card on this page.
function groupBySunday<TRow, TOut>(
  rows: readonly TRow[],
  sundayIdOf: (row: TRow) => string | null,
  mapRow: (row: TRow) => TOut,
): Map<string, TOut[]> {
  const grouped = new Map<string, TOut[]>();

  for (const row of rows) {
    const sundayId = sundayIdOf(row);
    if (sundayId === null) continue;

    const existing = grouped.get(sundayId);
    if (existing === undefined) grouped.set(sundayId, [mapRow(row)]);
    else existing.push(mapRow(row));
  }

  return grouped;
}
