// A WRITE THE POLICY REFUSED BY RAISING, RATHER THAN BY MATCHING NOTHING.
//
// ---------------------------------------------------------------------------
// WHY THIS IS ITS OWN MODULE
// ---------------------------------------------------------------------------
// It lived in lib/youth/queries.ts until youth-j, where lib/youth/rosterQueries.ts came to need
// it too — and queries.ts now imports rosterQueries.ts to attach a team's roster in its mapper.
// Importing back the other way would be a cycle between two server modules, and a second copy of
// this predicate is how one of them comes to map a different SQLSTATE from the other, which is
// the exact drift the defect below was about. So it belongs to neither and sits here.
//
// PURE — no Supabase, no next/headers, no clock. It reads one field off an error object.
//
// ---------------------------------------------------------------------------
// TWO SHAPES OF RLS REFUSAL, AND ONLY ONE OF THEM IS QUIET
// ---------------------------------------------------------------------------
// A row the USING clause excludes is simply not seen: the UPDATE matches nothing and returns a
// zero-row SUCCESS (plans/retros/foundation-c-services.md, which every write in this module
// follows). A row that passes USING and then fails WITH CHECK is different — PostgreSQL RAISES
// `new row violates row-level security policy`, SQLSTATE **42501**, and supabase-js surfaces it as
// an ordinary error. A refused INSERT always takes the loud path, because there is no zero-row
// shape for an insert to have.
//
// Both mean the same thing to the person who pressed the button: NOT YOURS TO CHANGE. Until
// 2026-08-31 only the quiet one was handled, so migration 054d's one divergent shape — a profile
// owned by another organization but entered by the caller, which USING admits and WITH CHECK
// refuses — came back as a **500** reading "Please try again", which was untrue: trying again
// cannot work (defect 060-D2, found walking scenario 060).
//
// Mapping it onto the same path as the zero-row refusal is what lets the route answer with one
// sentence for both. Distinguishing the two would tell a caller WHICH KIND of row they may not
// touch, which is the thing the 404 exists to avoid saying.
//
// NARROW ON PURPOSE. Only 42501. Every other error still throws and still surfaces, because "the
// policy said no" and "the database is broken" must not become one message (CLAUDE.md rule 7).
export function isPolicyRefusal(error: { code?: string } | null): boolean {
  return error?.code === "42501";
}
