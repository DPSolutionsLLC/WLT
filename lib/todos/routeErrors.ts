import { NextResponse } from "next/server";
import { respondToRouteError, type RouteErrorContext } from "@/lib/auth/routeErrors";
import { TodoLogWriteError } from "@/lib/todos/queries";

// Every To Do route ends in this rather than in respondToRouteError directly, for one extra case:
// a change that was SAVED but whose timeline line was not. The generic fallback would say "Please
// try again", which is untrue — trying again would repeat a change that already happened. This
// answers with the sentence TodoLogWriteError carries instead.
export function respondToTodoError(error: unknown, context: RouteErrorContext): NextResponse {
  if (error instanceof TodoLogWriteError) {
    console.error(`${context.route} saved its change but not its timeline line`, {
      ...context.detail,
      cause: error.cause,
    });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return respondToRouteError(error, context);
}
