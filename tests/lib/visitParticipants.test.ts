import { describe, expect, it } from "vitest";
import {
  MAX_VISIT_COMPANIONS,
  MAX_VISIT_PARTICIPANTS,
  participantsSchema,
  visitParticipantSchema,
} from "@/lib/validation/visit";

// The participant boundary, at the schema. Pure — no database, no network.
//
// ---------------------------------------------------------------------------
// THE OFF-BY-ONE IS THE POINT OF THIS FILE
// ---------------------------------------------------------------------------
// MAX_VISIT_COMPANIONS is 5 and the list holds SIX: the person writing the visit up, plus five
// companions. A cap of five entries would silently mean four companions for any leader who
// stayed on the list, and nobody would notice until a presidency of six went out together.
//
// The other half is the identity rule. `users` and `members` are unlinked in this schema, so a
// participant is a leader OR a member OR a typed name — and a discriminated union is what makes
// "two identities" unrepresentable rather than merely refused, matching migration 046's CHECK.

const A_USER = "11111111-1111-4111-8111-111111111111";
const ANOTHER_USER = "22222222-2222-4222-8222-222222222222";
const A_MEMBER = "33333333-3333-4333-8333-333333333333";
const ANOTHER_MEMBER = "44444444-4444-4444-8444-444444444444";

const userIdAt = (index: number): string =>
  `1111111${index}-1111-4111-8111-111111111111`;

describe("visitParticipantSchema", () => {
  it("accepts a leader", () => {
    expect(visitParticipantSchema.safeParse({ kind: "user", userId: A_USER }).success).toBe(
      true,
    );
  });

  it("accepts a member", () => {
    expect(
      visitParticipantSchema.safeParse({ kind: "member", memberId: A_MEMBER }).success,
    ).toBe(true);
  });

  it("accepts a typed name and trims it", () => {
    const parsed = visitParticipantSchema.parse({ kind: "label", label: "  A neighbour  " });

    expect(parsed).toEqual({ kind: "label", label: "A neighbour" });
  });

  // TWO IDENTITIES IN ONE PARTICIPANT. The union discriminates on `kind`, so the second identity
  // is not a field the chosen branch has — it is stripped, never honoured. The refusal that
  // matters is that no parse result can carry both.
  it("never returns a participant carrying two identities", () => {
    const parsed = visitParticipantSchema.parse({
      kind: "user",
      userId: A_USER,
      memberId: A_MEMBER,
    });

    expect(parsed).toEqual({ kind: "user", userId: A_USER });
    expect(parsed).not.toHaveProperty("memberId");
  });

  it("refuses a participant with no identity at all", () => {
    expect(visitParticipantSchema.safeParse({ kind: "user" }).success).toBe(false);
    expect(visitParticipantSchema.safeParse({ kind: "member" }).success).toBe(false);
    expect(visitParticipantSchema.safeParse({ kind: "label" }).success).toBe(false);
    expect(visitParticipantSchema.safeParse({}).success).toBe(false);
  });

  it("refuses a blank typed name", () => {
    expect(visitParticipantSchema.safeParse({ kind: "label", label: "   " }).success).toBe(
      false,
    );
  });

  it("refuses an unknown kind", () => {
    expect(
      visitParticipantSchema.safeParse({ kind: "angel", label: "Moroni" }).success,
    ).toBe(false);
  });

  it("refuses an id that is not a uuid", () => {
    expect(
      visitParticipantSchema.safeParse({ kind: "user", userId: "not-a-uuid" }).success,
    ).toBe(false);
  });
});

describe("participantsSchema — the cap", () => {
  it("holds the recorder plus five companions", () => {
    expect(MAX_VISIT_COMPANIONS).toBe(5);
    expect(MAX_VISIT_PARTICIPANTS).toBe(6);
  });

  // SIX IS ALLOWED. A leader who keeps themselves on the list may still add five other people,
  // which is exactly what "at most five companions" means.
  it("accepts six — the recorder and five companions", () => {
    const six = Array.from({ length: 6 }, (_, index) => ({
      kind: "user" as const,
      userId: userIdAt(index),
    }));

    expect(participantsSchema.safeParse(six).success).toBe(true);
  });

  it("refuses a seventh, and says how many a visit can hold", () => {
    const seven = Array.from({ length: 7 }, (_, index) => ({
      kind: "user" as const,
      userId: userIdAt(index),
    }));

    const result = participantsSchema.safeParse(seven);

    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain(String(MAX_VISIT_COMPANIONS));
  });

  it("accepts an empty list — nobody recorded as visiting is a real answer", () => {
    expect(participantsSchema.safeParse([]).success).toBe(true);
  });
});

describe("participantsSchema — duplicates", () => {
  it("refuses the same leader twice", () => {
    const result = participantsSchema.safeParse([
      { kind: "user", userId: A_USER },
      { kind: "user", userId: A_USER },
    ]);

    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain("already on this visit");
  });

  it("refuses the same member twice", () => {
    const result = participantsSchema.safeParse([
      { kind: "member", memberId: A_MEMBER },
      { kind: "member", memberId: A_MEMBER },
    ]);

    expect(result.success).toBe(false);
  });

  it("accepts two different leaders and two different members", () => {
    expect(
      participantsSchema.safeParse([
        { kind: "user", userId: A_USER },
        { kind: "user", userId: ANOTHER_USER },
        { kind: "member", memberId: A_MEMBER },
        { kind: "member", memberId: ANOTHER_MEMBER },
      ]).success,
    ).toBe(true);
  });

  // A user id and a member id are ids in two unrelated tables — they are not the same person
  // even when the strings match, because nothing links `users` to `members` in this schema.
  it("does not treat a user id and an identical member id as a duplicate", () => {
    expect(
      participantsSchema.safeParse([
        { kind: "user", userId: A_USER },
        { kind: "member", memberId: A_USER },
      ]).success,
    ).toBe(true);
  });

  // Two people can genuinely both be "a neighbour", and migration 046 has no unique index on
  // `label` for the same reason.
  it("allows the same typed name twice", () => {
    expect(
      participantsSchema.safeParse([
        { kind: "label", label: "A neighbour" },
        { kind: "label", label: "A neighbour" },
      ]).success,
    ).toBe(true);
  });
});
