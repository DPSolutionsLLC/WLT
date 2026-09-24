import { describe, expect, it } from "vitest";
import { isTodoUntouched } from "@/lib/todos/untouched";

// "Untouched" decides whether reassigning an agenda item may DELETE the old assignee's to-do
// (slice p5-b). Each of the four conditions alone must make it touched — otherwise something a
// person did could be destroyed.

const pristine = { completedAt: null, scheduledFor: null };

describe("isTodoUntouched", () => {
  it("is untouched with nothing done to it", () => {
    expect(isTodoUntouched(pristine, 0, 0)).toBe(true);
  });

  it("is touched by a step", () => {
    expect(isTodoUntouched(pristine, 1, 0)).toBe(false);
  });

  it("is touched by a log line", () => {
    expect(isTodoUntouched(pristine, 0, 1)).toBe(false);
  });

  it("is touched by completing it", () => {
    expect(isTodoUntouched({ ...pristine, completedAt: "2026-09-24T10:00:00Z" }, 0, 0)).toBe(false);
  });

  it("is touched by scheduling it", () => {
    expect(isTodoUntouched({ ...pristine, scheduledFor: "2026-09-25T01:30:00Z" }, 0, 0)).toBe(false);
  });
});
