import { describe, expect, it } from "vitest";
import {
  describeRegistrationFlags,
  describeRegistrationRow,
  pendingCount,
  splitRegistrations,
} from "@/lib/zoom/registrationRow";
import type { ZoomRegistration } from "@/lib/zoom/registrations";

// The words on one sign-up card, and the flags computed on read (ITER-052).

function registration(overrides: Partial<ZoomRegistration>): ZoomRegistration {
  return {
    id: "r1",
    displayName: "Avery Hart",
    phone: "555-123-4567",
    phoneDigits: "5551234567",
    email: null,
    saysMember: false,
    answers: [],
    status: "pending",
    heldReason: "approvals_on",
    memberId: null,
    memberName: null,
    referrerName: null,
    decidedByName: null,
    decidedAt: null,
    inviteeId: null,
    placeholderName: null,
    linkGiven: false,
    responses: [],
    createdAt: "2026-10-30T15:00:00.000Z",
    ...overrides,
  };
}

describe("describeRegistrationFlags", () => {
  it("finds nothing for a phone seen once", () => {
    const only = registration({});
    expect(describeRegistrationFlags(only, [only])).toEqual({ declinedBefore: false, samePhoneAs: null });
  });

  it("names the earliest other request from the same phone", () => {
    const first = registration({ id: "a", displayName: "First", createdAt: "2026-10-01T00:00:00Z" });
    const second = registration({ id: "b", displayName: "Second", createdAt: "2026-10-02T00:00:00Z" });
    const third = registration({ id: "c", displayName: "Third", createdAt: "2026-10-03T00:00:00Z" });
    expect(describeRegistrationFlags(third, [third, second, first]).samePhoneAs).toEqual({
      id: "a",
      displayName: "First",
    });
  });

  it("marks a request whose phone was declined before", () => {
    const declined = registration({ id: "a", status: "declined", createdAt: "2026-10-01T00:00:00Z" });
    const again = registration({ id: "b" });
    expect(describeRegistrationFlags(again, [declined, again]).declinedBefore).toBe(true);
  });

  // Found walking scenario 097: the first request carried "Same phone as an earlier request" too.
  it("leaves the EARLIER request unmarked when a later one shares its phone", () => {
    const first = registration({ id: "a", createdAt: "2026-10-01T00:00:00Z" });
    const later = registration({ id: "b", createdAt: "2026-10-02T00:00:00Z" });
    expect(describeRegistrationFlags(first, [first, later])).toEqual({
      declinedBefore: false,
      samePhoneAs: null,
    });
  });

  it("does not mark a declined request because the same phone signed up again afterwards", () => {
    const declined = registration({ id: "a", status: "declined", createdAt: "2026-10-01T00:00:00Z" });
    const laterDeclined = registration({ id: "b", status: "declined", createdAt: "2026-10-02T00:00:00Z" });
    expect(describeRegistrationFlags(declined, [declined, laterDeclined]).declinedBefore).toBe(false);
  });

  it("ignores a declined request from a different phone", () => {
    const declined = registration({ id: "a", status: "declined", phoneDigits: "5550000000" });
    const other = registration({ id: "b" });
    expect(describeRegistrationFlags(other, [declined, other])).toEqual({
      declinedBefore: false,
      samePhoneAs: null,
    });
  });
});

describe("describeRegistrationRow", () => {
  it("describes a waiting non-member with an answer and a referrer", () => {
    const row = describeRegistrationRow(
      registration({
        email: "avery@example.com",
        referrerName: "Jordan Lee",
        answers: [
          { questionId: "q", prompt: "Would you welcome a visit from the missionaries?", kind: "yes_no", answer: true },
        ],
      }),
      [],
    );
    expect(row).toMatchObject({
      isWaiting: true,
      statusLine: "Waiting",
      memberLine: "Not a member",
      phone: "555-123-4567",
      email: "avery@example.com",
      answerLines: ["Would you welcome a visit from the missionaries? — Yes"],
      referrerLine: "Referred by Jordan Lee",
      flagLines: [],
      stamp: "30 Oct 2026",
      dayKey: "2026-10-30",
    });
  });

  it("says a member has not been matched yet, and names the match once made", () => {
    expect(describeRegistrationRow(registration({ saysMember: true }), []).memberLine).toBe(
      "Member of the ward (not matched yet)",
    );
    expect(
      describeRegistrationRow(registration({ saysMember: true, memberName: "Avery Hart" }), []).memberLine,
    ).toBe("Matched to Avery Hart");
  });

  it("names the placeholder an approved person holds", () => {
    const row = describeRegistrationRow(
      registration({ status: "approved", linkGiven: true, placeholderName: "Guest 07", heldReason: null }),
      [],
    );
    expect(row.statusLine).toBe("Approved · Guest 07");
  });

  it("says an approved person is waiting for a link when the pool was empty", () => {
    const row = describeRegistrationRow(registration({ status: "approved", heldReason: null }), []);
    expect(row.statusLine).toBe("Approved · waiting for a link");
  });

  it("reads Declined for a declined request", () => {
    expect(describeRegistrationRow(registration({ status: "declined" }), []).statusLine).toBe("Declined");
  });

  it("lists every flag that applies", () => {
    const declined = registration({ id: "a", status: "declined", createdAt: "2026-10-01T00:00:00Z" });
    const held = registration({ id: "b", heldReason: "daily_limit" });
    expect(describeRegistrationRow(held, [declined, held]).flagLines).toEqual([
      "Same phone as an earlier request",
      "Declined before",
      "Held: lots of sign-ups today",
    ]);
  });

  it("puts the date in UTC, not the reader's zone (rule 12)", () => {
    const row = describeRegistrationRow(registration({ createdAt: "2026-10-31T02:30:00.000Z" }), []);
    expect(row.stamp).toBe("31 Oct 2026");
    expect(row.dayKey).toBe("2026-10-31");
  });
});

describe("splitRegistrations", () => {
  it("puts waiting oldest first and decided newest first", () => {
    const oldWaiting = registration({ id: "w1", createdAt: "2026-10-01T00:00:00Z" });
    const newWaiting = registration({ id: "w2", createdAt: "2026-10-05T00:00:00Z" });
    const oldDone = registration({ id: "d1", status: "approved", createdAt: "2026-10-02T00:00:00Z" });
    const newDone = registration({ id: "d2", status: "declined", createdAt: "2026-10-06T00:00:00Z" });

    const split = splitRegistrations([newDone, oldWaiting, oldDone, newWaiting]);
    expect(split.waiting.map((entry) => entry.id)).toEqual(["w1", "w2"]);
    expect(split.recent.map((entry) => entry.id)).toEqual(["d2", "d1"]);
    expect(pendingCount([newDone, oldWaiting, oldDone, newWaiting])).toBe(2);
  });
});
