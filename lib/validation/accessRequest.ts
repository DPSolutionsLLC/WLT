import { z } from "zod";
import {
  NON_OVERRIDABLE_PERMISSIONS,
  NON_OVERRIDABLE_ROLES,
  PERMISSIONS,
  type KnownPermission,
} from "@/lib/auth/permissions";
import { ACCESS_LEVELS, ROLES, type Role } from "@/types/domain";

// ---------------------------------------------------------------------------
// A REQUEST CANNOT ASK FOR SOMETHING AN APPROVAL COULD NOT GRANT
// ---------------------------------------------------------------------------
//
// `admin.*` and `sacrament.*` are NON-OVERRIDABLE IN BOTH DIRECTIONS (lib/auth/permissions.ts),
// and `mergeRoleAccess` restores their code defaults whatever a delta says. So a request for one
// of them would be accepted, queued, approved, written — and silently have no effect.
//
// REFUSING AT THE BOUNDARY IS THE WHOLE POINT. A granted permission that does not arrive is worse
// than a refusal, because nobody goes looking for it: the ward believes it was given something it
// does not have. This is `visits-f`'s rule — refuse, and name the alternative — applied to the
// one place in this phase where the approval path could otherwise lie.
//
// The two exclusions have their own reasons, both recorded on NON_OVERRIDABLE_PERMISSIONS:
// `admin.*` runs through the service-role client where assertCan() is the only boundary, so
// widening one is self-escalation; `sacrament.*` is the entire reach of a youth PIN account, and
// widening that is a product decision rather than a checkbox.
const REQUESTABLE_PERMISSIONS = PERMISSIONS.filter(
  (permission) => !NON_OVERRIDABLE_PERMISSIONS.includes(permission),
) as [KnownPermission, ...KnownPermission[]];

// `super_admin` cannot be reconfigured by a ward in either direction either — a ward may not
// disable the app-wide administrator who is there to help it — so a request naming that role
// would be equally inert.
const REQUESTABLE_ROLES = ROLES.filter(
  (role) => !NON_OVERRIDABLE_ROLES.includes(role),
) as [Role, ...Role[]];

// No wardId and no requestedBy — both come from the session (conventions.md §Validation). A body
// that could name the asking ward would let one ward file a request in another's name.
export const createAccessRequestSchema = z.object({
  role: z.enum(REQUESTABLE_ROLES, "Choose which calling needs the access."),
  permission: z.enum(
    REQUESTABLE_PERMISSIONS,
    "Choose something that can be granted. Administration and sacrament access cannot be " +
      "changed by a request.",
  ),
  level: z.enum(ACCESS_LEVELS).default("F"),
  // A REQUEST WITH NO WRITTEN REASON IS NOT A REQUEST. The person deciding has nothing to decide
  // on, and the column is NOT NULL besides (migration 073a).
  reason: z
    .string()
    .trim()
    .min(10, "Say why your ward needs this — a sentence is enough.")
    .max(2000, "That is longer than it needs to be — keep it under 2000 characters."),
});
export type CreateAccessRequestInput = z.infer<typeof createAccessRequestSchema>;

// DECIDING. `pending` is absent because a decision that leaves it pending is not a decision, and
// lib/access/requests.ts refuses it at the type level for the same reason.
export const decideAccessRequestSchema = z
  .object({
    status: z.enum(
      ["approved_ward", "approved_app_wide", "denied"],
      "Choose approve or decline.",
    ),
    decisionNote: z
      .string()
      .trim()
      .max(2000, "Keep the note under 2000 characters.")
      .nullish(),
  })
  .refine(
    (value) => value.status !== "denied" || (value.decisionNote?.length ?? 0) >= 5,
    {
      // A DENIAL MUST CARRY A NOTE, and this is the only field in the phase that is conditionally
      // required. The requester can read the outcome (migration 073a), and a denial with nothing
      // to read is exactly the gap the prototype shipped and caught: it teaches leaders that
      // asking does nothing. An approval needs no note — the grant speaks for itself.
      message: "Say why it was declined. The ward that asked will read this.",
      path: ["decisionNote"],
    },
  );
export type DecideAccessRequestInput = z.infer<typeof decideAccessRequestSchema>;
