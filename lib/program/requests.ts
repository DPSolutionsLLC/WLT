// The program screen's four client components all talk to the routes over `fetch`, and all four
// need the same two lines: read the body without letting a non-JSON response throw a bare
// SyntaxError, and pull the route's written sentence out of it.
//
// Written once here rather than copied into each. MonthPlannerBoard, ContactStagePanel and
// AiDraftButton each carry their own private copy of the first half, which was fine at one
// component per module and is not at four in one screen (conventions.md §Components: a thing
// used by two callers moves, it is not copied).
//
// CLIENT-SAFE. No Supabase import, no next/headers — a "use client" component importing anything
// that reaches next/headers fails `npm run build` while passing lint and typecheck
// (plans/retros/roster-b-picker-and-orgs.md).

export async function readJsonPayload(
  response: Response,
): Promise<Record<string, unknown>> {
  try {
    return (await response.json()) as Record<string, unknown>;
  } catch {
    throw new Error("The server sent a response this page could not read.");
  }
}

// The route's OWN sentence, whenever it sent one. Every route in this app answers a failure with
// `{ error }` written for a person, and the six AI error kinds are six distinguishable sentences
// — re-wording them in the client would collapse them back into one (plans/retros/ai-c-feature-routes.md).
export function messageFromPayload(
  payload: Record<string, unknown>,
  fallback: string,
): string {
  return typeof payload.error === "string" && payload.error.trim() !== ""
    ? payload.error
    : fallback;
}
