import { describe, expect, it } from "vitest";
import { createInviteeSchema, updateInviteeSchema } from "@/lib/validation/zoom";

// The hand-out and edit bodies (ITER-053, z2b). An empty optional field becomes NULL, never "".

const valid = {
  memberId: null,
  displayName: "Ann Lee",
  phone: "(555) 123-4567",
  email: "Ann@Example.ORG",
  notes: "Met at the hospital",
};

describe("createInviteeSchema", () => {
  it("accepts a typed non-member and lower-cases the email", () => {
    const parsed = createInviteeSchema.parse(valid);
    expect(parsed.email).toBe("ann@example.org");
    expect(parsed.displayName).toBe("Ann Lee");
  });

  it("turns blank optional fields into null, never an empty string", () => {
    const parsed = createInviteeSchema.parse({ ...valid, phone: "  ", email: "", notes: " " });
    expect(parsed.phone).toBeNull();
    expect(parsed.email).toBeNull();
    expect(parsed.notes).toBeNull();
  });

  it("refuses a phone with too few digits, with a sentence", () => {
    const result = createInviteeSchema.safeParse({ ...valid, phone: "555-12" });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe("That phone number looks too short.");
  });

  it("refuses a blank name", () => {
    const result = createInviteeSchema.safeParse({ ...valid, displayName: "   " });
    expect(result.error?.issues[0]?.message).toBe("Enter their name.");
  });

  it("refuses a malformed email", () => {
    expect(createInviteeSchema.safeParse({ ...valid, email: "ann@" }).success).toBe(false);
  });

  it("refuses a member id that is not a uuid", () => {
    expect(createInviteeSchema.safeParse({ ...valid, memberId: "m1" }).success).toBe(false);
  });
});

describe("updateInviteeSchema", () => {
  it("accepts one field and leaves the others undefined", () => {
    const parsed = updateInviteeSchema.parse({ phone: "555 123 4567" });
    expect(parsed.phone).toBe("555 123 4567");
    expect(parsed.email).toBeUndefined();
    expect(parsed.memberId).toBeUndefined();
  });

  it("accepts clearing a field to null", () => {
    expect(updateInviteeSchema.parse({ email: "" }).email).toBeNull();
  });

  it("refuses an empty body", () => {
    const result = updateInviteeSchema.safeParse({});
    expect(result.error?.issues[0]?.message).toBe("Change at least one thing before saving.");
  });
});
