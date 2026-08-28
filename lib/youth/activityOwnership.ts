import { BISHOPRIC_ROLES } from "@/lib/auth/permissions";
import type { SessionUser } from "@/types/domain";

// WHO MAY WRITE TO AN ACTIVITY PROFILE, mirroring migration 054d's `youth_activity_profiles_update`
// USING clause exactly:
//
//   using (ward_id = current_ward_id()
//          and (is_bishopric() or entered_by = auth.uid() or org_id = current_org_id()))
//
// The ward half is not restated here — every caller has already been narrowed to one ward by the
// query that fetched the profile. What this answers is the rest.
//
// ---------------------------------------------------------------------------
// WHY THIS EXISTS: A CONTROL THE POLICY REFUSES IS STILL A BUG
// ---------------------------------------------------------------------------
// This is lib/visits/visitOwnership.ts's lesson, arriving a second time in the same shape, and the
// second time is worse because the pattern was already written down.
//
// `youth_activities.manage` says a leader may manage activities. It does NOT say WHICH ones. Here
// reads are ward-wide BY DESIGN (migration 054's whole point), so unlike visits there is no
// setting to turn on before the gap shows — every org leader sees every organization's activities
// from the day the module ships. Gating the Edit and Remove buttons on the permission alone put
// both on all of them.
//
// RLS refused those writes correctly — nothing leaked and nothing was written, confirmed by
// re-reading each row. But a leader was offered a destructive-sounding "Remove" on another
// presidency's work, pressed it, and got a generic failure. Found walking scenario 049 on
// 2026-08-27; the walk's reviewer put it plainly: "I don't see any that I cannot change?"
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

// THREE WAYS IN, AND THE ORDER MATTERS ONLY FOR READABILITY: the bishopric, the person who entered
// it, or the organization that owns it.
//
// THE NULL-EQUALS-NULL TRAP IS THE ONE THING TO GET RIGHT HERE. JavaScript disagrees with SQL:
// `null === null` is `true`, so without the explicit guards an org leader whose account has no
// organization would match every ward-wide profile and be handed controls the policy refuses —
// and a ward-wide profile is the ORDINARY case for this module, not an edge one.
//
// `enteredBy` is nullable because migration 009 lets it be: a profile survives the deletion of the
// user who entered it. A null there matches nobody, which is what the policy does too.
export function canManageActivityProfile(
  user: Pick<SessionUser, "id" | "role" | "orgId">,
  profile: { orgId: string | null; enteredBy: string | null },
): boolean {
  if (isBishopricRole(user.role)) return true;

  if (profile.enteredBy !== null && profile.enteredBy === user.id) return true;

  if (user.orgId === null) return false;
  if (profile.orgId === null) return false;

  return user.orgId === profile.orgId;
}

// THERE IS DELIBERATELY NO canManageActivityEvent().
//
// `activity_events` keeps migration 019's ward-wide write policies and has no `org_id` of its own,
// so the database permits any holder of `youth_activities.manage` in the ward to edit any event.
// A helper here would either restate `true`, or invent a narrower rule the policy does not enforce
// — and a button hidden in the UI that the API would have allowed is the mirror mistake, the one
// nobody notices. EventList gates on the permission alone and says why.
//
// If events should ever be narrowed, the migration comes first and the helper follows it.
