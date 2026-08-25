import { describe, expect, it } from "vitest";
import type { Assignment } from "@/lib/assignments/queries";
import type { Sunday } from "@/lib/calendar/queries";
import type { Prayer } from "@/lib/prayers/queries";
import { assembleDraft, countsAsProgramSpeaker } from "@/lib/program/assembleDraft";
import { programDraftSchema } from "@/lib/program/draft";
import { parseProgramWardSettings, type ProgramSources } from "@/lib/program/gather";
import type { PipelineStage, SundayType } from "@/types/domain";

// The assembler, tested against a fixture that CAN FAIL.
//
// plans/retros/ai-b-knowledge-and-retrieval.md: a fixture whose own design hides a bug is worse
// than no fixture — a "all 1 of its passages" plural bug survived because every fixture had
// exactly one of everything. So the Sunday here carries THREE slots holding a member speaker, an
// external speaker and an empty slot at once. A fixture with one member speaker would let the
// external-speaker path (ITER-004) and the placeholder path both be broken and still pass.

const SUNDAY_DATE = "2026-09-06";

const MEMBER_SARAH = "member-sarah";
const MEMBER_DAVID = "member-david";
const MEMBER_RUTH = "member-ruth";
const TOPIC_ID = "topic-1";

function sunday(overrides: Partial<Sunday> = {}): Sunday {
  return {
    id: "sunday-1",
    date: SUNDAY_DATE,
    type: "standard" as SundayType,
    notes: null,
    conductingUserId: "user-counselor",
    speakingSlots: 3,
    slotConfig: null,
    presidingOverride: null,
    fastSundayPinned: false,
    createdAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

function assignment(overrides: Partial<Assignment> & { slotNumber: number }): Assignment {
  return {
    id: `assignment-${overrides.slotNumber}`,
    sundayId: "sunday-1",
    memberId: null,
    externalSpeakerName: null,
    externalSpeakerTitle: null,
    assignmentType: "sacrament_talk",
    countsTowardRotation: true,
    topicId: null,
    slotLengthMinutes: 10,
    stage: "notify" as PipelineStage,
    plannedBy: null,
    planSubmittedAt: null,
    approvedAt: null,
    requestedAt: null,
    requestedBy: null,
    requestOutcome: null,
    requestNotes: null,
    confirmedAt: null,
    notifyMessage: null,
    notifySentAt: null,
    notifySentBy: null,
    sundayConfirmedAt: null,
    thankYouMessage: null,
    thankYouSentAt: null,
    thankYouSentBy: null,
    completedAt: null,
    contactWaivedAt: null,
    contactWaivedBy: null,
    createdAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

function prayer(prayerType: "invocation" | "benediction", memberId: string | null): Prayer {
  return {
    id: `prayer-${prayerType}`,
    sundayId: "sunday-1",
    memberId,
    prayerType,
    stage: "done",
    askedBy: null,
    askedAt: null,
    confirmedAt: null,
    createdAt: "2026-08-01T00:00:00.000Z",
  };
}

// Slot 1 a member at `notify`, slot 2 an external speaker, slot 3 absent entirely.
function sources(overrides: Partial<ProgramSources> = {}): ProgramSources {
  return {
    sunday: sunday(),
    assignments: [
      assignment({ slotNumber: 1, memberId: MEMBER_SARAH, topicId: TOPIC_ID }),
      assignment({
        slotNumber: 2,
        externalSpeakerName: "Mark Andersen",
        externalSpeakerTitle: "President",
      }),
    ],
    prayers: [prayer("invocation", MEMBER_DAVID)],
    memberNames: {
      [MEMBER_SARAH]: "Sarah Whitfield",
      [MEMBER_DAVID]: "David Brooks",
      [MEMBER_RUTH]: "Ruth Okonkwo",
    },
    topicTitles: { [TOPIC_ID]: "Charity Never Faileth" },
    hymnSelections: [
      { hymnType: "opening", hymnNumber: 19, hymnTitle: "We Thank Thee, O God, for a Prophet" },
      { hymnType: "closing", hymnNumber: 152, hymnTitle: "God Be with You Till We Meet Again" },
    ],
    musicalNumber: null,
    bishopName: "Mark Chen",
    conductingName: "Peter Lindqvist",
    wardSettings: parseProgramWardSettings({
      leadership_contacts: [{ role: "Bishop", name: "Mark Chen", phone: "555-0100" }],
      missionaries: null,
    }),
    ...overrides,
  };
}

describe("assembleDraft — field sources", () => {
  it("produces a draft that validates against programDraftSchema", () => {
    // The schema is the contract program-b, program-c and program-d all validate against. An
    // assembler that produced something the schema rejects would fail at the storage boundary
    // rather than here.
    expect(programDraftSchema.safeParse(assembleDraft(sources())).success).toBe(true);
  });

  it("reads the date and conducting from the Sunday", () => {
    const draft = assembleDraft(sources());

    expect(draft.date).toBe(SUNDAY_DATE);
    expect(draft.conducting).toEqual({
      printedName: "Peter Lindqvist",
      publicName: "Peter Lindqvist",
    });
  });

  it("resolves hymns to a number AND a title", () => {
    const draft = assembleDraft(sources());

    expect(draft.openingHymn).toEqual({
      number: 19,
      title: "We Thank Thee, O God, for a Prophet",
    });
    expect(draft.closingHymn).toEqual({
      number: 152,
      title: "God Be with You Till We Meet Again",
    });
  });

  it("treats a hymn selection with no number as absent", () => {
    // A half-filled row means somebody opened the picker and did not choose. hymnRefSchema needs
    // a number, so carrying it would produce a draft the schema rejects.
    const draft = assembleDraft(
      sources({
        hymnSelections: [{ hymnType: "sacrament", hymnNumber: null, hymnTitle: "Something" }],
      }),
    );

    expect(draft.sacramentHymn).toBeNull();
    expect(draft.missing).toContain("sacrament_hymn");
  });

  it("keeps a hymn whose title could not be resolved", () => {
    // The hymnbook is only 42 of 341 seeded until program-e, so a number with no title is a real
    // state. The snapshot records what was chosen rather than dropping it.
    const draft = assembleDraft(
      sources({
        hymnSelections: [{ hymnType: "sacrament", hymnNumber: 169, hymnTitle: null }],
      }),
    );

    expect(draft.sacramentHymn).toEqual({ number: 169, title: "" });
    expect(draft.missing).not.toContain("sacrament_hymn");
  });

  it("resolves prayers to member names, never to ids", () => {
    const draft = assembleDraft(sources());

    expect(draft.invocation).toEqual({
      printedName: "David Brooks",
      publicName: "David Brooks",
    });
    expect(draft.benediction).toBeNull();
  });

  it("carries leadership contacts and missionary text from ward settings", () => {
    const draft = assembleDraft(sources());

    expect(draft.leadershipContacts).toEqual([
      { role: "Bishop", name: "Mark Chen", phone: "555-0100" },
    ]);
    expect(draft.missionaries).toBeNull();
  });
});

describe("assembleDraft — the three speaker kinds in one meeting", () => {
  // Both halves now hold the SAME text for a member too. The shortening was reversed on
  // 2026-08-24 (see tests/lib/publicNameFor.test.ts); what survives is that the pair still exists,
  // so a ward can give the web a different name from the handout for one person on one program.
  it("names a member speaker in full on the paper and on the web alike", () => {
    const [first] = assembleDraft(sources()).speakers;

    expect(first).toEqual({
      slotNumber: 1,
      kind: "member",
      printedName: "Sarah Whitfield",
      publicName: "Sarah Whitfield",
      topic: "Charity Never Faileth",
    });
  });

  it("keeps an external speaker's typed title in BOTH names (ITER-004)", () => {
    const [, second] = assembleDraft(sources()).speakers;

    // Their name was typed in order to be printed and there is no member record to protect, so
    // the public page names them exactly as the paper does.
    expect(second).toEqual({
      slotNumber: 2,
      kind: "external",
      printedName: "President Mark Andersen",
      publicName: "President Mark Andersen",
      topic: null,
    });
  });

  it("reports an unfilled slot as empty rather than omitting it", () => {
    const [, , third] = assembleDraft(sources()).speakers;

    expect(third).toEqual({
      slotNumber: 3,
      kind: "empty",
      printedName: null,
      publicName: null,
      topic: null,
    });
  });

  it("produces one speaker entry per slot the Sunday has", () => {
    expect(assembleDraft(sources()).speakers).toHaveLength(3);
    expect(
      assembleDraft(sources({ sunday: sunday({ speakingSlots: 0 }) })).speakers,
    ).toHaveLength(0);
  });

  it("never writes a placeholder string into an empty slot", () => {
    const draft = assembleDraft(sources());
    const rendered = JSON.stringify(draft);

    // program-d would print "TBD" exactly as though somebody had typed it, and nobody reading
    // the paper could tell the difference.
    expect(rendered).not.toContain("TBD");
    expect(rendered).not.toContain("Not yet assigned");
  });
});

describe("assembleDraft — which assignments count", () => {
  it("ignores an assignment that has not reached notify", () => {
    // Somebody planned but not notified is not yet a speaker: printing their name would tell a
    // congregation something the person has not been told.
    const draft = assembleDraft(
      sources({
        assignments: [
          assignment({ slotNumber: 1, memberId: MEMBER_SARAH, stage: "confirm" }),
        ],
      }),
    );

    expect(draft.speakers[0].kind).toBe("empty");
    expect(draft.speakers[0].printedName).toBeNull();
  });

  it("counts every stage from notify onwards", () => {
    expect(countsAsProgramSpeaker("plan")).toBe(false);
    expect(countsAsProgramSpeaker("review")).toBe(false);
    expect(countsAsProgramSpeaker("approve")).toBe(false);
    expect(countsAsProgramSpeaker("request")).toBe(false);
    expect(countsAsProgramSpeaker("confirm")).toBe(false);
    expect(countsAsProgramSpeaker("notify")).toBe(true);
    expect(countsAsProgramSpeaker("speak")).toBe(true);
    expect(countsAsProgramSpeaker("appreciate")).toBe(true);
    expect(countsAsProgramSpeaker("complete")).toBe(true);
  });
});

describe("assembleDraft — missing is a list, never a throw", () => {
  it("assembles a Thursday program with several gaps rather than refusing", () => {
    const draft = assembleDraft(sources());

    expect(draft.missing).toContain("sacrament_hymn");
    expect(draft.missing).toContain("benediction");
    expect(draft.missing).toContain("speaker_slot");
    expect(draft.missing).toContain("announcements");
    expect(draft.missing).toContain("organist");
    expect(draft.missing).toContain("chorister");
  });

  it("does not report what is present", () => {
    const draft = assembleDraft(sources());

    expect(draft.missing).not.toContain("opening_hymn");
    expect(draft.missing).not.toContain("closing_hymn");
    expect(draft.missing).not.toContain("invocation");
  });

  it("reports speaker_slot ONCE however many slots are empty", () => {
    // A closed set that program-b renders as one written sentence each. The same sentence twice
    // tells a secretary nothing about which slot; the slots themselves say that.
    const draft = assembleDraft(sources({ assignments: [] }));

    expect(draft.missing.filter((key) => key === "speaker_slot")).toHaveLength(1);
  });

  it("still assembles when the ward's settings are empty", () => {
    const draft = assembleDraft({
      ...sources(),
      wardSettings: parseProgramWardSettings({}),
    });

    expect(draft.leadershipContacts).toEqual([]);
    expect(draft.missionaries).toBeNull();
    expect(programDraftSchema.safeParse(draft).success).toBe(true);
  });

  it("still assembles when wards.settings is null or malformed", () => {
    for (const settings of [null, "not an object", []]) {
      const draft = assembleDraft({
        ...sources(),
        wardSettings: parseProgramWardSettings(settings),
      });

      expect(programDraftSchema.safeParse(draft).success).toBe(true);
    }
  });
});

describe("assembleDraft — presiding and the ward conference heading", () => {
  it("resolves presiding to the bishop when no override is typed", () => {
    const draft = assembleDraft(sources());

    expect(draft.presiding).toEqual({ printedName: "Mark Chen", publicName: "Mark Chen" });
  });

  it("keeps a typed presiding override verbatim in both names", () => {
    // Typed in order to be printed, exactly like an external speaker. Shortening it would publish
    // something nobody wrote.
    const draft = assembleDraft(
      sources({ sunday: sunday({ presidingOverride: "President Elena Ruiz" }) }),
    );

    expect(draft.presiding).toEqual({
      printedName: "President Elena Ruiz",
      publicName: "President Elena Ruiz",
    });
  });

  it("never guesses a presiding name — it asks instead", () => {
    // Decision 2. A ward conference usually has a visiting presiding officer, and prefilling the
    // stake president would write a name nobody typed onto a program that gets printed.
    const draft = assembleDraft(
      sources({ sunday: sunday({ type: "ward_conference", presidingOverride: null }) }),
    );

    expect(draft.presiding.printedName).toBe("Mark Chen");
    expect(draft.missing).toContain("presiding_unconfirmed_ward_conference");
  });

  it("stops asking once a ward conference has a typed presiding officer", () => {
    const draft = assembleDraft(
      sources({
        sunday: sunday({ type: "ward_conference", presidingOverride: "President Elena Ruiz" }),
      }),
    );

    expect(draft.missing).not.toContain("presiding_unconfirmed_ward_conference");
  });

  it("never asks on an ordinary Sunday, whose presiding is simply the bishop", () => {
    expect(assembleDraft(sources()).missing).not.toContain(
      "presiding_unconfirmed_ward_conference",
    );
  });

  it("heads a ward conference and nothing else", () => {
    // Decision 1: one template with a heading, not a second template. program-d renders NOTHING
    // when this is null.
    expect(assembleDraft(sources()).heading).toBeNull();
    expect(
      assembleDraft(sources({ sunday: sunday({ type: "ward_conference" }) })).heading,
    ).toBe("Ward Conference");
  });
});

describe("assembleDraft — the musical number", () => {
  it("carries a performer's typed name verbatim in both halves", () => {
    // "The Primary children" must not become "The Primary c.".
    const draft = assembleDraft(
      sources({
        musicalNumber: {
          performer: "The Primary children",
          pieceTitle: "I Am a Child of God",
          notes: null,
        },
      }),
    );

    expect(draft.musicalNumber).toEqual({
      performer: {
        printedName: "The Primary children",
        publicName: "The Primary children",
      },
      pieceTitle: "I Am a Child of God",
      notes: null,
    });
  });

  it("drops a row with neither a performer nor a piece", () => {
    const draft = assembleDraft(
      sources({ musicalNumber: { performer: null, pieceTitle: null, notes: null } }),
    );

    expect(draft.musicalNumber).toBeNull();
  });
});
