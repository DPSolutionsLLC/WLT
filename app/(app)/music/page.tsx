import { MusicSundayList, type MusicSundayEntry } from "@/app/(app)/music/MusicSundayList";
import { ContextualBackLink } from "@/components/layout/ContextualBackLink";
import { Card } from "@/components/ui/Card";
import { NotPermitted } from "@/components/ui/NotPermitted";
import { can, resolveRoleAccess } from "@/lib/auth/permissions";
import { requireSessionUser } from "@/lib/auth/session";
import { addDaysUtc, firstSundayOnOrAfter, formatDateOnly } from "@/lib/calendar/dates";
import { getSunday, listSundays, type Sunday } from "@/lib/calendar/queries";
import { listMusicalNumbers, listSelections } from "@/lib/music/queries";
import { listSundayTopicTitles } from "@/lib/music/sundayTopics";
import { musicSundayWindow, MUSIC_WINDOW_SUNDAYS } from "@/lib/music/sundayWindow";
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
// A ROLLING LIST WITH THE JUMPED-TO SUNDAY INSERTED — NOT A MONTH BOARD
// ---------------------------------------------------------------------------------------------
// ⚠️ THIS REVERSES `06910f8`, DELIBERATELY AND ON THE USER'S DECISION (2026-09-23, after seeing
// the month board deployed).
//
// The defect that produced the month board was real: a Music pill reporting correct work on a
// Sunday beyond the page's horizon landed on a page saying there were no sacrament meetings at
// all (072-D1, found by walking scenario 072). The diagnosis was right and the mechanism was not.
// The prototype closes the same defect by keeping a rolling list and INSERTING the jumped-to date
// into it in date order (module-map.md §6.2 item 6), which is what lib/music/sundayWindow.ts
// does — so a Sunday a year out is reachable because the link puts it in the list, not because
// the reader navigated to its month.
//
// `?month=` IS NOW DEAD AND IS IGNORED SILENTLY. It is one day old and nothing links to it, so it
// is not redirected — but it is named here rather than left as a trap, because a parameter the
// destination quietly ignores is exactly what roster-b's retro is about.
//
// searchParams is a Promise in Next 16, typed explicitly rather than with the generated PageProps
// helper — that only exists after a build (plans/retros/foundation-a-scaffold.md).
export type MusicPageProps = {
  searchParams: Promise<{ sunday?: string; from?: string }>;
};

// A malformed value would reach Postgres as a uuid comparison and come back as an error, turning
// a stale link into a 500. The parser is the boundary here, the way parseMonthParam was — no Zod
// schema, because this is a page read and not a route body.
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// WIDER THAN THE WINDOW, AND FILTERED DOWN. Sundays holding no sacrament meeting are dropped, so
// asking for exactly MUSIC_WINDOW_SUNDAYS weeks yields fewer than that many cards in any stretch
// containing general conference. Twice the window is enough slack for the two conference weekends
// and a stake conference in one run.
const WINDOW_QUERY_WEEKS = MUSIC_WINDOW_SUNDAYS * 2;

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

  const windowStart = firstSundayOnOrAfter(today);
  const range = { from: windowStart, to: addDaysUtc(windowStart, 7 * WINDOW_QUERY_WEEKS) };

  // Reads only. Generating Sundays is a calendar WRITE and stays on the calendar page — a music
  // board that quietly created Sundays would race the planner and the prayer tracker to do it
  // (calendar-c's half-generated months). Since slice 1 the calendar keeps a rolling 12 months
  // generated, so a Sunday a year out ordinarily already exists by the time a link names it.
  const sundays = await listSundays(user.wardId, range, supabase);

  // SUNDAYS THAT HOLD NO SACRAMENT MEETING ARE ABSENT ENTIRELY — not greyed out and not disabled.
  // There is no music for a meeting that is not held, and a disabled row reads as "this is
  // coming" when the truth is that it is not coming at all (the program list page's rule).
  const meetingSundays = sundays.filter((sunday) => holdsSacramentMeeting(sunday.type));

  // THE JUMP IS RESOLVED IN ITS OWN QUERY, not looked for in the range above. A Sunday a year out
  // is the case this exists for, so it must not depend on how wide the window query happens to
  // be. An id that names nothing, names another ward's Sunday (RLS returns nothing for it) or
  // names a Sunday holding no meeting is IGNORED and the ordinary list renders — a stale link
  // must not 404 a page the reader can still use.
  const jumped = await resolveJumpedSunday(user.wardId, params.sunday, meetingSundays, supabase);

  const candidates =
    jumped === null
      ? meetingSundays
      : [...meetingSundays, jumped].sort((left, right) => left.date.localeCompare(right.date));

  const openSundayId = jumped?.id ?? matchingId(meetingSundays, params.sunday);
  const windowed = musicSundayWindow(candidates, openSundayId);

  const [selections, musicalNumbers, topicsBySunday] = await Promise.all([
    listSelections(user.wardId, { sundayIds: windowed.map((sunday) => sunday.id) }, supabase),
    listMusicalNumbers(user.wardId, windowed.map((sunday) => sunday.id), supabase),
    listSundayTopicTitles(user.wardId, [...windowed], supabase),
  ]);

  const entries: MusicSundayEntry[] = windowed.map((sunday) => ({
    sunday: { id: sunday.id, date: sunday.date, type: sunday.type },
    topicTitles: topicsBySunday.get(sunday.id) ?? [],
    selections: selections.filter((selection) => selection.sundayId === sunday.id),
    musicalNumber:
      musicalNumbers.find((musicalNumber) => musicalNumber.sundayId === sunday.id) ?? null,
  }));

  return (
    <div className="flex flex-col gap-6">
      <ContextualBackLink from={params.from} />

      <div className="min-w-0">
        <h1 className="text-xl font-semibold text-foreground">Music</h1>
        {/* `entries.length`, NOT `sundays.length` — this page renders only the Sundays that hold
            a meeting, so counting the others would print a number that disagrees with the list
            beneath it, which is ITER-022 exactly. It counts the WINDOW, jumped-to Sunday
            included, because that is what is on the screen. Pluralised in a branch rather than
            templated: "1 Sundays" is the plural bug scenario 031 exists to catch
            (plans/retros/ai-b-knowledge-and-retrieval.md). */}
        <p className="mt-1 text-sm text-muted">
          {entries.length} {entries.length === 1 ? "Sunday" : "Sundays"}
        </p>
      </div>

      {/* TWO EMPTY STATES, because a window has two ways to be empty — and `entries.length` is
          tested FIRST, which is load-bearing rather than tidy. A jumped-to Sunday is resolved
          outside the window query, so a ward whose next 16 weeks hold no Sundays at all can
          still have exactly one card to show. Branching on `sundays.length` first would hide it
          behind "no sacrament meetings are coming up" — which is the 072-D1 failure again, in a
          page that had the right card in its hand.

          The first sentence no longer tells the reader to open the month on the calendar: since
          slice 1 the year is already generated, and this page's reader may hold no
          `calendar.manage` anyway, so the instruction would have been both unnecessary and
          unactionable. It states a fact and offers no action, because there is no action to
          offer. The second is reachable — a run of Sundays whose only entries are a stake
          conference and general conference. */}
      {entries.length > 0 ? (
        <MusicSundayList
          // KEYED ON THE JUMP, because `initialOpenSundayId` is a useState INITIAL value and
          // React keeps state across a re-render of the same component instance. Arriving at
          // /music?sunday=A and then at /music?sunday=B without leaving the route would otherwise
          // re-render the list with B's entries and A still open — the card the second link named
          // would be sitting there closed, which is 072-D1's symptom from a different cause.
          key={openSundayId ?? "none"}
          entries={entries}
          initialOpenSundayId={openSundayId}
          canManage={canManage}
        />
      ) : sundays.length === 0 ? (
        <Card>
          <p className="text-sm text-muted">No sacrament meetings are coming up.</p>
        </Card>
      ) : (
        <Card>
          <p className="text-sm text-muted">
            No Sunday in the weeks ahead holds a sacrament meeting.
          </p>
        </Card>
      )}
    </div>
  );
}

function matchingId(sundays: readonly Sunday[], sundayId: string | undefined): string | null {
  if (sundayId === undefined) return null;
  return sundays.some((sunday) => sunday.id === sundayId) ? sundayId : null;
}

// Null whenever the window already contains it, so the ordinary case — a pill on a Sunday a few
// weeks out — costs no second query at all.
async function resolveJumpedSunday(
  wardId: string,
  sundayId: string | undefined,
  inWindow: readonly Sunday[],
  client: Awaited<ReturnType<typeof createServerSupabaseClient>>,
): Promise<Sunday | null> {
  if (sundayId === undefined || !UUID_PATTERN.test(sundayId)) return null;
  if (inWindow.some((sunday) => sunday.id === sundayId)) return null;

  const sunday = await getSunday(wardId, sundayId, client);
  if (sunday === null) return null;

  // The page's existing rule, applied to the jump as well: there is no music for a meeting that
  // is not held, so a link to a stake-conference Sunday opens the ordinary list rather than
  // adding a card with nothing on it.
  return holdsSacramentMeeting(sunday.type) ? sunday : null;
}
