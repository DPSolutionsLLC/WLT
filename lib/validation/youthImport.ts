import { z } from "zod";

// The multipart fields both halves of the ICS import read. It followed the roster's old CSV
// import schemas, deleted in ITER-040 when the roster moved to a paste.
//
// NO wardId, NO enteredBy, NO calendarId ON ANY SCHEMA HERE, EVER. The ward and the user come from
// the session; the calendar is resolved from the profile by lib/youth/ics/applyImport.ts
// (conventions.md §Validation, and lib/validation/youth.ts's header states the same rule for
// slice A). A client that could name its own calendar could write into another activity's
// schedule.
//
// These schemas check SHAPE ONLY. Whether the profile is in the caller's ward is answered by
// getActivityProfile() through the caller's own client, where RLS decides — not here.

export const profileIdSchema = z.uuid("Choose which activity this schedule belongs to.");

// Decision: the confirm re-uploads the same file and the server re-derives everything from it, so
// the only thing carried across from the preview is a hash proving it is the same file. Copied in
// spirit from the old roster CSV import's fileHashSchema.
export const fileHashSchema = z
  .string()
  .regex(
    /^[0-9a-f]{64}$/,
    "That preview is no longer valid. Preview the file again before importing it.",
  );
