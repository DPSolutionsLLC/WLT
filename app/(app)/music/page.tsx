import { MonthNavigation } from "@/app/(app)/calendar/MonthNavigation";
import { SundayMusicCard } from "@/app/(app)/music/SundayMusicCard";
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
import { listMusicalNumbers, listSelections } from "@/lib/music/queries";
import { listSundayTopicTitles } from "@/lib/music/sundayTopics";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { holdsSacramentMeeting } from "@/types/domain";

// The music coordinator's whole screen.
//
// ---------------------------------------------------------------------------------------------
// TOPICS ONLY — NOT THE ASSIGNMENTS
// ---------------------------------------------------------------------------------------------
// The coordinator holds `talks.view`, but 06-program-music.md is explicit that the role does not
// get pipeline access: no speakers, no stages, no contact state. They see what the meeting is
// ABOUT so they can choose hymns for it. lib/music/sundayTopics.ts enforces that in its return
// type — it hands back titles and cannot hand back an assignment — so this page could not leak
// one by accident even if it tried.
//
// A Server Component reads through the query modules directly. It does not fetch its own API
// route (conventions.md §Data Access).
//
// ---------------------------------------------------------------------------------------------
// A MONTH, NOT A HORIZON
// ---------------------------------------------------------------------------------------------
// This page used to show a rolling six Sundays from today and take no date at all. The Sacrament
// hub deep-links a Sunday's Music pill into it, so a pill reporting real, correct work on a
// Sunday more than six weeks out landed on a page saying there were no sacrament meetings on the
// calendar — which is the exact failure the hub was built to prevent, and ~6 weeks is precisely
// the horizon a bishopric plans at (072-D1, found by walking scenario 072).
//
// So it is a month board, like /prayers, /assignments, /calendar and /sacrament. THE COST IS
// NAMED RATHER THAN DISCOVERED: late in a month the coordinator's default landing shows only the
// Sundays left in it, not the next six. Every sibling page has that property and Next is one
// click. Do not reintroduce the horizon alongside the month — two modes would need the heading
// AND the empty state to each say which one was on, which is decisions.md §1 "one mechanism, not
// two" broken for a page that now has an owner telling it which month to show.
//
// searchParams is a Promise in Next 16, typed explicitly rather than with the generated PageProps
// helper — that only exists after a build (plans/retros/foundation-a-scaffold.md).
export type MusicPageProps = {
  searchParams: Promise<{ month?: string }>;
};

export default async function MusicPage({ searchParams }: MusicPageProps) {
  const user = await requireSessionUser();
  const supabase = await createServerSupabaseClient();
  const roleAccess = await resolveRoleAccess(supabase, user.wardId, user.orgType);

  // can() rather than assertCan(): a ForbiddenError escaping a Server Component becomes a 500
  // whose message Next.js strips in production (plans/retros/auth-b-invites-admin.md).
  if (!can(user, "music.view", roleAccess)) {
    return <NotPermitted detail="Sacrament meeting music is limited to ward leadership." />;
  }

  const canManage = can(user, "music.manage", roleAccess);

  const today = formatDateOnly(new Date());
  const params = await searchParams;
  // Falls back to the current month for a missing OR malformed value, so /music?month=banana is
  // the current month and never a crash. No Zod schema — this is a page read, not a route body,
  // and the parser is the boundary.
  const month = parseMonthParam(params.month, today);
  const range = { from: month, to: lastDayOfMonth(month) };

  // Reads only. Generating a month is a calendar WRITE and stays on the calendar page — a music
  // board that quietly created Sundays would race the planner and the prayer tracker to do it
  // (calendar-c's half-generated months).
  const sundays = await listSundays(user.wardId, range, supabase);

  // SUNDAYS THAT HOLD NO SACRAMENT MEETING ARE ABSENT ENTIRELY — not greyed out and not disabled.
  // There is no music for a meeting that is not held, and a disabled row reads as "this is
  // coming" when the truth is that it is not coming at all (the program list page's rule).
  const meetingSundays = sundays.filter((sunday) => holdsSacramentMeeting(sunday.type));

  const [selections, musicalNumbers, topicsBySunday] = await Promise.all([
    listSelections(user.wardId, { sundayIds: meetingSundays.map((s) => s.id) }, supabase),
    listMusicalNumbers(user.wardId, meetingSundays.map((s) => s.id), supabase),
    listSundayTopicTitles(user.wardId, meetingSundays, supabase),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold text-foreground">Music — {monthLabel(month)}</h1>
          {/* `meetingSundays.length`, NOT `sundays.length` — a deliberate departure from /prayers
              and /sacrament, which count every Sunday. This page renders only the Sundays that
              hold a meeting, so counting the others would print a number that disagrees with the
              list beneath it, which is ITER-022 exactly. Pluralised in a branch rather than
              templated: "1 Sundays" is the plural bug scenario 031 exists to catch
              (plans/retros/ai-b-knowledge-and-retrieval.md). */}
          <p className="mt-1 text-sm text-muted">
            {meetingSundays.length} {meetingSundays.length === 1 ? "Sunday" : "Sundays"}
          </p>
        </div>

        <MonthNavigation
          monthStart={month}
          currentMonthStart={monthStart(today)}
          basePath="/music"
        />
      </div>

      {/* TWO EMPTY STATES, because a month has two ways to be empty and the horizon had one. The
          first sentence is copied verbatim from /prayers and /sacrament, so the three pages give
          one answer to one situation. The second is reachable — a month whose only Sundays are a
          stake conference and a ward conference — and the first sentence would be WRONG there: it
          tells the reader to add a month that is already on the calendar. It states a fact and
          offers no action, because there is no action to offer. */}
      {sundays.length === 0 ? (
        <Card>
          <p className="text-sm text-muted">
            This month is not on the calendar yet. Open it on the calendar first — a member of
            the bishopric or the ward secretary creates a month by viewing it.
          </p>
        </Card>
      ) : meetingSundays.length === 0 ? (
        <Card>
          <p className="text-sm text-muted">No Sunday this month holds a sacrament meeting.</p>
        </Card>
      ) : (
        <ul className="flex flex-col gap-4">
          {meetingSundays.map((sunday) => (
            <li key={sunday.id}>
              <SundayMusicCard
                sunday={{ id: sunday.id, date: sunday.date, type: sunday.type }}
                topicTitles={topicsBySunday.get(sunday.id) ?? []}
                selections={selections.filter(
                  (selection) => selection.sundayId === sunday.id,
                )}
                musicalNumber={
                  musicalNumbers.find(
                    (musicalNumber) => musicalNumber.sundayId === sunday.id,
                  ) ?? null
                }
                canManage={canManage}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
