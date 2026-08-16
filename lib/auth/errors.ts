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
