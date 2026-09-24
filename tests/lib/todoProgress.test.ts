import { describe, expect, it } from "vitest";
import { todoProgress } from "@/lib/todos/progress";

// Progress is computed from steps and never stored. A plain item — zero steps — shows nothing at
// all, so the function answers null rather than "0/0".

const done = { doneAt: "2026-09-24T18:00:00.000Z" };
const open = { doneAt: null };

describe("todoProgress", () => {
  it("is null for a plain item with no steps", () => {
    expect(todoProgress([])).toBeNull();
  });

  it("counts 0 of 3", () => {
    expect(todoProgress([open, open, open])).toEqual({ done: 0, total: 3, fraction: 0 });
  });

  it("counts 2 of 3", () => {
    expect(todoProgress([done, open, done])).toEqual({ done: 2, total: 3, fraction: 2 / 3 });
  });

  it("counts 3 of 3", () => {
    expect(todoProgress([done, done, done])).toEqual({ done: 3, total: 3, fraction: 1 });
  });
});
