import { z } from "zod";
import { ACCESS_MODULE_KEYS } from "@/lib/access/accessModules";
import { NON_OVERRIDABLE_ROLES } from "@/lib/auth/permissions";
import { ROLES, type Role } from "@/types/domain";

// ---------------------------------------------------------------------------
// A REQUEST CANNOT ASK FOR SOMETHING AN APPROVAL COULD NOT GRANT
// ---------------------------------------------------------------------------
//
// That guarantee now lives in lib/access/accessModules.ts rather than here: no module offers an
// `admin.*` or `sacrament.*` permission, and that file ASSERTS it at import time, because those
// are NON-OVERRIDABLE IN BOTH DIRECTIONS and `mergeRoleAccess` restores their code defaults
// whatever a delta says. A request for one would be accepted, approved, written — and silently
// have no effect, which is worse than a refusal because nobody goes looking for it.
//
// So the schema's job is narrower: accept a module key the app knows. An unknown one is refused
// with a sentence rather than stored and rendered as a request nobody can act on.
const REQUESTABLE_MODULES = ACCESS_MODULE_KEYS as [string, ...string[]];

// `Q` IS NOT OFFERED. decisions.md §2.3: the prototype's "their own organization only" maps onto
// WLT's EXISTING org scoping, which RLS applies through `current_org_id()` whether anybody asked
// or not. Offering it would suggest a ward could turn something on that is already on.
const REQUESTABLE_LEVELS = ["F", "R"] as const;

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
  module: z.enum(
    REQUESTABLE_MODULES,
    "Choose one of the listed modules. Administration and sacrament access cannot be changed " +
      "by a request.",
  ),
  level: z.enum(REQUESTABLE_LEVELS, "Choose how much access they need.").default("F"),
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
