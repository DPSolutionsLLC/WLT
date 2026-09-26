import type { SupabaseClient } from "@supabase/supabase-js";
import { type Assignment, getAssignment, listAssignments } from "@/lib/assignments/queries";
import { readConductorName } from "@/lib/calendar/queries";
import { hasSpeaker, loadSpeakerNames } from "@/lib/sacrament/sundayAsks";
import { listLatestAskOwners, listOpenAsks } from "@/lib/todos/askLinks";
import type { Database } from "@/types/database";

// WHAT A CALENDAR CHANGE WILL DO TO TALK ASKS, IN WORDS — Sacrament slice f2b. SERVER-ONLY.
//
// PATCH /api/sundays/[id] appends these sentences to the calendar's own warning before the change
// is confirmed, so whoever applies it knows two things first:
//   - speakers who were ASKED (an open ask) or have ACCEPTED a talk this change switches off, and
//     who will get a to-do to tell them they are not needed (lib/sacrament/conductorHandover.ts,
//     rule 1), and
//   - open asks on later Sundays that move to a new conductor with the re-shift (rule 3).
// The calendar module reads no to-dos, so it hands over only ids (CalendarChangeWarning). The
// sentences must describe what the reconcile WILL do, so they use its rules: the same owners, the
// same fall-back to the person making the change.

export async function describeAskConsequences(params: {
  wardId: string;
  atRiskAssignmentIds: readonly string[];
  conductorReshifts: readonly { sundayId: string; toUserId: string | null }[];
  actingUserId: string;
  client: SupabaseClient<Database>;
}): Promise<string> {
  const sentences = [
    ...(await describeTalksGoingOff(params)),
    ...(await describeAsksMoving(params)),
  ];
  return sentences.join(" ");
}

async function describeTalksGoingOff(params: {
  wardId: string;
  atRiskAssignmentIds: readonly string[];
  actingUserId: string;
  client: SupabaseClient<Database>;
}): Promise<string[]> {
  if (params.atRiskAssignmentIds.length === 0) return [];

  const talks = (
    await Promise.all(
      [...new Set(params.atRiskAssignmentIds)].map((id) =>
        getAssignment(params.wardId, id, params.client),
      ),
    )
  )
    .filter((talk): talk is Assignment => talk !== null && hasSpeaker(talk))
    // In slot order, the way a bishopric reads a Sunday.
    .sort((left, right) => (left.slotNumber ?? Infinity) - (right.slotNumber ?? Infinity));
  if (talks.length === 0) return [];

  const openAsks = await listOpenAsks({
    wardId: params.wardId,
    assignmentIds: talks.map((talk) => talk.id),
  });
  const asked = talks.filter(
    (talk) =>
      talk.requestOutcome === "accepted" ||
      openAsks.some((ask) => ask.assignmentId === talk.id),
  );
  if (asked.length === 0) return [];

  const latestOwners = await listLatestAskOwners({
    wardId: params.wardId,
    assignmentIds: asked.map((talk) => talk.id),
  });
  const ownerIds = new Set<string>();
  for (const talk of asked) {
    const open = openAsks.filter((ask) => ask.assignmentId === talk.id);
    if (open.length > 0) {
      for (const ask of open) ownerIds.add(ask.ownerUserId);
    } else {
      ownerIds.add(latestOwners.get(talk.id) ?? params.actingUserId);
    }
  }

  const speakerNames = await loadSpeakerNames({
    wardId: params.wardId,
    talks: asked,
    client: params.client,
  });
  const ownerNames = await namePeople(params, [...ownerIds]);

  const speakers = joinNames(asked.map((talk) => speakerNames.get(talk.id) ?? "a speaker"));
  const have = asked.length === 1 ? "has" : "have";
  const willGet = ownerIds.size === 1 ? "will get a to-do" : "will each get a to-do";
  return [
    `${speakers} ${have} been asked to speak that day. ${capitalize(joinNames(ownerNames))} ${willGet} to let them know they're not needed.`,
  ];
}

async function describeAsksMoving(params: {
  wardId: string;
  conductorReshifts: readonly { sundayId: string; toUserId: string | null }[];
  actingUserId: string;
  client: SupabaseClient<Database>;
}): Promise<string[]> {
  // A Sunday moving to NOBODY keeps its asks where they are, so it moves nothing.
  const moves = params.conductorReshifts.filter(
    (move): move is { sundayId: string; toUserId: string } => move.toUserId !== null,
  );
  if (moves.length === 0) return [];

  const talks = await listAssignments(
    params.wardId,
    { sundayIds: moves.map((move) => move.sundayId) },
    params.client,
  );
  const openAsks = await listOpenAsks({
    wardId: params.wardId,
    assignmentIds: talks.map((talk) => talk.id),
  });

  const countByNewOwner = new Map<string, number>();
  for (const move of moves) {
    const talkIds = new Set(
      talks.filter((talk) => talk.sundayId === move.sundayId).map((talk) => talk.id),
    );
    const moving = openAsks.filter(
      (ask) =>
        talkIds.has(ask.assignmentId) && ask.ownerUserId !== move.toUserId && ask.talkOffAt === null,
    ).length;
    if (moving > 0) {
      countByNewOwner.set(move.toUserId, (countByNewOwner.get(move.toUserId) ?? 0) + moving);
    }
  }

  const names = await namePeople(params, [...countByNewOwner.keys()]);
  return [...countByNewOwner.values()].map((count, index) =>
    count === 1
      ? `1 open ask moves to ${names[index]}.`
      : `${count} open asks move to ${names[index]}.`,
  );
}

// The person making the change is "you"; everybody else by name. Capitalised only where it opens a
// sentence, so "Peter Nakamura and you" reads as English.
async function namePeople(
  params: { wardId: string; actingUserId: string; client: SupabaseClient<Database> },
  userIds: readonly string[],
): Promise<string[]> {
  return Promise.all(
    userIds.map(async (userId) =>
      userId === params.actingUserId
        ? "you"
        : ((await readConductorName(params.wardId, userId, params.client)) ?? "Someone"),
    ),
  );
}

// Only "you" is touched. A name is written the way its owner wrote it.
function capitalize(text: string): string {
  return text.startsWith("you") ? `Y${text.slice(1)}` : text;
}

function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}
