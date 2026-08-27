import { describe, expect, it } from "vitest";
import { addCadence, subtractCadence } from "@/lib/visits/cadence";
import type { Cadence } from "@/lib/visits/cadence";
import {
  compareByPriority,
  householdVisitPriority,
  priorityRank,
  type VisitPriority,
} from "@/lib/visits/householdStatus";
import { VISIT_PRIORITY_BANDS } from "@/types/domain";

// EVERY BOUNDARY IS BUILT FROM THE ARITHMETIC, NEVER FROM A TRANSCRIBED DATE.
//
// plans/retros/visits-b-progress-dashboard.md records that the plan's own 80% dates were a day or
// two out, so the suite that transcribed them was quietly checking 80.3%. Here, `addCadence` and
// `subtractCadence` compute the boundary and the test asserts what happens ON it and either side
// of it — so the test cannot drift from the function without the function being wrong.

const YEAR: Cadence = { amount: 1, unit: "year" };
const TWO_MONTHS: Cadence = { amount: 2, unit: "month" };

// A UTC-midnight Date for a YYYY-MM-DD day, so `asOf` and the date-only strings agree.
function at(day: string): Date {
  return new Date(`${day}T00:00:00.000Z`);
}

function priority(
  lastCompletedOn: string | null,
  asOfDay: string,
  cadence: Cadence = YEAR,
  notice: Cadence = TWO_MONTHS,
): VisitPriority {
  return householdVisitPriority({
    lastCompletedOn,
    cadence,
    cadenceSource: "goal",
    notice,
    asOf: at(asOfDay),
  });
}

describe("householdVisitPriority — the four bands and their boundaries", () => {
  const lastVisit = "2025-06-15";
  const dueOn = addCadence(lastVisit, YEAR); // 2026-06-15
  const noticeStartsOn = subtractCadence(dueOn, TWO_MONTHS); // 2026-04-15

  it("is on_track well before the notice window opens", () => {
    const result = priority(lastVisit, "2025-08-01");
    expect(result.band).toBe("on_track");
    expect(result.dueOn).toBe(dueOn);
  });

  it("is on_track on the day BEFORE the notice window opens", () => {
    expect(priority(lastVisit, subtractCadence(noticeStartsOn, { amount: 1, unit: "day" })).band)
      .toBe("on_track");
  });

  it("is approaching ON the day the notice window opens", () => {
    expect(priority(lastVisit, noticeStartsOn).band).toBe("approaching");
  });

  it("is approaching on the day BEFORE it is due", () => {
    expect(priority(lastVisit, subtractCadence(dueOn, { amount: 1, unit: "day" })).band)
      .toBe("approaching");
  });

  // The due date is INCLUSIVE of overdue: a household due today is due today, not tomorrow.
  it("is overdue ON the due date", () => {
    expect(priority(lastVisit, dueOn).band).toBe("overdue");
  });

  it("is overdue after the due date", () => {
    expect(priority(lastVisit, addCadence(dueOn, { amount: 1, unit: "day" })).band)
      .toBe("overdue");
  });
});

describe("householdVisitPriority — never_visited", () => {
  it("reports never_visited with no fraction and no due date", () => {
    const result = priority(null, "2026-08-26");

    expect(result.band).toBe("never_visited");
    expect(result.elapsedFraction).toBeNull();
    expect(result.dueOn).toBeNull();
  });

  // ITER-018 Decision 3. A family nobody has ever visited is a different problem from one visited
  // thirteen months ago, and it has no anchor to measure a fraction from at all — so it is its
  // own top state rather than an overdue row with a missing number.
  it("outranks overdue", () => {
    const never = priority(null, "2026-08-26");
    const overdue = priority("2020-01-01", "2026-08-26");

    expect(overdue.band).toBe("overdue");
    expect(priorityRank(never)).toBeLessThan(priorityRank(overdue));
  });

  it("is the first band in the declared order, which IS the rank", () => {
    expect(VISIT_PRIORITY_BANDS[0]).toBe("never_visited");
    expect(priorityRank(priority(null, "2026-08-26"))).toBe(0);
  });
});

describe("householdVisitPriority — the notice clamp", () => {
  // A notice window as long as the cadence would make EVERY household read "approaching", which
  // is a dashboard that has stopped saying anything. The window is ignored instead: every
  // household is on_track or overdue. Under-warning is recoverable; flagging everything is not.
  it("produces NO approaching row when the notice equals the cadence", () => {
    const lastVisit = "2026-01-01";

    for (const day of ["2026-01-02", "2026-04-01", "2026-06-30", "2026-12-31"]) {
      expect(priority(lastVisit, day, YEAR, { amount: 12, unit: "month" }).band).not.toBe(
        "approaching",
      );
    }
  });

  it("produces NO approaching row when the notice is longer than the cadence", () => {
    expect(
      priority("2026-01-01", "2026-06-01", { amount: 6, unit: "month" }, YEAR).band,
    ).toBe("on_track");
  });

  it("still reports overdue with the window ignored", () => {
    expect(
      priority("2024-01-01", "2026-08-26", YEAR, { amount: 12, unit: "month" }).band,
    ).toBe("overdue");
  });
});

describe("householdVisitPriority — elapsedFraction", () => {
  it("is floored at 0 for a lastCompletedOn in the future", () => {
    // Clock skew between the database and the browser. "0% elapsed" is the honest reading; a
    // negative fraction would sort a future visit ahead of an overdue one.
    const result = priority("2027-01-01", "2026-08-26");
    expect(result.elapsedFraction).toBe(0);
    expect(result.band).toBe("on_track");
  });

  it("is roughly a half at the midpoint of the interval", () => {
    // Half of a 100-day cadence, computed rather than transcribed.
    const cadence: Cadence = { amount: 100, unit: "day" };
    const result = priority("2026-01-01", addCadence("2026-01-01", { amount: 50, unit: "day" }), cadence, {
      amount: 1,
      unit: "day",
    });

    expect(result.elapsedFraction).toBeCloseTo(0.5, 10);
  });

  // NOT CLAMPED ABOVE 1. 1.4 means 40% past due, and the badge and the sort both read it — which
  // is the whole point of the redesign: a household at 95% and one at 10% no longer read the same.
  it("exceeds 1 when overdue", () => {
    const cadence: Cadence = { amount: 100, unit: "day" };
    const result = priority("2026-01-01", addCadence("2026-01-01", { amount: 140, unit: "day" }), cadence, {
      amount: 1,
      unit: "day",
    });

    expect(result.band).toBe("overdue");
    expect(result.elapsedFraction).toBeCloseTo(1.4, 10);
  });
});

describe("householdVisitPriority — a household override", () => {
  // The single most important behaviour in this slice: the SAME household, the SAME last visit,
  // a different cadence, a different answer — and `cadenceSource` says which cadence produced it.
  const lastVisit = "2026-05-01";
  const asOfDay = "2026-08-26";

  it("reads on_track against the organization's yearly goal", () => {
    const result = priority(lastVisit, asOfDay, YEAR);
    expect(result.band).toBe("on_track");
    expect(result.cadenceSource).toBe("goal");
  });

  it("reads overdue against a three-month household override, with the goal unchanged", () => {
    const result = householdVisitPriority({
      lastCompletedOn: lastVisit,
      cadence: { amount: 3, unit: "month" },
      cadenceSource: "household",
      notice: { amount: 2, unit: "week" },
      asOf: at(asOfDay),
    });

    expect(result.band).toBe("overdue");
    expect(result.cadenceSource).toBe("household");
    expect(result.cadence).toEqual({ amount: 3, unit: "month" });
  });
});

describe("priorityRank and compareByPriority", () => {
  it("ranks null last, covering no-goal and do-not-contact alike", () => {
    expect(priorityRank(null)).toBe(VISIT_PRIORITY_BANDS.length);
    expect(priorityRank(priority("2020-01-01", "2026-08-26"))).toBeLessThan(priorityRank(null));
  });

  it("puts the most-overdue household first inside the overdue band", () => {
    const cadence: Cadence = { amount: 100, unit: "day" };
    const notice: Cadence = { amount: 1, unit: "day" };

    // Both overdue; the first is further past due.
    const veryOverdue = {
      familyName: "Zulu",
      priority: priority("2026-01-01", "2026-06-01", cadence, notice),
    };
    const justOverdue = {
      familyName: "Alpha",
      priority: priority("2026-02-20", "2026-06-01", cadence, notice),
    };

    expect(veryOverdue.priority.band).toBe("overdue");
    expect(justOverdue.priority.band).toBe("overdue");

    // Alphabetically Alpha would lead. The fraction is what puts Zulu first.
    expect([justOverdue, veryOverdue].sort(compareByPriority)[0]).toBe(veryOverdue);
  });

  it("falls back to family name when the fractions match", () => {
    const left = { familyName: "Brooks", priority: priority("2026-01-01", "2026-03-01") };
    const right = { familyName: "Andrade", priority: priority("2026-01-01", "2026-03-01") };

    expect([left, right].sort(compareByPriority)[0]).toBe(right);
  });

  it("orders the bands never_visited, overdue, approaching, on_track", () => {
    const rows = [
      { familyName: "d", priority: priority("2026-08-01", "2026-08-26") },
      { familyName: "c", priority: priority("2025-09-30", "2026-08-26") },
      { familyName: "b", priority: priority("2020-01-01", "2026-08-26") },
      { familyName: "a", priority: priority(null, "2026-08-26") },
    ];

    expect(rows.sort(compareByPriority).map((row) => row.priority.band)).toEqual([
      "never_visited",
      "overdue",
      "approaching",
      "on_track",
    ]);
  });
});
