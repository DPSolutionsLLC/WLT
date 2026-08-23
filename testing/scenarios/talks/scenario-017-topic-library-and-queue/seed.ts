import {
  createAssignment,
  createAssignmentApproval,
  createHousehold,
  createMember,
  createSunday,
  createTestUser,
  createTopic,
  createTopicCandidate,
  ensureTestWard,
  seedNotificationTriggers,
} from "../../../infrastructure/seedUtils.ts";

// The accept/reject boundary, seeded so it can be proven BEFORE Phase 5 exists to fill it. Three
// `pending` candidates are inserted directly, standing in for the AI route that will eventually
// write them — which is the whole argument for building this queue in talks-c rather than
// alongside the thing that fills it.
//
// The library is eight topics in three deliberate groups:
//   3 never assigned  -> "Not used yet", and they must sort FIRST
//   3 assigned 2, 7 and 14 months ago -> "Used recently", "Used a while ago"
//   2 archived        -> hidden until somebody asks for them
//
// The waiting assignment carries a NEVER-ASSIGNED topic on purpose. Approving it has to visibly
// move that topic down the list; a topic that was already stamped would move a little and prove
// much less.

// Fixed timestamps rather than offsets from "now", so a re-seed produces the same library rather
// than one that drifts a day each run. Chosen against the harness's 2026-08 timeframe:
//   2 months  -> "Used recently"     (inside the 6-month boundary)
//   7 months  -> "Used a while ago"  (outside it)
//   14 months -> "Used a while ago"  (well outside it, and the oldest)
const TWO_MONTHS_AGO = "2026-06-14T12:00:00.000Z";
const SEVEN_MONTHS_AGO = "2026-01-18T12:00:00.000Z";
const FOURTEEN_MONTHS_AGO = "2025-06-22T12:00:00.000Z";

const SEPTEMBER_SUNDAYS = [
  "2026-09-06",
  "2026-09-13",
  "2026-09-20",
  "2026-09-27",
] as const;

export async function seed(): Promise<void> {
  await ensureTestWard({ name: "Harness Test Ward" });

  // The approve path fires plan_approved, and a ward created outside supabase/seed/ward.sql has
  // no notification_settings rows at all.
  await seedNotificationTriggers();

  // --- The bishopric: three DIFFERENT accounts -----------------------------------------------
  // The approval gate counts PEOPLE, so a satisfied 3-of-3 genuinely needs three users. It is
  // seeded satisfied because the gate is scenario 012's subject, not this one's — step 14 has to
  // be a single press so the scenario stays about the stamp.
  const bishop = await createTestUser({
    handle: "bishop",
    role: "bishop",
    org: "bishopric",
    firstName: "Mark",
    lastName: "Andersen",
  });

  const counselorOne = await createTestUser({
    handle: "counselor1",
    role: "counselor",
    org: "bishopric",
    counselorPosition: 1,
    firstName: "Peter",
    lastName: "Nakamura",
  });

  const counselorTwo = await createTestUser({
    handle: "counselor2",
    role: "counselor",
    org: "bishopric",
    counselorPosition: 2,
    firstName: "Daniel",
    lastName: "Okafor",
  });

  // --- The refused seat ------------------------------------------------------------------------
  // A ward secretary holds `talks.view` and NO topics permission at all, and migration 019 puts
  // `topics` in the bishopric-only RLS loop. Both agree, so this account must reach a
  // "Not permitted" page — an empty library would be a different and misleading claim.
  await createTestUser({
    handle: "secretary",
    role: "ward_secretary",
    firstName: "Ruth",
    lastName: "Kaufman",
  });

  // --- The three NEVER-ASSIGNED topics ---------------------------------------------------------
  // These sort first. `burdens` is the one the waiting assignment carries.
  const burdens = await createTopic({
    title: "Bearing One Another's Burdens",
    category: "doctrinal",
    description: "Mosiah 18 and what a covenant people owe each other.",
    suggestedScriptures: ["Mosiah 18:8-10", "Galatians 6:2"],
  });

  await createTopic({
    title: "The Book of Mormon",
    category: "scriptural",
    description: "Its place beside the Bible as a second witness.",
    suggestedScriptures: ["2 Nephi 29:8", "Ezekiel 37:16-17"],
  });

  await createTopic({
    title: "Come, Follow Me",
    category: "conference_talk",
    description: "Studying at home, together, through the week.",
    suggestedTalks: ["Come, Follow Me — April 2019 general conference"],
  });

  // --- The three ASSIGNED topics ----------------------------------------------------------------
  // Two, seven and fourteen months back, so the two staleness buckets are both represented and
  // the ordering within "used" is visible rather than a coin flip.
  await createTopic({
    title: "Faith in Jesus Christ",
    category: "doctrinal",
    description: "The first principle, and what acting on it looks like.",
    lastAssignedAt: TWO_MONTHS_AGO,
    suggestedScriptures: ["Alma 32:21", "Hebrews 11:1"],
  });

  await createTopic({
    title: "The Sabbath Day",
    category: "doctrinal",
    description: "A delight rather than a list.",
    lastAssignedAt: SEVEN_MONTHS_AGO,
    suggestedScriptures: ["Isaiah 58:13-14"],
  });

  await createTopic({
    title: "Temple Worship",
    category: "doctrinal",
    description: "Preparing to attend, and what to bring to it.",
    lastAssignedAt: FOURTEEN_MONTHS_AGO,
    suggestedScriptures: ["D&C 109:8"],
  });

  // --- The two ARCHIVED topics --------------------------------------------------------------
  // Hidden until "Showing" is set to Archived. Archiving is the ONLY way a topic leaves the
  // library — there is no delete route — so these prove the filter rather than a deletion.
  await createTopic({
    title: "Ward Budget Reminders",
    category: "custom",
    description: "Retired — this belonged in ward council, not sacrament meeting.",
    status: "archived",
  });

  await createTopic({
    title: "Christmas Devotional",
    category: "seasonal",
    description: "Out of season until December.",
    status: "archived",
    lastAssignedAt: FOURTEEN_MONTHS_AGO,
  });

  // --- September 2026 ---------------------------------------------------------------------------
  const sundays: Record<string, string> = {};

  for (const date of SEPTEMBER_SUNDAYS) {
    sundays[date] = await createSunday({
      date,
      type: date === "2026-09-06" ? "fast_sunday" : "standard",
      // 09-06 is the fast Sunday and carries zero SPEAKING slots — but the waiting assignment
      // needs a slot, so this one is deliberately given slots despite being a fast Sunday. The
      // zero-slot case is scenario 016's subject.
      speakingSlots: 3,
      conductingUserId: bishop.id,
    });
  }

  // --- The speaker ------------------------------------------------------------------------------
  const householdId = await createHousehold({ familyName: "Whitfield" });
  const sarah = await createMember({
    firstName: "Sarah",
    lastName: "Whitfield",
    householdId,
    category: "adult",
    phone: "(801) 555-0134",
  });

  // --- The assignment waiting at `review` with every approval in ---------------------------------
  // It carries `burdens`, a NEVER-ASSIGNED topic, so approving it has to visibly move that topic
  // out of the "Not used yet" group and down the list.
  const waiting = await createAssignment({
    sundayId: sundays["2026-09-06"],
    memberId: sarah,
    topicId: burdens,
    slotNumber: 1,
    slotLengthMinutes: 12,
    pipelineStage: "review",
    plannedBy: counselorOne.id,
  });

  for (const user of [bishop, counselorOne, counselorTwo]) {
    await createAssignmentApproval({
      assignmentId: waiting,
      userId: user.id,
      approved: true,
    });
  }

  // --- Three PENDING candidates, standing in for Phase 5 ------------------------------------------
  // Inserted directly into topic_candidates. Nothing in the app writes here yet, and nothing in
  // the app may write to `topics` from a suggestion except an explicit accept (CLAUDE.md rule 3)
  // — which is exactly what this scenario is here to prove.
  await createTopicCandidate({
    title: "Ministering with Real Intent",
    category: "doctrinal",
    description: "What ministering asks beyond a monthly visit.",
    suggestedScriptures: ["Moroni 7:6-9", "John 21:16"],
    suggestedTalks: ["Ministering — April 2018 general conference"],
  });

  await createTopicCandidate({
    title: "The Gathering of Israel",
    category: "scriptural",
    description: "The covenant, and who it is being kept with.",
    suggestedScriptures: ["3 Nephi 21", "Jeremiah 16:16"],
  });

  await createTopicCandidate({
    title: "Preparing for General Conference",
    category: "seasonal",
    description: "Questions to bring to the October sessions.",
    suggestedTalks: ["Hear Him — April 2020 general conference"],
  });

  console.log(
    "  ward, 4 users, 8 topics (3 never assigned, 3 assigned 2/7/14 months ago, 2 archived), " +
      "September 2026 with one assignment at `review` carrying a never-assigned topic and all " +
      "3 approvals already in, and 3 PENDING topic candidates standing in for Phase 5",
  );
}
