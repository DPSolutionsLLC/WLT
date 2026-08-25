import { SundayMusicCard } from "@/app/(app)/music/SundayMusicCard";
import { Card } from "@/components/ui/Card";
import { NotPermitted } from "@/components/ui/NotPermitted";
import { can, resolveRoleAccess } from "@/lib/auth/permissions";
import { requireSessionUser } from "@/lib/auth/session";
import { addDaysUtc, formatDateOnly } from "@/lib/calendar/dates";
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

// Six Sundays. Far enough ahead for a coordinator working a month or two out, short enough that
// the page stays a page.
const HORIZON_SUNDAYS = 6;

export default async function MusicPage() {
  const user = await requireSessionUser();
  const supabase = await createServerSupabaseClient();
  const roleAccess = await resolveRoleAccess(supabase, user.wardId);

  // can() rather than assertCan(): a ForbiddenError escaping a Server Component becomes a 500
  // whose message Next.js strips in production (plans/retros/auth-b-invites-admin.md).
  if (!can(user, "music.view", roleAccess)) {
    return <NotPermitted detail="Sacrament meeting music is limited to ward leadership." />;
  }

  const canManage = can(user, "music.manage", roleAccess);

  const today = formatDateOnly(new Date());
  const sundays = await listSundays(
    user.wardId,
    // A wider window than six weeks, then sliced. Cancelled Sundays and ward conferences hold no
    // sacrament meeting and are filtered out below, so asking for exactly six weeks would show
    // four cards in a month that has two of them.
    { from: today, to: addDaysUtc(today, HORIZON_SUNDAYS * 7 * 2) },
    supabase,
  );

  // SUNDAYS THAT HOLD NO SACRAMENT MEETING ARE ABSENT ENTIRELY — not greyed out and not disabled.
  // There is no music for a meeting that is not held, and a disabled row reads as "this is
  // coming" when the truth is that it is not coming at all (the program list page's rule).
  const meetingSundays = sundays
    .filter((sunday) => holdsSacramentMeeting(sunday.type))
    .slice(0, HORIZON_SUNDAYS);

  const [selections, musicalNumbers, topicsBySunday] = await Promise.all([
    listSelections(user.wardId, { sundayIds: meetingSundays.map((s) => s.id) }, supabase),
    listMusicalNumbers(user.wardId, meetingSundays.map((s) => s.id), supabase),
    listSundayTopicTitles(user.wardId, meetingSundays, supabase),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Music</h1>
        {/* "The next 1 Sunday" is not a sentence anybody writes. The singular drops the count
            entirely rather than printing it — the plural bug scenario 031 exists to catch
            (plans/retros/ai-b-knowledge-and-retrieval.md). */}
        <p className="mt-1 text-sm text-muted">
          {meetingSundays.length === 1
            ? "The next Sunday that holds a sacrament meeting."
            : `The next ${meetingSundays.length} Sundays that hold a sacrament meeting.`}
        </p>
      </div>

      {meetingSundays.length === 0 ? (
        <Card>
          <p className="text-sm text-muted">
            There are no sacrament meetings on the calendar yet. Open the month on the calendar
            first — a member of the bishopric or the ward secretary creates a month by viewing it.
          </p>
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
