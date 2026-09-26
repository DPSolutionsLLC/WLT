import type { SupabaseClient } from "@supabase/supabase-js";
import { speakerDisplayName } from "@/components/assignments/SpeakerLine";
import { speakerFrom } from "@/lib/assignments/speaker";
import type { Assignment } from "@/lib/assignments/queries";
import { referencesDecisionOf, type Sunday } from "@/lib/calendar/queries";
import { listReferencesForAssignments, loadSundayTalks } from "@/lib/references/queries";
import { getMember } from "@/lib/roster/queries";
import {
  buildAskNotes,
  buildAskTitle,
  talkIsOff,
  talksAskState,
  type TalkAskInput,
  type TalksAskState,
  type TalksAskStateInput,
} from "@/lib/sacrament/talkAsks";
import { countOpenAsksByAssignment, type AskToCreate } from "@/lib/todos/askLinks";
import { getTopic } from "@/lib/topics/queries";
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
        isOff: talkIsOff({
          sundayType: loaded.sunday.type,
          speakingSlots: loaded.sunday.speakingSlots,
          slotNumber: talk.slotNumber,
        }),
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

// The title and text of each talk's ask, built from the talk as it stands now. Send asks uses it,
// and so does a handover (Sacrament slice f2): the new conductor gets a CLEAN copy built here,
// never the old owner's to-do copied, because whatever the old owner wrote on theirs stays with
// them (U6).
// `speakerName` rides along for a caller that words something else about the same speaker (f2b's
// "Let ___ know there's no talk"), so nobody parses it back out of a title that may be truncated.
export type BuiltAsk = AskToCreate & { speakerName: string };

export async function buildAsksForTalks(params: {
  wardId: string;
  sundayDate: string;
  talks: readonly Assignment[];
  client: SupabaseClient<Database>;
}): Promise<BuiltAsk[]> {
  const { wardId, talks, client } = params;
  if (talks.length === 0) return [];

  const memberIds = [
    ...new Set(talks.flatMap((talk) => (talk.memberId === null ? [] : [talk.memberId]))),
  ];
  const topicIds = [
    ...new Set(talks.flatMap((talk) => (talk.topicId === null ? [] : [talk.topicId]))),
  ];

  const [members, topics, references] = await Promise.all([
    Promise.all(memberIds.map((memberId) => getMember(wardId, memberId, client))),
    Promise.all(topicIds.map((topicId) => getTopic(wardId, topicId, client))),
    listReferencesForAssignments(
      wardId,
      talks.map((talk) => talk.id),
      client,
    ),
  ]);

  const membersById = new Map(
    members.flatMap((member) => (member === null ? [] : [[member.id, member] as const])),
  );
  const memberNames = Object.fromEntries(
    [...membersById.values()].map(
      (member) => [member.id, `${member.firstName} ${member.lastName}`.trim()] as const,
    ),
  );
  const topicTitles = new Map(
    topics.flatMap((topic) => (topic === null ? [] : [[topic.id, topic.title] as const])),
  );

  return talks.map((talk) => {
    const speakerName = speakerDisplayName(talk, memberNames) ?? "a speaker";
    const member = talk.memberId === null ? undefined : membersById.get(talk.memberId);
    return {
      assignmentId: talk.id,
      speakerName,
      title: buildAskTitle(speakerName),
      notes: buildAskNotes({
        speakerName,
        onRoster: talk.memberId !== null,
        phone: member?.phone ?? null,
        topicTitle: talk.topicId === null ? null : (topicTitles.get(talk.topicId) ?? null),
        sundayDate: params.sundayDate,
        references: references
          .filter((reference) => reference.assignmentId === talk.id)
          .map((reference) => reference.citation),
      }),
    };
  });
}

// Each talk's speaker as a name, for sentences about them (f2b's calendar warning). Only the
// members are read — none of what an ask's notes need.
export async function loadSpeakerNames(params: {
  wardId: string;
  talks: readonly Assignment[];
  client: SupabaseClient<Database>;
}): Promise<Map<string, string>> {
  const memberIds = [
    ...new Set(params.talks.flatMap((talk) => (talk.memberId === null ? [] : [talk.memberId]))),
  ];
  const members = await Promise.all(
    memberIds.map((memberId) => getMember(params.wardId, memberId, params.client)),
  );
  const memberNames = Object.fromEntries(
    members.flatMap((member) =>
      member === null ? [] : [[member.id, `${member.firstName} ${member.lastName}`.trim()] as const],
    ),
  );
  return new Map(
    params.talks.map(
      (talk) => [talk.id, speakerDisplayName(talk, memberNames) ?? "a speaker"] as const,
    ),
  );
}
