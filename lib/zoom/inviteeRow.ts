import type { ZoomInvitee } from "@/lib/zoom/invitees";

// The words on one Invitees row (ITER-053, z2b). Pure, so the list's wording is tested without a
// browser. Imports a TYPE only — this runs in the client bundle.

export type InviteeRow = {
  id: string;
  displayName: string;
  isMember: boolean;
  isWaiting: boolean;
  // "Guest 07", or "Waiting for a link".
  linkLine: string;
  // "Given by Dana Reyes · 28 Oct 2026", or null when nobody is recorded.
  givenLine: string | null;
  lastWatchedLine: string;
  sundaysWatchedLine: string;
};

// A date-only "when did this happen" stamp renders in UTC (CLAUDE.md rule 12, second case) — the
// same format as the Remote links tab.
const STAMP_DATE = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

const NOT_YET = "—";

function givenLine(invitee: ZoomInvitee): string | null {
  const stamp = invitee.linkGivenAt ? STAMP_DATE.format(new Date(invitee.linkGivenAt)) : null;
  if (invitee.assignedByName && stamp) return `Given by ${invitee.assignedByName} · ${stamp}`;
  if (invitee.assignedByName) return `Added by ${invitee.assignedByName}`;
  if (stamp) return `Given ${stamp}`;
  return null;
}

export function describeInviteeRow(invitee: ZoomInvitee): InviteeRow {
  const isWaiting = invitee.linkGivenAt === null;
  return {
    id: invitee.id,
    displayName: invitee.displayName,
    isMember: invitee.memberId !== null,
    isWaiting,
    linkLine: isWaiting ? "Waiting for a link" : (invitee.placeholderName ?? "Link given"),
    givenLine: givenLine(invitee),
    // Filled by ITER-054's attendance import; a dash until then, never "Never" or "0".
    lastWatchedLine:
      invitee.lastWatchedOn === null
        ? NOT_YET
        : STAMP_DATE.format(new Date(`${invitee.lastWatchedOn}T00:00:00Z`)),
    sundaysWatchedLine: invitee.sundaysWatched === null ? NOT_YET : String(invitee.sundaysWatched),
  };
}

export function matchesInviteeSearch(invitee: ZoomInvitee, term: string): boolean {
  const needle = term.trim().toLowerCase();
  if (needle === "") return true;
  return [invitee.displayName, invitee.placeholderName ?? ""].join(" ").toLowerCase().includes(needle);
}
