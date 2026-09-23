import {
  createAssignment,
  createHousehold,
  createHymnSelection,
  createMember,
  createSunday,
  createTestUser,
  createTopic,
  ensureTestWard,
} from "../../../infrastructure/seedUtils.ts";

// ---------------------------------------------------------------------------
// THREE SUNDAYS, THREE FINALIZE STATES, AND ONE OF THEM IS A TRAP
// ---------------------------------------------------------------------------
// The auto-unfinalize rule is the sharpest edge in this slice and is near-impossible to set up by
// hand: it needs a Sunday that is ALREADY finalized, carrying speakers at several pipeline
// stages, so that advancing one of them can be seen NOT to clear the stamp.
//
// Getting that backwards is not a visible bug — it is a month of finalized topics quietly coming
// undone as speakers are contacted, one Sunday at a time, with nothing anywhere saying why. No
// green suite can show it to you, because every individual write succeeds.
//
//   11-07  FINALIZED, 3 topics, speakers at `approve`   the "advance a speaker" trap
//   11-14  FINALIZED, 3 topics, NOBODY in any slot      finalize does not depend on speakers
//   11-21  NOT finalized, 2 topics of 3                 the ordinary starting state
//
// 11-14 IS THE ONE THAT STATES THE PRODUCT RULE. The prototype's build note is explicit that
// finalizing "never depends on speaker confirmation/acceptance, only on the conductor's own
// explicit click", and this ward's own workflow is to lay out a whole month of topics BEFORE
// finding anyone to give them. A Sunday with three topics and no speakers at all must be able to
// read "finalized" — if a build ever gates finalize on having speakers, this card is where it
// shows.
//
// EVERY SUNDAY CARRIES HYMNS TOO, because half of what is being walked is what /music does with
// the flag: a finalized Sunday shows its completion pill, an un-finalized one is dimmed and reads
// `Topics pending` INSTEAD. Without real hymn selections the replacement is invisible — there
// would be nothing for the pending pill to have replaced.

const FINALIZED_WITH_SPEAKERS = "2027-11-07";
const FINALIZED_NO_SPEAKERS = "2027-11-14";
const NOT_FINALIZED = "2027-11-21";

// ---------------------------------------------------------------------------
// ⚠️ THE RECENTLY-USED PANEL NEEDS SUNDAYS NEAR *TODAY*, NOT NEAR THE FIXED DATES ABOVE
// ---------------------------------------------------------------------------
// FOUND BY WALKING THIS SCENARIO, 2026-09-23. The three Sundays above are deliberately fixed so a
// re-seeded run reads the same dates on screen — which is right for the finalize half, and is
// WRONG for `/talks/topics`, whose Recently used list reads a window of RECENT_MONTHS either side
// of TODAY. November 2027 is eight months past the forward edge of that window, so the panel
// rendered its empty state and four checklist items could not pass at any time.
//
// The finalize half does not care what day it is; the usage half cares about nothing else. So
// these are computed RELATIVE TO TODAY and the fixed trio above is left alone.
//
// It is the same trap in reverse for a future reader: do NOT "tidy" these into fixed dates. They
// would fall out of the window within six months and the panel would silently go empty again,
// with every automated test still green — no test imports that page.
function sundayOnOrBefore(today: Date): Date {
  const date = new Date(
    Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()),
  );
  date.setUTCDate(date.getUTCDate() - date.getUTCDay());
  return date;
}

function weeksFrom(anchor: Date, weeks: number): string {
  const date = new Date(anchor);
  date.setUTCDate(date.getUTCDate() + weeks * 7);
  return date.toISOString().slice(0, 10);
}

const ANCHOR = sundayOnOrBefore(new Date());

// Three past and one upcoming. The spread is what makes the ORDER visible, and the upcoming one
// is what makes the "Coming up" mark reachable at all.
const USED_TEN_WEEKS_AGO = weeksFrom(ANCHOR, -10);
const USED_SIX_WEEKS_AGO = weeksFrom(ANCHOR, -6);
const USED_TWO_WEEKS_AGO = weeksFrom(ANCHOR, -2);
const COMING_UP = weeksFrom(ANCHOR, 3);

// The stamp on the two finalized Sundays. A FIXED instant rather than `new Date()`, so a
// re-seeded run reads the same date on screen and a walker can tell "it did not move" from "it
// was re-stamped just now" — which is exactly what the idempotence check turns on.
const FINALIZED_AT = "2027-10-05T17:30:00Z";

export async function seed(): Promise<void> {
  await ensureTestWard({ name: "Harness Test Ward" });

  const bishop = await createTestUser({
    handle: "bishop",
    role: "bishop",
    org: "bishopric",
    firstName: "Mark",
    lastName: "Andersen",
  });

  // SHARED BISHOPRIC AUTHORITY (CLAUDE.md §7). A counselor must be able to un-finalize what the
  // bishop finalized, from both places, with no difference anywhere.
  await createTestUser({
    handle: "counselor1",
    role: "counselor",
    org: "bishopric",
    counselorPosition: 1,
    firstName: "Peter",
    lastName: "Nakamura",
  });

  // THE ROLE THIS WHOLE SIGNAL IS FOR, AND THE ONE THAT MUST NOT BE ABLE TO SET IT. A
  // music_coordinator holds `talks.view` — so they open /sacrament and see the Topics pill — and
  // does NOT hold `topics.view` or `topics.manage`, which are bishopric-only. That combination is
  // not the intuitive one (CLAUDE.md §8) and it is precisely what makes this account the test:
  // they must see `Topics pending` on /music, see the pill on the hub, and see NO checkmark and
  // NO Topics shortcut anywhere.
  await createTestUser({
    handle: "music",
    role: "music_coordinator",
    org: "bishopric",
    firstName: "Hannah",
    lastName: "Restrepo",
  });

  // --- Members --------------------------------------------------------------------------------
  const NAMES: ReadonlyArray<readonly [string, string]> = [
    ["Sarah", "Whitfield"],
    ["Andre", "Bell"],
    ["Claire", "Bennett"],
  ];

  const memberIds: string[] = [];

  for (const [firstName, lastName] of NAMES) {
    const householdId = await createHousehold({ familyName: lastName });
    memberIds.push(
      await createMember({
        firstName,
        lastName,
        householdId,
        category: "adult",
        status: "active",
      }),
    );
  }

  // --- Topics ---------------------------------------------------------------------------------
  // SIX, so that changing a topic on 11-07 means picking a DIFFERENT one rather than clearing it.
  // Both paths un-finalize, and the walk should exercise the one a conductor actually does.
  const topicTitles = [
    "The Atonement of Jesus Christ",
    "Ministering as the Savior Did",
    "Temple Covenants",
    "Faith in Times of Uncertainty",
    "Gratitude",
    "Keeping the Sabbath Day Holy",
  ] as const;

  const topicIds: string[] = [];

  for (const title of topicTitles) {
    topicIds.push(await createTopic({ title }));
  }

  const seedHymns = async (sundayId: string) => {
    for (const [hymnType, hymnNumber, hymnTitle] of [
      ["opening", 2, "The Spirit of God"],
      ["sacrament", 181, "Jesus of Nazareth, Savior and King"],
    ] as const) {
      await createHymnSelection({
        sundayId,
        hymnType,
        hymnNumber,
        hymnTitle,
        selectedBy: bishop.id,
      });
    }
  };

  // --- 11-07 — FINALIZED, with speakers already moving through the pipeline -------------------
  // THE TRAP. Every slot has a topic AND a speaker, and the speakers sit at `approve` — one step
  // away from `request`, which is the first stage where somebody is actually contacted. Advancing
  // them is the ordinary next thing a bishopric does, and it must leave the stamp alone.
  const withSpeakersId = await createSunday({
    date: FINALIZED_WITH_SPEAKERS,
    type: "standard",
    speakingSlots: 3,
    conductingUserId: bishop.id,
    topicsFinalizedAt: FINALIZED_AT,
  });

  for (const [index, memberId] of memberIds.entries()) {
    await createAssignment({
      sundayId: withSpeakersId,
      slotNumber: index + 1,
      memberId,
      topicId: topicIds[index],
      pipelineStage: "approve",
      plannedBy: bishop.id,
    });
  }

  await seedHymns(withSpeakersId);

  // --- 11-14 — FINALIZED, and NOBODY is speaking ----------------------------------------------
  // Three topics, three slots, not one speaker. This is what the ward's workflow actually looks
  // like in week one of planning a month, and it must be a legitimate finalized state — the
  // Topics pill reads 3/3 with a filled checkmark while the Talks pill reads 0/3.
  //
  // It is also where `speaking_slots` is changed during the walk, which is the OTHER thing that
  // un-finalizes a Sunday and the one a pure test cannot reach.
  const noSpeakersId = await createSunday({
    date: FINALIZED_NO_SPEAKERS,
    type: "standard",
    speakingSlots: 3,
    conductingUserId: bishop.id,
    topicsFinalizedAt: FINALIZED_AT,
  });

  for (const index of [0, 1, 2]) {
    await createAssignment({
      sundayId: noSpeakersId,
      slotNumber: index + 1,
      topicId: topicIds[index + 3],
      pipelineStage: "plan",
      plannedBy: bishop.id,
    });
  }

  await seedHymns(noSpeakersId);

  // --- 11-21 — NOT finalized, and deliberately part-planned ------------------------------------
  // Two topics of three. It is the control: dimmed on /music and reading `Topics pending` from
  // the moment the page loads, with no action taken by the walker.
  //
  // ⚠️ IT IS ALSO THE ASSERTION THAT THE FLAG IS NOT DERIVED. A build that inferred "finalized"
  // from "every slot has a topic" would be indistinguishable from a correct one on 11-07 and
  // 11-14 — both have all three — and would only be caught here, where the count is partial. The
  // opposite trap needs the reverse: 11-14 has 3/3 topics and would read finalized ANYWAY under a
  // derived rule, which is why the walk finalizes and un-finalizes it rather than only reading it.
  const notFinalizedId = await createSunday({
    date: NOT_FINALIZED,
    type: "standard",
    speakingSlots: 3,
    conductingUserId: bishop.id,
  });

  await createAssignment({
    sundayId: notFinalizedId,
    slotNumber: 1,
    memberId: memberIds[0],
    topicId: topicIds[0],
    pipelineStage: "plan",
    plannedBy: bishop.id,
  });

  await createAssignment({
    sundayId: notFinalizedId,
    slotNumber: 2,
    topicId: topicIds[1],
    pipelineStage: "plan",
    plannedBy: bishop.id,
  });

  await seedHymns(notFinalizedId);

  // --- Near today — the Recently used panel's data -------------------------------------------
  // FOUR MORE SUNDAYS, none of them finalized and none of them part of the finalize walk. They
  // exist only so `/talks/topics` has something to show, and between them they cover every rule
  // that list has:
  //
  //   -10 weeks  a roster member          the ordinary row
  //   -6  weeks  an EXTERNAL speaker      ITER-004 — a visiting speaker is a real speaker, and
  //                                       reading member_id alone would render this as nobody
  //   -2  weeks  a topic and NO speaker   renders "no speaker yet", never "None" (talks-c)
  //   +3  weeks  a roster member          the only row that can carry "Coming up"
  const recentSpread: ReadonlyArray<{
    date: string;
    topicIndex: number;
    memberIndex: number | null;
    externalSpeakerName?: string;
  }> = [
    { date: USED_TEN_WEEKS_AGO, topicIndex: 0, memberIndex: 0 },
    {
      date: USED_SIX_WEEKS_AGO,
      topicIndex: 1,
      memberIndex: null,
      externalSpeakerName: "Brother Elias Hale",
    },
    { date: USED_TWO_WEEKS_AGO, topicIndex: 2, memberIndex: null },
    { date: COMING_UP, topicIndex: 3, memberIndex: 2 },
  ];

  for (const entry of recentSpread) {
    const sundayId = await createSunday({
      date: entry.date,
      type: "standard",
      speakingSlots: 3,
      conductingUserId: bishop.id,
    });

    await createAssignment({
      sundayId,
      slotNumber: 1,
      memberId: entry.memberIndex === null ? undefined : memberIds[entry.memberIndex],
      externalSpeakerName: entry.externalSpeakerName,
      topicId: topicIds[entry.topicIndex],
      pipelineStage: "plan",
      plannedBy: bishop.id,
    });
  }

  console.log(
    "  ward, 3 users (bishop, counselor, music_coordinator), 3 households, 3 adult members, " +
      "6 topics, and November 2027 — 11-07 FINALIZED with 3 topics and 3 speakers at `approve`, " +
      "11-14 FINALIZED with 3 topics and NO speakers, 11-21 NOT finalized with 2 topics of 3. " +
      "Every Sunday carries 2 of 3 hymns so /music has a completion pill to replace. " +
      `Plus 4 Sundays near today (${USED_TEN_WEEKS_AGO}, ${USED_SIX_WEEKS_AGO}, ` +
      `${USED_TWO_WEEKS_AGO}, ${COMING_UP}) carrying one topic each — a member, an external ` +
      "speaker, nobody, and one upcoming — so /talks/topics' Recently used panel has content " +
      "inside its six-months-either-side window.",
  );
}
