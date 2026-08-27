import { describe, expect, it } from "vitest";
import { formatDateOnly } from "@/lib/calendar/dates";
import {
  createVisitGoalSchema,
  createVisitLogSchema,
  MAX_CADENCE_BY_UNIT,
  setHouseholdVisitCadenceSchema,
  updateVisitGoalSchema,
  updateVisitLogSchema,
  upsertPrivateNoteSchema,
} from "@/lib/validation/visit";

// Pure and fast — no database, no network. These are the refusals that keep a row out of the
// table rather than the ones RLS makes, so they are worth having as unit tests: a goal whose
// warning window swallows its own cadence, or a visit dated next month, would insert perfectly
// happily.

const HOUSEHOLD_ID = "11111111-1111-4111-8111-111111111111";
const ORG_ID = "22222222-2222-4222-8222-222222222222";

function goal(overrides: Record<string, unknown> = {}) {
  return {
    title: "Visit every household",
    orgId: ORG_ID,
    targetType: "all_households",
    cadenceAmount: 1,
    cadenceUnit: "year",
    noticeAmount: 2,
    noticeUnit: "month",
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
  it("accepts a goal with a cadence, a notice window and no dates at all", () => {
    expect(createVisitGoalSchema.safeParse(goal()).success).toBe(true);
  });

  it("accepts every unit for both the cadence and the notice window", () => {
    for (const unit of ["day", "week", "month", "year"] as const) {
      expect(
        createVisitGoalSchema.safeParse(
          goal({ cadenceAmount: 10, cadenceUnit: unit, noticeAmount: 1, noticeUnit: "day" }),
        ).success,
      ).toBe(true);
    }
  });

  // A deadline is PRESENTATION ONLY (ITER-018 Decision 1). It is not related to the cadence, and
  // one in the past is a legitimate record of a deadline that passed rather than an error.
  it("accepts a goal with no deadline", () => {
    expect(createVisitGoalSchema.safeParse(goal({ deadline: null })).success).toBe(true);
    expect(createVisitGoalSchema.safeParse(goal()).success).toBe(true);
  });

  it("accepts a deadline in the past", () => {
    expect(createVisitGoalSchema.safeParse(goal({ deadline: "2020-01-01" })).success).toBe(true);
  });

  it("refuses a deadline that is not YYYY-MM-DD", () => {
    expect(createVisitGoalSchema.safeParse(goal({ deadline: "01/01/2026" })).success).toBe(false);
  });

  // THE ONE REFINEMENT THIS SLICE ADDS. A notice window as long as the cadence makes every
  // household permanently "approaching", which is a dashboard that has stopped saying anything.
  it("refuses a notice window equal to the cadence", () => {
    const result = createVisitGoalSchema.safeParse(
      goal({ noticeAmount: 12, noticeUnit: "month" }),
    );

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toContain("shorter than the cadence");
    expect(result.error?.issues[0]?.path).toEqual(["noticeAmount"]);
  });

  it("refuses a notice window longer than the cadence", () => {
    expect(
      createVisitGoalSchema.safeParse(
        goal({ cadenceAmount: 6, cadenceUnit: "month", noticeAmount: 1, noticeUnit: "year" }),
      ).success,
    ).toBe(false);
  });

  // PROVES THE CHECK USES compareCadences() AND NOT A DAY APPROXIMATION. Two months is 59, 60 or
  // 61 days depending on where you start, so a day conversion would have to pick one — and
  // whichever it picked, this pair would come out equal or the wrong way round. Projected from a
  // fixed anchor, 2 months is longer than 60 days, so this is refused.
  it("refuses a 2-month notice against a 60-day cadence", () => {
    expect(
      createVisitGoalSchema.safeParse(
        goal({ cadenceAmount: 60, cadenceUnit: "day", noticeAmount: 2, noticeUnit: "month" }),
      ).success,
    ).toBe(false);
  });

  it("accepts a 1-month notice against a 60-day cadence", () => {
    expect(
      createVisitGoalSchema.safeParse(
        goal({ cadenceAmount: 60, cadenceUnit: "day", noticeAmount: 1, noticeUnit: "month" }),
      ).success,
    ).toBe(true);
  });

  it("refuses a zero-length interval, which would be overdue the moment it was saved", () => {
    expect(createVisitGoalSchema.safeParse(goal({ cadenceAmount: 0 })).success).toBe(false);
    expect(createVisitGoalSchema.safeParse(goal({ noticeAmount: 0 })).success).toBe(false);
  });

  it("refuses a fractional interval", () => {
    expect(createVisitGoalSchema.safeParse(goal({ cadenceAmount: 1.5 })).success).toBe(false);
  });

  // A typo cannot produce an interval nobody will live to see, and the ceiling is per-unit so the
  // message names the unit the person is actually typing in.
  it("enforces each unit's own ceiling", () => {
    for (const unit of ["day", "week", "month", "year"] as const) {
      const ceiling = MAX_CADENCE_BY_UNIT[unit];

      expect(
        createVisitGoalSchema.safeParse(
          goal({ cadenceAmount: ceiling, cadenceUnit: unit, noticeAmount: 1, noticeUnit: "day" }),
        ).success,
      ).toBe(true);

      const over = createVisitGoalSchema.safeParse(
        goal({ cadenceAmount: ceiling + 1, cadenceUnit: unit, noticeAmount: 1, noticeUnit: "day" }),
      );

      expect(over.success).toBe(false);
      expect(over.error?.issues.some((issue) => issue.message.includes(unit))).toBe(true);
    }
  });

  it("refuses a unit that is not one of the four", () => {
    expect(createVisitGoalSchema.safeParse(goal({ cadenceUnit: "fortnight" })).success)
      .toBe(false);
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

  // No schema in this file accepts a wardId — it comes from the session, always
  // (conventions.md §Validation). A schema that accepted one is a schema somebody will
  // eventually trust.
  it("strips a wardId rather than honouring it", () => {
    const result = createVisitGoalSchema.safeParse(goal({ wardId: ORG_ID }));

    expect(result.success).toBe(true);
    expect(result.data).not.toHaveProperty("wardId");
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

  it("accepts clearing the deadline", () => {
    expect(updateVisitGoalSchema.safeParse({ deadline: null }).success).toBe(true);
  });

  // The same refinement as the create schema, so a patch that is incoherent ON ITS OWN is refused
  // here. A PARTIAL patch cannot be checked against fields the request never sent — that
  // merge-and-recheck lives in app/api/visit-goals/[id]/route.ts.
  it("refuses a patch whose own cadence and notice disagree", () => {
    const result = updateVisitGoalSchema.safeParse({
      cadenceAmount: 3,
      cadenceUnit: "month",
      noticeAmount: 3,
      noticeUnit: "month",
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toContain("shorter than the cadence");
  });

  it("refuses a 2-month notice against a 60-day cadence in a patch too", () => {
    expect(
      updateVisitGoalSchema.safeParse({
        cadenceAmount: 60,
        cadenceUnit: "day",
        noticeAmount: 2,
        noticeUnit: "month",
      }).success,
    ).toBe(false);
  });

  it("lets a half-specified patch through for the route to re-check", () => {
    // Only the notice window. There is nothing here to compare it against, so the schema cannot
    // and must not guess — the route merges it with the stored row.
    expect(
      updateVisitGoalSchema.safeParse({ noticeAmount: 11, noticeUnit: "month" }).success,
    ).toBe(true);
  });

  it("enforces the per-unit ceiling on a patch", () => {
    expect(
      updateVisitGoalSchema.safeParse({ cadenceAmount: 11, cadenceUnit: "year" }).success,
    ).toBe(false);
  });
});

describe("setHouseholdVisitCadenceSchema", () => {
  it("accepts an amount, a unit and an organization", () => {
    expect(
      setHouseholdVisitCadenceSchema.safeParse({
        orgId: ORG_ID,
        cadenceAmount: 3,
        cadenceUnit: "month",
      }).success,
    ).toBe(true);
  });

  // Absent orgId is the org leader's case: the route stamps `user.orgId`. Only the bishopric has
  // to name one, and the ROUTE is what requires it of them.
  it("accepts an absent organization", () => {
    expect(
      setHouseholdVisitCadenceSchema.safeParse({ cadenceAmount: 3, cadenceUnit: "month" })
        .success,
    ).toBe(true);
  });

  it("refuses a zero amount and an unknown unit", () => {
    expect(
      setHouseholdVisitCadenceSchema.safeParse({ cadenceAmount: 0, cadenceUnit: "month" })
        .success,
    ).toBe(false);
    expect(
      setHouseholdVisitCadenceSchema.safeParse({ cadenceAmount: 3, cadenceUnit: "decade" })
        .success,
    ).toBe(false);
  });

  it("enforces the per-unit ceiling", () => {
    expect(
      setHouseholdVisitCadenceSchema.safeParse({ cadenceAmount: 11, cadenceUnit: "year" })
        .success,
    ).toBe(false);
  });

  // There is no householdId in the body — it is the route's path parameter — and no wardId.
  it("strips a householdId and a wardId rather than honouring them", () => {
    const result = setHouseholdVisitCadenceSchema.safeParse({
      orgId: ORG_ID,
      cadenceAmount: 3,
      cadenceUnit: "month",
      householdId: HOUSEHOLD_ID,
      wardId: ORG_ID,
    });

    expect(result.success).toBe(true);
    expect(result.data).not.toHaveProperty("householdId");
    expect(result.data).not.toHaveProperty("wardId");
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
