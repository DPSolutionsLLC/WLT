import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { isAiRequestError } from "@/lib/ai/errors";
import { isForbiddenError, isPinLockedError } from "@/lib/auth/errors";

export type RouteErrorContext = {
  route: string;
  fallbackMessage: string;
  detail?: Record<string, unknown>;
};

const FORBIDDEN_MESSAGE = "You do not have permission to do that.";

// The one place this app names the reason a sign-in failed. Everything else about PIN login is
// deliberately indistinguishable (see app/api/auth/pin-login/route.ts), but by the time anyone
// reads this the account is already known to exist, and a teenager staring at a PIN they know
// is correct needs to be told why it keeps failing.
export function pinLockedMessage(remainingMinutes: number): string {
  return `Too many attempts. Try again in ${remainingMinutes} ${
    remainingMinutes === 1 ? "minute" : "minutes"
  }.`;
}

export class InvalidRequestBodyError extends Error {
  constructor(cause: unknown) {
    super("The request body was not valid JSON");
    this.name = "InvalidRequestBodyError";
    this.cause = cause;
  }
}

// Read every request body through this, never `await request.json()` directly. A body that is
// not JSON is the caller's mistake; parsed inline, the SyntaxError falls through to the 500
// fallback below and the server reports its own fault for someone else's bad request
// (conventions.md §Error Handling).
//
// The catch translates rather than swallows — the original error travels on `cause`.
export async function readJsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch (error) {
    throw new InvalidRequestBodyError(error);
  }
}

// A ForbiddenError that escapes a route handler becomes a 500, which tells the user nothing and
// hides a permission decision behind a server fault. Every mutating route in auth-b and auth-c
// ends in this call, so the mapping lives in one place instead of being re-derived per route.
//
// Callers must resolve the session OUTSIDE the try block this feeds: requireSessionUser()
// redirects by throwing an internal Next.js error, and catching that here would turn a
// redirect into a 500.
export function respondToRouteError(
  error: unknown,
  context: RouteErrorContext,
): NextResponse {
  if (isForbiddenError(error)) {
    return NextResponse.json({ error: FORBIDDEN_MESSAGE }, { status: 403 });
  }

  // Logs AND returns. An AI failure is both a user-facing event and something worth having in the
  // server log with its `cause` attached — the cause is the SDK's own error, which is the only
  // place the real reason survives. The MESSAGE the user reads is already written for a human
  // (lib/ai/errors.ts); re-wording it here would collapse six distinguishable failures into one.
  if (isAiRequestError(error)) {
    console.error(`AI request failed in ${context.route} — ${error.kind}`, {
      ...context.detail,
      cause: error.cause,
    });
    return NextResponse.json({ error: error.message }, { status: error.status });
  }

  // 429, not 403. The credentials may well be correct; what is being refused is the rate.
  if (isPinLockedError(error)) {
    return NextResponse.json(
      { error: pinLockedMessage(error.remainingMinutes) },
      { status: 429 },
    );
  }

  if (error instanceof InvalidRequestBodyError) {
    return NextResponse.json(
      { error: "The request body was not valid JSON." },
      { status: 400 },
    );
  }

  if (error instanceof ZodError) {
    return NextResponse.json(
      { error: error.issues[0]?.message ?? "Check the form and try again." },
      { status: 400 },
    );
  }

  // The error goes in the MESSAGE, not only in the payload object. Next.js's dev logger
  // renders an object argument as `{}` regardless of its contents, so this branch — whose
  // whole job is recording an unexpected failure — recorded nothing identifiable when the
  // error lived in the second argument. The object still carries the stack for the consoles
  // that do render it.
  const description =
    error instanceof Error ? `${error.name}: ${error.message}` : String(error);

  console.error(`Unhandled error in ${context.route} — ${description}`, {
    ...context.detail,
    stack: error instanceof Error ? error.stack : undefined,
  });

  return NextResponse.json({ error: context.fallbackMessage }, { status: 500 });
}
