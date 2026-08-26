import {
  createHousehold,
  createMember,
  createReportReadStatus,
  createTestUser,
  createVisitLog,
  createVisitParticipant,
  createVisitPrivateNote,
  ensureTestWard,
  seedNotificationTriggers,
} from "../../../infrastructure/seedUtils.ts";

// THE STATE THIS SEEDS IS TWO PEOPLE WITH DIFFERENT READ STATE OVER THE SAME FEED.
//
// Per-user read state is invisible until two people have looked at the same reports, and Next
// Unread needs a queue with GAPS in it — read tiles scattered among unread ones, not a block of
// unread at the top. Both are unreasonable to arrange by hand: it means signing in twice, tapping
// a precise number of specific tiles, and signing back.
//
// So the EQ counselor arrives having already read three of the eight EQ reports, and the EQ
// president has read none. Everything the checklist asserts is a difference between those two
// numbers.
//
// ---------------------------------------------------------------------------------------------
// THE THREE READ REPORTS ARE NOT CONTIGUOUS
// ---------------------------------------------------------------------------------------------
// They sit at positions 2, 5 and 7 of the eight EQ reports in feed order. A block of three at the
// top would let a broken Next Unread — one that walks the list from the beginning every time
// rather than from where the reader is — pass by accident.
//
// ---------------------------------------------------------------------------------------------
// WHY THE DATES ARE PINNED
// ---------------------------------------------------------------------------------------------
// Unlike scenario 040, nothing here is a WINDOW. A feed is ordered by date and nothing else, so a
// pinned date keeps its meaning as the scenario ages — the same reasoning scenario 044 gives.
//
// ---------------------------------------------------------------------------------------------
// THE TWO PRIVATE NOTES ARE THE POINT OF THE PRIVACY CHECK
// ---------------------------------------------------------------------------------------------
// Both are authored by the EQ PRESIDENT, on visits they can see, in the organization they lead.
// If a private note were ever going to leak into a tile, this is the person it would leak to —
// which is what makes "not even their own note appears in the feed" a real assertion rather than
// a restatement of org isolation. The text is distinctive so it can be searched for on the page.

const EQ_VISIT_DATES = [
  "2026-08-16",
  "2026-08-09",
  "2026-08-02",
  "2026-07-26",
  "2026-07-19",
  "2026-07-12",
  "2026-07-05",
  "2026-06-28",
];

const RS_VISIT_DATES = ["2026-08-14", "2026-08-07", "2026-07-24", "2026-07-10"];

// Positions in EQ_VISIT_DATES the counselor has already read. Deliberately scattered — see above.
const COUNSELOR_HAS_READ = [1, 4, 6];

const LONG_SHARED_NOTE =
  "We called round on Tuesday evening and stayed a good while — they had just come back from " +
  "a fortnight with her sister in Boise and wanted to tell us all about it, and then the " +
  "conversation turned to the boy starting at the high school in September and whether anybody " +
  "from the ward would be in his year, which none of us could answer on the spot.";

const MULTI_LINE_SHARED_NOTE =
  "They are doing well and asked after the bishop.\n" +
  "The porch light still needs fixing; somebody with a ladder should call round.";

export async function seed(): Promise<void> {
  await ensureTestWard({ name: "Harness Test Ward", crossOrgVisibility: false });
  await seedNotificationTriggers();

  await createTestUser({
    handle: "bishop",
    role: "bishop",
    firstName: "Mark",
    lastName: "Andersen",
  });

  const eqPresident = await createTestUser({
    handle: "eq-president",
    role: "org_president",
    org: "eldersQuorum",
    firstName: "Miguel",
    lastName: "Cortez",
  });

  const eqCounselor = await createTestUser({
    handle: "eq-counselor",
    role: "org_counselor",
    org: "eldersQuorum",
    firstName: "Daniel",
    lastName: "Whitfield",
  });

  const rsPresident = await createTestUser({
    handle: "rs-president",
    role: "org_president",
    org: "reliefSociety",
    firstName: "Ruth",
    lastName: "Delacroix",
  });

  // One household per report, so a tile's family name identifies it unambiguously in the list.
  const familyNames = [
    "Andersen",
    "Brooks",
    "Calderon",
    "Doyle",
    "Ellsworth",
    "Fairbanks",
    "Grant",
    "Halvorsen",
    "Ibarra",
    "Jessop",
    "Kimball",
    "Lindqvist",
  ];

  const households: string[] = [];

  for (const familyName of familyNames) {
    const householdId = await createHousehold({
      familyName,
      address: `${100 + households.length} Canyon Road`,
    });

    // A household with no active members is invisible to the visit picker (scenario 040). It makes
    // no difference to the feed — a report is a record of something that happened — but seeding
    // one member each keeps this ward consistent with what the rest of the app expects.
    await createMember({
      firstName: "Adult",
      lastName: familyName,
      householdId,
      category: "adult",
      gender: "female",
    });

    households.push(householdId);
  }

  const eqVisitIds: string[] = [];

  for (const [index, visitDate] of EQ_VISIT_DATES.entries()) {
    // Two reports with NO shared note at all, so the "No shared note" line is on screen rather
    // than asserted about. One with a note far past the preview limit, so the truncation is too.
    const sharedNotes =
      index === 2 || index === 5
        ? undefined
        : index === 0
          ? LONG_SHARED_NOTE
          : index === 3
            ? MULTI_LINE_SHARED_NOTE
            : `Called on the ${familyNames[index]} family. All well.`;

    const visitId = await createVisitLog({
      org: "eldersQuorum",
      householdId: households[index],
      recordedBy: eqPresident.id,
      visitDate,
      // One attempt among the eight. An attempted visit counts towards no goal and must be
      // visibly distinct in the feed; a tile that rendered it like a completed visit would undo
      // that (visits-b).
      outcome: index === 4 ? "attempted" : "completed",
      arrangement: index === 1 ? "appointment" : "drop_in",
      sharedNotes,
    });

    // Who WENT, which is not the same as who typed it in. The last report deliberately has NO
    // participants, so the tile reads "Nobody recorded as taking part" rather than crediting the
    // recorder — the exact ambiguity visits-d removed.
    if (index !== EQ_VISIT_DATES.length - 1) {
      await createVisitParticipant({
        org: "eldersQuorum",
        visitLogId: visitId,
        userId: index % 2 === 0 ? eqPresident.id : eqCounselor.id,
      });
    }

    eqVisitIds.push(visitId);
  }

  for (const [index, visitDate] of RS_VISIT_DATES.entries()) {
    const visitId = await createVisitLog({
      org: "reliefSociety",
      householdId: households[EQ_VISIT_DATES.length + index],
      recordedBy: rsPresident.id,
      visitDate,
      sharedNotes: `Relief Society called on the ${familyNames[EQ_VISIT_DATES.length + index]} family.`,
    });

    await createVisitParticipant({
      org: "reliefSociety",
      visitLogId: visitId,
      userId: rsPresident.id,
    });
  }

  // Both authored by the EQ president, on their OWN organization's visits — see the header.
  await createVisitPrivateNote({
    visitLogId: eqVisitIds[0],
    userId: eqPresident.id,
    notes: "PRIVATE-ALPHA: he asked us not to repeat what he said about his job.",
  });

  await createVisitPrivateNote({
    visitLogId: eqVisitIds[3],
    userId: eqPresident.id,
    notes: "PRIVATE-BRAVO: a confidence the family asked us to keep.",
  });

  // The counselor arrives with three already read. The president has no rows at all, which is
  // what "unread" means in the absence of a row.
  for (const position of COUNSELOR_HAS_READ) {
    await createReportReadStatus({
      userId: eqCounselor.id,
      reportType: "visit_log",
      reportId: eqVisitIds[position],
      readAt: new Date("2026-08-20T15:00:00.000Z").toISOString(),
    });
  }

  console.log(
    "  ward, 4 users, 12 households, 12 visits (8 EQ / 4 RS), 2 private notes, " +
      "3 reports pre-read by the EQ counselor",
  );
}
