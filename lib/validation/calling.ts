import { z } from "zod";
import { ROLES, type Role } from "@/types/domain";

// ASSIGNING A CALLING — the write that makes multi-ward reachable by hand rather than by seeding.
//
// `super_admin` IS NOT ASSIGNABLE HERE, exactly as it is not assignable through
// lib/validation/adminUser.ts. It bypasses the access matrix (CLAUDE.md §7) and its authority
// does not come from a ward at all — it lives in `unit_assignments`, which has no ward_id. A
// schema that accepted it would make a ward-scoped route the ordinary path to an app-wide
// administrator, which is the one thing every guard around that role exists to prevent.
//
// The three STAKE roles are refused for the same structural reason: a stake officer's authority
// is a `unit_assignments` row over a unit, not a calling in a ward. INVITABLE_ROLES already
// excludes all four, and this list is derived from the same reasoning rather than from that
// constant — INVITABLE_ROLES also excludes `sacrament_manager`, which has no email and is created
// by its own flow, and that exclusion is about the INVITE mechanism rather than about the calling.
// A youth PIN account genuinely holds a `sacrament_manager` calling, so this path must accept it.
const ASSIGNABLE_CALLING_ROLES = ROLES.filter(
  (role) =>
    role !== "super_admin" &&
    role !== "stake_president" &&
    role !== "stake_counselor" &&
    role !== "stake_secretary",
) as [Role, ...Role[]];

// `wardId` IS PRESENT HERE, unlike in every other schema in this directory, and it is the one
// place that is correct. conventions.md §Validation says the ward comes from the session because
// a body must never be able to assert which ward it is writing to — but this route's entire
// purpose is to give somebody a calling in a ward that is NOT the one the caller is acting in.
//
// What protects it is the route's guard, not the schema: a ward id other than the session's
// requires `super_admin`, checked against `unit_assignments`. The body may NAME a ward; it may
// not AUTHORIZE one.
export const createCallingSchema = z.object({
  userId: z.uuid("Choose a person from the list."),
  wardId: z.uuid("Choose a ward from the list."),
  role: z.enum(ASSIGNABLE_CALLING_ROLES, "Choose a calling."),
  orgId: z.uuid("Choose an organization from the list.").nullish(),
  counselorPosition: z
    .union([z.literal(1), z.literal(2)])
    .nullable()
    .optional(),
  startedOn: z.iso.date("Use a real date.").nullish(),
});
export type CreateCallingInput = z.infer<typeof createCallingSchema>;

// RELEASING A CALLING, and putting one back. `isActive: false` is a release — never a delete,
// because a calling somebody held is a record of what happened and the partial unique index is
// on `where is_active` precisely so the released row can stay (migration 068).
export const updateCallingStatusSchema = z.object({
  userId: z.uuid("Choose a person from the list."),
  wardId: z.uuid("Choose a ward from the list."),
  isActive: z.boolean(),
  endedOn: z.iso.date("Use a real date.").nullish(),
});
export type UpdateCallingStatusInput = z.infer<typeof updateCallingStatusSchema>;
