import type { SupabaseClient } from "@supabase/supabase-js";
import {
  type Assignment,
  listAssignments,
  listCancelledHistoryAssignmentIds,
  writeAssignmentHistory,
} from "@/lib/assignments/queries";
import { formatSundayLabelWithYear } from "@/lib/calendar/dates";
import { getSunday, readConductorName, type Sunday } from "@/lib/calendar/queries";
import { listMusicalNumbers, type MusicalNumber } from "@/lib/music/queries";
import { listCancelledPrayers, type Prayer } from "@/lib/prayers/queries";
import { getMember } from "@/lib/roster/queries";
import { buildAsksForTalks, hasSpeaker } from "@/lib/sacrament/sundayAsks";
import {
  buildMusicTellTitle,
  buildPrayerTellTitle,
  buildTellTitle,
  talkIsOff,
} from "@/lib/sacrament/talkAsks";
import { createServiceSupabaseClient } from "@/lib/supabase/service";
import {
  AskLinkWriteError,
  createTellTodos,
  handOverAsks,
  listLatestAskOwners,
  listOpenAsks,
  listToldAssignmentIds,
  listToldMusicalNumberIds,
  listToldPrayerIds,
  markAsksTalkOff,
  type OpenAsk,
  type TellToCreate,
} from "@/lib/todos/askLinks";
import { wardDateOnly } from "@/lib/ward/wardDate";
import { readWardTimezone } from "@/lib/ward/wardTimezone";
import type { Database } from "@/types/database";
import { PRAYER_TYPE_LABELS } from "@/types/domain";

// A SUNDAY'S PEOPLE, BROUGHT INTO LINE WITH THE CALENDAR — Sacrament slices f2, f2b and f2c.
// SERVER-ONLY. Run after every Sunday save.
//
// A RECONCILE, NOT A REACTION TO A CHANGE. It asks of the STATE what should be true, never "what
// just changed?", because that question cannot be asked twice: once the Sunday is saved, a retry
// after a half-finished run would see no change and do nothing. Asked of the state, a repeat
// finishes whatever the last run left, and a run with nothing to do is a few reads.
//
// Two rules, in this order:
//
//   1. CANCELLED WORK REACHES THE PEOPLE IT AFFECTS (f2b, f2c). The calendar cancels a Sunday's lost
//      talks, prayers and music (lib/calendar/queries.ts, cancelSundayWork); this tells people.
//        - a cancelled talk by a ward member gets its `cancelled` speaker-history row, once;
//        - an open ask on a talk that is off stays with its owner, stamped, and offers "Told them";
//        - a speaker who had already ACCEPTED gets their last asker a "Let ___ know the talk is
//          cancelled" to-do;
//        - a cancelled prayer somebody was ASKED to give gets whoever asked a to-do; one only
//          assigned was never asked, so nobody is told;
//        - a cancelled musical number gets the person making the change a to-do, because nothing
//          records who arranged it;
//        - a hymn choice tells nobody.
//      Each "let them know" to-do is created only if that work has NEVER had one, open or closed,
//      so pressing Told them can never bring one back. A talk that is off but not cancelled (a
//      Fast Sunday moved by calendar GENERATION, which cancels nothing — see the f2c plan's known
//      limitation) is treated the same as a cancelled one here.
//   2. THE WORK FOLLOWS THE CONDUCTOR (f2). On a live talk that is on, an open ask held by anybody
//      but the current conductor moves to them: a clean copy for the conductor, the old one closed
//      as handed over. A Sunday with NO conductor keeps its asks where they are.
//
// There is NO "back on" rule any more (f2b had one). Cancelled work stays cancelled; if the Sunday
// holds a meeting again, planning starts over and the "let them know" to-dos stay open (the user's
// decision C6, 2026-09-26).
//
// Every caller that writes `sundays.conducting_user_id` over a previous value, or cancels a
// Sunday's work, must call this for the Sundays it changed. tests/lib/conductorHandoverSites.test.ts
// reads the source to hold them to it.
//
// `client` is the caller's OWN RLS-scoped client: the Sundays and talks are read through it, so the
// ids handed to the service-role writes are ones RLS admitted. The writes to other people's to-dos
// and to speaker history use the service role behind the route's guard: `calendar.manage` does not
// carry the talk pipeline's writes, and a ward secretary who cancels a meeting must still leave the
// record and the to-dos behind.

export type ReconcileResult = {
  // Rule 2.
  handedOverSundayIds: string[];
  createdIds: string[];
  closedIds: string[];
  // Rule 1.
  talkOffTodoIds: string[];
  tellTodoIds: string[];
  historyWrittenAssignmentIds: string[];
};

function emptyResult(): ReconcileResult {
  return {
    handedOverSundayIds: [],
    createdIds: [],
    closedIds: [],
    talkOffTodoIds: [],
    tellTodoIds: [],
    historyWrittenAssignmentIds: [],
  };
}

export function writtenTodoIds(result: ReconcileResult): string[] {
  return [...result.createdIds, ...result.closedIds, ...result.talkOffTodoIds, ...result.tellTodoIds];
}

type SundayWork = {
  talks: Assignment[];
  openAsks: OpenAsk[];
  prayers: Prayer[];
  musicalNumbers: MusicalNumber[];
  toldTalks: Set<string>;
  toldPrayers: Set<string>;
  toldMusic: Set<string>;
  talksWithHistory: Set<string>;
};

export async function reconcileSundayAsks(params: {
  wardId: string;
  sundayIds: readonly string[];
  actingUserId: string;
  client: SupabaseClient<Database>;
}): Promise<ReconcileResult> {
  const { wardId, client } = params;
  const result = emptyResult();

  const sundayIds = [...new Set(params.sundayIds)];
  if (sundayIds.length === 0) return result;

  // A handful of reads however many Sundays a re-shift touched. Only a Sunday with something to
  // act on is read further.
  const [talks, prayers, allMusic] = await Promise.all([
    listAssignments(wardId, { sundayIds, includeCancelled: true }, client),
    listCancelledPrayers(wardId, sundayIds, client),
    listMusicalNumbers(wardId, sundayIds, client, { includeCancelled: true }),
  ]);
  const musicalNumbers = allMusic.filter((number) => number.cancelledAt !== null);
  const openAsks = await listOpenAsks({ wardId, assignmentIds: talks.map((talk) => talk.id) });

  const cancelledTalkIds = talks.filter((talk) => talk.cancelledAt !== null).map((talk) => talk.id);
  const accepted = talks.filter((talk) => talk.requestOutcome === "accepted" && hasSpeaker(talk));
  if (
    openAsks.length === 0 &&
    cancelledTalkIds.length === 0 &&
    accepted.length === 0 &&
    prayers.length === 0 &&
    musicalNumbers.length === 0
  ) {
    return result;
  }

  const [toldTalks, toldPrayers, toldMusic, talksWithHistory] = await Promise.all([
    listToldAssignmentIds({ wardId, assignmentIds: talks.map((talk) => talk.id) }),
    listToldPrayerIds({ wardId, prayerIds: prayers.map((prayer) => prayer.id) }),
    listToldMusicalNumberIds({
      wardId,
      musicalNumberIds: musicalNumbers.map((number) => number.id),
    }),
    listCancelledHistoryAssignmentIds(wardId, cancelledTalkIds, createServiceSupabaseClient()),
  ]);

  const talkById = new Map(talks.map((talk) => [talk.id, talk] as const));
  const sundays = await readSundays(
    wardId,
    [
      ...openAsks.map((ask) => talkById.get(ask.assignmentId)?.sundayId),
      ...cancelledTalkIds.map((id) => talkById.get(id)?.sundayId),
      ...accepted.map((talk) => talk.sundayId),
      ...prayers.map((prayer) => prayer.sundayId),
      ...musicalNumbers.map((number) => number.sundayId),
    ],
    client,
  );

  const timeZone = await readWardTimezone(wardId, client);
  const today = wardDateOnly(new Date(), timeZone);

  for (const sunday of sundays) {
    const work: SundayWork = {
      talks: talks.filter((talk) => talk.sundayId === sunday.id),
      openAsks,
      prayers: prayers.filter((prayer) => prayer.sundayId === sunday.id),
      musicalNumbers: musicalNumbers.filter((number) => number.sundayId === sunday.id),
      toldTalks,
      toldPrayers,
      toldMusic,
      talksWithHistory,
    };
    const isOff = (talk: Assignment) =>
      talk.cancelledAt !== null ||
      talkIsOff({
        sundayType: sunday.type,
        speakingSlots: sunday.speakingSlots,
        slotNumber: talk.slotNumber,
      });
    const asksOn = (talk: Assignment) => openAsks.filter((ask) => ask.assignmentId === talk.id);

    try {
      await tellAboutCancelledWork({
        wardId,
        sunday,
        work,
        offTalks: work.talks.filter(isOff),
        asksOn,
        actingUserId: params.actingUserId,
        today,
        client,
        result,
      });

      // What is left open on a live talk that is on. A stamped ask is somebody's to tell, never
      // somebody's to hand over.
      const liveAsks = work.talks
        .filter((talk) => !isOff(talk))
        .flatMap(asksOn)
        .filter((ask) => ask.talkOffAt === null);
      const conductorId = sunday.conductingUserId;
      // f3 adds the assistant here: their copies are not stray either.
      const stray =
        conductorId === null ? [] : liveAsks.filter((ask) => ask.ownerUserId !== conductorId);
      if (conductorId !== null && stray.length > 0) {
        await handOverSunday({
          wardId,
          sunday,
          conductorId,
          stray,
          talks: work.talks,
          actingUserId: params.actingUserId,
          today,
          client,
          result,
        });
      }
    } catch (error) {
      if (!(error instanceof AskLinkWriteError)) throw error;
      throw new AskLinkWriteError(error.cause, [
        ...writtenTodoIds(result),
        ...error.completedIds,
      ]);
    }
  }

  return result;
}

// Rule 1.
async function tellAboutCancelledWork(params: {
  wardId: string;
  sunday: Sunday;
  work: SundayWork;
  offTalks: readonly Assignment[];
  asksOn: (talk: Assignment) => OpenAsk[];
  actingUserId: string;
  today: string;
  client: SupabaseClient<Database>;
  result: ReconcileResult;
}): Promise<void> {
  const { wardId, sunday, work, result } = params;
  const sundayLabel = formatSundayLabelWithYear(sunday.date);

  // Speaker history, once per cancelled member talk. writeAssignmentHistory() writes nothing for a
  // visitor, who has no history row (migration 005: `member_id not null`).
  const service = createServiceSupabaseClient();
  for (const talk of params.offTalks) {
    if (talk.cancelledAt === null || talk.memberId === null) continue;
    if (work.talksWithHistory.has(talk.id)) continue;
    await writeAssignmentHistory(wardId, talk, "cancelled", service);
    result.historyWrittenAssignmentIds.push(talk.id);
  }

  const toMark = params.offTalks
    .flatMap(params.asksOn)
    .filter((ask) => ask.talkOffAt === null)
    .map((ask) => ask.todoId);
  result.talkOffTodoIds.push(...(await markAsksTalkOff({ wardId, todoIds: toMark, sundayLabel })));

  const tells: TellToCreate[] = [];

  const toTell = params.offTalks.filter(
    (talk) =>
      talk.requestOutcome === "accepted" &&
      hasSpeaker(talk) &&
      params.asksOn(talk).length === 0 &&
      !work.toldTalks.has(talk.id),
  );
  if (toTell.length > 0) {
    const [asks, owners] = await Promise.all([
      buildAsksForTalks({ wardId, sundayDate: sunday.date, talks: toTell, client: params.client }),
      listLatestAskOwners({ wardId, assignmentIds: toTell.map((talk) => talk.id) }),
    ]);
    for (const ask of asks) {
      tells.push({
        link: { assignmentId: ask.assignmentId },
        // A talk accepted from its own panel has no ask, so nobody asked it through To Do. The
        // person who made this calendar change is told instead: they are the one who knows.
        ownerUserId: owners.get(ask.assignmentId) ?? params.actingUserId,
        title: buildTellTitle(ask.speakerName),
        notes: ask.notes,
      });
    }
  }

  // A prayer somebody was asked to give. One still at `assign` was never asked.
  for (const prayer of work.prayers) {
    if (work.toldPrayers.has(prayer.id)) continue;
    if (prayer.stage !== "ask" && prayer.stage !== "confirm") continue;
    if (prayer.askedBy === null || prayer.memberId === null) continue;
    const member = await getMember(wardId, prayer.memberId, params.client);
    const name = member === null ? "the person asked" : `${member.firstName} ${member.lastName}`.trim();
    const prayerLabel = prayer.prayerType === null ? "Prayer" : PRAYER_TYPE_LABELS[prayer.prayerType];
    tells.push({
      link: { prayerId: prayer.id },
      ownerUserId: prayer.askedBy,
      title: buildPrayerTellTitle(name),
      notes: [
        `${prayerLabel}: ${name}`,
        member?.phone ? `Phone: ${member.phone}` : null,
        `Sunday: ${sundayLabel}`,
      ]
        .filter((line): line is string => line !== null)
        .join("\n"),
    });
  }

  for (const number of work.musicalNumbers) {
    if (work.toldMusic.has(number.id)) continue;
    tells.push({
      link: { musicalNumberId: number.id },
      ownerUserId: params.actingUserId,
      title: buildMusicTellTitle(number.performer),
      notes: [
        number.pieceTitle ? `Musical number: ${number.pieceTitle}` : "Musical number",
        number.performer ? `Performer: ${number.performer}` : null,
        `Sunday: ${sundayLabel}`,
      ]
        .filter((line): line is string => line !== null)
        .join("\n"),
    });
  }

  if (tells.length === 0) return;
  result.tellTodoIds.push(
    ...(await createTellTodos({
      wardId,
      tells,
      assignedByUserId: params.actingUserId,
      today: params.today,
      sundayLabel,
    })),
  );
}

// Rule 2.
async function handOverSunday(params: {
  wardId: string;
  sunday: Sunday;
  conductorId: string;
  stray: readonly OpenAsk[];
  talks: readonly Assignment[];
  actingUserId: string;
  today: string;
  client: SupabaseClient<Database>;
  result: ReconcileResult;
}): Promise<void> {
  const strayTalkIds = new Set(params.stray.map((ask) => ask.assignmentId));
  const previousOwnerIds = [...new Set(params.stray.map((ask) => ask.ownerUserId))];

  const [asks, conductorName, previousNames] = await Promise.all([
    buildAsksForTalks({
      wardId: params.wardId,
      sundayDate: params.sunday.date,
      talks: params.talks.filter((talk) => strayTalkIds.has(talk.id)),
      client: params.client,
    }),
    readConductorName(params.wardId, params.conductorId, params.client),
    Promise.all(
      previousOwnerIds.map(
        async (userId) =>
          [userId, await readConductorName(params.wardId, userId, params.client)] as const,
      ),
    ),
  ]);
  const askByTalk = new Map(asks.map((ask) => [ask.assignmentId, ask] as const));
  const nameOf = new Map(previousNames);

  const { createdIds, closedIds } = await handOverAsks({
    wardId: params.wardId,
    toUserId: params.conductorId,
    toName: conductorName ?? "the new conductor",
    handovers: params.stray.flatMap((openAsk) => {
      const ask = askByTalk.get(openAsk.assignmentId);
      return ask === undefined
        ? []
        : [
            {
              fromTodoId: openAsk.todoId,
              fromName: nameOf.get(openAsk.ownerUserId) ?? "the previous conductor",
              ask,
            },
          ];
    }),
    assignedByUserId: params.actingUserId,
    today: params.today,
  });

  params.result.handedOverSundayIds.push(params.sunday.id);
  params.result.createdIds.push(...createdIds);
  params.result.closedIds.push(...closedIds);
}

async function readSundays(
  wardId: string,
  sundayIds: readonly (string | null | undefined)[],
  client: SupabaseClient<Database>,
): Promise<Sunday[]> {
  const unique = [
    ...new Set(sundayIds.filter((id): id is string => id !== null && id !== undefined)),
  ];
  const found = await Promise.all(unique.map((sundayId) => getSunday(wardId, sundayId, client)));
  return found.filter((sunday): sunday is Sunday => sunday !== null);
}
