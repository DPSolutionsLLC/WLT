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

  // Sacrament slice f. `ask_declined`'s body is the REASON LABEL, never the free-text note.
  it("says what a talk's ask was answered or closed with", () => {
    expect(describeLogEntry({ kind: "ask_accepted", body: null })).toBe("Accepted");
    expect(describeLogEntry({ kind: "ask_declined", body: "Not available" })).toBe(
      "Declined — Not available",
    );
    expect(describeLogEntry({ kind: "ask_declined", body: null })).toBe("Declined");
    expect(describeLogEntry({ kind: "handed_over", body: "Brother Diaz" })).toBe(
      "Handed over to Brother Diaz",
    );
    expect(describeLogEntry({ kind: "assistant_released", body: null })).toBe(
      "No longer assisting this Sunday",
    );
    expect(describeLogEntry({ kind: "speaker_changed", body: null })).toBe(
      "Speaker changed — this ask is closed",
    );
  });
});
