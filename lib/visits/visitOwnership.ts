import { BISHOPRIC_ROLES } from "@/lib/auth/permissions";
import type { SessionUser } from "@/types/domain";

// WHO MAY WRITE TO A VISIT LOG, mirroring migration 019's `visit_logs_update` exactly:
//
//   using (ward_id = current_ward_id() and (is_bishopric() or org_id = current_org_id()))
//
// The ward half is not restated here — every caller has already been narrowed to one ward by the
// query that fetched the visit. What this answers is the org half.
//
// ---------------------------------------------------------------------------
// WHY THIS EXISTS: A CONTROL THE POLICY REFUSES IS STILL A BUG
// ---------------------------------------------------------------------------
// `visits.create` says a leader may log visits. It does NOT say which visits they may edit, and
// until cross-org visibility shipped in visits-c the difference never showed: a leader could only
// SEE their own organization's logs, so gating a button on the permission alone happened to be
// right. With the setting on they can see every organization's, and the Recent visits panel put a
// "Flag for ward council" button on all of them.
//
// RLS refused those writes correctly — nothing leaked, nothing was written, no notification was
// sent. But the leader was offered a consequential-sounding action, confirmed it, and got a
// generic failure. Found walking scenario 042 on 2026-08-26.
//
// CLAUDE.md rule 2 says the policy is the security boundary and this function is not it. This is
// the UI agreeing with the boundary so a person is never invited through a door that is locked.
// If the two ever disagree the policy still wins, and the symptom is this cosmetic bug again
// rather than a leak.
//
// PURE and client-importable — no Supabase, no next/headers, no clock.

export function isBishopricRole(role: SessionUser["role"]): boolean {
  return (BISHOPRIC_ROLES as readonly string[]).includes(role);
}

// `visitOrgId` is null for a bishopric-authored visit, which migration 019 makes bishopric-only:
// `org_id = current_org_id()` compares null to null, and in SQL that is NULL rather than true, so
// no org leader can reach it.
//
// THE NULL-EQUALS-NULL TRAP IS THE ONE THING TO GET RIGHT HERE. JavaScript disagrees with SQL:
// `null === null` is `true`, so an org leader whose account has no organization would match every
// bishopric-authored visit and be handed edit controls on all of them. The explicit guard below
// is what keeps this function saying the same thing the policy says.
export function canManageVisitLog(
  user: Pick<SessionUser, "role" | "orgId">,
  visitOrgId: string | null,
): boolean {
  if (isBishopricRole(user.role)) return true;

  if (user.orgId === null) return false;
  if (visitOrgId === null) return false;

  return user.orgId === visitOrgId;
}
