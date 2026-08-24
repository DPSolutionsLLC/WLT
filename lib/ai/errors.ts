// Every failure of an outbound Claude call arrives here first, translated into one of six kinds
// with one sentence a bishop can act on. Nothing in this app shows a user a raw SDK error, and
// nothing shows an empty draft — an empty draft is the silent failure CLAUDE.md rule 7 forbids.
//
// The class + type-guard shape follows lib/auth/errors.ts. Callers use isAiRequestError() rather
// than `instanceof` so the check survives a module-instance split (two copies of this module
// loaded through different resolutions would each own a distinct class object).

export const AI_ERROR_KINDS = [
  "not_configured",
  "rate_limited",
  "refused",
  "truncated",
  "unavailable",
  "invalid_request",
] as const;
export type AiErrorKind = (typeof AI_ERROR_KINDS)[number];

// Six kinds, six distinct sentences, each naming what happened AND what to do. A test asserts the
// set has size six, so a copy-paste that collapses two failures into one message fails there.
export const AI_ERROR_MESSAGES: Record<AiErrorKind, string> = {
  not_configured:
    "AI is not set up yet. An administrator needs to add the Anthropic API key before this will work.",
  rate_limited: "The AI service is busy. Wait a moment and try again — nothing was lost.",
  refused: "Claude declined to answer this one. Try rewording the request.",
  truncated: "The draft was cut off before it finished. Try a shorter request.",
  unavailable: "Could not reach the AI service. Check your connection and try again.",
  invalid_request:
    "The AI service rejected the request. This is a bug — nothing was saved.",
};

// Chosen so respondToRouteError can map kind -> status without a second table. 429 and 503 are
// retryable-by-waiting, 422 means the request reached Claude and came back unusable, 502 means it
// never got there, and 500 is ours.
export const AI_ERROR_STATUSES: Record<AiErrorKind, number> = {
  not_configured: 503,
  rate_limited: 429,
  refused: 422,
  truncated: 422,
  unavailable: 502,
  invalid_request: 500,
};

export class AiRequestError extends Error {
  readonly kind: AiErrorKind;
  readonly status: number;

  // `message` is the text the USER reads, so it defaults to the written sentence for the kind.
  // The original failure travels on `cause` and is never swallowed (CLAUDE.md rule 7). The API
  // key never reaches either field.
  constructor(kind: AiErrorKind, message?: string, cause?: unknown) {
    super(message ?? AI_ERROR_MESSAGES[kind]);
    this.name = "AiRequestError";
    this.kind = kind;
    this.status = AI_ERROR_STATUSES[kind];
    this.cause = cause;
  }
}

export function isAiRequestError(error: unknown): error is AiRequestError {
  return error instanceof Error && error.name === "AiRequestError";
}
