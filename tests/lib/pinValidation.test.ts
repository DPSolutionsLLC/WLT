// @vitest-environment node

import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { syntheticYouthEmail } from "@/lib/auth/syntheticYouthEmail";
import { pinSchema, usernameSchema } from "@/lib/validation/youthAccount";

// Pure functions, no network. The cheapest and highest-value tests in this plan
// (CLAUDE.md §8 item 4).

const REJECTED_PINS = [
  // Predictable
  "123456",
  "654321",
  "123123",
  "121212",
  "112233",
  "000000",
  "111111",
  "999999",
  // Wrong length. Four and five digits are refused now, not merely discouraged: Supabase Auth
  // would accept them at creation and refuse them at reset, stranding a locked-out account.
  "1234",
  "12345",
  "1234567",
  "123",
  "",
  // Not digits
  "12a456",
  "12 456",
  "12.456",
  "१२३४५६",
  "123456\n",
  " 12345",
];

const ACCEPTED_PINS = ["573914", "904287", "018342", "572913", "481625"];

describe("pinSchema", () => {
  it.each(REJECTED_PINS)("rejects %j", (pin) => {
    expect(pinSchema.safeParse(pin).success).toBe(false);
  });

  it.each(ACCEPTED_PINS)("accepts %j", (pin) => {
    expect(pinSchema.safeParse(pin).success).toBe(true);
  });

  // The regression guard for CLAUDE.md rule 8. Zod's default message for a failing string can
  // echo the input, and a validation error is the shortest route from a PIN to a log line.
  //
  // The empty string is excluded because every string contains it, so the assertion could
  // never fail — a passing check that proves nothing is worse than no check.
  it.each(REJECTED_PINS.filter((pin) => pin.length > 0))(
    "does not repeat %j back in its error message",
    (pin) => {
      const result = pinSchema.safeParse(pin);

      expect(result.success).toBe(false);
      if (result.success) return;

      for (const issue of result.error.issues) {
        expect(issue.message).not.toContain(pin);
      }
    },
  );

  it("rejects a non-string without echoing it", () => {
    const result = pinSchema.safeParse(572913);

    expect(result.success).toBe(false);
    if (result.success) return;

    for (const issue of result.error.issues) {
      expect(issue.message).not.toContain("572913");
    }
  });

  // The reason the rule is exactly six rather than four to six. Supabase Auth's
  // admin.updateUserById refuses a password under six characters, so a shorter PIN could be
  // created and then never reset — and a reset is the only way to unblock a locked-out youth.
  it("refuses every length Supabase Auth would refuse at reset", () => {
    for (const tooShort of ["1", "12", "123", "1234", "12345"]) {
      expect(pinSchema.safeParse(tooShort).success).toBe(false);
    }
  });
});

describe("usernameSchema", () => {
  it("lower-cases its input", () => {
    const result = usernameSchema.safeParse("JSmith");

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).toBe("jsmith");
  });

  it.each(["jsmith", "j.smith", "j_smith", "j-smith", "jsmith2028"])(
    "accepts %j",
    (username) => {
      expect(usernameSchema.safeParse(username).success).toBe(true);
    },
  );

  it.each(["ab", "j smith", "j@smith", "j+smith", "a".repeat(31), ""])(
    "rejects %j",
    (username) => {
      expect(usernameSchema.safeParse(username).success).toBe(false);
    },
  );
});

describe("syntheticYouthEmail", () => {
  const wardId = randomUUID();

  it("ends in .invalid so no mail can ever be sent to it", () => {
    expect(syntheticYouthEmail("jsmith", wardId).endsWith(".invalid")).toBe(true);
  });

  it("lower-cases the username so one account has one address", () => {
    const address = syntheticYouthEmail("JSmith", wardId);

    expect(address).toBe(`jsmith@youth.${wardId}.invalid`);
    expect(address).toBe(address.toLowerCase());
  });

  // Two wards may each hold a "jsmith". The ward id is what keeps their auth accounts apart.
  it("gives the same username in two wards two different addresses", () => {
    expect(syntheticYouthEmail("jsmith", wardId)).not.toBe(
      syntheticYouthEmail("jsmith", randomUUID()),
    );
  });
});
