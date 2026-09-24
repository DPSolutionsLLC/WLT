import { describe, expect, it } from "vitest";
import { compareTodos, todoViewState } from "@/lib/todos/viewState";

// Pure. `today` is always passed, never read from a clock, so every branch is pinned.

const TODAY = "2026-09-24";
const ZONE = "America/Denver";

type Dated = {
  completedAt: string | null;
  doDate: string | null;
  dueDate: string | null;
  scheduledFor: string | null;
  createdAt: string;
};

function todo(overrides: Partial<Dated> = {}): Dated {
  return {
    completedAt: null,
    doDate: null,
    dueDate: null,
    scheduledFor: null,
    createdAt: "2026-09-01T12:00:00.000Z",
    ...overrides,
  };
}

describe("todoViewState", () => {
  it("is done once completed, whatever its dates say", () => {
    expect(
      todoViewState(todo({ completedAt: "2026-09-20T12:00:00Z", dueDate: "2026-09-01" }), TODAY, ZONE),
    ).toBe("done");
  });

  it("is overdue when the due date has passed", () => {
    expect(todoViewState(todo({ dueDate: "2026-09-23" }), TODAY, ZONE)).toBe("overdue");
  });

  it("is due today on the due date", () => {
    expect(todoViewState(todo({ dueDate: TODAY }), TODAY, ZONE)).toBe("due_today");
  });

  it("is do today on the do date", () => {
    expect(todoViewState(todo({ doDate: TODAY }), TODAY, ZONE)).toBe("do_today");
  });

  it("stays do today after the do date has passed — an intention is never overdue", () => {
    expect(todoViewState(todo({ doDate: "2026-09-20" }), TODAY, ZONE)).toBe("do_today");
  });

  it("lets due beat do, because a missed deadline is the louder fact", () => {
    expect(todoViewState(todo({ doDate: TODAY, dueDate: "2026-09-23" }), TODAY, ZONE)).toBe("overdue");
    expect(todoViewState(todo({ doDate: "2026-09-20", dueDate: TODAY }), TODAY, ZONE)).toBe("due_today");
  });

  it("is upcoming when any date is in the future", () => {
    expect(todoViewState(todo({ doDate: "2026-09-30" }), TODAY, ZONE)).toBe("upcoming");
    expect(todoViewState(todo({ dueDate: "2026-09-30" }), TODAY, ZONE)).toBe("upcoming");
  });

  it("is someday with no dates", () => {
    expect(todoViewState(todo(), TODAY, ZONE)).toBe("someday");
  });
});

// "Schedule this" (p5-c, defect 077-D2). The scheduled INSTANT is read as the WARD's day.
describe("todoViewState with a scheduled time", () => {
  it("is upcoming, not someday, when scheduled for a later day", () => {
    expect(todoViewState(todo({ scheduledFor: "2026-09-26T01:30:00.000Z" }), TODAY, ZONE)).toBe(
      "upcoming",
    );
  });

  // 7:30pm Denver on the 24th is 01:30 UTC on the 25th — a UTC day would call it tomorrow.
  it("is do today when scheduled for this evening in the ward's zone", () => {
    expect(todoViewState(todo({ scheduledFor: "2026-09-25T01:30:00.000Z" }), TODAY, ZONE)).toBe(
      "do_today",
    );
  });

  it("is overdue once the scheduled day has passed and it is not done", () => {
    expect(todoViewState(todo({ scheduledFor: "2026-09-18T16:00:00.000Z" }), TODAY, ZONE)).toBe(
      "overdue",
    );
  });

  it("is done when completed, even with a past scheduled time", () => {
    expect(
      todoViewState(
        todo({ scheduledFor: "2026-09-18T16:00:00.000Z", completedAt: "2026-09-18T18:00:00Z" }),
        TODAY,
        ZONE,
      ),
    ).toBe("done");
  });
});

describe("compareTodos", () => {
  const sort = (items: Dated[]) => [...items].sort((a, b) => compareTodos(a, b, TODAY, ZONE));

  it("orders open items overdue, due today, do today, upcoming, someday", () => {
    const someday = todo();
    const upcoming = todo({ dueDate: "2026-10-01" });
    const doToday = todo({ doDate: TODAY });
    const dueToday = todo({ dueDate: TODAY });
    const overdue = todo({ dueDate: "2026-09-01" });

    expect(sort([someday, upcoming, doToday, dueToday, overdue])).toEqual([
      overdue,
      dueToday,
      doToday,
      upcoming,
      someday,
    ]);
  });

  it("puts every open item before every done one", () => {
    const doneItem = todo({ completedAt: "2026-09-24T10:00:00Z", dueDate: "2026-09-01" });
    const someday = todo();

    expect(sort([doneItem, someday])).toEqual([someday, doneItem]);
  });

  it("orders done items most recently completed first", () => {
    const earlier = todo({ completedAt: "2026-09-20T10:00:00Z" });
    const later = todo({ completedAt: "2026-09-23T10:00:00Z" });

    expect(sort([earlier, later])).toEqual([later, earlier]);
  });

  it("within a state, orders by the earlier of the two dates, undated last", () => {
    const soon = todo({ doDate: "2026-09-26", dueDate: "2026-10-30" });
    const later = todo({ dueDate: "2026-09-28" });

    expect(sort([later, soon])).toEqual([soon, later]);
  });

  it("falls back to creation order", () => {
    const first = todo({ createdAt: "2026-09-01T00:00:00Z" });
    const second = todo({ createdAt: "2026-09-02T00:00:00Z" });

    expect(sort([second, first])).toEqual([first, second]);
  });
});
