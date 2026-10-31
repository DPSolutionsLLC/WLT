import type { AnswerSnapshot } from "@/lib/zoom/registrationAnswers";
import type { ZoomRegistration } from "@/lib/zoom/registrations";

// THE WORDS ON ONE SIGN-UP CARD (ITER-052). Pure, so the wording is tested without a browser.
// Imports TYPES only — this runs in the client bundle.
//
// "Declined before" and "Same phone as an earlier request" are COMPUTED ON READ from the ward's
// other sign-ups (plan D2), never stored: nothing in this project refreshes a stored flag.

export type RegistrationFlags = {
  declinedBefore: boolean;
  // The earliest sign-up from the same phone made BEFORE this one, if any.
  samePhoneAs: { id: string; displayName: string } | null;
};

// Only EARLIER requests count: the first request from a phone is not "a repeat" of a later one, and
// a decline that came afterwards says nothing about the request it followed.
export function describeRegistrationFlags(
  registration: Pick<ZoomRegistration, "id" | "phoneDigits" | "createdAt">,
  all: readonly Pick<ZoomRegistration, "id" | "phoneDigits" | "createdAt" | "status" | "displayName">[],
): RegistrationFlags {
  const createdAt = Date.parse(registration.createdAt);
  const earlier = all
    .filter(
      (other) =>
        other.id !== registration.id &&
        other.phoneDigits === registration.phoneDigits &&
        Date.parse(other.createdAt) < createdAt,
    )
    .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));

  const earliest = earlier[0] ?? null;
  return {
    declinedBefore: earlier.some((other) => other.status === "declined"),
    samePhoneAs: earliest ? { id: earliest.id, displayName: earliest.displayName } : null,
  };
}

export type RegistrationRow = {
  id: string;
  displayName: string;
  isWaiting: boolean;
  statusLine: string;
  memberLine: string;
  phone: string;
  email: string | null;
  answerLines: string[];
  referrerLine: string | null;
  flagLines: string[];
  stamp: string;
  // The UTC calendar day the request arrived, for grouping the list by day.
  dayKey: string;
};

// A date-only "when did this happen" stamp renders in UTC (CLAUDE.md rule 12, second case) — the
// same format as the Invitees rows.
const STAMP_DATE = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

function statusLine(registration: ZoomRegistration): string {
  if (registration.status === "pending") return "Waiting";
  if (registration.status === "declined") return "Declined";
  if (!registration.linkGiven) return "Approved · waiting for a link";
  return registration.placeholderName ? `Approved · ${registration.placeholderName}` : "Approved";
}

function memberLine(registration: ZoomRegistration): string {
  if (registration.memberName) return `Matched to ${registration.memberName}`;
  return registration.saysMember ? "Member of the ward (not matched yet)" : "Not a member";
}

export function answerLine(answer: AnswerSnapshot): string {
  const value = typeof answer.answer === "boolean" ? (answer.answer ? "Yes" : "No") : answer.answer;
  return `${answer.prompt} — ${value}`;
}

function flagLines(registration: ZoomRegistration, flags: RegistrationFlags): string[] {
  const lines: string[] = [];
  if (flags.samePhoneAs) lines.push("Same phone as an earlier request");
  if (flags.declinedBefore) lines.push("Declined before");
  if (registration.status === "pending" && registration.heldReason === "daily_limit") {
    lines.push("Held: lots of sign-ups today");
  }
  return lines;
}

export function describeRegistrationRow(
  registration: ZoomRegistration,
  all: readonly ZoomRegistration[],
): RegistrationRow {
  const created = new Date(registration.createdAt);
  return {
    id: registration.id,
    displayName: registration.displayName,
    isWaiting: registration.status === "pending",
    statusLine: statusLine(registration),
    memberLine: memberLine(registration),
    phone: registration.phone,
    email: registration.email,
    answerLines: registration.answers.map(answerLine),
    referrerLine: registration.referrerName ? `Referred by ${registration.referrerName}` : null,
    flagLines: flagLines(registration, describeRegistrationFlags(registration, all)),
    stamp: STAMP_DATE.format(created),
    dayKey: created.toISOString().slice(0, 10),
  };
}

// Waiting oldest first, so nobody waits longest unseen; then decided, newest first.
export function splitRegistrations(registrations: readonly ZoomRegistration[]): {
  waiting: ZoomRegistration[];
  recent: ZoomRegistration[];
} {
  return {
    waiting: registrations
      .filter((registration) => registration.status === "pending")
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    recent: registrations
      .filter((registration) => registration.status !== "pending")
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
  };
}

export function pendingCount(registrations: readonly ZoomRegistration[]): number {
  return registrations.filter((registration) => registration.status === "pending").length;
}

// ---------------------------------------------------------------------------------------------
// THE APPROVAL LINE (z3b)
// ---------------------------------------------------------------------------------------------
// Computed on read against whoever serves in the bishopric NOW (listBishopricUsers()), so a
// released calling drops out of "Waiting on" without a write — the same set
// respond_to_zoom_registration() requires (migration 096). Names, never he/she.

export type BishopricPerson = { userId: string; name: string };

export type ApprovalState = {
  approvedBy: string[];
  talkFirst: string[];
  // Serving members who have said nothing yet. "you" stands in for the reader.
  waitingOn: string[];
  // Pending, at least one approval, and every serving member has approved: the request is waiting
  // only because a calling was released after the last answer. "Finish approval" approves it.
  canFinish: boolean;
  // Why "Finish approval" is offered, shown beside it so the button does not appear unexplained.
  // Null whenever canFinish is false.
  finishReason: string | null;
  ownResponse: "approve" | "talk_first" | null;
};

const EVERYONE_SERVING_APPROVED = "Everyone serving now has approved.";

// Names only somebody who answered "Let's talk first" and is no longer serving: a released member who
// never answered has no name on the request, so the general sentence stands in.
function describeFinishReason(releasedTalkFirst: readonly string[]): string {
  if (releasedTalkFirst.length === 0) {
    return `The bishopric has changed since this came in. ${EVERYONE_SERVING_APPROVED}`;
  }
  const names =
    releasedTalkFirst.length === 1
      ? releasedTalkFirst[0]
      : `${releasedTalkFirst.slice(0, -1).join(", ")} and ${releasedTalkFirst[releasedTalkFirst.length - 1]}`;
  const verb = releasedTalkFirst.length === 1 ? "is" : "are";
  return `${names} wanted to talk first and ${verb} no longer in the bishopric. ${EVERYONE_SERVING_APPROVED}`;
}

export function waitingOnNames(
  registration: Pick<ZoomRegistration, "status" | "responses">,
  bishopric: readonly BishopricPerson[],
  readerId: string,
): ApprovalState {
  const nameFor = (person: BishopricPerson) => (person.userId === readerId ? "you" : person.name);
  const responseOf = (userId: string) =>
    registration.responses.find((response) => response.userId === userId)?.response ?? null;

  const approvals = registration.responses.filter((response) => response.response === "approve");
  const notYetApproved = bishopric.filter((person) => responseOf(person.userId) !== "approve");
  const canFinish =
    registration.status === "pending" && approvals.length > 0 && notYetApproved.length === 0;
  const releasedTalkFirst = registration.responses
    .filter(
      (response) =>
        response.response === "talk_first" &&
        !bishopric.some((person) => person.userId === response.userId),
    )
    .map((response) => response.name);

  return {
    approvedBy: approvals.map((response) => (response.userId === readerId ? "you" : response.name)),
    talkFirst: bishopric.filter((person) => responseOf(person.userId) === "talk_first").map(nameFor),
    waitingOn: bishopric.filter((person) => responseOf(person.userId) === null).map(nameFor),
    canFinish,
    finishReason: canFinish ? describeFinishReason(releasedTalkFirst) : null,
    ownResponse: responseOf(readerId),
  };
}

// "Approved by Daniel Peterson · Wants to talk first: Tom Haskell · Waiting on: you". Null when
// nobody has answered and nobody is serving — there is nothing to say.
export function approvalLine(state: ApprovalState): string | null {
  const parts: string[] = [];
  if (state.approvedBy.length > 0) parts.push(`Approved by ${state.approvedBy.join(", ")}`);
  if (state.talkFirst.length > 0) parts.push(`Wants to talk first: ${state.talkFirst.join(", ")}`);
  if (state.waitingOn.length > 0) parts.push(`Waiting on: ${state.waitingOn.join(", ")}`);
  return parts.length > 0 ? parts.join(" · ") : null;
}

// What a declined person reads on their status page (plan D2). One sentence, no reason — shared by
// the status page and the decline window, so the window shows exactly what they will see.
export const DECLINED_STATUS_SENTENCE =
  "We weren't able to give you a stream link right now. Please speak with the bishop.";
