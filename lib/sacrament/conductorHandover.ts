import type { SupabaseClient } from "@supabase/supabase-js";
import { type Assignment, listAssignments, writeRequestOutcome } from "@/lib/assignments/queries";
import { formatSundayLabelWithYear } from "@/lib/calendar/dates";
import { getSunday, readConductorName, type Sunday } from "@/lib/calendar/queries";
import { buildAsksForTalks, hasSpeaker } from "@/lib/sacrament/sundayAsks";
import { buildTellTitle, talkIsOff } from "@/lib/sacrament/talkAsks";
import { createServiceSupabaseClient } from "@/lib/supabase/service";
import {
  AskLinkWriteError,
  closeAsksForAssignment,
  createTellTodos,
  handOverAsks,
  listLatestAskOwners,
  listOpenAsks,
  markAsksTalkOff,
  type OpenAsk,
} from "@/lib/todos/askLinks";
import { wardDateOnly } from "@/lib/ward/wardDate";
import { readWardTimezone } from "@/lib/ward/wardTimezone";
import type { Database } from "@/types/database";

// A SUNDAY'S TALK ASKS, BROUGHT INTO LINE WITH THE CALENDAR — Sacrament slices f2 and f2b.
// SERVER-ONLY. Run after every Sunday save.
//
// A RECONCILE, NOT A REACTION TO A CHANGE. It asks of the STATE what should be true, never "what
// just changed?", because that question cannot be asked twice: once the Sunday is saved, a retry
// after a half-finished run would see no change and do nothing. Asked of the state, a repeat
// finishes whatever the last run left, and a run with nothing to do is two reads.
//
// Three rules, per talk, in this order:
//
//   1. THE TALK IS OFF (talkIsOff(): no meeting, or no slot). Whoever asked the speaker must tell
//      them. Each open ask is stamped and gets a "No talk on ___ any more" line, and stays with its
//      owner. A speaker who had already ACCEPTED has no open ask, so whoever asked them last gets a
//      new "Let ___ know there's no talk" to-do. "Told them" on the card closes it.
//   2. THE TALK IS BACK ON before anybody was told. Every stamped ask closes ("The talk is back on")
//      and the talk's answer is cleared, so Send asks offers the speaker again FROM SCRATCH (the
//      user's decision, 2026-09-26).
//   3. THE WORK FOLLOWS THE CONDUCTOR (f2). On a talk that is on, an open ask held by anybody but
//      the current conductor moves to them: a clean copy for the conductor, the old one closed as
//      handed over. A Sunday with NO conductor keeps its asks where they are.
//
// Every caller that writes `sundays.conducting_user_id` over a previous value must call this for
// the Sundays it changed. tests/lib/conductorHandoverSites.test.ts reads the source to hold them
// to it.
//
// `client` is the caller's OWN RLS-scoped client: the Sundays and talks are read through it, so
// the ids handed to the service-role writes in lib/todos/askLinks.ts are ones RLS admitted. The
// one talk write here — clearing an answer on rule 2 — uses the service role too, behind the same
// route guard: `calendar.manage` does not carry the talk pipeline's write, and a calendar change
// that leaves a talk claiming an answer for a meeting that went away and came back is worse.

export type ReconcileResult = {
  // Rule 3.
  handedOverSundayIds: string[];
  createdIds: string[];
  closedIds: string[];
  // Rule 1.
  talkOffTodoIds: string[];
  tellTodoIds: string[];
  // Rule 2.
  backOnTodoIds: string[];
  answersClearedAssignmentIds: string[];
};

function emptyResult(): ReconcileResult {
  return {
    handedOverSundayIds: [],
    createdIds: [],
    closedIds: [],
    talkOffTodoIds: [],
    tellTodoIds: [],
    backOnTodoIds: [],
    answersClearedAssignmentIds: [],
  };
}

export function writtenTodoIds(result: ReconcileResult): string[] {
  return [
    ...result.createdIds,
    ...result.closedIds,
    ...result.talkOffTodoIds,
    ...result.tellTodoIds,
    ...result.backOnTodoIds,
  ];
}

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

  // One read of the talks and one of the open asks, however many Sundays a re-shift touched. Only
  // a Sunday with an open ask or an accepted speaker can need anything, and only those are read.
  const talks = await listAssignments(wardId, { sundayIds }, client);
  const openAsks = await listOpenAsks({
    wardId,
    assignmentIds: talks.map((talk) => talk.id),
  });
  const accepted = talks.filter(
    (talk) => talk.requestOutcome === "accepted" && hasSpeaker(talk),
  );
  if (openAsks.length === 0 && accepted.length === 0) return result;

  const talkById = new Map(talks.map((talk) => [talk.id, talk] as const));
  const sundays = await readSundays(
    wardId,
    [...openAsks.map((ask) => talkById.get(ask.assignmentId)?.sundayId), ...accepted.map((talk) => talk.sundayId)],
    client,
  );

  const timeZone = await readWardTimezone(wardId, client);
  const today = wardDateOnly(new Date(), timeZone);

  for (const sunday of sundays) {
    const sundayTalks = talks.filter((talk) => talk.sundayId === sunday.id);
    const isOff = (talk: Assignment) =>
      talkIsOff({
        sundayType: sunday.type,
        speakingSlots: sunday.speakingSlots,
        slotNumber: talk.slotNumber,
      });
    const asksOn = (talk: Assignment) => openAsks.filter((ask) => ask.assignmentId === talk.id);

    try {
      await applyTalkOff({
        wardId,
        sunday,
        offTalks: sundayTalks.filter(isOff),
        asksOn,
        actingUserId: params.actingUserId,
        today,
        client,
        result,
      });

      const onTalks = sundayTalks.filter((talk) => !isOff(talk));
      await applyBackOn({ wardId, onTalks, asksOn, result });

      // What is left open on a talk that is on, once rule 2 has closed the stamped ones.
      const liveAsks = onTalks.flatMap(asksOn).filter((ask) => ask.talkOffAt === null);
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
          talks: sundayTalks,
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
async function applyTalkOff(params: {
  wardId: string;
  sunday: Sunday;
  offTalks: readonly Assignment[];
  asksOn: (talk: Assignment) => OpenAsk[];
  actingUserId: string;
  today: string;
  client: SupabaseClient<Database>;
  result: ReconcileResult;
}): Promise<void> {
  if (params.offTalks.length === 0) return;
  const sundayLabel = formatSundayLabelWithYear(params.sunday.date);

  const toMark = params.offTalks
    .flatMap(params.asksOn)
    .filter((ask) => ask.talkOffAt === null)
    .map((ask) => ask.todoId);
  params.result.talkOffTodoIds.push(
    ...(await markAsksTalkOff({ wardId: params.wardId, todoIds: toMark, sundayLabel })),
  );

  const toTell = params.offTalks.filter(
    (talk) =>
      talk.requestOutcome === "accepted" && hasSpeaker(talk) && params.asksOn(talk).length === 0,
  );
  if (toTell.length === 0) return;

  const [asks, owners] = await Promise.all([
    buildAsksForTalks({
      wardId: params.wardId,
      sundayDate: params.sunday.date,
      talks: toTell,
      client: params.client,
    }),
    listLatestAskOwners({ wardId: params.wardId, assignmentIds: toTell.map((talk) => talk.id) }),
  ]);

  params.result.tellTodoIds.push(
    ...(await createTellTodos({
      wardId: params.wardId,
      tells: asks.map((ask) => ({
        assignmentId: ask.assignmentId,
        // A talk accepted from its own panel has no ask, so nobody asked it through To Do. The
        // person who made this calendar change is told instead: they are the one who knows.
        ownerUserId: owners.get(ask.assignmentId) ?? params.actingUserId,
        title: buildTellTitle(ask.speakerName),
        notes: ask.notes,
      })),
      assignedByUserId: params.actingUserId,
      today: params.today,
      sundayLabel,
    })),
  );
}

// Rule 2.
async function applyBackOn(params: {
  wardId: string;
  onTalks: readonly Assignment[];
  asksOn: (talk: Assignment) => OpenAsk[];
  result: ReconcileResult;
}): Promise<void> {
  const backOn = params.onTalks.filter((talk) =>
    params.asksOn(talk).some((ask) => ask.talkOffAt !== null),
  );

  for (const talk of backOn) {
    params.result.backOnTodoIds.push(
      ...(await closeAsksForAssignment({
        wardId: params.wardId,
        assignmentId: talk.id,
        reason: "talk_back_on",
        onlyTalkOff: true,
      })),
    );

    if (talk.requestOutcome !== null) {
      await writeRequestOutcome(
        params.wardId,
        talk.id,
        null,
        undefined,
        createServiceSupabaseClient(),
      );
      params.result.answersClearedAssignmentIds.push(talk.id);
    }
  }
}

// Rule 3.
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
              scheduledFor: openAsk.scheduledFor,
              scheduledWithMemberId: openAsk.scheduledWithMemberId,
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
