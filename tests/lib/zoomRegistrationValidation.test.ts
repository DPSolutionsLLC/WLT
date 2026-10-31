import { describe, expect, it } from "vitest";
import {
  createQuestionSchema,
  publicRegistrationSchema,
  registrationSettingsSchema,
  updateQuestionSchema,
} from "@/lib/validation/zoomRegistration";

// The public Zoom sign-up and its settings (ITER-052).

const VALID = {
  slug: "zoom-0123456789abcdef",
  displayName: "Avery Hart",
  phone: "(555) 123-4567",
  saysMember: false,
};

function firstError(result: { success: boolean; error?: { issues: { message: string }[] } }) {
  return result.error?.issues[0]?.message;
}

describe("publicRegistrationSchema", () => {
  it("turns an empty email into null, never an empty string", () => {
    const parsed = publicRegistrationSchema.parse({ ...VALID, email: "   " });
    expect(parsed.email).toBeNull();
  });

  it("lower-cases an email", () => {
    expect(publicRegistrationSchema.parse({ ...VALID, email: "Avery@Example.COM" }).email).toBe(
      "avery@example.com",
    );
  });

  it("treats a missing email as null", () => {
    expect(publicRegistrationSchema.parse(VALID).email).toBeNull();
  });

  it("requires a phone number", () => {
    const result = publicRegistrationSchema.safeParse({ ...VALID, phone: "" });
    expect(firstError(result)).toBe("Enter a phone number we can reach you on.");
  });

  it("refuses a phone number too short to dial", () => {
    const result = publicRegistrationSchema.safeParse({ ...VALID, phone: "12345" });
    expect(firstError(result)).toBe("That phone number looks too short.");
  });

  it("requires an answer to the member question", () => {
    const result = publicRegistrationSchema.safeParse({
      slug: VALID.slug,
      displayName: VALID.displayName,
      phone: VALID.phone,
    });
    expect(firstError(result)).toBe("Tell us whether you're a member of the ward.");
  });

  it("accepts the honeypot field — it is the route that ignores the request", () => {
    expect(publicRegistrationSchema.parse({ ...VALID, website: "http://spam.example" }).website).toBe(
      "http://spam.example",
    );
  });

  it("treats a mangled referral code as no referral rather than an error", () => {
    expect(publicRegistrationSchema.parse({ ...VALID, ref: "not a code!" }).ref).toBeNull();
    expect(publicRegistrationSchema.parse({ ...VALID, ref: "AbCdE12345" }).ref).toBe("AbCdE12345");
  });

  it("defaults the answers to none", () => {
    expect(publicRegistrationSchema.parse(VALID).answers).toEqual([]);
  });

  it("refuses a short answer over 500 characters", () => {
    const result = publicRegistrationSchema.safeParse({
      ...VALID,
      answers: [{ questionId: "11111111-1111-4111-8111-111111111111", answer: "x".repeat(501) }],
    });
    expect(firstError(result)).toBe("Answers can be at most 500 characters.");
  });
});

describe("registrationSettingsSchema", () => {
  it("needs at least one setting", () => {
    expect(firstError(registrationSettingsSchema.safeParse({}))).toBe(
      "Change at least one setting before saving.",
    );
    expect(registrationSettingsSchema.parse({ isOpen: true })).toEqual({ isOpen: true });
  });
});

describe("the question schemas", () => {
  it("defaults a new question to optional", () => {
    expect(
      createQuestionSchema.parse({ prompt: "How did you hear about us?", kind: "short_text", audience: "everyone" })
        .isRequired,
    ).toBe(false);
  });

  it("refuses to change a question's kind", () => {
    expect(firstError(updateQuestionSchema.safeParse({ kind: "short_text" }))).toBe(
      "A question's kind can't be changed once it's made. Turn it off and add a new one.",
    );
  });

  it("accepts a move", () => {
    expect(updateQuestionSchema.parse({ move: "up" })).toEqual({ move: "up" });
  });
});
