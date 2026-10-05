import type { SupabaseClient } from "@supabase/supabase-js";
import { formatSundayLabelWithYear } from "@/lib/calendar/dates";
import { getSunday } from "@/lib/calendar/queries";
import { emailCoordinators, topicsReadyEmail } from "@/lib/email/musicEmails";
import { listMusicCoordinatorIds } from "@/lib/music/musicCoordinators";
import { reopenMusicIfNeeded } from "@/lib/music/musicReview";
import { listSundayTopicTitles } from "@/lib/music/sundayTopics";
import { emitNotification } from "@/lib/notifications/emitNotification";
import { resolveSiteUrl } from "@/lib/program/queries";
import { createChooseTodos, hasChooseTodo, type MusicTodoContent } from "@/lib/todos/musicLinks";
import { wardDateOnly } from "@/lib/ward/wardDate";
import { readWardTimezone } from "@/lib/ward/wardTimezone";
import type { Database } from "@/types/database";
import { holdsSacramentMeeting } from "@/types/domain";

// FINALIZING TOPICS TELLS THE MUSIC COORDINATOR — ITER-038 slice mc (plan D1, D2).
//
// SERVER-ONLY.
//
// ---------------------------------------------------------------------------
// THIS REVERSES THE PROTOTYPE, AND THE CONDITION IT GAVE IS NOW MET
// ---------------------------------------------------------------------------
// The prototype refused to notify anybody when topics were finalized, because doing so "would still
// require assuming a group with the music-coordinator role exists" (build note
// §topics-finalized-readiness). WLT does not assume: it resolves the ward's real, active
// `music_coordinator` callings (lib/music/musicCoordinators.ts), gives each one "Choose the music",
// and says in words when there are none. That was the one thing the prototype could not do.
//
// ---------------------------------------------------------------------------
// FIRST HANDOUT, TOPICS CHANGED, OR NOTHING TO SAY
// ---------------------------------------------------------------------------
// Decided with the user at execute time, correcting the plan's "a completed choose to-do means the
// topics changed" — that misfired after an ordinary submit (submitting completes those to-dos) and
// missed a coordinator still mid-way (whose to-do is open):
//   - nobody was ever handed this Sunday            → "Choose the music for …"
//   - handed out before, and the stamp just MOVED   → the topics changed: a done to-do reopens as
//     (un-finalized, then finalized again)           "Topics changed — check the music for …", an
//                                                    open one gets a "topics changed" line, and
//                                                    everybody is told either way
//   - handed out before, and it was ALREADY final   → nothing; nobody is told twice
// `wasAlreadyFinalized` comes from the route, which read the Sunday before its write.
//
// THE TO-DO ALWAYS HAPPENS; the notification row and the email are told only to people whose to-do
// was created, reopened, or given the "topics changed" line — so a repeat tells nobody twice.
//
// NOTES CARRY TOPIC TITLES ONLY (lib/music/sundayTopics.ts's privacy boundary): the coordinator is
// never handed a speaker's name.

type Client = SupabaseClient<Database>;

export type MusicHandoff =
  | { status: "no_meeting" }
  | { status: "no_coordinator" }
  | { status: "already_told"; coordinatorCount: number }
  | {
      status: "told";
      coordinatorCount: number;
      topicsChanged: boolean;
      toldUserIds: string[];
      todoIds: string[];
      emailedCount: number;
      emailProblem: string | null;
    };

const CHOOSE_INSTRUCTION =
  "Choose the hymns, the chorister and the organist, then submit the music for review.";

export function topicsHandoffContent(
  sundayDate: string,
  topicTitles: readonly string[],
  topicsChanged: boolean,
): MusicTodoContent {
  const label = formatSundayLabelWithYear(sundayDate);
  const topics =
    topicTitles.length === 0 ? "No topics are listed." : `Topics: ${topicTitles.join("; ")}.`;
  return {
    title: topicsChanged
      ? `Topics changed — check the music for ${label}`
      : `Choose the music for ${label}`,
    notes: `${topics}\n\n${CHOOSE_INSTRUCTION}`,
  };
}

export async function handTopicsToMusic(params: {
  wardId: string;
  sundayId: string;
  actingUserId: string;
  wasAlreadyFinalized: boolean;
  client: Client;
}): Promise<MusicHandoff> {
  const { wardId, sundayId, client } = params;

  const sunday = await getSunday(wardId, sundayId, client);
  if (sunday === null || !holdsSacramentMeeting(sunday.type)) return { status: "no_meeting" };

  const coordinatorIds = await listMusicCoordinatorIds(wardId);
  if (coordinatorIds.length === 0) return { status: "no_coordinator" };

  const handedOutBefore = await hasChooseTodo({ wardId, sundayId });
  if (handedOutBefore && params.wasAlreadyFinalized) {
    return { status: "already_told", coordinatorCount: coordinatorIds.length };
  }
  const topicsChanged = handedOutBefore;

  const [topicsBySunday, timeZone] = await Promise.all([
    listSundayTopicTitles(wardId, [sunday], client),
    readWardTimezone(wardId, client),
  ]);
  const topicTitles = topicsBySunday.get(sunday.id) ?? [];

  const chosen = await createChooseTodos({
    wardId,
    sundayId,
    ownerUserIds: coordinatorIds,
    content: topicsHandoffContent(sunday.date, topicTitles, topicsChanged),
    assignedByUserId: params.actingUserId,
    today: wardDateOnly(new Date(), timeZone),
    line: topicsChanged ? { kind: "topics_changed", body: null } : undefined,
  });

  const todoIds = [
    ...chosen.createdIds,
    ...chosen.reopenedIds,
    ...(topicsChanged ? chosen.existingIds : []),
  ];
  const alreadyHeld = new Set(chosen.existingOwnerIds);
  const toldUserIds = topicsChanged
    ? coordinatorIds
    : coordinatorIds.filter((userId) => !alreadyHeld.has(userId));

  if (toldUserIds.length === 0) {
    return { status: "already_told", coordinatorCount: coordinatorIds.length };
  }

  const sundayLabel = formatSundayLabelWithYear(sunday.date);
  await emitNotification({
    wardId,
    triggerKey: "music_topics_ready",
    title: topicsChanged ? "Topics changed" : "Topics ready for music",
    body: topicsChanged
      ? `The topics for ${sundayLabel} changed. Check the music.`
      : `The topics for ${sundayLabel} are ready. Choose the music.`,
    recipientUserIds: toldUserIds,
  });

  const email = await emailCoordinators({
    wardId,
    userIds: toldUserIds,
    triggerKey: "music_topics_ready",
    ...topicsReadyEmail({
      sundayLabel,
      topicTitles,
      topicsChanged,
      siteUrl: resolveSiteUrl(),
      sundayId,
    }),
  });

  return {
    status: "told",
    coordinatorCount: coordinatorIds.length,
    topicsChanged,
    toldUserIds,
    todoIds,
    ...email,
  };
}

// The topics changed under music that was submitted or approved: back to draft with a "Topics
// changed" banner, picks kept, the conductor's open review closed. It tells NOBODY — telling
// happens when the topics are finalized again (plan D2), through handTopicsToMusic() above.
export async function reopenMusicForTopicChange(params: {
  wardId: string;
  sundayId: string;
}): Promise<{ reopened: boolean }> {
  const { reopened } = await reopenMusicIfNeeded({ ...params, reason: "topics_changed" });
  return { reopened };
}

// The one line the Finalize control shows after it saved. Null when there is nothing to say.
export function describeMusicHandoff(handoff: MusicHandoff): string | null {
  switch (handoff.status) {
    case "no_meeting":
    case "already_told":
      return null;
    case "no_coordinator":
      return "No music coordinator holds a calling in this ward, so nobody was told.";
    case "told": {
      const who =
        handoff.toldUserIds.length === 1
          ? "the music coordinator"
          : `${handoff.toldUserIds.length} music coordinators`;
      const emailed = handoff.emailedCount > 0 ? ` (emailed ${handoff.emailedCount})` : "";
      const told = handoff.topicsChanged
        ? `Told ${who} the topics changed${emailed}.`
        : `Told ${who}${emailed}.`;
      return handoff.emailProblem === null ? told : `${told} ${handoff.emailProblem}`;
    }
  }
}
