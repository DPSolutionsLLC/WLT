import type { RemoteLinkPosition, Role } from "@/types/domain";

// The TypeScript mirror of remote_link_position_matches() in migration 094. The two must agree:
// the database decides who may READ a link, and this decides which row the app asks for and which
// links a calling change turns off.
//
// "Ward Clerk" is the user's word for the position. ROLE_LABELS.ward_secretary still says "Ward
// Secretary"; these labels are their own constant on purpose.
export const REMOTE_LINK_POSITION_LABELS: Record<RemoteLinkPosition, string> = {
  bishop: "Bishop",
  counselor_1: "1st Counselor",
  counselor_2: "2nd Counselor",
  ward_clerk: "Ward Clerk",
  executive_secretary: "Executive Secretary",
};

// A counselor with no position number holds no remote. Guessing one would hand somebody the other
// counselor's link.
export function positionForCalling(
  role: Role,
  counselorPosition: 1 | 2 | null,
): RemoteLinkPosition | null {
  switch (role) {
    case "bishop":
      return "bishop";
    case "counselor":
      if (counselorPosition === 1) return "counselor_1";
      if (counselorPosition === 2) return "counselor_2";
      return null;
    case "ward_secretary":
      return "ward_clerk";
    case "executive_secretary":
      return "executive_secretary";
    default:
      return null;
  }
}

export function callingMatchesPosition(
  role: Role,
  counselorPosition: 1 | 2 | null,
  position: RemoteLinkPosition,
): boolean {
  return positionForCalling(role, counselorPosition) === position;
}
