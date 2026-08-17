import { z } from "zod";
import { MEMBER_CATEGORIES, MEMBER_GENDERS, MEMBER_STATUSES } from "@/types/domain";

// No wardId on any schema here, ever — it comes from the session (conventions.md §Validation).
// A schema that accepts a wardId is a schema someone will eventually trust.

export const createHouseholdSchema = z.object({
  familyName: z.string().trim().min(1, "Enter a family name.").max(120),
  address: z.string().trim().max(300).optional().nullable(),
});
export type CreateHouseholdInput = z.infer<typeof createHouseholdSchema>;

export const updateHouseholdSchema = createHouseholdSchema.partial();
export type UpdateHouseholdInput = z.infer<typeof updateHouseholdSchema>;

export const createMemberSchema = z.object({
  householdId: z.uuid("Choose a household from the list.").optional().nullable(),
  firstName: z.string().trim().min(1, "Enter a first name.").max(80),
  lastName: z.string().trim().min(1, "Enter a last name.").max(80),
  category: z.enum(MEMBER_CATEGORIES).optional().nullable(),
  gender: z.enum(MEMBER_GENDERS).optional().nullable(),
  status: z.enum(MEMBER_STATUSES).default("active"),
  phone: z.string().trim().max(40).optional().nullable(),
});
export type CreateMemberInput = z.infer<typeof createMemberSchema>;

export const updateMemberSchema = createMemberSchema.partial();
export type UpdateMemberInput = z.infer<typeof updateMemberSchema>;

export const memberFiltersSchema = z.object({
  search: z.string().trim().max(120).optional(),
  category: z.enum(MEMBER_CATEGORIES).optional(),
  statuses: z.array(z.enum(MEMBER_STATUSES)).optional(),
  organizationId: z.uuid().optional(),
});
export type MemberFilters = z.infer<typeof memberFiltersSchema>;

export const createMemberNoteSchema = z.object({
  body: z.string().trim().min(1, "Enter a note.").max(5000),
});
export type CreateMemberNoteInput = z.infer<typeof createMemberNoteSchema>;

// Organization ids and nothing else. A field the server accepts and then discards is the silent
// drop CLAUDE.md rule 9 exists to prevent (plans/retros/auth-c-youth-pin.md) — if a future
// caller needs to say something more about a membership, it belongs in a column first.
//
// An empty array is valid and means "remove this member from every organization", which is why
// there is no min(1) here.
export const setMemberOrganizationsSchema = z.object({
  organizationIds: z
    .array(z.uuid("Choose an organization from the list."))
    .max(20, "That is more organizations than a ward has."),
});
export type SetMemberOrganizationsInput = z.infer<typeof setMemberOrganizationsSchema>;

// 500 is a UI selection cap, not an import cap. A roster larger than one screenful of
// checkboxes belongs in roster-c's CSV import, which has its own preview-and-confirm step.
export const bulkAssignSchema = z.object({
  memberIds: z
    .array(z.uuid("That member id is not valid."))
    .min(1, "Select at least one member.")
    .max(500, "Select 500 members or fewer."),
  organizationId: z.uuid("Choose an organization."),
});
export type BulkAssignInput = z.infer<typeof bulkAssignSchema>;
