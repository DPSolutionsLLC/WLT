import type { Role } from "@/types/domain";

export const BISHOPRIC_ROLE_LABELS = ["Bishop", "1st Counselor", "2nd Counselor"] as const;

export type BishopricRoleLabel = (typeof BISHOPRIC_ROLE_LABELS)[number];

// Who you are in the Planner comes from the CALLING, never from a name typed into a menu (D6).
// The Planner's own `settings/bishopric` document lists each member's name beside one of these
// labels, so the label is the join between the login and the Planner's records.
export function bishopricRoleLabel(
  role: Role,
  counselorPosition: number | null,
): BishopricRoleLabel | null {
  if (role === "bishop") return "Bishop";
  if (role !== "counselor") return null;
  if (counselorPosition === 1) return "1st Counselor";
  if (counselorPosition === 2) return "2nd Counselor";
  return null;
}

type BishopricMember = { name?: unknown; role?: unknown };

export function plannerNameFor(
  label: BishopricRoleLabel | null,
  bishopricDocument: unknown,
): string | null {
  if (label === null || bishopricDocument === null || typeof bishopricDocument !== "object") {
    return null;
  }

  const members = (bishopricDocument as { members?: unknown }).members;
  if (!Array.isArray(members)) return null;

  const match = (members as BishopricMember[]).find(
    (member) => member && member.role === label && typeof member.name === "string",
  );

  const name = typeof match?.name === "string" ? match.name.trim() : "";
  return name === "" ? null : name;
}
