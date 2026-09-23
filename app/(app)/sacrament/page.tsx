import { MonthNavigation } from "@/app/(app)/calendar/MonthNavigation";
import { SacramentCalendar } from "@/app/(app)/sacrament/SacramentCalendar";
import type { SundayCardProps } from "@/components/sacrament/SundayCard";
import { Card } from "@/components/ui/Card";
import { NotPermitted } from "@/components/ui/NotPermitted";
import { listAssignments } from "@/lib/assignments/queries";
import { can, resolveRoleAccess } from "@/lib/auth/permissions";
import { requireSessionUser } from "@/lib/auth/session";
import {
  formatDateOnly,
  lastDayOfMonth,
  monthLabel,
  monthOf,
  monthStart,
  parseMonthParam,
} from "@/lib/calendar/dates";
import { conductingNameMap, listBishopricUsers, listSundays } from "@/lib/calendar/queries";
import { listSelections } from "@/lib/music/queries";
import { listPrayers } from "@/lib/prayers/queries";
import {
  sundayPills,
  type SundayPillKey,
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

  const conductingNames = conductingNameMap(bishopricUsers);

  // Resolved ONCE, outside the map, from the roleAccess already in hand (CLAUDE.md rule 10).
  const canOpenSundayEditor = can(user, "calendar.view", roleAccess);

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
    }),
    hrefs: hrefsFor(sunday.id, sunday.date),
    // The whole card opens this Sunday's programme — there is no programme PILL any more
    // (components/sacrament/SundayCard.tsx records why).
    programHref: `/program/${sunday.id}`,
    // Withheld from anybody who could not open the Sunday editor. It gates on `calendar.view`,
    // which this page's own `talks.view` does not imply — a music_coordinator holds talks.view
    // and the two are genuinely separate grants. Offering a link that refuses on arrival is the
    // mirror of youth-a-D1, and the conservative direction is to render the name as plain text.
    conductingHref: canOpenSundayEditor ? `/calendar/sunday/${sunday.id}` : null,
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

// EVERY PILL LANDS ON THIS SUNDAY, NOT ON THE NEAREST ONE. The prototype shipped that bug and
// wrote it down: `openProgram(key)` ignored its key and always opened whichever Sunday was
// closest to today (build-notes-raw.md §sacrament-to-program-navigation). The id is in every
// href below precisely so the same mistake cannot be made here silently.
//
// TOPICS AND TALKS BOTH GO TO /assignments/[id], AND THAT IS CORRECT. The prototype's "Topics"
// pill is the PER-DATE editor — the speaker-count stepper, the day category, every talk slot —
// which is the page WLT already has. It is NOT /talks/topics, which is the ward-level topic
// LIBRARY a slot's topic is chosen FROM (module-map.md §2.1, correction 2). The near-collision
// in the two names is the single most likely thing to get backwards here.
//
// `/music` takes no date: it is a rolling six-Sunday horizon, not a month
// (app/(app)/music/page.tsx §HORIZON_SUNDAYS). Sending it a `?month=` it does not read would be
// silently IGNORED rather than refused, which is roster-b's lesson, so nothing is sent.
function hrefsFor(sundayId: string, date: string): Record<SundayPillKey, string> {
  const assignment = `/assignments/${sundayId}`;

  return {
    topics: assignment,
    talks: assignment,
    // /prayers is a MONTH board with no per-Sunday page, so the pill lands on the month and
    // scrolls to the card. PrayerBoard carries the matching `id` on each Sunday's Card.
    prayer: `/prayers?month=${monthOf(date)}#sunday-${sundayId}`,
    music: "/music",
  };
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
