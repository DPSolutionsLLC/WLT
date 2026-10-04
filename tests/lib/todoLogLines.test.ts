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
      "Somebody else was chosen — this ask is no longer needed",
    );
  });

  // Sacrament slice f2b. `taken_over` names the PREVIOUS owner, `talk_off` the Sunday in words.
  it("says where a handed-over ask came from, and what happened when its talk went off", () => {
    expect(describeLogEntry({ kind: "taken_over", body: "Peter Nakamura" })).toBe(
      "Taken over from Peter Nakamura",
    );
    expect(describeLogEntry({ kind: "talk_off", body: "Sunday, October 11, 2026" })).toBe(
      "Cancelled for Sunday, October 11, 2026 — let them know they're not needed",
    );
    expect(describeLogEntry({ kind: "told_not_needed", body: null })).toBe(
      "Told them they're not needed",
    );
    expect(describeLogEntry({ kind: "talk_back_on", body: null })).toBe(
      "The talk is back on — finalize speakers to ask again",
    );
  });

  // ITER-036 (migration 088): an ask somebody had worked on, closed when its decision reopened.
  it("says an ask was closed because its decision was reopened", () => {
    expect(describeLogEntry({ kind: "unfinalized", body: null })).toBe(
      "The decision was reopened — this ask is closed",
    );
  });

  // ITER-038 (migration 089d): a Sunday's music. A send-back quotes the conductor's note.
  it("says where a Sunday's music went, quoting a send-back's note", () => {
    expect(describeLogEntry({ kind: "music_submitted", body: null })).toBe(
      "Music submitted for review",
    );
    expect(describeLogEntry({ kind: "music_approved", body: null })).toBe("Music approved");
    expect(describeLogEntry({ kind: "music_sent_back", body: "Swap the closing hymn." })).toBe(
      "Sent back: Swap the closing hymn.",
    );
    expect(describeLogEntry({ kind: "music_reopened", body: null })).toBe(
      "The music changed — this review is no longer needed",
    );
    expect(describeLogEntry({ kind: "meeting_cancelled", body: null })).toBe(
      "No sacrament meeting this Sunday any more",
    );
  });
});
