import { NextResponse } from "next/server";
import { respondToRouteError, type RouteErrorContext } from "@/lib/auth/routeErrors";
import { TodoLinkWriteError, TodoLogWriteError } from "@/lib/todos/queries";

// Every To Do route ends in this rather than in respondToRouteError directly, for one extra case:
// a change that was SAVED but whose timeline line was not. The generic fallback would say "Please
// try again", which is untrue — trying again would repeat a change that already happened. This
// answers with the sentence TodoLogWriteError carries instead. TodoLinkWriteError is the same case
// for the agenda item a linked to-do flags (slice p5-b).
export function respondToTodoError(error: unknown, context: RouteErrorContext): NextResponse {
  if (error instanceof TodoLogWriteError || error instanceof TodoLinkWriteError) {
    console.error(`${context.route} saved its change but not all of its side effects`, {
      ...context.detail,
      cause: error.cause,
    });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return respondToRouteError(error, context);
}
