import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildImportPreview,
  type BuildImportPreviewInput,
  type IcsImportPreview,
  type PreviewEvent,
} from "@/lib/youth/ics/buildImportPreview";
import type { IcsProblem } from "@/lib/youth/ics/occurrence";
import {
  createIcsCalendar,
  insertImportedEvents,
  touchCalendarSyncedAt,
  updateImportedEvent,
  type ActivityCalendar,
  type ImportedEventInsert,
} from "@/lib/youth/queries";
import type { Database } from "@/types/database";

// THE ONLY MODULE IN lib/youth/ics/ THAT WRITES ANYTHING.
//
// ---------------------------------------------------------------------------
// WHAT IT NEVER DOES, AND WHY THE ABSENCE IS THE FEATURE
// ---------------------------------------------------------------------------
// NO DELETES, EVER, and NO WRITE TO `status` OR `event_type` ON ANY EXISTING ROW.
//
// An event in the app but absent from a re-imported file is LEFT ALONE. A school feed that
// briefly publishes a short file must not be able to cancel a season, and a re-import must never
// destroy something a leader typed, corrected, or cancelled by hand. The preview names those
// events so the guarantee is visible; this module simply does not touch them.
//
// Decision 6 in full, for a row that DID match:
//   title, location, event_date, all_day   updated — the school moved the game, which is the
//                                          whole reason to re-import
//   status                                 never — a hand-cancelled game stays cancelled
//   event_type (home/away)                 never — slice C lets a person fix a misclassification,
//                                          and overwriting would undo it on every re-import
//   profile_id, calendar_id                never — an event that moved between activities is a
//                                          different event (lib/validation/youth.ts says so too)
//
// ---------------------------------------------------------------------------
// THERE IS NO TRANSACTION HERE, AND THAT IS NOT AN OVERSIGHT
// ---------------------------------------------------------------------------
// The roster import has `apply_roster_import` (migration 022) because it spanned households,
// members, notes and org membership, where a partial write leaves the roster in a state nobody
// asked for. An ICS import writes to ONE table plus one calendar row. If a batch insert fails
// partway, migration 055's unique index means a re-run creates only what is still missing —
// which is exactly what "idempotent" is for. A stored procedure here would buy nothing and would
// put the diff in a second language.

export type IcsImportResult = {
  calendarId: string;
  created: number;
  updated: number;
  unchanged: number;
  // A COUNT AND THE NAMES. The count on its own reads as a warning about something that happened;
  // the names are what let a leader see that the four games listed are last season's.
  notInFile: PreviewEvent[];
  problems: IcsProblem[];
  occurrencesDropped: number;
  lastSyncedAt: string;
};

export type ApplyImportInput = Omit<
  BuildImportPreviewInput,
  "calendarExists" | "lastSyncedAt"
> & {
  wardId: string;
  profileId: string;
  calendar: ActivityCalendar | null;
  // The clock enters as a parameter, like everywhere else in this slice, so a test can pin what
  // `last_synced_at` becomes.
  syncedAt: Date;
};

// Create-or-reuse, per Decision 5: one ICS calendar per profile. Reusing is what makes a
// re-import mean "the same feed again" rather than "a second feed that happens to look alike".
async function resolveCalendar(
  input: ApplyImportInput,
  client: SupabaseClient<Database>,
): Promise<ActivityCalendar> {
  if (input.calendar !== null) return input.calendar;

  return createIcsCalendar(
    input.wardId,
    input.profileId,
    input.syncedAt.toISOString(),
    client,
  );
}

function toInsert(
  event: PreviewEvent,
  profileId: string,
  calendarId: string,
): ImportedEventInsert {
  return {
    profileId,
    calendarId,
    title: event.title,
    eventDate: event.eventDate,
    location: event.location,
    allDay: event.allDay,
    sourceUid: event.uid,
    sourceRecurrenceId: event.recurrenceId,
  };
}

export async function applyIcsImport(
  input: ApplyImportInput,
  client: SupabaseClient<Database>,
): Promise<{ result: IcsImportResult; preview: IcsImportPreview }> {
  const calendar = await resolveCalendar(input, client);

  // The SAME diff the preview screen rendered, recomputed here from the re-uploaded file rather
  // than accepted back from the client. Two implementations of "what will change" is how a
  // preview and a confirm start to disagree, which is the failure the whole two-step flow exists
  // to prevent.
  const preview = buildImportPreview({
    occurrences: input.occurrences,
    problems: input.problems,
    occurrencesDropped: input.occurrencesDropped,
    existingEvents: input.existingEvents,
    wardTimeZone: input.wardTimeZone,
    fileHash: input.fileHash,
    calendarExists: input.calendar !== null,
    lastSyncedAt: input.calendar?.lastSyncedAt ?? null,
  });

  const inserted = await insertImportedEvents(
    input.wardId,
    preview.toCreate.map((event) => toInsert(event, input.profileId, calendar.id)),
    client,
  );

  let updated = 0;

  for (const change of preview.toUpdate) {
    const row = await updateImportedEvent(
      input.wardId,
      change.existingId,
      {
        title: change.event.title,
        eventDate: change.event.eventDate,
        location: change.event.location,
        allDay: change.event.allDay,
      },
      client,
    );

    // Null is a row RLS refused — a zero-row success, not an error. Counting only what actually
    // changed is what keeps the result screen from reporting a write that did not happen
    // (plans/retros/roster-c-csv-import.md).
    if (row !== null) updated += 1;
  }

  const lastSyncedAt = input.syncedAt.toISOString();

  // Stamped on the way OUT, so a failed import does not claim to have happened. A calendar
  // created a moment ago already carries this instant; stamping it again is a no-op write that
  // costs one statement and keeps the two paths identical.
  await touchCalendarSyncedAt(input.wardId, calendar.id, lastSyncedAt, client);

  return {
    preview,
    result: {
      calendarId: calendar.id,
      // The rows the DATABASE returned, never `preview.toCreate.length`. A write refused by
      // policy is a zero-row success, and reporting the estimate would call that a success too.
      created: inserted.length,
      updated,
      unchanged: preview.unchanged,
      notInFile: preview.notInFile,
      problems: preview.problems,
      occurrencesDropped: preview.occurrencesDropped,
      lastSyncedAt,
    },
  };
}
