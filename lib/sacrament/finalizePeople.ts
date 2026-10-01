import type { SupabaseClient } from "@supabase/supabase-js";
import type { Assignment } from "@/lib/assignments/queries";
import { speakerChanged } from "@/lib/assignments/requestOutcome";
import { readConductorName, setSpeakersFinalized, type Sunday } from "@/lib/calendar/queries";
import {
  describeAskImpact,
  type AskImpact,
  type TalkChangeWarnings,
} from "@/lib/sacrament/askImpact";
import {
  buildAsksForTalks,
  hasSpeaker,
  loadSpeakerNames,
  loadSundayAsks,
} from "@/lib/sacrament/sundayAsks";
import { talkNeedsAsk, TALKS_LOCK_REASON_TEXT } from "@/lib/sacrament/talkAsks";
import {
  AskLinkWriteError,
  createAsksForSunday,
  listOpenAsks,
  withdrawAsks,
  type WithdrawnAsks,
} from "@/lib/todos/askLinks";
import { wardDateOnly } from "@/lib/ward/wardDate";
import { readWardTimezone } from "@/lib/ward/wardTimezone";
import type { Database } from "@/types/database";

// FINALIZING A SUNDAY'S PEOPLE IS WHAT ASKS THEM — ITER-036 (plans/sacrament-finalize-hands-off-asks.md).
// SERVER-ONLY.
//
// Finalizing means "I've prayed about it and decided", separately per kind (D1). Finalizing the
// SPEAKERS stamps `sundays.speakers_finalized_at` and puts one "Ask ___ to speak" to-do per chosen
// speaker not yet asked on the CONDUCTOR's list (D6). It replaces "Send asks", whose body moved here.
// References no longer gate it (D5): the ask card reads the talk's references live.
//
// STAMP FIRST, ASKS SECOND. supabase-js has no transaction, so a run can stop half-way. With the
// stamp written first, a half-run reads "finalized, N still to ask" and pressing again finishes it:
// the stamp is idempotent (setSpeakersFinalized) and so is every ask (migration 083b).
//
// ---------------------------------------------------------------------------
// ⚠️ WHAT UN-FINALIZES, AND WHAT DOES NOT — the topics-finalize rule, applied to speakers
// ---------------------------------------------------------------------------
// The rule is about WHAT changed, never WHO MOVED (plans/retros/sacrament-topics-finalize-and-history.md):
//
//   A speaker set, changed or cleared on a talk          un-finalizes (D2)
//   A new talk created with a speaker                    un-finalizes
//   The Un-finalize control                              un-finalizes, and withdraws every ask (D3)
//   A pipeline transition                                DOES NOT
//   A speaker accepting                                  DOES NOT
//   A speaker DECLINING (it clears the speaker!)          DOES NOT
//   A topic, a slot or any contact field                 DOES NOT
//
// A decline clears the speaker through recordRequestOutcome() and the pipeline's decline branch.
// Neither may call unfinalizeSpeakersIfNeeded(), or every decline would quietly reopen the Sunday;
// tests/lib/speakersFinalizeSites.test.ts reads the source to hold them to it.
//
// A SPEAKER CHANGE clears the stamp and withdraws only the OLD person's ask — the other speakers'
// asks stay where they are, and re-finalizing asks only the new person (D2). The Un-finalize
// control withdraws every ask on the Sunday that is only on To Do (D3); a scheduled one stays (D4).

type Client = SupabaseClient<Database>;

export const NO_CONDUCTOR =
  "Nobody is conducting this Sunday yet. Choose who conducts first — the asks go to them.";
const NOT_IN_WARD = "That Sunday is not on your ward's calendar.";

export type FinalizeOutcome =
  | { ok: false; status: 400 | 404; error: string }
  | {
      ok: true;
      sunday: Sunday;
      conductorName: string | null;
      askedAssignmentIds: string[];
      createdIds: string[];
      // Set when the stamp landed and only some asks did. Pressing again finishes the run.
      partialFailure: AskLinkWriteError | null;
    };

export async function finalizeSpeakers(params: {
  wardId: string;
  sundayId: string;
  actingUserId: string;
  client: Client;
}): Promise<FinalizeOutcome> {
  const { wardId, sundayId, client } = params;

  const loaded = await loadSundayAsks(wardId, sundayId, client);
  if (loaded === null) return { ok: false, status: 404, error: NOT_IN_WARD };

  const { sunday, talks, inputs } = loaded;
  if (!talks.some(hasSpeaker)) {
    return { ok: false, status: 400, error: `${TALKS_LOCK_REASON_TEXT.no_speaker}.` };
  }
  const conductorId = sunday.conductingUserId;
  if (conductorId === null) return { ok: false, status: 400, error: NO_CONDUCTOR };

  const stamped = await setSpeakersFinalized(wardId, sundayId, true, client);
  if (stamped === null) return { ok: false, status: 404, error: NOT_IN_WARD };

  const toAsk = talks.filter((talk) => {
    const input = inputs.get(talk.id);
    return input !== undefined && talkNeedsAsk(input);
  });

  const [asks, timeZone, conductorName] = await Promise.all([
    buildAsksForTalks({ wardId, sundayDate: sunday.date, talks: toAsk, client }),
    readWardTimezone(wardId, client),
    readConductorName(wardId, conductorId, client),
  ]);

  let createdIds: string[] = [];
  let partialFailure: AskLinkWriteError | null = null;
  try {
    createdIds = await createAsksForSunday({
      wardId,
      sundayId,
      ownerUserIds: [conductorId],
      asks,
      assignedByUserId: params.actingUserId,
      today: wardDateOnly(new Date(), timeZone),
    });
  } catch (error) {
    if (!(error instanceof AskLinkWriteError)) throw error;
    console.error("finalizeSpeakers created only some of its asks", {
      wardId,
      sundayId,
      cause: error.cause,
    });
    partialFailure = error;
    createdIds = [...error.completedIds];
  }

  return {
    ok: true,
    sunday: stamped,
    conductorName,
    askedAssignmentIds: asks.map((ask) => ask.assignmentId),
    createdIds,
    partialFailure,
  };
}

export type UnfinalizeOutcome =
  | { ok: false; status: 404; error: string }
  | { ok: true; sunday: Sunday; withdrawn: WithdrawnAsks };

// The Un-finalize control. Stamp cleared first, then every ask on the Sunday's talks withdrawn
// (D3). The withdraw runs whether or not the stamp moved, so a half-run is finished by pressing
// again rather than leaving asks out over a Sunday that reads "not finalized".
export async function unfinalizeSpeakers(params: {
  wardId: string;
  sundayId: string;
  client: Client;
}): Promise<UnfinalizeOutcome> {
  const { wardId, sundayId, client } = params;

  const loaded = await loadSundayAsks(wardId, sundayId, client);
  if (loaded === null) return { ok: false, status: 404, error: NOT_IN_WARD };

  const sunday = await setSpeakersFinalized(wardId, sundayId, false, client);
  if (sunday === null) return { ok: false, status: 404, error: NOT_IN_WARD };

  const withdrawn = await withdrawAsks({
    wardId,
    assignmentIds: loaded.talks.map((talk) => talk.id),
    reason: "unfinalized",
  });

  return { ok: true, sunday, withdrawn };
}

// Was a speaker set, changed or cleared? `before` is null for a talk that did not exist yet.
export function speakerSetOrChanged(before: Assignment | null, after: Assignment): boolean {
  return before === null ? hasSpeaker(after) : speakerChanged(before, after);
}

// The speaker-change trigger (D2). Clears the stamp only — the route withdraws the old person's ask
// itself, finalized or not, because that ask names somebody who is no longer the speaker.
//
// NEVER THROWS: unfinalizeTopicsIfNeeded()'s contract. The speaker genuinely was changed, and
// refusing that because a flag could not be cleared would be the tail wagging the dog. A stamp left
// standing still shows "1 to ask" on the hub, because the new speaker has no ask, and pressing it
// asks them.
export async function unfinalizeSpeakersIfNeeded(params: {
  wardId: string;
  before: Assignment | null;
  after: Assignment;
  client: Client;
}): Promise<boolean> {
  const { wardId, after } = params;
  if (after.sundayId === null || !speakerSetOrChanged(params.before, after)) return false;

  try {
    const sunday = await setSpeakersFinalized(wardId, after.sundayId, false, params.client);
    return sunday !== null;
  } catch (error) {
    console.error("Could not clear a Sunday's speakers-finalized stamp", {
      wardId,
      sundayId: after.sundayId,
      error,
    });
    return false;
  }
}

// ---------------------------------------------------------------------------
// WHO A CHANGE WOULD AFFECT (D4)
// ---------------------------------------------------------------------------
// Each talk's AskImpact: its speaker has ACCEPTED, or somebody holds a SCHEDULED open ask for them.
// Null for every other talk. `viewerUserId` decides "You have…" against "Peter Nakamura has…" —
// another leader's appointment is theirs (f3a). Talks are read through the caller's client; the
// open asks through the service role (listOpenAsks), because they sit on the conductor's list.
export async function loadSpeakerImpacts(params: {
  wardId: string;
  talks: readonly Assignment[];
  viewerUserId: string;
  client: Client;
}): Promise<Map<string, AskImpact>> {
  const { wardId, talks, client } = params;
  const impacts = new Map<string, AskImpact>();
  const withSpeaker = talks.filter(hasSpeaker);
  if (withSpeaker.length === 0) return impacts;

  const [openAsks, names] = await Promise.all([
    listOpenAsks({ wardId, assignmentIds: withSpeaker.map((talk) => talk.id) }),
    loadSpeakerNames({ wardId, talks: withSpeaker, client }),
  ]);
  const scheduled = openAsks.filter((ask) => ask.scheduledFor !== null && ask.talkOffAt === null);

  const holderIds = [
    ...new Set(
      scheduled.map((ask) => ask.ownerUserId).filter((id) => id !== params.viewerUserId),
    ),
  ];
  const holderNames = new Map(
    await Promise.all(
      holderIds.map(async (id) => [id, await readConductorName(wardId, id, client)] as const),
    ),
  );

  for (const talk of withSpeaker) {
    const personName = names.get(talk.id) ?? "a speaker";
    if (talk.requestOutcome === "accepted") {
      impacts.set(talk.id, { personName, scheduledFor: null, holderName: null, accepted: true });
      continue;
    }
    const asks = scheduled.filter((ask) => ask.assignmentId === talk.id);
    const ask = asks.find((each) => each.ownerUserId === params.viewerUserId) ?? asks[0];
    if (ask === undefined) continue;
    impacts.set(talk.id, {
      personName,
      scheduledFor: ask.scheduledFor,
      holderName:
        ask.ownerUserId === params.viewerUserId
          ? null
          : (holderNames.get(ask.ownerUserId) ?? "Another leader"),
      accepted: false,
    });
  }

  return impacts;
}

// Each affected talk's D4 warnings, keyed by talk id. Talks nobody would be affected by are absent.
export async function loadChangeWarnings(params: {
  wardId: string;
  talks: readonly Assignment[];
  viewerUserId: string;
  client: Client;
}): Promise<Record<string, TalkChangeWarnings>> {
  const [impacts, timeZone] = await Promise.all([
    loadSpeakerImpacts(params),
    readWardTimezone(params.wardId, params.client),
  ]);
  return Object.fromEntries(
    [...impacts].map(([assignmentId, impact]) => [
      assignmentId,
      {
        speaker: describeAskImpact([impact], "speaker", timeZone),
        topic: describeAskImpact([impact], "topic", timeZone),
      },
    ]),
  );
}
