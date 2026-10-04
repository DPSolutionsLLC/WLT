import { describe, expect, it } from "vitest";
import { describeMissingMusic, musicCompletionFor } from "@/lib/music/musicCompletion";
import { emptySundayMusic } from "@/lib/music/sundayMusic";
import type { HymnSelection, MusicalNumber } from "@/lib/music/queries";
import type { HymnType, SundayMusic } from "@/types/domain";

// ITER-038 slice mb: the ONE completion rule the card's pill, the Submit button and the server all
// use. Table-driven, because the table is the rule.

const SUNDAY_ID = "00000000-0000-4000-8000-000000000001";

function hymn(hymnType: HymnType, overrides: Partial<HymnSelection> = {}): HymnSelection {
  return {
    id: `hymn-${hymnType}`,
    sundayId: SUNDAY_ID,
    hymnType,
    hymnNumber: 2,
    hymnTitle: "The Spirit of God",
    aiSuggested: false,
    selectedBy: null,
    cancelledAt: null,
    ...overrides,
  };
}

const THREE_HYMNS = [hymn("opening"), hymn("sacrament"), hymn("closing")];

function people(overrides: Partial<SundayMusic> = {}): SundayMusic {
  return {
    ...emptySundayMusic(SUNDAY_ID),
    chorister: { memberId: "member-1", name: "Ruth Hale" },
    organist: { memberId: null, name: "Brother Visiting" },
    ...overrides,
  };
}

function musicalNumber(overrides: Partial<MusicalNumber> = {}): MusicalNumber {
  return {
    id: "number-1",
    sundayId: SUNDAY_ID,
    performer: "The Jansen family",
    pieceTitle: "I Am a Child of God",
    notes: null,
    cancelledAt: null,
    ...overrides,
  };
}

describe("musicCompletionFor", () => {
  it("counts an empty Sunday as 0 of 5, every item missing in the card's order", () => {
    expect(
      musicCompletionFor({ selections: [], musicalNumber: null, sundayMusic: emptySundayMusic(SUNDAY_ID) }),
    ).toEqual({
      filled: 0,
      total: 5,
      missing: ["Opening hymn", "Sacrament hymn", "Closing hymn", "Chorister", "Organist"],
      complete: false,
    });
  });

  it("counts three hymns alone as 3 of 5, missing the chorister and organist", () => {
    const completion = musicCompletionFor({
      selections: THREE_HYMNS,
      musicalNumber: null,
      sundayMusic: emptySundayMusic(SUNDAY_ID),
    });
    expect(completion).toMatchObject({ filled: 3, total: 5, missing: ["Chorister", "Organist"] });
    expect(completion.complete).toBe(false);
  });

  it("is complete with three hymns, a chorister and an organist, and no musical number", () => {
    expect(
      musicCompletionFor({ selections: THREE_HYMNS, musicalNumber: null, sundayMusic: people() }),
    ).toEqual({ filled: 5, total: 5, missing: [], complete: true });
  });

  it("counts a typed-name person as filled", () => {
    const completion = musicCompletionFor({
      selections: THREE_HYMNS,
      musicalNumber: null,
      sundayMusic: people({ chorister: { memberId: null, name: "Sister Jansen" } }),
    });
    expect(completion.complete).toBe(true);
  });

  it("adds a sixth item when a musical number exists, unfilled without a performer", () => {
    const completion = musicCompletionFor({
      selections: THREE_HYMNS,
      musicalNumber: musicalNumber({ performer: null }),
      sundayMusic: people(),
    });
    expect(completion).toEqual({ filled: 5, total: 6, missing: ["Musical number"], complete: false });
  });

  it("treats a blank piece title as unfilled", () => {
    const completion = musicCompletionFor({
      selections: THREE_HYMNS,
      musicalNumber: musicalNumber({ pieceTitle: "   " }),
      sundayMusic: people(),
    });
    expect(completion.missing).toEqual(["Musical number"]);
  });

  it("is complete with a filled musical number", () => {
    expect(
      musicCompletionFor({ selections: THREE_HYMNS, musicalNumber: musicalNumber(), sundayMusic: people() }),
    ).toEqual({ filled: 6, total: 6, missing: [], complete: true });
  });

  // The readers skip cancelled rows; this holds the rule even for a caller that forgot to.
  it("never counts a cancelled hymn or a cancelled musical number", () => {
    const completion = musicCompletionFor({
      selections: [hymn("opening"), hymn("sacrament", { cancelledAt: "2027-01-01T00:00:00Z" }), hymn("closing")],
      musicalNumber: musicalNumber({ cancelledAt: "2027-01-01T00:00:00Z", performer: null }),
      sundayMusic: people(),
    });
    expect(completion).toMatchObject({ total: 5, missing: ["Sacrament hymn"] });
  });

  it("does not count a slot whose hymn number was cleared", () => {
    const completion = musicCompletionFor({
      selections: [hymn("opening", { hymnNumber: null }), hymn("sacrament"), hymn("closing")],
      musicalNumber: null,
      sundayMusic: people(),
    });
    expect(completion.missing).toEqual(["Opening hymn"]);
  });
});

describe("describeMissingMusic", () => {
  it("names what is still to pick as a sentence", () => {
    expect(describeMissingMusic(["Opening hymn", "Organist"])).toBe(
      "Still to pick: Opening hymn, Organist.",
    );
  });
});
