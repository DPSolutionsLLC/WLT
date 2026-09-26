import type { SupabaseClient } from "@supabase/supabase-js";
import { speakerFrom } from "@/lib/assignments/speaker";
import type { Assignment } from "@/lib/assignments/queries";
import { referencesDecisionOf, type Sunday } from "@/lib/calendar/queries";
import { loadSundayTalks } from "@/lib/references/queries";
import {
  talksAskState,
  type TalkAskInput,
  type TalksAskState,
  type TalksAskStateInput,
} from "@/lib/sacrament/talkAsks";
import { countOpenAsksByAssignment } from "@/lib/todos/askLinks";
import type { Database } from "@/types/database";

// One Sunday's talks with their ask state, for GET and POST /api/sundays/[id]/asks. SERVER-ONLY:
// it reads through the caller's client, plus the service-role COUNT of open asks in
// lib/todos/askLinks.ts. That count is read that way so it does not depend on whose list the asks
// are on.

export type SundayAsks = {
  sunday: Sunday;
  // Every talk on the Sunday, with or without a topic. An ask needs a speaker, not a topic.
  talks: Assignment[];
  inputs: Map<string, TalkAskInput>;
  stateInput: TalksAskStateInput;
  state: TalksAskState;
};

export function hasSpeaker(talk: Assignment): boolean {
  return speakerFrom(talk).kind !== "empty";
}

// Null when the Sunday is not the caller's to read — RLS's zero rows, which the route turns into
// a 404.
export async function loadSundayAsks(
  wardId: string,
  sundayId: string,
  client: SupabaseClient<Database>,
): Promise<SundayAsks | null> {
  const loaded = await loadSundayTalks(wardId, sundayId, client);
  if (loaded === null) return null;

  const talks = loaded.assignments;
  const openCounts = await countOpenAsksByAssignment({
    wardId,
    assignmentIds: talks.map((talk) => talk.id),
  });

  const inputs = new Map<string, TalkAskInput>(
    talks.map((talk) => [
      talk.id,
      {
        hasSpeaker: hasSpeaker(talk),
        requestOutcome: talk.requestOutcome,
        openAskCount: openCounts.get(talk.id) ?? 0,
      },
    ]),
  );

  const stateInput: TalksAskStateInput = {
    referencesDecided: referencesDecisionOf(loaded.sunday) !== null,
    hasConductor: loaded.sunday.conductingUserId !== null,
    talks: [...inputs.values()],
  };

  return {
    sunday: loaded.sunday,
    talks,
    inputs,
    stateInput,
    state: talksAskState(stateInput),
  };
}
