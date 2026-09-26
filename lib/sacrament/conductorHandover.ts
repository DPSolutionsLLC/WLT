import type { SupabaseClient } from "@supabase/supabase-js";
import { listAssignments } from "@/lib/assignments/queries";
import { getSunday, readConductorName, type Sunday } from "@/lib/calendar/queries";
import { buildAsksForTalks } from "@/lib/sacrament/sundayAsks";
import {
  AskLinkWriteError,
  handOverAsks,
  listOpenAsks,
  type OpenAsk,
} from "@/lib/todos/askLinks";
import { wardDateOnly } from "@/lib/ward/wardDate";
import { readWardTimezone } from "@/lib/ward/wardTimezone";
import type { Database } from "@/types/database";

// THE WORK FOLLOWS THE CONDUCTOR — Sacrament slice f2 (U3, U6). SERVER-ONLY.
//
// A RECONCILE, NOT A REACTION TO A CHANGE. For each Sunday given, every open ask held by somebody
// other than its CURRENT conductor moves to that conductor. It does not ask "did the conductor
// change?", because that question cannot be asked twice: once the new conductor is saved, a
// retry after a half-finished move would see no change and move nothing. Asked of the state
// instead, a repeat finishes whatever the last run left, and a run with nothing to do is one read.
//
// A Sunday with NO conductor keeps its asks where they are. The work is never orphaned: a type
// change to a non-meeting Sunday clears the conductor, and the asks stay with the previous owner.
//
// Every caller that writes `sundays.conducting_user_id` over a previous value must call this for
// the Sundays it changed. tests/lib/conductorHandoverSites.test.ts reads the source to hold them
// to it.
//
// `client` is the caller's OWN RLS-scoped client: the Sundays and talks are read through it, so
// the ids handed to the service-role writes in lib/todos/askLinks.ts are ones RLS admitted.

export type HandoverResult = {
  handedOverSundayIds: string[];
  createdIds: string[];
  closedIds: string[];
};

export async function reconcileSundayAsksToConductor(params: {
  wardId: string;
  sundayIds: readonly string[];
  actingUserId: string;
  client: SupabaseClient<Database>;
}): Promise<HandoverResult> {
  const { wardId, client } = params;
  const result: HandoverResult = { handedOverSundayIds: [], createdIds: [], closedIds: [] };

  const sundayIds = [...new Set(params.sundayIds)];
  if (sundayIds.length === 0) return result;

  // One read of the talks and one of the open asks, however many Sundays a re-shift touched.
  // Only the Sundays that turn out to hold a stray ask cost anything more.
  const talks = await listAssignments(wardId, { sundayIds }, client);
  const openAsks = await listOpenAsks({
    wardId,
    assignmentIds: talks.map((talk) => talk.id),
  });
  if (openAsks.length === 0) return result;

  const sundayIdByTalk = new Map(talks.map((talk) => [talk.id, talk.sundayId] as const));
  const sundays = await readSundays(
    wardId,
    openAsks.flatMap((ask) => {
      const sundayId = sundayIdByTalk.get(ask.assignmentId);
      return sundayId === null || sundayId === undefined ? [] : [sundayId];
    }),
    client,
  );

  const timeZone = await readWardTimezone(wardId, client);
  const today = wardDateOnly(new Date(), timeZone);

  for (const sunday of sundays) {
    const conductorId = sunday.conductingUserId;
    if (conductorId === null) continue;

    // f3 adds the assistant here: their copies are not stray either.
    const stray = openAsks.filter(
      (ask) =>
        sundayIdByTalk.get(ask.assignmentId) === sunday.id && ask.ownerUserId !== conductorId,
    );
    if (stray.length === 0) continue;

    try {
      await handOverSunday({
        wardId,
        sunday,
        conductorId,
        stray,
        talks: talks.filter((talk) => talk.sundayId === sunday.id),
        actingUserId: params.actingUserId,
        today,
        client,
        result,
      });
    } catch (error) {
      if (!(error instanceof AskLinkWriteError)) throw error;
      throw new AskLinkWriteError(error.cause, [
        ...result.createdIds,
        ...result.closedIds,
        ...error.completedIds,
      ]);
    }
  }

  return result;
}

async function handOverSunday(params: {
  wardId: string;
  sunday: Sunday;
  conductorId: string;
  stray: readonly OpenAsk[];
  talks: Awaited<ReturnType<typeof listAssignments>>;
  actingUserId: string;
  today: string;
  client: SupabaseClient<Database>;
  result: HandoverResult;
}): Promise<void> {
  const strayTalkIds = new Set(params.stray.map((ask) => ask.assignmentId));
  const [asks, conductorName] = await Promise.all([
    buildAsksForTalks({
      wardId: params.wardId,
      sundayDate: params.sunday.date,
      talks: params.talks.filter((talk) => strayTalkIds.has(talk.id)),
      client: params.client,
    }),
    readConductorName(params.wardId, params.conductorId, params.client),
  ]);
  const askByTalk = new Map(asks.map((ask) => [ask.assignmentId, ask] as const));

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
  sundayIds: readonly string[],
  client: SupabaseClient<Database>,
): Promise<Sunday[]> {
  const found = await Promise.all(
    [...new Set(sundayIds)].map((sundayId) => getSunday(wardId, sundayId, client)),
  );
  return found.filter((sunday): sunday is Sunday => sunday !== null);
}
