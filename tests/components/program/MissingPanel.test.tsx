import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MissingPanel, NOTHING_MISSING } from "@/app/(app)/program/[sunday_id]/MissingPanel";
import type { ProgramDraft, ProgramSpeaker } from "@/lib/program/draft";
import { messageFor, missingItems } from "@/lib/program/missingMessages";
import { MISSING_FIELD_KEYS, MISSING_FIELD_LABELS } from "@/types/domain";

// MISSING IS NOT AN ERROR STATE. A Thursday program with five gaps is the normal case
// (06-program-music.md §Step 2), and the single judgement no test can make is whether the panel
// FEELS like work remaining. What a test can do is rule out the shapes that guarantee it does
// not: a raw field name, a validation-summary word, an alert role.
//
// ONE AND SEVERAL, EVERY TIME. "all 1 of its passages" survived review because every fixture had
// exactly one of everything (plans/retros/ai-b-knowledge-and-retrieval.md). Every count in this
// suite is asserted with one and with several.

function speaker(slotNumber: number, filled: boolean): ProgramSpeaker {
  return filled
    ? {
        slotNumber,
        kind: "member",
        printedName: `Speaker ${slotNumber}`,
        publicName: `Speaker ${slotNumber}`,
        topic: null,
      }
    : { slotNumber, kind: "empty", printedName: null, publicName: null, topic: null };
}

function draft(overrides: Partial<ProgramDraft> = {}): ProgramDraft {
  return {
    version: 1,
    heading: null,
    date: "2026-09-20",
    sundayType: "standard",
    presiding: { printedName: "Mark Andersen", publicName: "Mark A." },
    conducting: { printedName: "Peter Lindqvist", publicName: "Peter L." },
    organist: null,
    chorister: null,
    openingHymn: { number: 19, title: "We Thank Thee, O God, for a Prophet" },
    invocation: { printedName: "David Brooks", publicName: "David B." },
    wardBusiness: null,
    sacramentHymn: null,
    specialNotes: null,
    musicalNumber: null,
    speakers: [speaker(1, true), speaker(2, false), speaker(3, false)],
    closingHymn: { number: 152, title: "God Be with You Till We Meet Again" },
    benediction: null,
    announcements: null,
    leadershipContacts: [],
    missionaries: null,
    missing: [],
    ...overrides,
  };
}

// The words that make a list read as a validation summary rather than as a checklist. If any of
// these reaches the panel, the feature has failed even though every sentence is technically
// correct.
const FAILURE_WORDS = [
  /error/i,
  /invalid/i,
  /required/i,
  /problem/i,
  /failed/i,
  /must be/i,
  /cannot be/i,
];

describe("MissingPanel — the sentences", () => {
  it("writes a sentence for every key, never the key itself", () => {
    // ONE open slot, so `speaker_slot` renders its singular sentence — the plural form is a
    // different string and is asserted on its own below.
    const { container } = render(
      <MissingPanel
        draft={draft({
          speakers: [speaker(1, true), speaker(2, false)],
          missing: [...MISSING_FIELD_KEYS],
        })}
      />,
    );

    for (const key of MISSING_FIELD_KEYS) {
      expect(screen.getByText(MISSING_FIELD_LABELS[key])).toBeInTheDocument();
    }

    // No snake_case anywhere. Every key that is not an ordinary English word carries an
    // underscore, so one underscore on screen is a column name reaching a bishop — calendar-b's
    // raw-uuid rule. `invocation` and `organist` cannot be caught that way, and are covered by
    // the sentence assertions above instead.
    expect(container.textContent).not.toContain("_");
  });

  // Driven off MISSING_FIELD_KEYS rather than a hand-written list, so a key added to the enum
  // fails HERE until somebody writes its sentence.
  it("has a written sentence for every key in the enum", () => {
    for (const key of MISSING_FIELD_KEYS) {
      const sentence = MISSING_FIELD_LABELS[key];

      expect(sentence.trim()).not.toBe("");
      expect(sentence).not.toContain("_");
    }
  });

  it("says nothing is needed rather than rendering an empty list", () => {
    render(<MissingPanel draft={draft({ missing: [] })} />);

    expect(screen.getByText(NOTHING_MISSING)).toBeInTheDocument();
    expect(screen.queryByRole("list")).toBeNull();
  });
});

describe("MissingPanel — one and several", () => {
  it("renders a single gap with a singular count line", () => {
    render(<MissingPanel draft={draft({ missing: ["sacrament_hymn"] })} />);

    expect(screen.getByText("1 thing still needed")).toBeInTheDocument();
    expect(
      screen.getByText(MISSING_FIELD_LABELS.sacrament_hymn),
    ).toBeInTheDocument();
  });

  it("renders several gaps with a plural count line", () => {
    render(
      <MissingPanel
        draft={draft({ missing: ["sacrament_hymn", "benediction", "announcements"] })}
      />,
    );

    expect(screen.getByText("3 things still needed")).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
  });
});

describe("MissingPanel — open speaking slots", () => {
  // ONE open slot. The singular path, which is the one a plural-only implementation breaks.
  it("reads one open slot in the singular", () => {
    render(
      <MissingPanel
        draft={draft({
          speakers: [speaker(1, true), speaker(2, true), speaker(3, false)],
          missing: ["speaker_slot"],
        })}
      />,
    );

    expect(screen.getByText(MISSING_FIELD_LABELS.speaker_slot)).toBeInTheDocument();
    expect(screen.queryByText(/1 speaking slots/)).toBeNull();
  });

  // TWO open slots, which is scenario 031's case: one line with a count, correctly pluralised.
  it("collapses two open slots into one correctly pluralised line", () => {
    render(<MissingPanel draft={draft({ missing: ["speaker_slot"] })} />);

    expect(screen.getByText("2 speaking slots are still open.")).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
  });

  // The stored array is jsonb a hand-edit or an AI edit could put a duplicate into. Two identical
  // sentences in a checklist read as a rendering fault.
  it("renders a duplicated key once", () => {
    const items = missingItems(
      draft({ missing: ["speaker_slot", "speaker_slot", "benediction"] }),
    );

    expect(items).toHaveLength(2);
    expect(items.filter((item) => item.key === "speaker_slot")).toHaveLength(1);
  });

  // A gap named with no empty slot to point at is still one thing needed. Falling to zero would
  // render "0 speaking slots are still open".
  it("never counts to zero", () => {
    expect(messageFor("speaker_slot", 1)).toBe(MISSING_FIELD_LABELS.speaker_slot);

    const items = missingItems(
      draft({
        speakers: [speaker(1, true)],
        missing: ["speaker_slot"],
      }),
    );

    expect(items[0]?.count).toBe(1);
  });
});

describe("MissingPanel — it does not read as a failure", () => {
  it("uses no alert role and no validation wording", () => {
    const { container } = render(
      <MissingPanel draft={draft({ missing: [...MISSING_FIELD_KEYS] })} />,
    );

    expect(container.querySelector('[role="alert"]')).toBeNull();

    const text = container.textContent ?? "";
    for (const word of FAILURE_WORDS) {
      expect(text).not.toMatch(word);
    }
  });

  // No field is ever the string "TBD" or "Not yet assigned" — a placeholder baked into the data
  // would be printed by program-d as though somebody had typed it.
  it("never says TBD or Not yet assigned", () => {
    const { container } = render(
      <MissingPanel draft={draft({ missing: [...MISSING_FIELD_KEYS] })} />,
    );

    expect(container.textContent).not.toMatch(/TBD/i);
    expect(container.textContent).not.toMatch(/not yet assigned/i);
  });
});
