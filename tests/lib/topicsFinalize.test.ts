// @vitest-environment node
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { topicShapeChanged } from "@/lib/topics/finalize";
import {
  updateAssignmentSchema,
  type UpdateAssignmentInput,
} from "@/lib/validation/assignment";
import { PIPELINE_STAGES } from "@/types/domain";

// ---------------------------------------------------------------------------
// THE SHARPEST RULE IN THE SLICE, AND THE ONE MOST LIKELY TO BE GOT BACKWARDS
// ---------------------------------------------------------------------------
// `sundays.topics_finalized_at` says a member of the bishopric decided what a Sunday's talks are
// ABOUT. It must be cleared when that changes and must NOT be cleared when a speaker moves
// through the pipeline — the prototype's build note §topics-finalized-readiness is explicit that
// finalizing "never depends on speaker confirmation/acceptance, only on the conductor's own
// explicit click".
//
// Get it backwards and a month of finalized topics unravels one Sunday at a time as speakers are
// contacted, with nothing anywhere saying why — which is precisely the state the signal exists to
// report.
//
// EVERY PATCH IS BUILT THROUGH THE REAL ZOD SCHEMA rather than cast into shape. `topicShapeChanged`
// asks whether a KEY IS PRESENT, and Zod strips unknown keys and leaves absent optional ones
// absent — so a hand-built literal could pass here while the real request body behaved
// differently. Parsing is what makes these assertions about the route's actual input.

function patch(body: unknown): UpdateAssignmentInput {
  return updateAssignmentSchema.parse(body);
}

const TOPIC_ID = "00000000-0000-4000-8000-000000000001";
const MEMBER_ID = "00000000-0000-4000-8000-000000000002";

describe("topicShapeChanged — what un-finalizes a Sunday", () => {
  it("un-finalizes when a topic is SET", () => {
    expect(topicShapeChanged(patch({ action: "update", fields: { topicId: TOPIC_ID } }))).toBe(
      true,
    );
  });

  // THE CASE A TRUTHINESS CHECK WOULD MISS. Removing a topic changes the day's shape exactly as
  // much as adding one, and a finalized Sunday with a topic taken off it is not finalized.
  it("un-finalizes when a topic is CLEARED", () => {
    expect(topicShapeChanged(patch({ action: "update", fields: { topicId: null } }))).toBe(true);
  });

  it("un-finalizes when the topic changes alongside other fields", () => {
    const input = patch({
      action: "update",
      fields: { topicId: TOPIC_ID, memberId: MEMBER_ID, requestNotes: "Called on Tuesday" },
    });

    expect(topicShapeChanged(input)).toBe(true);
  });
});

describe("topicShapeChanged — what does NOT un-finalize a Sunday", () => {
  // ---------------------------------------------------------------------------
  // EVERY PIPELINE STAGE, ENUMERATED
  // ---------------------------------------------------------------------------
  // A single `it` over one stage would go green while eight others un-finalized. Driven from
  // PIPELINE_STAGES rather than from a list kept here, so a tenth stage is covered the day it is
  // added rather than the day somebody remembers this file.
  for (const stage of PIPELINE_STAGES) {
    it(`leaves it finalized on a transition to "${stage}"`, () => {
      const input = patch({ action: "transition", to: stage, reason: "Moving it along" });

      expect(topicShapeChanged(input)).toBe(false);
    });
  }

  it("leaves it finalized when a speaker declines — request back to plan", () => {
    const input = patch({ action: "transition", to: "plan", reason: "They declined" });

    expect(topicShapeChanged(input)).toBe(false);
  });

  it("leaves it finalized when contact is waived for an outside speaker", () => {
    expect(topicShapeChanged(patch({ action: "waive_contact" }))).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // EVERY NON-TOPIC FIELD ON THE UPDATE ACTION, ONE ASSERTION EACH
  // ---------------------------------------------------------------------------
  // These are the fields a conductor fills in AFTER deciding the topics — the second half of this
  // ward's own workflow. Un-finalizing on any of them makes the finalized state unreachable in
  // practice: you would finalize a month and watch it come undone as you assigned speakers to it.
  const NON_TRIGGERING: readonly [string, unknown][] = [
    ["memberId", MEMBER_ID],
    ["externalSpeaker", { name: "Elder Wright", title: "High Council" }],
    ["slotNumber", 2],
    ["slotLengthMinutes", 12],
    ["assignmentType", "youth_speaker"],
    ["requestOutcome", "accepted"],
    ["requestNotes", "Happy to speak"],
    ["notifyMessage", "Here is your topic"],
    ["notifySentAt", "2027-03-01T12:00:00.000Z"],
    ["sundayConfirmedAt", "2027-03-07T12:00:00.000Z"],
    ["thankYouMessage", "Thank you"],
    ["thankYouSentAt", "2027-03-08T12:00:00.000Z"],
  ];

  for (const [field, value] of NON_TRIGGERING) {
    it(`leaves it finalized when only "${field}" changes`, () => {
      const input = patch({ action: "update", fields: { [field]: value } });

      expect(topicShapeChanged(input)).toBe(false);
    });
  }

  // The sibling that stops the loop above passing because every field silently stopped reaching
  // the schema. If Zod ever strips one of these, this fails rather than the loop going green on
  // twelve empty objects.
  it("keeps every non-triggering field in the parsed patch", () => {
    for (const [field, value] of NON_TRIGGERING) {
      const input = patch({ action: "update", fields: { [field]: value } });

      expect(
        input.action === "update" && field in input.fields,
        `"${field}" was stripped by the schema — this loop is asserting nothing`,
      ).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// THE CALL SITES, READ OUT OF THE SOURCE
// ---------------------------------------------------------------------------
// No assertion about BEHAVIOUR can see a fourth write path that forgot to call the helper — the
// failure is a line that is not there. So this reads the routes the way
// tests/lib/explicitTimeZone.test.ts and tests/lib/navigationRoutesExist.test.ts read source and
// the filesystem: the only instrument that can catch the thing that actually goes wrong here.
//
// It is deliberately NOT a search for "every route that writes assignments" — that would be a
// second definition of the rule, kept here, drifting from the one in lib/topics/finalize.ts. It
// is a named list, and adding a write path means adding a line to it on purpose.
//
// Since p4-sacrament-c the helper also clears `references_finalized_at` (decision 2), so these
// three call sites un-finalize References too. tests/routes/talk-references.test.ts asserts that.
describe("the three write paths all clear the stamp", () => {
  const CALL_SITES = [
    "app/api/assignments/route.ts",
    "app/api/assignments/[id]/route.ts",
    "app/api/sundays/[id]/route.ts",
  ] as const;

  function sourceOf(relative: string): string {
    return readFileSync(path.resolve(process.cwd(), relative), "utf8");
  }

  for (const relative of CALL_SITES) {
    it(`${relative} calls unfinalizeTopicsIfNeeded`, () => {
      const source = sourceOf(relative);

      expect(
        source,
        `${relative} writes a Sunday's shape and must clear the topics-finalized stamp`,
      ).toContain("unfinalizeTopicsIfNeeded(");
      expect(source).toContain('from "@/lib/topics/finalize"');
    });
  }

  // PATCH /api/assignments/[id] carries BOTH kinds of change, so it is the one route that must
  // ASK rather than always clear. A version of it that cleared unconditionally would pass every
  // assertion above and unravel a month of topics the first time somebody was contacted.
  it("guards the assignment PATCH with topicShapeChanged", () => {
    const source = sourceOf("app/api/assignments/[id]/route.ts");

    expect(source).toContain("if (topicShapeChanged(input))");
  });

  // POST /api/assignments is the opposite: a NEW slot always changes the day, so it must NOT be
  // conditional.
  it("clears unconditionally when an assignment is created", () => {
    const source = sourceOf("app/api/assignments/route.ts");

    expect(source).not.toContain("topicShapeChanged");
  });

  // PATCH /api/sundays/[id] clears only when the SUBMITTED patch names the slot count. Keying on
  // the resulting count instead would fire on a type change that zeroed the slots as a side
  // effect, and would miss a form that submits the field unchanged.
  it("keys the Sunday PATCH on the submitted speakingSlots field", () => {
    const source = sourceOf("app/api/sundays/[id]/route.ts");

    expect(source).toContain("changes.speakingSlots === undefined");
  });
});
