// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  lastSpokeLabel,
  lastSpokeOn,
  orderSpeakerCandidates,
} from "@/lib/assignments/speakerOrder";

const ANA = { id: "ana", firstName: "Ana", lastName: "Silva" };
const LUIS = { id: "luis", firstName: "Luis", lastName: "Ortega" };
const MARIA = { id: "maria", firstName: "Maria", lastName: "Lopez" };
const TOMAS = { id: "tomas", firstName: "Tomas", lastName: "Reyes" };

const spoke = (sundayDate: string) => ({ outcome: "completed" as const, sundayDate });

describe("lastSpokeOn", () => {
  it("takes the latest completed talk", () => {
    expect(lastSpokeOn([spoke("2025-03-02"), spoke("2026-01-04"), spoke("2024-11-10")])).toBe(
      "2026-01-04",
    );
  });

  // Never given, so never "spoke" — the f2c rule and the reliability flags' rule.
  it("ignores cancelled and declined talks", () => {
    expect(
      lastSpokeOn([
        { outcome: "cancelled", sundayDate: "2026-09-06" },
        { outcome: "declined", sundayDate: "2026-08-02" },
        spoke("2024-05-05"),
      ]),
    ).toBe("2024-05-05");
  });

  it("is null for somebody who has never spoken", () => {
    expect(lastSpokeOn([{ outcome: "declined", sundayDate: "2026-08-02" }])).toBeNull();
  });
});

describe("orderSpeakerCandidates", () => {
  const history = new Map([
    ["maria", [spoke("2026-07-05")]],
    ["tomas", [spoke("2023-06-04")]],
    ["luis", [{ outcome: "declined" as const, sundayDate: "2026-08-02" }]],
  ]);

  it("puts never-spoken first, then the longest since speaking", () => {
    expect(orderSpeakerCandidates([MARIA, TOMAS, ANA, LUIS], history).map((m) => m.id)).toEqual([
      "luis",
      "ana",
      "tomas",
      "maria",
    ]);
  });

  it("breaks ties alphabetically by last name, then first name", () => {
    const ties = [
      { id: "b", firstName: "Beth", lastName: "Hale" },
      { id: "a", firstName: "Adam", lastName: "Hale" },
      { id: "c", firstName: "Cara", lastName: "Doe" },
    ];
    expect(orderSpeakerCandidates(ties, new Map()).map((m) => m.id)).toEqual(["c", "a", "b"]);
  });

  // Without the bishopric's history, no order can claim who spoke when.
  it("is plain alphabetical with no history to read", () => {
    expect(orderSpeakerCandidates([MARIA, TOMAS, ANA, LUIS], null).map((m) => m.id)).toEqual([
      "maria",
      "luis",
      "tomas",
      "ana",
    ]);
  });

  it("does not change the list it was given", () => {
    const members = [MARIA, TOMAS];
    orderSpeakerCandidates(members, history);
    expect(members.map((m) => m.id)).toEqual(["maria", "tomas"]);
  });
});

describe("lastSpokeLabel", () => {
  it("says never spoken", () => {
    expect(lastSpokeLabel(null, "2026-09-29")).toBe("Never spoken");
  });

  it("says how long ago", () => {
    expect(lastSpokeLabel("2026-01-25", "2026-09-29")).toBe("last spoke 8 months ago");
  });
});
