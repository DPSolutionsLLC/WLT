// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { DateOnly } from "@/lib/calendar/dates";
import { mapTopicHistoryRows, type TopicHistoryRow } from "@/lib/topics/queries";

// The ward's topic history (migration 086) — every topic a talk has carried, when, and who gave it.
// Rewritten from the "recent topic usage" list when the topic library was retired: the history
// reads `topic_title` straight off the talk, over all time.
//
// Every decision in it is pure — the ordering, the external-speaker fallback, what counts as
// upcoming, and what is dropped — which is why they live in mapTopicHistoryRows() rather than
// inside the async read. The cancelled-talk filter is in the query and is guarded by
// tests/lib/cancelledReaders.test.ts.

const TODAY: DateOnly = "2027-06-15";

function row(overrides: Partial<TopicHistoryRow> = {}): TopicHistoryRow {
  return {
    id: "talk-1",
    sunday_id: "march",
    slot_number: 1,
    topic_title: "Faith",
    external_speaker_name: null,
    external_speaker_title: null,
    sunday: { date: "2027-03-07" },
    speaker: { first_name: "Sarah", last_name: "Bennett" },
    ...overrides,
  };
}

describe("mapTopicHistoryRows — ordering", () => {
  it("puts the most recent Sunday first", () => {
    const history = mapTopicHistoryRows(
      [
        row({ sunday: { date: "2026-12-06" } }),
        row({ sunday: { date: "2027-04-04" } }),
        row({ sunday: { date: "2027-03-07" } }),
      ],
      TODAY,
    );

    expect(history.map((entry) => entry.date)).toEqual(["2027-04-04", "2027-03-07", "2026-12-06"]);
  });

  it("puts an upcoming Sunday above every past one", () => {
    const history = mapTopicHistoryRows(
      [row({ sunday: { date: "2027-03-07" } }), row({ sunday: { date: "2027-06-20" } })],
      TODAY,
    );

    expect(history[0].date).toBe("2027-06-20");
  });

  it("breaks a tie on one Sunday by slot number", () => {
    const history = mapTopicHistoryRows(
      [
        row({ slot_number: 3, topic_title: "Charity" }),
        row({ slot_number: 1, topic_title: "Agency" }),
        row({ slot_number: 2, topic_title: "Baptism" }),
      ],
      TODAY,
    );

    expect(history.map((entry) => entry.topicTitle)).toEqual(["Agency", "Baptism", "Charity"]);
  });

  // ONE ROW PER TALK, NOT PER TOPIC. A subject given twice is exactly what a history must show.
  it("keeps a topic that was used twice as two rows", () => {
    const history = mapTopicHistoryRows(
      [row({ id: "a" }), row({ id: "b", sunday: { date: "2027-04-04" } })],
      TODAY,
    );

    expect(history.map((entry) => entry.assignmentId)).toEqual(["b", "a"]);
  });

  // ALL TIME. There is no window: a topic from three years ago is still history.
  it("keeps a talk from years ago", () => {
    const history = mapTopicHistoryRows([row({ sunday: { date: "2023-01-01" } })], TODAY);

    expect(history).toHaveLength(1);
  });
});

describe("mapTopicHistoryRows — who gave it", () => {
  it("names a roster member", () => {
    expect(mapTopicHistoryRows([row()], TODAY)[0].speakerName).toBe("Sarah Bennett");
  });

  it("falls back to an outside speaker's name", () => {
    const [entry] = mapTopicHistoryRows(
      [row({ speaker: null, external_speaker_name: "Elder Wright" })],
      TODAY,
    );

    expect(entry.speakerName).toBe("Elder Wright");
  });

  it("puts an outside speaker's title before their name", () => {
    const [entry] = mapTopicHistoryRows(
      [row({ speaker: null, external_speaker_name: "Hale", external_speaker_title: "President" })],
      TODAY,
    );

    expect(entry.speakerName).toBe("President Hale");
  });

  it("returns null for a talk with a topic and no speaker", () => {
    const [entry] = mapTopicHistoryRows(
      [row({ speaker: null, external_speaker_name: null })],
      TODAY,
    );

    expect(entry.speakerName).toBeNull();
  });

  it("treats a blank outside name as nobody", () => {
    const [entry] = mapTopicHistoryRows(
      [row({ speaker: null, external_speaker_name: "   " })],
      TODAY,
    );

    expect(entry.speakerName).toBeNull();
  });

  it("handles a member with only a first name", () => {
    const [entry] = mapTopicHistoryRows(
      [row({ speaker: { first_name: "Sarah", last_name: null } })],
      TODAY,
    );

    expect(entry.speakerName).toBe("Sarah");
  });
});

describe("mapTopicHistoryRows — what counts as upcoming", () => {
  it("marks a Sunday after today", () => {
    expect(
      mapTopicHistoryRows([row({ sunday: { date: "2027-06-20" } })], TODAY)[0].isUpcoming,
    ).toBe(true);
  });

  // STRICT. A talk given today is decided, and as much of a repeat risk as last week's.
  it("does not mark today itself", () => {
    expect(mapTopicHistoryRows([row({ sunday: { date: TODAY } })], TODAY)[0].isUpcoming).toBe(
      false,
    );
  });

  it("does not mark a past Sunday", () => {
    expect(mapTopicHistoryRows([row()], TODAY)[0].isUpcoming).toBe(false);
  });
});

describe("mapTopicHistoryRows — rows it drops", () => {
  it("drops a talk with no topic", () => {
    expect(mapTopicHistoryRows([row({ topic_title: null })], TODAY)).toEqual([]);
  });

  it("drops a talk whose topic is only whitespace", () => {
    expect(mapTopicHistoryRows([row({ topic_title: "   " })], TODAY)).toEqual([]);
  });

  it("drops a talk with no Sunday", () => {
    expect(mapTopicHistoryRows([row({ sunday_id: null, sunday: null })], TODAY)).toEqual([]);
  });
});
