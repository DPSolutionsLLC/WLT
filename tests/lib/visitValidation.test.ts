import { describe, expect, it } from "vitest";
import { formatDateOnly } from "@/lib/calendar/dates";
import {
  CADENCE_MONTHS,
  createVisitGoalSchema,
  createVisitLogSchema,
  updateVisitGoalSchema,
  updateVisitLogSchema,
  upsertPrivateNoteSchema,
} from "@/lib/validation/visit";

// Pure and fast — no database, no network. These are the refusals that keep a row out of the
// table rather than the ones RLS makes, so they are worth having as unit tests: a goal with an
// incoherent cadence or a visit dated next month would insert perfectly happily.

const HOUSEHOLD_ID = "11111111-1111-4111-8111-111111111111";
const ORG_ID = "22222222-2222-4222-8222-222222222222";

function goal(overrides: Record<string, unknown> = {}) {
  return {
    title: "Visit every household this year",
    orgId: ORG_ID,
    targetType: "all_households",
    cadence: "annual",
    goalPeriodStart: "2026-01-01",
    goalPeriodEnd: "2026-12-31",
    ...overrides,
  };
}

function visit(overrides: Record<string, unknown> = {}) {
  return {
    householdId: HOUSEHOLD_ID,
    visitDate: "2026-03-01",
    visitType: "in_home",
    ...overrides,
  };
}

describe("createVisitGoalSchema", () => {
  it("accepts an annual goal with no month count", () => {
    expect(createVisitGoalSchema.safeParse(goal()).success).toBe(true);
  });

  it("refuses a custom cadence with no month count", () => {
    const result = createVisitGoalSchema.safeParse(goal({ cadence: "custom" }));

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toContain("number of months");
  });

  it("accepts a custom cadence that carries its month count", () => {
    const result = createVisitGoalSchema.safeParse(
      goal({ cadence: "custom", cadenceMonths: 3 }),
    );

    expect(result.success).toBe(true);
  });

  // Two sources of truth for one interval is the bug this stops: a goal that says "annual"
  // while a stale month count quietly drives the arithmetic.
  it("refuses a month count alongside a named cadence", () => {
    const result = createVisitGoalSchema.safeParse(
      goal({ cadence: "biannual", cadenceMonths: 3 }),
    );

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toContain("already sets its own interval");
  });

  it("refuses a period that ends before it starts", () => {
    const result = createVisitGoalSchema.safeParse(
      goal({ goalPeriodStart: "2026-12-31", goalPeriodEnd: "2026-01-01" }),
    );

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toContain("end after it starts");
  });

  it("refuses a period that ends on the day it starts", () => {
    const result = createVisitGoalSchema.safeParse(
      goal({ goalPeriodStart: "2026-06-01", goalPeriodEnd: "2026-06-01" }),
    );

    expect(result.success).toBe(false);
  });

  // §Decision 2. `specific_households` and `custom` stay in migration 008's CHECK so an existing
  // row still reads back, and are refused HERE so no new one can be created that nothing in the
  // schema could resolve to a set of households.
  it("refuses specific_households on create", () => {
    expect(createVisitGoalSchema.safeParse(goal({ targetType: "specific_households" })).success)
      .toBe(false);
  });

  it("refuses custom targeting on create", () => {
    expect(createVisitGoalSchema.safeParse(goal({ targetType: "custom" })).success).toBe(false);
  });

  it("refuses a date that is not YYYY-MM-DD", () => {
    expect(createVisitGoalSchema.safeParse(goal({ goalPeriodStart: "01/01/2026" })).success)
      .toBe(false);
  });
});

describe("updateVisitGoalSchema", () => {
  it("refuses an empty patch", () => {
    const result = updateVisitGoalSchema.safeParse({});

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe("Nothing was changed.");
  });

  it("accepts a title-only patch", () => {
    expect(updateVisitGoalSchema.safeParse({ title: "New title" }).success).toBe(true);
  });

  // The schema cannot check a partial period against a start the request never sent. That
  // merge-and-recheck lives in the route; what the schema owns is a body that is incoherent
  // ON ITS OWN.
  it("refuses a patch whose own two dates disagree", () => {
    const result = updateVisitGoalSchema.safeParse({
      goalPeriodStart: "2026-12-01",
      goalPeriodEnd: "2026-01-01",
    });

    expect(result.success).toBe(false);
  });
});

describe("createVisitLogSchema", () => {
  it("accepts a visit logged today", () => {
    const today = formatDateOnly(new Date());

    expect(createVisitLogSchema.safeParse(visit({ visitDate: today })).success).toBe(true);
  });

  it("refuses a visit dated in the future", () => {
    const result = createVisitLogSchema.safeParse(visit({ visitDate: "2999-01-01" }));

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toContain("in the future");
  });

  it("refuses a visit type outside the CHECK constraint", () => {
    expect(createVisitLogSchema.safeParse(visit({ visitType: "phone" })).success).toBe(false);
  });

  it("refuses a household id that is not a uuid", () => {
    expect(createVisitLogSchema.safeParse(visit({ householdId: "not-a-uuid" })).success)
      .toBe(false);
  });

  it("accepts a visit with no shared notes", () => {
    expect(createVisitLogSchema.safeParse(visit({ sharedNotes: null })).success).toBe(true);
  });
});

describe("updateVisitLogSchema", () => {
  it("refuses an empty patch", () => {
    expect(updateVisitLogSchema.safeParse({}).success).toBe(false);
  });

  it("accepts a flag-only patch", () => {
    expect(updateVisitLogSchema.safeParse({ flaggedForWardCouncil: true }).success).toBe(true);
  });

  // There is no `flagSentAt` on this schema and there must never be — a body that could stamp
  // its own would be able to silence the notification the flag exists to send.
  it("drops a flagSentAt somebody tried to send", () => {
    const result = updateVisitLogSchema.safeParse({
      flaggedForWardCouncil: true,
      flagSentAt: "2026-01-01T00:00:00Z",
    });

    expect(result.success).toBe(true);
    expect(result.data).not.toHaveProperty("flagSentAt");
  });
});

describe("upsertPrivateNoteSchema", () => {
  it("accepts a note", () => {
    expect(upsertPrivateNoteSchema.safeParse({ notes: "Follow up next month." }).success)
      .toBe(true);
  });

  it("refuses an empty note", () => {
    expect(upsertPrivateNoteSchema.safeParse({ notes: "" }).success).toBe(false);
  });

  it("refuses a note that is only whitespace", () => {
    expect(upsertPrivateNoteSchema.safeParse({ notes: "   \n\t " }).success).toBe(false);
  });

  // No userId, in the schema or anywhere below it. "Write somebody else's note" is not a
  // request this API can express (CLAUDE.md rule 5).
  it("drops a userId somebody tried to send", () => {
    const result = upsertPrivateNoteSchema.safeParse({
      notes: "Mine.",
      userId: "33333333-3333-4333-8333-333333333333",
    });

    expect(result.success).toBe(true);
    expect(result.data).not.toHaveProperty("userId");
  });
});

describe("CADENCE_MONTHS", () => {
  // visits-b's progress denominator reads these same two numbers. A test rather than a comment,
  // because the failure mode of a silent change is a dashboard that is quietly wrong.
  it("names twelve months for annual and six for biannual", () => {
    expect(CADENCE_MONTHS).toEqual({ annual: 12, biannual: 6 });
  });
});
