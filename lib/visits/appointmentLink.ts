// The protocol between the appointments panel and the visit form: one query parameter.
//
// ---------------------------------------------------------------------------
// WHY THIS IS ITS OWN MODULE, AND NOT A CONSTANT IN AppointmentPanel.tsx
// ---------------------------------------------------------------------------
// It WAS a constant in AppointmentPanel.tsx, and that silently broke the whole "Log this visit"
// flow. AppointmentPanel is a `"use client"` module. When a Server Component imports a value
// from a client module, Next.js replaces the module with client-reference proxies — so
// `APPOINTMENT_QUERY_PARAM` arrived in `app/(app)/visits/page.tsx` as a FUNCTION, not as the
// string "appointment".
//
// Nothing threw. `searchParams[someFunction]` is simply `undefined`, so the page found no
// appointment, the form opened blank, and every server test still passed because they call the
// route handlers rather than render the page. Found by walking scenario 044 in a browser.
//
// This module has no "use client" directive, so both sides get the real values. The rule it
// encodes: a constant shared between a Server Component and a Client Component belongs in a
// module that is neither.
//
// It owns BOTH halves deliberately — the panel builds the link, the page reads it back — so the
// two cannot drift apart the way a bare string in two files would.

export const APPOINTMENT_QUERY_PARAM = "appointment";

// The anchor the visit form's heading carries, so following the link scrolls to the form rather
// than leaving the reader at the top of a long page.
export const LOG_VISIT_ANCHOR = "log-a-visit";

export function logVisitHref(appointmentId: string): string {
  return `/visits?${APPOINTMENT_QUERY_PARAM}=${encodeURIComponent(appointmentId)}#${LOG_VISIT_ANCHOR}`;
}

// Next hands a repeated query parameter through as an array. Taking the first is the same answer
// a single value gives, and it keeps a hand-edited `?appointment=a&appointment=b` from being an
// error a leader has to understand.
export function readAppointmentParam(
  searchParams: Record<string, string | string[] | undefined>,
): string | undefined {
  const value = searchParams[APPOINTMENT_QUERY_PARAM];
  return Array.isArray(value) ? value[0] : value;
}
