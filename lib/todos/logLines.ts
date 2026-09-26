import type { TodoLogEntry } from "@/types/domain";

// The sentence a timeline line renders. A written note is its own text; every other kind is an
// automatic line, and a step kind quotes the label as it was when the step was checked.
//
// Exhaustive: a kind added to TODO_LOG_KINDS without a sentence here is a compile error.
export function describeLogEntry(entry: Pick<TodoLogEntry, "kind" | "body">): string {
  switch (entry.kind) {
    case "note":
      return entry.body ?? "";
    case "step_done":
      return `Checked off "${entry.body ?? ""}"`;
    case "step_undone":
      return `Unchecked "${entry.body ?? ""}"`;
    case "completed":
      return "Marked complete";
    case "reopened":
      return "Reopened";
    case "scheduled":
      return "Scheduled";
    case "unscheduled":
      return "Unscheduled";
    case "source_completed":
      return "Marked complete on the agenda";
    case "ask_accepted":
      return "Accepted";
    case "ask_declined":
      return entry.body === null ? "Declined" : `Declined — ${entry.body}`;
    case "handed_over":
      return entry.body === null ? "Handed over" : `Handed over to ${entry.body}`;
    case "assistant_released":
      return "No longer assisting this Sunday";
    case "speaker_changed":
      return "Speaker changed — this ask is closed";
    default: {
      const unhandled: never = entry.kind;
      throw new Error(`No sentence for to-do log kind "${String(unhandled)}".`);
    }
  }
}
