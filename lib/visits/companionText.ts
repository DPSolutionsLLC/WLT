import { formatAppointmentInstant } from "@/lib/visits/visitDates";
import { VISIT_INVITE_STATUS_LABELS, type VisitCompanion } from "@/types/domain";

// The words for a visit's companions and its invite (ITER-055 bv6). Pure and importable from a
// client component: no server imports, and the zone is always a parameter (rule 12).

// LEADERS FIRST, THEN EVERYONE ELSE, EACH A TO Z (defect 102-D2, the user's choice). One booking
// writes all its companions in one statement, so `created_at` ties and the old `id` tiebreak was a
// random order that changed from visit to visit.
export function compareCompanions(a: VisitCompanion, b: VisitCompanion): number {
  const aIsLeader = a.kind === "user" ? 0 : 1;
  const bIsLeader = b.kind === "user" ? 0 : 1;
  if (aIsLeader !== bIsLeader) return aIsLeader - bIsLeader;
  return a.displayName.localeCompare(b.displayName, "en", { sensitivity: "base" });
}

// "With Ann Lee (invited), John Park (coming), a neighbour" — the status only where there is one,
// because a recorded companion was never asked anything. Null when nobody is going along.
export function describeCompanions(companions: readonly VisitCompanion[]): string | null {
  if (companions.length === 0) return null;

  const parts = companions.map((companion) =>
    companion.status === null
      ? companion.displayName
      : `${companion.displayName} (${VISIT_INVITE_STATUS_LABELS[companion.status]})`,
  );
  return `With ${parts.join(", ")}`;
}

export const VISIT_INVITE_TITLE = "Visit invite";

// The bell notification's body. The time is the WARD's, like every appointment time in this app.
export function visitInviteBody(params: {
  bookerName: string | null;
  familyName: string | null;
  scheduledFor: string;
  wardZone: string;
}): string {
  const who = params.bookerName ?? "A leader";
  const where = params.familyName === null ? "a household" : `the ${params.familyName} family`;
  const when = formatAppointmentInstant(params.scheduledFor, params.wardZone);
  return `${who} invited you to visit ${where} on ${when}. Open My Appointments to accept or decline.`;
}

// The line on an invite card: "Brother Lee asked you to visit the Park family".
export function describeInvite(invite: {
  householdName: string | null;
  madeByName: string | null;
}): string {
  const where = invite.householdName === null ? "a household" : `the ${invite.householdName} family`;
  return `${invite.madeByName ?? "A leader"} asked you to visit ${where}`;
}

// The leaders the companion picker offers: everybody with a calling in the ward except the booker,
// who is going because they booked it, with the bishopric first (the plan's picker order) and the
// rest in the order given.
export function orderCompanionLeaders<Leader extends { id: string }>(
  leaders: readonly Leader[],
  bishopricIds: readonly string[],
  bookerId: string,
): Leader[] {
  const bishopric = new Set(bishopricIds);
  const others = leaders.filter((leader) => leader.id !== bookerId);
  return [
    ...others.filter((leader) => bishopric.has(leader.id)),
    ...others.filter((leader) => !bishopric.has(leader.id)),
  ];
}
