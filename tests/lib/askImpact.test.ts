import { describe, expect, it } from "vitest";
import { describeAskImpact, type AskImpact } from "@/lib/sacrament/askImpact";

// ITER-036, D4: a change that would affect somebody already scheduled or already accepted warns
// first, naming them. Pure, so every change kind and every combination is cheap to pin down.

const DENVER = "America/Denver";
// 01:00 UTC on the 27th is 7:00 PM on the 26th in Denver (MDT, UTC-6) — the wrong DAY in UTC.
const SCHEDULED = "2026-09-27T01:00:00.000Z";

function impact(overrides: Partial<AskImpact> = {}): AskImpact {
  return {
    personName: "Maria Lopez",
    askedTo: "speak",
    scheduledFor: null,
    holderName: null,
    accepted: false,
    ...overrides,
  };
}

describe("describeAskImpact", () => {
  it("is null when nobody is scheduled or accepted", () => {
    for (const change of ["unfinalize", "speaker", "topic"] as const) {
      expect(describeAskImpact([impact(), impact({ personName: "Ana" })], change, DENVER)).toBeNull();
      expect(describeAskImpact([], change, DENVER)).toBeNull();
    }
  });

  it("names the appointment in the ward's zone, never the server's", () => {
    const sentence = describeAskImpact([impact({ scheduledFor: SCHEDULED })], "unfinalize", DENVER);
    expect(sentence).toMatch(
      /^You have an appointment with Maria Lopez on Sat, Sep 26, 2026, 7:00\sPM to ask them to speak\./,
    );
    expect(sentence).not.toMatch(/Sep 27/);
  });

  it("says whose appointment it is when it is another leader's", () => {
    const sentence = describeAskImpact(
      [impact({ scheduledFor: SCHEDULED, holderName: "Peter Nakamura" })],
      "speaker",
      DENVER,
    );
    expect(sentence).toMatch(/^Peter Nakamura has an appointment with Maria Lopez on /);
  });

  it("words each change kind for an appointment", () => {
    const scheduled = [impact({ scheduledFor: SCHEDULED })];
    expect(describeAskImpact(scheduled, "unfinalize", DENVER)).toMatch(/That ask stays on the list\.$/);
    expect(describeAskImpact(scheduled, "speaker", DENVER)).toMatch(
      /cancel it or use it for something else\.$/,
    );
    expect(describeAskImpact(scheduled, "topic", DENVER)).toMatch(
      /tell them about the new topic\.$/,
    );
  });

  it("words each change kind for somebody who accepted", () => {
    const accepted = [impact({ personName: "Tomas Reyes", accepted: true })];
    expect(describeAskImpact(accepted, "unfinalize", DENVER)).toBe(
      "Tomas Reyes has already accepted — you'll need to let them know if anything changes.",
    );
    expect(describeAskImpact(accepted, "speaker", DENVER)).toBe(
      "Tomas Reyes has already accepted — you'll need to let them know they're no longer speaking.",
    );
    expect(describeAskImpact(accepted, "topic", DENVER)).toBe(
      "Tomas Reyes has already accepted — you'll want to tell them about their new topic.",
    );
  });

  it("names everybody affected, scheduled and accepted together, and skips the rest", () => {
    const sentence = describeAskImpact(
      [
        impact({ scheduledFor: SCHEDULED }),
        impact({ personName: "Ana Diaz" }),
        impact({ personName: "Tomas Reyes", accepted: true }),
      ],
      "unfinalize",
      DENVER,
    );
    expect(sentence).toContain("Maria Lopez");
    expect(sentence).toContain("Tomas Reyes has already accepted");
    expect(sentence).not.toContain("Ana Diaz");
  });

  // An accepted speaker's appointment is already done with; the acceptance is what matters.
  it("says accepted, not the appointment, for somebody who accepted at their appointment", () => {
    const sentence = describeAskImpact(
      [impact({ scheduledFor: SCHEDULED, accepted: true })],
      "speaker",
      DENVER,
    );
    expect(sentence).toMatch(/^Maria Lopez has already accepted/);
    expect(sentence).not.toMatch(/appointment/);
  });

  it("never guesses a pronoun from a name", () => {
    const every = (["unfinalize", "speaker", "topic"] as const).flatMap((change) => [
      describeAskImpact([impact({ scheduledFor: SCHEDULED })], change, DENVER) ?? "",
      describeAskImpact([impact({ accepted: true })], change, DENVER) ?? "",
    ]);
    for (const sentence of every) {
      expect(sentence).not.toMatch(/\b(he|him|his|she|her|hers)\b/i);
    }
  });
});
