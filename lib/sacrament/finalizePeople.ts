import type { SupabaseClient } from "@supabase/supabase-js";
import type { Assignment } from "@/lib/assignments/queries";
import { speakerChanged } from "@/lib/assignments/requestOutcome";
import {
  getSunday,
  readConductorName,
  setPrayersFinalized,
  setSpeakersFinalized,
  type Sunday,
} from "@/lib/calendar/queries";
import {
  buildPrayerAskNotes,
  buildPrayerAskTitle,
  PRAYER_ASK_PURPOSE,
  PRAYERS_LOCK_REASON_TEXT,
  prayerNeedsAsk,
  prayersAskState,
  prayersSettled,
  type PrayerAskInput,
  type PrayersAskState,
  type PrayersAskStateInput,
} from "@/lib/prayers/prayerAsks";
import { listPrayers, type Prayer } from "@/lib/prayers/queries";
import { getMember } from "@/lib/roster/queries";
import {
  ASKED_TO_SPEAK,
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
  countOpenAsksByPrayer,
  createAsksForSunday,
  listOpenAsks,
  listOpenPrayerAsks,
  withdrawAsks,
  type PrayerAskToCreate,
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
      impacts.set(talk.id, {
        personName,
        askedTo: ASKED_TO_SPEAK,
        scheduledFor: null,
        holderName: null,
        accepted: true,
      });
      continue;
    }
    const asks = scheduled.filter((ask) => ask.assignmentId === talk.id);
    const ask = asks.find((each) => each.ownerUserId === params.viewerUserId) ?? asks[0];
    if (ask === undefined) continue;
    impacts.set(talk.id, {
      personName,
      askedTo: ASKED_TO_SPEAK,
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

// ===========================================================================
// PRAYERS — ITER-036 fb
// ===========================================================================
// The same act for a Sunday's two prayers: finalizing stamps `sundays.prayers_finalized_at` and
// puts one "Ask ___ to give the opening prayer" (or closing) per prayer not yet asked on the
// CONDUCTOR's To Do. Un-finalizing withdraws the asks that are only on To Do (D3).
//
// ⚠️ WHAT UN-FINALIZES THE PRAYERS, AND WHAT DOES NOT:
//
//   A person set, changed or cleared on a prayer (POST /api/prayers,     un-finalizes (D2), and the
//     or PATCH /api/prayers/[id] action "assign")                         old person's ask is withdrawn
//   The Un-finalize control                                               un-finalizes, withdraws all
//   A stage move on the board                                             DOES NOT
//   Accepted on the ask                                                   DOES NOT
//   Declined on the ask (it clears the person!)                           DOES NOT
//
// A decline clears the person through lib/prayers/prayerOutcome.ts, which must never call
// afterPrayerPersonChanged(); tests/lib/prayersFinalizeSites.test.ts reads the source to hold that.

export type SundayPrayerAsks = {
  sunday: Sunday;
  prayers: Prayer[];
  inputs: Map<string, PrayerAskInput>;
  stateInput: PrayersAskStateInput;
  state: PrayersAskState;
};

// Null when the Sunday is not the caller's to read. The open-ask COUNT is the service role's, so it
// does not depend on whose list the asks are on (countOpenAsksByPrayer).
export async function loadSundayPrayerAsks(
  wardId: string,
  sundayId: string,
  client: Client,
): Promise<SundayPrayerAsks | null> {
  const sunday = await getSunday(wardId, sundayId, client);
  if (sunday === null) return null;

  const prayers = await listPrayers(wardId, { sundayId }, client);
  const openCounts = await countOpenAsksByPrayer({
    wardId,
    prayerIds: prayers.map((prayer) => prayer.id),
  });

  const inputs = new Map<string, PrayerAskInput>(
    prayers.map((prayer) => [prayer.id, toPrayerAskInput(prayer, openCounts)]),
  );
  const stateInput: PrayersAskStateInput = {
    prayersFinalized: sunday.prayersFinalizedAt !== null,
    hasConductor: sunday.conductingUserId !== null,
    prayers: [...inputs.values()],
  };

  return { sunday, prayers, inputs, stateInput, state: prayersAskState(stateInput) };
}

export function toPrayerAskInput(
  prayer: Pick<Prayer, "id" | "memberId" | "stage">,
  openCounts: ReadonlyMap<string, number>,
): PrayerAskInput {
  return {
    hasMember: prayer.memberId !== null,
    stage: prayer.stage,
    openAskCount: openCounts.get(prayer.id) ?? 0,
  };
}

// The title and text of each prayer's ask, built from the prayer as it stands now — for finalize
// and for a handover, which gives the new conductor a CLEAN copy (f2, U6).
export async function buildPrayerAsks(params: {
  wardId: string;
  sundayDate: string;
  prayers: readonly Prayer[];
  client: Client;
}): Promise<PrayerAskToCreate[]> {
  const people = await loadPrayerPeople(params);
  return params.prayers.flatMap((prayer) => {
    const person = people.get(prayer.id);
    if (person === undefined) return [];
    return [
      {
        prayerId: prayer.id,
        title: buildPrayerAskTitle(person.name, prayer.prayerType),
        notes: buildPrayerAskNotes({
          personName: person.name,
          phone: person.phone,
          prayerType: prayer.prayerType,
          sundayDate: params.sundayDate,
        }),
      },
    ];
  });
}

// Each prayer's person, by prayer id. A prayer with nobody down, or whose member is no longer
// readable, is absent.
async function loadPrayerPeople(params: {
  wardId: string;
  prayers: readonly Prayer[];
  client: Client;
}): Promise<Map<string, { name: string; phone: string | null }>> {
  const memberIds = [
    ...new Set(
      params.prayers.flatMap((prayer) => (prayer.memberId === null ? [] : [prayer.memberId])),
    ),
  ];
  const members = await Promise.all(
    memberIds.map((memberId) => getMember(params.wardId, memberId, params.client)),
  );
  const byId = new Map(
    members.flatMap((member) => (member === null ? [] : [[member.id, member] as const])),
  );
  const people = new Map<string, { name: string; phone: string | null }>();
  for (const prayer of params.prayers) {
    const member = prayer.memberId === null ? undefined : byId.get(prayer.memberId);
    if (member === undefined) continue;
    people.set(prayer.id, {
      name: `${member.firstName} ${member.lastName}`.trim(),
      phone: member.phone,
    });
  }
  return people;
}

export type FinalizePrayersOutcome =
  | { ok: false; status: 400 | 404; error: string }
  | {
      ok: true;
      sunday: Sunday;
      conductorName: string | null;
      askedPrayerIds: string[];
      createdIds: string[];
      partialFailure: AskLinkWriteError | null;
    };

// STAMP FIRST, ASKS SECOND — finalizeSpeakers()'s reasoning exactly.
export async function finalizePrayers(params: {
  wardId: string;
  sundayId: string;
  actingUserId: string;
  client: Client;
}): Promise<FinalizePrayersOutcome> {
  const { wardId, sundayId, client } = params;

  const loaded = await loadSundayPrayerAsks(wardId, sundayId, client);
  if (loaded === null) return { ok: false, status: 404, error: NOT_IN_WARD };

  const { sunday, prayers, inputs } = loaded;
  if (!prayers.some((prayer) => prayer.memberId !== null)) {
    return { ok: false, status: 400, error: `${PRAYERS_LOCK_REASON_TEXT.no_prayer}.` };
  }
  const conductorId = sunday.conductingUserId;
  if (conductorId === null) return { ok: false, status: 400, error: NO_CONDUCTOR };

  const stamped = await setPrayersFinalized(wardId, sundayId, true, client);
  if (stamped === null) return { ok: false, status: 404, error: NOT_IN_WARD };

  const toAsk = prayers.filter((prayer) => {
    const input = inputs.get(prayer.id);
    return input !== undefined && prayerNeedsAsk(input);
  });

  const [asks, timeZone, conductorName] = await Promise.all([
    buildPrayerAsks({ wardId, sundayDate: sunday.date, prayers: toAsk, client }),
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
    console.error("finalizePrayers created only some of its asks", {
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
    askedPrayerIds: asks.map((ask) => ask.prayerId),
    createdIds,
    partialFailure,
  };
}

export async function unfinalizePrayers(params: {
  wardId: string;
  sundayId: string;
  client: Client;
}): Promise<UnfinalizeOutcome> {
  const { wardId, sundayId, client } = params;

  const loaded = await loadSundayPrayerAsks(wardId, sundayId, client);
  if (loaded === null) return { ok: false, status: 404, error: NOT_IN_WARD };

  const sunday = await setPrayersFinalized(wardId, sundayId, false, client);
  if (sunday === null) return { ok: false, status: 404, error: NOT_IN_WARD };

  const withdrawn = await withdrawAsks({
    wardId,
    prayerIds: loaded.prayers.map((prayer) => prayer.id),
    reason: "unfinalized",
  });

  return { ok: true, sunday, withdrawn };
}

// EACH SUNDAY'S PRAYER FINALIZE STATE, for a month of Sundays at once — the hub's Prayer pill and
// the Prayers board both read it, so the two cannot disagree. ONE service-role count for every
// prayer, never one per Sunday. `prayers` are the live prayers the page already read.
export type PrayerAsksSummary = { state: PrayersAskState; settled: boolean };

export async function loadPrayerAsksBySunday(params: {
  wardId: string;
  sundays: readonly Pick<Sunday, "id" | "prayersFinalizedAt" | "conductingUserId">[];
  prayers: readonly Prayer[];
}): Promise<Map<string, PrayerAsksSummary>> {
  const openCounts = await countOpenAsksByPrayer({
    wardId: params.wardId,
    prayerIds: params.prayers.map((prayer) => prayer.id),
  });
  return new Map(
    params.sundays.map((sunday) => {
      const input: PrayersAskStateInput = {
        prayersFinalized: sunday.prayersFinalizedAt !== null,
        hasConductor: sunday.conductingUserId !== null,
        prayers: params.prayers
          .filter((prayer) => prayer.sundayId === sunday.id)
          .map((prayer) => toPrayerAskInput(prayer, openCounts)),
      };
      return [sunday.id, { state: prayersAskState(input), settled: prayersSettled(input) }];
    }),
  );
}

// THE CHANGE-OF-PERSON TRIGGER (D2, D3) — both prayer routes call it after saving who prays.
// `before` is null for a prayer slot that did not exist yet. Nothing happens when the person did
// not change.
//
// The old person's ask is withdrawn first (deleted if untouched, closed if touched, unlinked and
// kept if scheduled) and THROWS AskLinkWriteError if it cannot be — the route reports that, because
// the change itself was saved. Clearing the stamp NEVER throws: unfinalizeSpeakersIfNeeded()'s
// contract, and a stamp left standing still reads "1 to ask" on the hub, so pressing it asks them.
export async function afterPrayerPersonChanged(params: {
  wardId: string;
  before: Prayer | null;
  after: Prayer;
  client: Client;
}): Promise<{ withdrawn: WithdrawnAsks | null; unfinalized: boolean }> {
  const { wardId, before, after } = params;
  if (before === null ? after.memberId === null : before.memberId === after.memberId) {
    return { withdrawn: null, unfinalized: false };
  }

  const withdrawn =
    before === null
      ? null
      : await withdrawAsks({ wardId, prayerIds: [after.id], reason: "speaker_changed" });

  if (after.sundayId === null) return { withdrawn, unfinalized: false };
  try {
    const sunday = await setPrayersFinalized(wardId, after.sundayId, false, params.client);
    return { withdrawn, unfinalized: sunday !== null };
  } catch (error) {
    console.error("Could not clear a Sunday's prayers-finalized stamp", {
      wardId,
      sundayId: after.sundayId,
      error,
    });
    return { withdrawn, unfinalized: false };
  }
}

// ---------------------------------------------------------------------------
// WHO A PRAYER CHANGE WOULD AFFECT (D4)
// ---------------------------------------------------------------------------
// A prayer whose person has CONFIRMED (stage `confirm` or `done`), or for whom somebody holds a
// SCHEDULED open ask. loadSpeakerImpacts()'s rules, for prayers.
export async function loadPrayerImpacts(params: {
  wardId: string;
  prayers: readonly Prayer[];
  viewerUserId: string;
  client: Client;
}): Promise<Map<string, AskImpact>> {
  const { wardId, client } = params;
  const impacts = new Map<string, AskImpact>();
  const withPerson = params.prayers.filter((prayer) => prayer.memberId !== null);
  if (withPerson.length === 0) return impacts;

  const [openAsks, people] = await Promise.all([
    listOpenPrayerAsks({ wardId, prayerIds: withPerson.map((prayer) => prayer.id) }),
    loadPrayerPeople({ wardId, prayers: withPerson, client }),
  ]);
  const scheduled = openAsks.filter((ask) => ask.scheduledFor !== null && ask.talkOffAt === null);

  const holderIds = [
    ...new Set(scheduled.map((ask) => ask.ownerUserId).filter((id) => id !== params.viewerUserId)),
  ];
  const holderNames = new Map(
    await Promise.all(
      holderIds.map(async (id) => [id, await readConductorName(wardId, id, client)] as const),
    ),
  );

  for (const prayer of withPerson) {
    const personName = people.get(prayer.id)?.name ?? "the person praying";
    const askedTo = `give ${prayer.prayerType === null ? "a prayer" : PRAYER_ASK_PURPOSE[prayer.prayerType]}`;
    if (prayer.stage === "confirm" || prayer.stage === "done") {
      impacts.set(prayer.id, {
        personName,
        askedTo,
        scheduledFor: null,
        holderName: null,
        accepted: true,
      });
      continue;
    }
    const asks = scheduled.filter((ask) => ask.prayerId === prayer.id);
    const ask = asks.find((each) => each.ownerUserId === params.viewerUserId) ?? asks[0];
    if (ask === undefined) continue;
    impacts.set(prayer.id, {
      personName,
      askedTo,
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

// Each affected prayer's change-of-person warning, keyed by prayer id, for the Prayers board's
// picker. Prayers nobody would be affected by are absent. Built here because the appointment time
// is formatted in the ward's zone (rule 12).
export async function loadPrayerChangeWarnings(params: {
  wardId: string;
  prayers: readonly Prayer[];
  viewerUserId: string;
  client: Client;
}): Promise<Record<string, string>> {
  const [impacts, timeZone] = await Promise.all([
    loadPrayerImpacts(params),
    readWardTimezone(params.wardId, params.client),
  ]);
  return Object.fromEntries(
    [...impacts].flatMap(([prayerId, impact]) => {
      const warning = describeAskImpact([impact], "speaker", timeZone);
      return warning === null ? [] : [[prayerId, warning] as const];
    }),
  );
}
