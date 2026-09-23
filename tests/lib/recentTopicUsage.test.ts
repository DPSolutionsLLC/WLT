// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { DateOnly } from "@/lib/calendar/dates";
import {
  mapTopicUsageRows,
  topicUsageWindow,
  type TopicUsageRow,
} from "@/lib/topics/queries";
import { RECENT_MONTHS } from "@/lib/topics/topicRotation";

// "What have we talked about lately, and who gave it" — the list a conductor reads before
// planning a month, so as not to repeat a subject the congregation has just heard.
//
// Every decision in it is pure — the ordering, the external-speaker fallback, what counts as
// upcoming, and the window — which is why those live in mapTopicUsageRows() and
// topicUsageWindow() rather than inside the async read. Asserting them through a hosted database
// would be a slow test of arithmetic.

const TODAY: DateOnly = "2027-06-15";

const SUNDAYS = new Map<string, DateOnly>([
  ["last-december", "2026-12-06"],
  ["march", "2027-03-07"],
  ["april", "2027-04-04"],
  ["today", "2027-06-15"],
  ["next-week", "2027-06-20"],
]);

function row(overrides: Partial<TopicUsageRow> = {}): TopicUsageRow {
  return {
    topic_id: "topic-faith",
    sunday_id: "march",
    slot_number: 1,
    external_speaker_name: null,
    topic: { id: "topic-faith", title: "Faith" },
    speaker: { first_name: "Sarah", last_name: "Bennett" },
    ...overrides,
  };
}

describe("mapTopicUsageRows — ordering", () => {
  it("puts the most recent Sunday first", () => {
    const usage = mapTopicUsageRows(
      [
        row({ sunday_id: "last-december" }),
        row({ sunday_id: "april" }),
        row({ sunday_id: "march" }),
      ],
      SUNDAYS,
      TODAY,
    );

    expect(usage.map((entry) => entry.date)).toEqual([
      "2027-04-04",
      "2027-03-07",
      "2026-12-06",
    ]);
  });

  // An upcoming Sunday sorts above a past one WITHOUT a branch, because its date is larger. That
  // is worth pinning: a later "upcoming first" special case would be a second rule saying what
  // the comparison already says.
  it("puts an upcoming Sunday above every past one", () => {
    const usage = mapTopicUsageRows(
      [row({ sunday_id: "march" }), row({ sunday_id: "next-week" })],
      SUNDAYS,
      TODAY,
    );

    expect(usage[0].date).toBe("2027-06-20");
  });

  // STABLE. Three talks on one Sunday must come out in the same order twice, or the list
  // reshuffles between renders of identical data — compareTopicsByStaleness's rule.
  it("breaks a tie on one Sunday by slot number", () => {
    const usage = mapTopicUsageRows(
      [
        row({ slot_number: 3, topic: { id: "c", title: "Charity" }, topic_id: "c" }),
        row({ slot_number: 1, topic: { id: "a", title: "Agency" }, topic_id: "a" }),
        row({ slot_number: 2, topic: { id: "b", title: "Baptism" }, topic_id: "b" }),
      ],
      SUNDAYS,
      TODAY,
    );

    expect(usage.map((entry) => entry.topicTitle)).toEqual(["Agency", "Baptism", "Charity"]);
  });

  // ONE ROW PER USAGE, NOT PER TOPIC. A subject given twice is exactly what this list exists to
  // surface, and collapsing the two would throw away the dates, which are the answer.
  it("keeps a topic that was used twice as two rows", () => {
    const usage = mapTopicUsageRows(
      [row({ sunday_id: "march" }), row({ sunday_id: "april" })],
      SUNDAYS,
      TODAY,
    );

    expect(usage).toHaveLength(2);
    expect(new Set(usage.map((entry) => entry.topicTitle))).toEqual(new Set(["Faith"]));
  });
});

describe("mapTopicUsageRows — who gave it", () => {
  it("names a roster member", () => {
    const [usage] = mapTopicUsageRows([row()], SUNDAYS, TODAY);

    expect(usage.speakerName).toBe("Sarah Bennett");
  });

  // A VISITING SPEAKER IS A REAL SPEAKER (ITER-004). Reading `member_id` alone would show a
  // planned stake-visit Sunday as having nobody on it — sundayStatus.ts's hasSpeaker() rule, in a
  // second place.
  it("falls back to an outside speaker's name", () => {
    const [usage] = mapTopicUsageRows(
      [row({ speaker: null, external_speaker_name: "Elder Wright" })],
      SUNDAYS,
      TODAY,
    );

    expect(usage.speakerName).toBe("Elder Wright");
  });

  // NULL, NEVER A PLACEHOLDER. A slot with a topic and nobody in it yet is the ORDINARY state in
  // this ward's workflow — topics first, speakers after — and the view renders an absence as an
  // absence rather than as the word "None" (talks-c).
  it("returns null for a slot with a topic and no speaker", () => {
    const [usage] = mapTopicUsageRows(
      [row({ speaker: null, external_speaker_name: null })],
      SUNDAYS,
      TODAY,
    );

    expect(usage.speakerName).toBeNull();
  });

  it("treats a blank outside name as nobody rather than as an empty speaker", () => {
    const [usage] = mapTopicUsageRows(
      [row({ speaker: null, external_speaker_name: "   " })],
      SUNDAYS,
      TODAY,
    );

    expect(usage.speakerName).toBeNull();
  });

  // A member row with no surname still names somebody. Trimming is what stops it rendering as a
  // name with a trailing space, and the empty check is what stops an all-blank row becoming "".
  it("handles a member with only a first name", () => {
    const [usage] = mapTopicUsageRows(
      [row({ speaker: { first_name: "Sarah", last_name: null } })],
      SUNDAYS,
      TODAY,
    );

    expect(usage.speakerName).toBe("Sarah");
  });
});

describe("mapTopicUsageRows — what counts as upcoming", () => {
  it("marks a Sunday after today", () => {
    const [usage] = mapTopicUsageRows([row({ sunday_id: "next-week" })], SUNDAYS, TODAY);

    expect(usage.isUpcoming).toBe(true);
  });

  // THE BOUNDARY, AND IT IS STRICT. A talk being given TODAY is not "coming up" in the sense this
  // list means — it is decided, and it is exactly as much of a repeat risk as last week's.
  it("does not mark today itself", () => {
    const [usage] = mapTopicUsageRows([row({ sunday_id: "today" })], SUNDAYS, TODAY);

    expect(usage.isUpcoming).toBe(false);
  });

  it("does not mark a past Sunday", () => {
    const [usage] = mapTopicUsageRows([row({ sunday_id: "march" })], SUNDAYS, TODAY);

    expect(usage.isUpcoming).toBe(false);
  });
});

describe("mapTopicUsageRows — rows it drops", () => {
  // Defensive. There is no delete path for topics, so this should be unreachable — and dropping
  // the row is still right, because a usage with no subject says nothing to a reader.
  it("drops a row whose topic could not be resolved", () => {
    expect(mapTopicUsageRows([row({ topic: null })], SUNDAYS, TODAY)).toEqual([]);
  });

  // An assignment can outlive the Sunday it was planned for — every one of these tables allows a
  // null sunday_id — and such a row belongs to no date on this list.
  it("drops a row with no Sunday", () => {
    expect(mapTopicUsageRows([row({ sunday_id: null })], SUNDAYS, TODAY)).toEqual([]);
  });

  it("drops a row whose Sunday is outside the window that was read", () => {
    expect(mapTopicUsageRows([row({ sunday_id: "not-in-the-map" })], SUNDAYS, TODAY)).toEqual([]);
  });
});

describe("topicUsageWindow", () => {
  // IMPORTED, NOT RESTATED. lib/topics/topicRotation.ts already decides what "used recently"
  // means, and its badge renders on the same page as this list — two definitions of one word,
  // three inches apart, is a disagreement a user notices before a test does.
  it("defaults to RECENT_MONTHS in both directions", () => {
    expect(topicUsageWindow(TODAY)).toEqual({ from: "2026-12-15", to: "2027-12-15" });
    expect(RECENT_MONTHS).toBe(6);
  });

  it("honours an explicit window", () => {
    expect(topicUsageWindow(TODAY, 1)).toEqual({ from: "2027-05-15", to: "2027-07-15" });
  });

  // SYMMETRIC, and asserted as such rather than as two numbers that happen to match — the forward
  // half is deliberately the same constant, because there is no definition of "soon" anywhere in
  // this codebase and inventing one would be a third number to keep in step.
  it("looks the same distance forward as back", () => {
    for (const months of [1, 3, 6, 12]) {
      const { from, to } = topicUsageWindow(TODAY, months);

      expect(from < TODAY, `${months} months back should precede today`).toBe(true);
      expect(to > TODAY, `${months} months forward should follow today`).toBe(true);
    }
  });
});
