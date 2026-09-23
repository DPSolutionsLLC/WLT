import { monthOf, type DateOnly } from "@/lib/calendar/dates";
import {
  holdsSacramentMeeting,
  type PipelineStage,
  type PrayerType,
  type SundayType,
} from "@/types/domain";

// ONE DEFINITION OF EACH COUNT ON A SUNDAY, so the hub's pill and the page behind it cannot
// disagree. The hub renders `Topics 2/3`; /assignments/[id] renders two topics. If those two
// numbers were computed in two places they would drift on the next change to either — which is
// exactly what ITER-022 shipped, where every card read `Covered · 0` above an event card reading
// `Covered · 1` because the summary type held the state and the date but not the COUNT.
//
// So this module returns the counts it displayed. Nothing downstream re-derives them.
//
// ---------------------------------------------------------------------------
// NOTHING BUT `@/types/domain` AND THE PURE DATE HELPERS MAY BE IMPORTED HERE
// ---------------------------------------------------------------------------
// A single VALUE import of any `queries.ts` pulls in `next/headers`, which `npm run lint` and
// `npm run typecheck` both pass and only `npm run build` catches
// (plans/retros/roster-b-picker-and-orgs.md). lib/assignments/pipeline.ts carries this same rule
// in its header for the same reason. `@/lib/calendar/dates` is admitted because it is pure string
// arithmetic with no imports of its own — see NO CLOCK below for why `monthOf` in particular does
// not breach the second rule either.
//
// ⚠️ NOTHING RENDERS THIS FROM A CLIENT COMPONENT TODAY, and the rule is here anyway. The hub is
// a Server Component and components/sacrament/{SundayCard,StatusPill}.tsx have no "use client" —
// month navigation is a URL change, handled by the client component /calendar already owns. But
// p4-sacrament-f turns the Talks pill four-state on an interaction, which is the slice most
// likely to put this module in the browser bundle, and the import that breaks it is invisible to
// every check except the production build. Keeping the constraint while it costs nothing is what
// stops that slice discovering it.
//
// ---------------------------------------------------------------------------
// NO CLOCK
// ---------------------------------------------------------------------------
// No `Date`, no `now`, no `asOf`. A pill says how much of a Sunday has been filled in, which is
// not a question the clock answers — an untouched Sunday three weeks out and an untouched Sunday
// three weeks past are both `0/3`. Anything time-dependent belongs to the caller.
//
// `monthOf` does not breach this: it takes a `DateOnly` the caller already holds and slices it.
// It calls no `new Date()`, so an href built here is a function of the Sunday's own date and of
// nothing ambient — which is what tests/lib/sacramentSundayStatus.test.ts pins, so that a future
// clock cannot make the month assertion pass by accident.

export type PillStatus = "empty" | "partial" | "complete";

// FOUR PILLS, AND THE TWO THAT LEFT WERE NOT DROPPED FOR SPACE.
//
// `program` LEFT BECAUSE THE WHOLE CARD IS NOW THE PROGRAMME LINK. Clicking a Sunday opens what
// that Sunday's programme will look like, incomplete parts included — the user's own model, and
// a better one: the programme is the SUM of this card, not one more item beside its parts.
//
// `conducting` LEFT BECAUSE IT IS NOT A PIECE OF WORK. Every other pill counts something a
// leader has to go and do; who conducts is a standing rotation that is occasionally overridden.
// Scoring it `1/1` put a settled fact in a row of outstanding ones. The conducting NAME is still
// on the card and is now the link to the Sunday editor, which is where the override already
// lives — so nothing became unreachable by removing the pill.
//
// `assignments` — who passes, blesses and prepares — belongs in this list and is deliberately
// ABSENT until P11 builds the adult ordinance screen. A pill pointing at a route with no page is
// the standing broken-link bug P3 closed (lib/auth/navigation.tsx's `built` gate); add the key
// here in the same change that adds the page, never before.
export type SundayPillKey = "topics" | "talks" | "prayer" | "music";

export type SundayPill = {
  key: SundayPillKey;
  label: string;
  filled: number;
  total: number;
  status: PillStatus;
};

export type SundayStatusAssignment = {
  topicId: string | null;
  memberId: string | null;
  externalSpeakerName: string | null;
  // NOT READ BY ANY COUNT BELOW, and deliberately required anyway. p4-sacrament-f turns the Talks
  // pill four-state (dimmed → pending → accepted → declined), which is a question about the
  // pipeline stage and nothing else. Every caller already holds it — `Assignment.stage` is on the
  // row they mapped from — so requiring it now costs nothing and means that slice changes this
  // module rather than every page that feeds it.
  stage: PipelineStage;
};

export type SundayStatusPrayer = {
  memberId: string | null;
  prayerType: PrayerType | null;
};

export type SundayStatusInput = {
  // `sundays.speaking_slots`, NEVER `assignments.length`. A Sunday configured for three talks
  // with one assignment on it reads `1/3` — the two slots nobody has touched are the whole point
  // of the pill, and counting the rows instead would render it `1/1` and say the Sunday is done.
  speakingSlots: number;
  assignments: readonly SundayStatusAssignment[];
  prayers: readonly SundayStatusPrayer[];
  hymnSelectionCount: number;
};

// Three hymns — opening, sacrament, closing (HYMN_TYPES). Musical numbers are extra and
// deliberately uncounted: p4-sacrament-e gives them a position and until then a Sunday with three
// hymns is a Sunday whose music is chosen.
export const HYMNS_PER_SUNDAY = 3;

// An invocation and a benediction (PRAYER_TYPES). Prayers SURVIVE `speaking_slots = 0` — a fast
// Sunday still has both — so this total is never derived from the slot count
// (lib/prayers/queries.ts states the same rule from the other side).
export const PRAYERS_PER_SUNDAY = 2;

const PILL_LABELS: Record<SundayPillKey, string> = {
  topics: "Topics",
  talks: "Talks",
  prayer: "Prayer",
  music: "Music",
};

// `total === 0` IS `complete`, NOT `empty` — a GUARD now rather than a live case. A Sunday with
// no speaking slots omits its talk pills outright (see sundayPills below), so nothing should
// reach this branch; if something ever does, "nothing outstanding" is still the right answer and
// the alternative would put a fast Sunday permanently on a list of things to chase.
export function pillStatus(filled: number, total: number): PillStatus {
  if (total === 0) return "complete";
  if (filled >= total) return "complete";
  if (filled === 0) return "empty";
  return "partial";
}

function hasSpeaker(assignment: SundayStatusAssignment): boolean {
  // An ITER-004 external speaker is a REAL speaker. A visiting high councillor named in
  // `external_speaker_name` fills the slot exactly as a roster member does, and counting only
  // `memberId` would report a fully planned stake-visit Sunday as empty.
  return (
    assignment.memberId !== null ||
    (assignment.externalSpeakerName !== null && assignment.externalSpeakerName.trim() !== "")
  );
}

function countTopics(input: SundayStatusInput): number {
  return input.assignments.filter((assignment) => assignment.topicId !== null).length;
}

function countTalks(input: SundayStatusInput): number {
  return input.assignments.filter(
    (assignment) => assignment.topicId !== null && hasSpeaker(assignment),
  ).length;
}

// TOPICS AND TALKS ARE DELIBERATELY DIFFERENT METRICS AND MUST NOT BE FOLDED INTO ONE.
// The prototype's build note §topics-pill-and-finalize-checkmark records why: "a topic can
// genuinely be decided before any speaker is even picked". That is this ward's stated workflow —
// lay out a month of topics first, then find people for them — so a single "planned" count would
// report the whole first half of the work as nothing having happened.
export function sundayPills(input: SundayStatusInput): readonly SundayPill[] {
  const slots = Math.max(0, input.speakingSlots);

  const prayers = Math.min(
    input.prayers.filter((prayer) => prayer.prayerType !== null && prayer.memberId !== null)
      .length,
    PRAYERS_PER_SUNDAY,
  );

  const hymns = Math.min(Math.max(0, input.hymnSelectionCount), HYMNS_PER_SUNDAY);

  // A SUNDAY WITH NO SPEAKING SLOTS SHOWS NO TALK PILLS AT ALL.
  //
  // A fast Sunday has no speakers by design, and `Topics 0/0` beside `Talks 0/0` was reporting
  // that as though it were a score. Walking scenario 072 the user read it as the card having
  // failed to load, which is the same complaint program-c's reversal answers from the other
  // direction — there, an omitted pill read as broken; here, a pill for work that does not exist
  // read as broken. The rule that reconciles them is: **a pill is shown when there is work to
  // count, and omitted when the work is not part of that Sunday**.
  //
  // Keyed on `speaking_slots`, NOT on `type === "fast_sunday"`. A ward that zeroes the slots on
  // an ordinary Sunday means the same thing by it, and reading the type here would put a second
  // definition of "has speakers" in the codebase for the calendar to disagree with.
  //
  // PRAYERS AND MUSIC SURVIVE, and that is the whole reason this is not `holdsSacramentMeeting`:
  // a fast Sunday still has an invocation, a benediction and three hymns
  // (lib/prayers/queries.ts states the same rule from the other side).
  const talkPills =
    slots === 0
      ? []
      : [
          // Clamped, not asserted. More assignment rows than slots is reachable: cutting
          // speaking_slots warns and reverts assignments (calendar-b's CalendarChangeWarning),
          // and a surviving row would otherwise render `4/3`, which reads as a bug in the pill
          // rather than as a fact about the Sunday.
          pill("topics", Math.min(countTopics(input), slots), slots),
          pill("talks", Math.min(countTalks(input), slots), slots),
        ];

  return [
    ...talkPills,
    pill("prayer", prayers, PRAYERS_PER_SUNDAY),
    pill("music", hymns, HYMNS_PER_SUNDAY),
  ];
}

function pill(key: SundayPillKey, filled: number, total: number): SundayPill {
  return { key, label: PILL_LABELS[key], filled, total, status: pillStatus(filled, total) };
}

// Whether the hub renders pills for this Sunday at all. A stake- or general-conference Sunday
// holds no sacrament meeting: no conductor, no speakers, no prayers. Six pills reading `0/3` on
// it would invite somebody to plan a meeting that is not happening, so the card says so in a
// sentence instead (components/sacrament/SundayCard.tsx).
export function sundayHasPills(type: SundayType): boolean {
  return holdsSacramentMeeting(type);
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
// `/music` IS A MONTH BOARD, so the Music pill carries the month and the Sunday anchor exactly
// as Prayer does. It used to carry neither: /music was a rolling six-Sunday horizon from today
// with no date parameter, so a pill reporting real work on a Sunday more than six weeks out
// opened a page saying there were no sacrament meetings on the calendar at all. That is 072-D1,
// found by walking scenario 072, and this href plus app/(app)/music/page.tsx's month parameter
// are the two halves of the fix.
export function sundayPillHrefs(
  sundayId: string,
  date: DateOnly,
): Record<SundayPillKey, string> {
  const assignment = `/assignments/${sundayId}`;

  return {
    topics: assignment,
    talks: assignment,
    // /prayers and /music are MONTH boards with no per-Sunday page, so the pill lands on the
    // month and scrolls to the card. PrayerBoard and SundayMusicCard each carry the matching
    // `id` on that Sunday's Card.
    prayer: `/prayers?month=${monthOf(date)}#sunday-${sundayId}`,
    music: `/music?month=${monthOf(date)}#sunday-${sundayId}`,
  };
}
