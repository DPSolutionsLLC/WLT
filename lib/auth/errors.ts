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
