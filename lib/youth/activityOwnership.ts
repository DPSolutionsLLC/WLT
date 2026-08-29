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

// WHO MAY EDIT A FOLLOW-UP, mirroring migration 057c's `activity_logs_update` USING clause
// exactly:
//
//   using (ward_id = current_ward_id() and (is_bishopric() or logged_by = auth.uid()))
//
// TWO WAYS IN, AND THE ORGANIZATION IS NOT ONE OF THEM. An org president may READ their
// organization's follow-ups and may not rewrite one somebody else wrote — a follow-up is a
// personal account of an event, and editing another person's account is not oversight. What the
// bishopric branch is actually for is clearing a ward-council FLAG on somebody's follow-up: they
// own the agenda. The policy's WITH CHECK still refuses anybody, bishopric included, leaving a row
// attributed to a different author.
//
// This is the same mirror canManageActivityProfile is, for the same reason its header gives at
// length: a control the policy refuses is still a bug, twice recorded (visits-d, youth-a-D1).
// `loggedBy` is `not null` as of migration 057a, so there is no null arm to get wrong here — the
// trap that made the profile version's explicit guards necessary is simply absent.
export function canManageActivityLog(
  user: Pick<SessionUser, "id" | "role">,
  log: { loggedBy: string },
): boolean {
  if (isBishopricRole(user.role)) return true;

  return log.loggedBy === user.id;
}

// WHO MAY FILE A FOLLOW-UP ON AN EVENT, mirroring migration 057c's `activity_logs_insert`
// WITH CHECK clause:
//
//   with check (ward_id = current_ward_id()
//               and logged_by = auth.uid()
//               and (is_bishopric() or activity_event_is_in_caller_org(event_id)))
//
// THE `logged_by = auth.uid()` CLAUSE IS NOT REPRESENTED HERE AND MUST NOT BE. The caller is
// always writing their OWN follow-up — `loggedBy` is never in a request body, the route reads it
// from the session — so that clause is satisfied by construction. Restating it as a parameter
// would invite somebody to pass another user's id and get a `true` back for a write the policy
// would refuse.
//
// ---------------------------------------------------------------------------
// THE NULL HANDLING HERE IS THE INVERSE OF canManageActivityProfile'S, DELIBERATELY
// ---------------------------------------------------------------------------
// This is the most important line in this file. There, a null `org_id` means NOBODY but the
// author or the bishopric; here it means EVERYBODY. The two policies genuinely differ:
// `youth_activity_profiles_update` compares `org_id = current_org_id()` directly, while
// `activity_event_is_in_caller_org` resolves the event's profile through a LEFT JOIN carrying an
// explicit `profile.org_id is null` arm:
//
//   left join youth_activity_profiles profile
//     on profile.id = event.profile_id
//    and profile.ward_id = event.ward_id
//   where event.id = target_event_id
//     and event.ward_id = current_ward_id()
//     and (profile.org_id is null or profile.org_id = current_org_id())
//
// Two mirrors of two different policies are allowed to disagree. A reader assuming they agree is
// the hazard, and "unifying" them would silently remove every ward-wide activity from the
// follow-up flow — the ordinary case for this module, not an edge one.
//
// THERE IS NO `enteredBy` ARM. The profile's UPDATE policy has one; the log's INSERT policy does
// not. Filing a follow-up is about the organization that owns the event, not about who typed the
// activity in.
//
// WHY IT EXISTS: scenario 056 found "Say how it went" offered on another organization's event —
// the third sighting of visits-d / youth-a-D1's shape, inside the module whose own plan quotes the
// lesson. RLS refused the write and the route answered 403 with a sentence; the leader was still
// invited through a locked door. ITER-021.
export function canWriteFollowUpOn(
  user: Pick<SessionUser, "role" | "orgId">,
  profile: { orgId: string | null } | null,
): boolean {
  if (isBishopricRole(user.role)) return true;

  // A LEFT JOIN that matched nothing yields a null org_id, and `profile.org_id is null` is the
  // policy's own first arm — so an event with no profile, or one whose profile is not in the
  // reader's list, is ward-wide and writable. Absent means ward-wide, module-wide.
  if (profile === null) return true;
  if (profile.orgId === null) return true;

  // Only NOW does the null-equals-null trap apply: a reader with no organization cannot match an
  // owned profile, and SQL's `null = current_org_id()` is NULL rather than true.
  if (user.orgId === null) return false;

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
