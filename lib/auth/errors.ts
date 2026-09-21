export class ForbiddenError extends Error {
  readonly permission: string;

  constructor(permission: string) {
    super(`Not permitted: ${permission}`);
    this.name = "ForbiddenError";
    this.permission = permission;
  }
}

export function isForbiddenError(error: unknown): error is ForbiddenError {
  return error instanceof ForbiddenError;
}

// Carries the remaining minutes rather than the unlock timestamp: every caller wants to say
// "try again in N minutes" to a teenager on a phone, and a timestamp would have to be
// converted to a duration at each one.
//
// The message on the Error is for logs. The user-facing sentence is built by the route from
// `remainingMinutes` — this class never sees a username or a PIN.
export class PinLockedError extends Error {
  readonly remainingMinutes: number;

  constructor(remainingMinutes: number) {
    super(`PIN sign-in is locked for another ${remainingMinutes} minute(s)`);
    this.name = "PinLockedError";
    this.remainingMinutes = remainingMinutes;
  }
}

export function isPinLockedError(error: unknown): error is PinLockedError {
  return error instanceof PinLockedError;
}

// A request whose SHAPE was valid but whose CONTENT names something the ward cannot use — an id
// belonging to another ward, most of all. It carries a sentence written for a person, and
// respondToRouteError turns it into a 400 with that sentence.
//
// ---------------------------------------------------------------------------
// WHY THIS CLASS EXISTS AT ALL, RATHER THAN A ZodError OR A THROWN Error
// ---------------------------------------------------------------------------
// Zod validates shape at the boundary and cannot ask the database anything, so "is this user id
// in this ward" is a question only a query can answer — and until migration 069 it was never
// asked in TypeScript at all. The composite foreign key `(user_id, ward_id)` answered it, and a
// violation surfaced as a 500: the server reporting its own fault for the caller's bad id.
//
// 069 narrowed those keys, so the check moved into the app (lib/callings/queries.ts
// §filterUsersInWard) and needs somewhere to land that is neither a 500 nor the JSON-parse
// message InvalidRequestBodyError is hardcoded to.
//
// THE MESSAGE IS THE WHOLE POINT: it is read by a leader who picked somebody from a list, so it
// says what is wrong in the app's own vocabulary. It must never name ids or disclose counts the
// caller is not entitled to resolve.
export class InvalidInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidInputError";
  }
}

export function isInvalidInputError(error: unknown): error is InvalidInputError {
  return error instanceof InvalidInputError;
}
