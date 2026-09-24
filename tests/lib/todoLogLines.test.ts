import { describe, expect, it } from "vitest";
import { describeLogEntry } from "@/lib/todos/logLines";
import { TODO_LOG_KINDS } from "@/types/domain";

// Every kind the CHECK constraint allows must have a sentence. Looping over the tuple means a kind
// added to TODO_LOG_KINDS is covered here the moment it exists.

describe("describeLogEntry", () => {
  it.each(TODO_LOG_KINDS)("has a non-empty sentence for %s", (kind) => {
    expect(describeLogEntry({ kind, body: "Call the stake" }).trim()).not.toBe("");
  });

  it("renders a note as its own text", () => {
    expect(describeLogEntry({ kind: "note", body: "Left a message." })).toBe("Left a message.");
  });

  it("quotes the step label on a checked or unchecked step", () => {
    expect(describeLogEntry({ kind: "step_done", body: "Book the room" })).toBe(
      'Checked off "Book the room"',
    );
    expect(describeLogEntry({ kind: "step_undone", body: "Book the room" })).toBe(
      'Unchecked "Book the room"',
    );
  });

  it("names a completion on the agenda", () => {
    expect(describeLogEntry({ kind: "source_completed", body: null })).toBe(
      "Marked complete on the agenda",
    );
  });
});
