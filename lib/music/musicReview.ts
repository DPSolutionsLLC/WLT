import type { SupabaseClient } from "@supabase/supabase-js";
import { formatSundayLabelWithYear } from "@/lib/calendar/dates";
import { getSunday, readConductorName, type Sunday } from "@/lib/calendar/queries";
import { describeMissingMusic, musicCompletionFor } from "@/lib/music/musicCompletion";
import { listMusicCoordinatorIds } from "@/lib/music/musicCoordinators";
import { getMusicalNumber, listSelections } from "@/lib/music/queries";
import { getSundayMusic, mapSundayMusicRow, SUNDAY_MUSIC_COLUMNS } from "@/lib/music/sundayMusic";
import { emailCoordinators, sentBackEmail } from "@/lib/email/musicEmails";
import { emitNotification } from "@/lib/notifications/emitNotification";
import { resolveSiteUrl } from "@/lib/program/queries";
import { createServiceSupabaseClient } from "@/lib/supabase/service";
import {
  addLineToOpenMusicTodos,
  closeOpenMusicTodos,
  completeOpenMusicTodos,
  createChooseTodos,
  createReviewTodo,
  type MusicTodoContent,
} from "@/lib/todos/musicLinks";
import { wardDateOnly } from "@/lib/ward/wardDate";
import { readWardTimezone } from "@/lib/ward/wardTimezone";
import type { Database } from "@/types/database";
import { holdsSacramentMeeting, type MusicReturnedReason, type SundayMusic } from "@/types/domain";

// A SUNDAY'S MUSIC: SUBMIT, APPROVE, SEND BACK, REOPEN — ITER-038 slice mb.
//
// SERVER-ONLY. THIS FILE IS THE ONLY WRITER OF `sunday_music.status`. The table has a SELECT policy
// and no write policy at all (migration 089a), so a client cannot skip this file: every write below
// is the service role, after the caller's OWN client has read the Sunday, so every id written is one
// RLS already admitted. tests/lib/musicReopenSites.test.ts holds every music write route to calling
// reopenMusicIfNeeded(), and fails if anything outside lib/music/ writes the table.
//
// The machine:
//   draft ──submit──▶ submitted ──approve──▶ approved
//     ▲                  │
//     └──send back───────┘ (with the conductor's note)
//   submitted / approved ──any change to the music──▶ draft ("music_changed")
//
// NOBODY APPROVES THEIR OWN SUBMISSION (plan A3) — the prototype's own fix, generalized from the
// coordinator role to the PERSON, because the bishopric holds `music.manage` too. Refused with a
// sentence naming the alternative, never hidden.
//
// THE COMPLETION GATE IS lib/music/musicCompletion.ts, re-checked here on submit AND on approve: a
// hymn cancelled between the two would otherwise be approved as present.

type Client = SupabaseClient<Database>;

type Refusal = { ok: false; status: 400 | 403 | 404 | 409 | 422; error: string };

const NOT_IN_WARD = "That Sunday is not on your ward's calendar.";
const NO_MEETING = "That Sunday holds no sacrament meeting, so there is no music to submit.";
const TOPICS_NOT_FINALIZED =
  "The conductor hasn't finalized this Sunday's topics yet. Submit the music once they have.";
const NO_CONDUCTOR =
  "Nobody is conducting this Sunday yet. Ask the bishopric to choose who conducts first — the music goes to them for review.";
const ALREADY_APPROVED = "This music is already approved.";
const NOT_WAITING = "This music isn't waiting for approval.";
const OWN_SUBMISSION =
  "You submitted this music, so another member of the bishopric approves it.";

export function reviewTodoContent(sundayDate: string): MusicTodoContent {
  return {
    title: `Review the music for ${formatSundayLabelWithYear(sundayDate)}`,
    notes: "Open the music to approve it or send it back with a note.",
  };
}

export function chooseTodoContent(sundayDate: string): MusicTodoContent {
  return {
    title: `Choose the music for ${formatSundayLabelWithYear(sundayDate)}`,
    notes: "Choose the hymns, the chorister and the organist, then submit the music for review.",
  };
}

function fail(context: string, error: { message: string }, detail: Record<string, unknown>): never {
  console.error(`${context} — ${error.message}`, detail);
  throw new Error(`${context}: ${error.message}`);
}

async function loadMusic(wardId: string, sundayId: string, client: Client) {
  const [selections, musicalNumber, sundayMusic] = await Promise.all([
    listSelections(wardId, { sundayId }, client),
    getMusicalNumber(wardId, sundayId, client),
    getSundayMusic(wardId, sundayId, client),
  ]);
  return {
    sundayMusic,
    completion: musicCompletionFor({ selections, musicalNumber, sundayMusic }),
  };
}

async function loadSunday(wardId: string, sundayId: string, client: Client): Promise<Sunday | Refusal> {
  const sunday = await getSunday(wardId, sundayId, client);
  if (sunday === null) return { ok: false, status: 404, error: NOT_IN_WARD };
  if (!holdsSacramentMeeting(sunday.type)) return { ok: false, status: 422, error: NO_MEETING };
  return sunday;
}

function isRefusal(value: Sunday | Refusal): value is Refusal {
  return "ok" in value;
}

async function wardToday(wardId: string, client: Client): Promise<string> {
  return wardDateOnly(new Date(), await readWardTimezone(wardId, client));
}

// ---------------------------------------------------------------------------
// SUBMIT
// ---------------------------------------------------------------------------
// THE TO-DOS FIRST, THE STATUS LAST. If the to-dos land and the status write fails, the card still
// reads Draft with Submit on it, and pressing it again finishes the run: the review meets the
// partial index and the choose to-dos are already closed. The other order would leave a submitted
// Sunday with no review anywhere and no button to fix it.
//
// Pressing Submit on music that is already submitted repairs rather than refuses — the same steps
// are safe to repeat — and notifies nobody a second time.
//
// A RESUBMISSION AFTER A SEND-BACK REUSES THE CONDUCTOR'S OPEN REVIEW. Sending back leaves it open
// (see SEND BACK), so the review meets the partial index here and gains a "Music submitted for
// review" line instead, and the conductor is told again.
export type SubmitOutcome =
  | Refusal
  | {
      ok: true;
      sunday: Sunday;
      sundayMusic: SundayMusic;
      conductorName: string | null;
      reviewTodoId: string | null;
      completedChooseIds: string[];
      alreadySubmitted: boolean;
    };

export async function submitMusic(params: {
  wardId: string;
  sundayId: string;
  actingUserId: string;
  client: Client;
}): Promise<SubmitOutcome> {
  const { wardId, sundayId, client } = params;

  const sunday = await loadSunday(wardId, sundayId, client);
  if (isRefusal(sunday)) return sunday;
  if (sunday.topicsFinalizedAt === null) {
    return { ok: false, status: 400, error: TOPICS_NOT_FINALIZED };
  }
  const conductorId = sunday.conductingUserId;
  if (conductorId === null) return { ok: false, status: 400, error: NO_CONDUCTOR };

  const { sundayMusic, completion } = await loadMusic(wardId, sundayId, client);
  if (sundayMusic.status === "approved") return { ok: false, status: 409, error: ALREADY_APPROVED };
  if (!completion.complete) {
    return { ok: false, status: 400, error: describeMissingMusic(completion.missing) };
  }

  const alreadySubmitted = sundayMusic.status === "submitted";
  const [today, conductorName] = await Promise.all([
    wardToday(wardId, client),
    readConductorName(wardId, conductorId, client),
  ]);

  const completedChooseIds = await completeOpenMusicTodos({
    wardId,
    sundayId,
    role: "choose",
    kind: "music_submitted",
  });
  const review = await createReviewTodo({
    wardId,
    sundayId,
    ownerUserId: conductorId,
    content: reviewTodoContent(sunday.date),
    assignedByUserId: params.actingUserId,
    today,
  });

  const saved = alreadySubmitted
    ? sundayMusic
    : await writeStatus(wardId, sundayId, {
        status: "submitted",
        submitted_at: new Date().toISOString(),
        submitted_by: params.actingUserId,
        approved_at: null,
        returned_at: null,
        returned_reason: null,
        return_note: null,
      });

  const reopenedReviewIds =
    !review.created && !alreadySubmitted
      ? await addLineToOpenMusicTodos({
          wardId,
          sundayId,
          role: "review",
          kind: "music_submitted",
          body: null,
        })
      : [];

  if (review.created || reopenedReviewIds.length > 0) {
    await emitNotification({
      wardId,
      triggerKey: "music_submitted",
      title: "Music ready for review",
      body: `The music for ${formatSundayLabelWithYear(sunday.date)} is ready for you to approve.`,
      recipientUserIds: [conductorId],
    });
  }

  return {
    ok: true,
    sunday,
    sundayMusic: saved,
    conductorName,
    reviewTodoId: review.todoId,
    completedChooseIds,
    alreadySubmitted,
  };
}

// ---------------------------------------------------------------------------
// APPROVE
// ---------------------------------------------------------------------------
// The status first, conditional on it still being `submitted`, then the review to-dos. A repeat on
// approved music is a quiet success that closes any review left open, so a half-run is finished by
// pressing again.
export type ReviewOutcome =
  | Refusal
  | {
      ok: true;
      sunday: Sunday;
      sundayMusic: SundayMusic;
      todoIds: string[];
      // A send-back's email to the coordinator could not go (slice mc). Null otherwise.
      emailProblem: string | null;
    };

export async function approveMusic(params: {
  wardId: string;
  sundayId: string;
  actingUserId: string;
  client: Client;
}): Promise<ReviewOutcome> {
  const { wardId, sundayId, client } = params;

  const sunday = await loadSunday(wardId, sundayId, client);
  if (isRefusal(sunday)) return sunday;

  const { sundayMusic, completion } = await loadMusic(wardId, sundayId, client);
  if (sundayMusic.status !== "approved") {
    if (sundayMusic.status !== "submitted") return { ok: false, status: 409, error: NOT_WAITING };
    if (sundayMusic.submittedByUserId === params.actingUserId) {
      return { ok: false, status: 403, error: OWN_SUBMISSION };
    }
    if (!completion.complete) {
      return {
        ok: false,
        status: 409,
        error: `${describeMissingMusic(completion.missing)} Send it back so the music can be finished.`,
      };
    }
  }

  const saved =
    sundayMusic.status === "approved"
      ? sundayMusic
      : await writeStatusFrom(wardId, sundayId, "submitted", {
          status: "approved",
          approved_at: new Date().toISOString(),
        });
  if (saved === null) return { ok: false, status: 409, error: NOT_WAITING };

  const todoIds = await completeOpenMusicTodos({
    wardId,
    sundayId,
    role: "review",
    kind: "music_approved",
  });

  return { ok: true, sunday, sundayMusic: saved, todoIds, emailProblem: null };
}

// ---------------------------------------------------------------------------
// SEND BACK
// ---------------------------------------------------------------------------
// The status first: it carries the note, and the Music card shows it from there whatever happens to
// the to-dos. Whoever submitted gets their "Choose the music" back with the note on its timeline —
// every coordinator when the submitter's account is gone.
//
// THE CONDUCTOR'S REVIEW STAYS OPEN with the same "Sent back: <note>" line, so it shows they sent it
// back until the music is resubmitted (which reuses this to-do) or moves on another way — the user's
// decision walking scenario 087. It closed with "Marked complete" before, which said nothing.
export async function returnMusic(params: {
  wardId: string;
  sundayId: string;
  actingUserId: string;
  note: string;
  client: Client;
}): Promise<ReviewOutcome> {
  const { wardId, sundayId, client } = params;

  const sunday = await loadSunday(wardId, sundayId, client);
  if (isRefusal(sunday)) return sunday;

  const sundayMusic = await getSundayMusic(wardId, sundayId, client);
  if (sundayMusic.status !== "submitted") return { ok: false, status: 409, error: NOT_WAITING };
  if (sundayMusic.submittedByUserId === params.actingUserId) {
    return { ok: false, status: 403, error: OWN_SUBMISSION };
  }

  const saved = await writeStatusFrom(wardId, sundayId, "submitted", {
    status: "draft",
    approved_at: null,
    returned_at: new Date().toISOString(),
    returned_reason: "sent_back",
    return_note: params.note,
  });
  if (saved === null) return { ok: false, status: 409, error: NOT_WAITING };

  const notedReviewIds = await addLineToOpenMusicTodos({
    wardId,
    sundayId,
    role: "review",
    kind: "music_sent_back",
    body: params.note,
  });

  const owners =
    sundayMusic.submittedByUserId !== null
      ? [sundayMusic.submittedByUserId]
      : await listMusicCoordinatorIds(wardId);

  const chosen = await createChooseTodos({
    wardId,
    sundayId,
    ownerUserIds: owners,
    content: chooseTodoContent(sunday.date),
    assignedByUserId: params.actingUserId,
    today: await wardToday(wardId, client),
    line: { kind: "music_sent_back", body: params.note },
  });

  const sundayLabel = formatSundayLabelWithYear(sunday.date);
  let emailProblem: string | null = null;
  if (owners.length > 0) {
    await emitNotification({
      wardId,
      triggerKey: "music_sent_back",
      title: "Music sent back",
      body: `The conductor sent back the music for ${sundayLabel}.`,
      recipientUserIds: owners,
    });
    // Slice mc: anybody who switched email on hears it there too. Never throws.
    ({ emailProblem } = await emailCoordinators({
      wardId,
      userIds: owners,
      triggerKey: "music_sent_back",
      ...sentBackEmail({ sundayLabel, note: params.note, siteUrl: resolveSiteUrl(), sundayId }),
    }));
  }

  return {
    ok: true,
    sunday,
    sundayMusic: saved,
    todoIds: [...notedReviewIds, ...chosen.createdIds, ...chosen.reopenedIds, ...chosen.existingIds],
    emailProblem,
  };
}

// ---------------------------------------------------------------------------
// REOPEN — the music (or, in slice mc, the topics) changed after it was submitted
// ---------------------------------------------------------------------------
// One read in the ordinary case: a Sunday whose music is a draft is left exactly as it is —
// including a draft that was SENT BACK, whose note must survive the coordinator's next edit.
// Otherwise it goes back to draft with the reason, and the conductor's open review closes as no
// longer needed. Asked of the state, so it is safe to call after every write.
export async function reopenMusicIfNeeded(params: {
  wardId: string;
  sundayId: string;
  reason: Extract<MusicReturnedReason, "music_changed" | "topics_changed">;
}): Promise<{ reopened: boolean; closedTodoIds: string[] }> {
  const { wardId, sundayId } = params;
  const service = createServiceSupabaseClient();

  const { data, error } = await service
    .from("sunday_music")
    .select("status")
    .eq("ward_id", wardId)
    .eq("sunday_id", sundayId)
    .maybeSingle();
  if (error) fail("Could not read whether the music was submitted", error, { wardId, sundayId });

  if (data === null || data.status === "draft") return { reopened: false, closedTodoIds: [] };

  const { data: updated, error: updateError } = await service
    .from("sunday_music")
    .update({
      status: "draft",
      approved_at: null,
      returned_at: new Date().toISOString(),
      returned_reason: params.reason,
      return_note: null,
      updated_at: new Date().toISOString(),
    })
    .eq("ward_id", wardId)
    .eq("sunday_id", sundayId)
    .in("status", ["submitted", "approved"])
    .select("sunday_id");
  if (updateError) fail("Could not return the music to draft", updateError, { wardId, sundayId });

  const closedTodoIds = await closeOpenMusicTodos({
    wardId,
    sundayId,
    role: "review",
    closedReason: "music_reopened",
  });

  return { reopened: (updated ?? []).length > 0, closedTodoIds };
}

// What every music WRITE route calls after its write succeeded (tests/lib/musicReopenSites.test.ts).
// The write already happened, so a failure here must not turn a saved hymn into a 500: it is
// logged and returned as a sentence the route puts beside its success (rule 7 — said, not
// swallowed).
export type ReopenAfterWrite = { reopened: boolean; reopenProblem: string | null };

const REOPEN_PROBLEM =
  "Saved — but this Sunday's music was submitted, and it could not be returned to draft. Reload the page and check it.";

export async function reopenMusicAfterWrite(params: {
  wardId: string;
  sundayId: string;
}): Promise<ReopenAfterWrite> {
  try {
    const { reopened } = await reopenMusicIfNeeded({ ...params, reason: "music_changed" });
    return { reopened, reopenProblem: null };
  } catch (error) {
    console.error("A music change was saved but the submission could not be reopened", {
      ...params,
      error: error instanceof Error ? error.message : String(error),
    });
    return { reopened: false, reopenProblem: REOPEN_PROBLEM };
  }
}

// ---------------------------------------------------------------------------
// THE MEETING IS GONE — called by the save-time reconcile (lib/sacrament/conductorHandover.ts)
// ---------------------------------------------------------------------------
// The submission no longer means anything, so it returns to a plain draft with no reason; the
// chorister and organist are kept, because a Sunday that holds its meeting again needs them just
// the same. Every open music to-do closes as `meeting_cancelled`. Asked of the state: a repeat
// finds nothing open and a draft, and writes nothing.
export async function resetMusicForLostMeeting(params: {
  wardId: string;
  sundayId: string;
}): Promise<{ closedTodoIds: string[] }> {
  const { wardId, sundayId } = params;
  const service = createServiceSupabaseClient();

  const { error } = await service
    .from("sunday_music")
    .update({
      status: "draft",
      submitted_at: null,
      submitted_by: null,
      approved_at: null,
      returned_at: null,
      returned_reason: null,
      return_note: null,
      updated_at: new Date().toISOString(),
    })
    .eq("ward_id", wardId)
    .eq("sunday_id", sundayId)
    .or("status.neq.draft,returned_at.not.is.null");
  if (error) fail("Could not reset the music for a Sunday with no meeting", error, { wardId, sundayId });

  const closedTodoIds = await closeOpenMusicTodos({
    wardId,
    sundayId,
    closedReason: "meeting_cancelled",
  });
  return { closedTodoIds };
}

// ---------------------------------------------------------------------------
// THE STATUS WRITES
// ---------------------------------------------------------------------------
type StatusColumns = Database["public"]["Tables"]["sunday_music"]["Update"];

// Upsert on (ward_id, sunday_id): a Sunday with no row yet takes this write as its first. Touches
// only the status columns — the people columns are lib/music/sundayMusic.ts's.
async function writeStatus(wardId: string, sundayId: string, columns: StatusColumns): Promise<SundayMusic> {
  const { data, error } = await createServiceSupabaseClient()
    .from("sunday_music")
    .upsert(
      { ward_id: wardId, sunday_id: sundayId, ...columns, updated_at: new Date().toISOString() },
      { onConflict: "ward_id,sunday_id" },
    )
    .select(SUNDAY_MUSIC_COLUMNS)
    .single();
  if (error) fail("Could not save the music's status", error, { wardId, sundayId });
  return mapSundayMusicRow(data);
}

// Conditional on the status still being `from`. Null when it was not — somebody else moved it first.
async function writeStatusFrom(
  wardId: string,
  sundayId: string,
  from: SundayMusic["status"],
  columns: StatusColumns,
): Promise<SundayMusic | null> {
  const { data, error } = await createServiceSupabaseClient()
    .from("sunday_music")
    .update({ ...columns, updated_at: new Date().toISOString() })
    .eq("ward_id", wardId)
    .eq("sunday_id", sundayId)
    .eq("status", from)
    .select(SUNDAY_MUSIC_COLUMNS)
    .maybeSingle();
  if (error) fail("Could not save the music's status", error, { wardId, sundayId });
  return data === null ? null : mapSundayMusicRow(data);
}
