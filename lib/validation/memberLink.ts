import { z } from "zod";

// The login ↔ roster link (ITER-058 cr1). No wardId and no userId in any body — both come from the
// session, so nobody can ask to link an account other than their own through these schemas.

export const myMemberLinkSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("confirm"), memberId: z.uuid("That roster record is not valid.") }).strict(),
  z.object({ action: z.literal("ask") }).strict(),
]);
export type MyMemberLinkInput = z.infer<typeof myMemberLinkSchema>;

export const adminMemberLinkSchema = z
  .object({
    userId: z.uuid("That account is not valid."),
    memberId: z.uuid("Choose someone from the ward list."),
  })
  .strict();
export type AdminMemberLinkInput = z.infer<typeof adminMemberLinkSchema>;

export const decideMemberLinkSchema = z
  .object({ action: z.enum(["decline", "end"], "Choose decline or end.") })
  .strict();
export type DecideMemberLinkInput = z.infer<typeof decideMemberLinkSchema>;
