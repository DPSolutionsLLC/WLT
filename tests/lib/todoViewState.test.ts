import { describe, expect, it } from "vitest";
import { compareTodos, todoViewState } from "@/lib/todos/viewState";

// Pure. `today` is always passed, never read from a clock, so every branch is pinned.

const TODAY = "2026-09-24";

type Dated = {
  completedAt: string | null;
  doDate: string | null;
  dueDate: string | null;
  createdAt: string;
};

function todo(overrides: Partial<Dated> = {}): Dated {
  return {
    completedAt: null,
    doDate: null,
    dueDate: null,
    createdAt: "2026-09-01T12:00:00.000Z",
    ...overrides,
  };
}

describe("todoViewState", () => {
  it("is done once completed, whatever its dates say", () => {
    expect(
      todoViewState(todo({ completedAt: "2026-09-20T12:00:00Z", dueDate: "2026-09-01" }), TODAY),
    ).toBe("done");
  });

  it("is overdue when the due date has passed", () => {
    expect(todoViewState(todo({ dueDate: "2026-09-23" }), TODAY)).toBe("overdue");
  });

  it("is due today on the due date", () => {
    expect(todoViewState(todo({ dueDate: TODAY }), TODAY)).toBe("due_today");
  });

  it("is do today on the do date", () => {
    expect(todoViewState(todo({ doDate: TODAY }), TODAY)).toBe("do_today");
  });

  it("stays do today after the do date has passed — an intention is never overdue", () => {
    expect(todoViewState(todo({ doDate: "2026-09-20" }), TODAY)).toBe("do_today");
  });

  it("lets due beat do, because a missed deadline is the louder fact", () => {
    expect(todoViewState(todo({ doDate: TODAY, dueDate: "2026-09-23" }), TODAY)).toBe("overdue");
    expect(todoViewState(todo({ doDate: "2026-09-20", dueDate: TODAY }), TODAY)).toBe("due_today");
  });

  it("is upcoming when any date is in the future", () => {
    expect(todoViewState(todo({ doDate: "2026-09-30" }), TODAY)).toBe("upcoming");
    expect(todoViewState(todo({ dueDate: "2026-09-30" }), TODAY)).toBe("upcoming");
  });

  it("is someday with no dates", () => {
    expect(todoViewState(todo(), TODAY)).toBe("someday");
  });
});

describe("compareTodos", () => {
  const sort = (items: Dated[]) => [...items].sort((a, b) => compareTodos(a, b, TODAY));

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
