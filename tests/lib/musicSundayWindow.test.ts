import { describe, expect, it } from "vitest";
import {
  musicSundayWindow,
  MUSIC_WINDOW_SUNDAYS,
} from "@/lib/music/sundayWindow";
import type { SundayType } from "@/types/domain";

// The half of the deep link that lives on the DESTINATION.
//
// p4-sacrament-music-month's Pattern section is the thing to keep in mind here: "a deep link is
// two halves, and a green test suite can only ever see one of them". This suite covers the
// window arithmetic and tests/lib/sacramentSundayStatus.test.ts covers the href; neither can
// prove that the page opens the card it was sent to. Only the walk of scenario 072 does that.

type TestSunday = { id: string; date: string; type: SundayType };

function sunday(id: string, date: string, type: SundayType = "standard"): TestSunday {
  return { id, date, type };
}

// Eight consecutive Sundays, which is exactly the window — so the ninth in any list below is the
// first one the window drops.
const WEEKLY: TestSunday[] = [
  sunday("s1", "2026-10-04"),
  sunday("s2", "2026-10-11"),
  sunday("s3", "2026-10-18"),
  sunday("s4", "2026-10-25"),
  sunday("s5", "2026-11-01"),
  sunday("s6", "2026-11-08"),
  sunday("s7", "2026-11-15"),
  sunday("s8", "2026-11-22"),
  sunday("s9", "2026-11-29"),
  sunday("s10", "2026-12-06"),
];

const ids = (sundays: readonly TestSunday[]) => sundays.map((entry) => entry.id);

describe("musicSundayWindow", () => {
  it("returns at most the window size when no jump is given", () => {
    expect(MUSIC_WINDOW_SUNDAYS).toBe(8);

    const result = musicSundayWindow(WEEKLY, null);

    expect(result).toHaveLength(MUSIC_WINDOW_SUNDAYS);
    expect(ids(result)).toEqual(["s1", "s2", "s3", "s4", "s5", "s6", "s7", "s8"]);
  });

  it("returns every candidate when there are fewer than the window size", () => {
    const few = WEEKLY.slice(0, 3);

    expect(ids(musicSundayWindow(few, null))).toEqual(["s1", "s2", "s3"]);
  });

  it("returns nothing for an empty list and a null jump, rather than throwing", () => {
    expect(musicSundayWindow([], null)).toEqual([]);
  });

  it("returns nothing for an empty list and a jump that cannot be found", () => {
    expect(musicSundayWindow([], "s1")).toEqual([]);
  });

  // The ordinary case: a hub pill on a Sunday a few weeks out. Nothing is inserted and nothing is
  // duplicated — the card is already there and the page simply opens it.
  it("changes nothing when the jump is already inside the window", () => {
    const result = musicSundayWindow(WEEKLY, "s4");

    expect(result).toHaveLength(MUSIC_WINDOW_SUNDAYS);
    expect(ids(result)).toEqual(["s1", "s2", "s3", "s4", "s5", "s6", "s7", "s8"]);
  });

  // THE POINT OF THE WHOLE SLICE. `s10` falls outside the eight, so it is added — making nine.
  it("adds a jumped-to Sunday that falls outside the window", () => {
    const result = musicSundayWindow(WEEKLY, "s10");

    expect(result).toHaveLength(MUSIC_WINDOW_SUNDAYS + 1);
    expect(ids(result)).toContain("s10");
  });

  // INSERTED BY DATE, NOT APPENDED. The page merges the jumped-to Sunday into the candidates with
  // its own query, so it can arrive anywhere in the list; the position in the RESULT must come
  // from its date. A date that sorts into the middle is what separates a real insert from an
  // append that happens to look right for a future date.
  it("inserts a jumped-to Sunday in date order rather than appending it", () => {
    // Deliberately LAST in the candidate list and EARLY by date — exactly the shape a merge that
    // appended would produce.
    const candidates = [...WEEKLY.slice(0, 8), sunday("jumped", "2026-10-20")];

    const result = musicSundayWindow(candidates, "jumped");

    expect(ids(result)).toEqual([
      "s1",
      "s2",
      "s3",
      "jumped",
      "s4",
      "s5",
      "s6",
      "s7",
      "s8",
    ]);
  });

  // 072-D1 AS AN ASSERTION. A Sunday a year out was the case that could not be reached at all
  // before this slice: it is beyond any rolling window, so the link has to put it in the list.
  it("reaches a Sunday a year out", () => {
    const distant = sunday("august-2027", "2027-08-15");

    const result = musicSundayWindow([...WEEKLY, distant], "august-2027");

    expect(ids(result)).toEqual([
      "s1",
      "s2",
      "s3",
      "s4",
      "s5",
      "s6",
      "s7",
      "s8",
      "august-2027",
    ]);
  });

  // A stale bookmark, another ward's id, or a Sunday the page filtered out for holding no
  // meeting. All three arrive here as "not in the candidates", and all three render the ordinary
  // list rather than an error.
  it("ignores a jump that matches nothing", () => {
    const result = musicSundayWindow(WEEKLY, "no-such-sunday");

    expect(result).toHaveLength(MUSIC_WINDOW_SUNDAYS);
    expect(ids(result)).toEqual(["s1", "s2", "s3", "s4", "s5", "s6", "s7", "s8"]);
  });

  it("never duplicates the jumped-to Sunday", () => {
    for (const jump of ids(WEEKLY)) {
      const result = musicSundayWindow(WEEKLY, jump);
      expect(new Set(ids(result)).size, `${jump} was duplicated`).toBe(result.length);
    }
  });

  // A Sunday holding no meeting never reaches this function — the page filters those out before
  // calling it — but the window must not care what type a Sunday is, or it would hold a second
  // definition of "has a meeting" beside holdsSacramentMeeting().
  it("does not inspect the Sunday type", () => {
    const mixed = [
      sunday("a", "2026-10-04", "fast_sunday"),
      sunday("b", "2026-10-11", "ward_conference"),
      sunday("c", "2026-10-18", "special"),
    ];

    expect(ids(musicSundayWindow(mixed, null))).toEqual(["a", "b", "c"]);
  });

  it("does not mutate the candidates it was given", () => {
    const candidates = [...WEEKLY];

    musicSundayWindow(candidates, "s10");

    expect(candidates).toEqual(WEEKLY);
  });
});
