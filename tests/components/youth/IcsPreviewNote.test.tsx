// @vitest-environment jsdom
//
// leftAloneNote — the sentence the import preview puts on a row it is about to rewrite.
//
// ---------------------------------------------------------------------------
// WHY THIS HAS A TEST OF ITS OWN
// ---------------------------------------------------------------------------
// The first version of this note interpolated EVENT_TYPE_LABELS on both sides, and produced
// "this file would have set it to Home or away not set" — which typechecked, broke no test, and
// was caught only by reading the real screen during a walkthrough on 2026-08-28.
//
// That is the youth-b failure mode exactly: three copy defects shipped with a green suite. A
// label can be right on a chip standing alone and nonsense inside a clause, and nothing about the
// types can tell the difference. So the assertion below is about the SENTENCE, not the values:
// the `tbd` label must never appear in one.

import { describe, expect, it } from "vitest";
import { leftAloneNote } from "@/app/(app)/youth/import/IcsPreviewStep";
import type { PreviewEventChange } from "@/lib/youth/ics/buildImportPreview";
import { EVENT_TYPES, EVENT_TYPE_LABELS, type EventType } from "@/types/domain";

function change(stored: EventType, classified: EventType): PreviewEventChange {
  return {
    event: {
      uid: "u",
      recurrenceId: null,
      title: "Varsity Basketball at Jefferson",
      location: "Jefferson High School",
      eventDate: "2027-01-29T02:30:00.000Z",
      allDay: false,
      localTime: "Fri, 29 Jan 2027, 19:30",
      usedWardZone: false,
      eventType: classified,
    },
    existingId: "e",
    existingTitle: "Varsity Basketball at Jefferson",
    existingLocalTime: "Fri, 22 Jan 2027, 19:30",
    changedFields: ["date and time"],
    existingEventType: stored,
  };
}

describe("leftAloneNote", () => {
  it("says only that it is left alone when the file agrees", () => {
    for (const type of EVENT_TYPES) {
      expect(leftAloneNote(change(type, type))).toBe("Home or away is left as it is.");
    }
  });

  it("names what the file would have set it to", () => {
    expect(leftAloneNote(change("away", "home"))).toBe(
      "Home or away stays Away — this file would have set it to Home.",
    );
  });

  it("says the file would have left it unset rather than naming the tbd label", () => {
    expect(leftAloneNote(change("away", "tbd"))).toBe(
      "Home or away stays Away — this file would have left it for somebody to set.",
    );
  });

  it("reads correctly when the STORED value is the unset one", () => {
    expect(leftAloneNote(change("tbd", "home"))).toBe(
      "Home or away is still not set — this file would have set it to Home.",
    );
  });

  // THE GUARD, over every combination rather than the three spelled out above. "Home or away not
  // set" is correct on a chip and unreadable in a clause; if it ever reaches one of these
  // sentences again, this fails whichever branch introduced it.
  it("never drops the tbd label into a sentence", () => {
    for (const stored of EVENT_TYPES) {
      for (const classified of EVENT_TYPES) {
        expect(leftAloneNote(change(stored, classified))).not.toContain(
          EVENT_TYPE_LABELS.tbd,
        );
      }
    }
  });

  it("produces one sentence ending in a full stop for every combination", () => {
    for (const stored of EVENT_TYPES) {
      for (const classified of EVENT_TYPES) {
        const note = leftAloneNote(change(stored, classified));
        expect(note.endsWith(".")).toBe(true);
        expect(note).not.toContain("undefined");
      }
    }
  });
});
