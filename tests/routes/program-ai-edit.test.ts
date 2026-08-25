// @vitest-environment node
//
// POST /api/programs/[id]/ai-edit — the NO-AUTOSAVE test, on the highest-risk AI surface in the
// app.
//
// The claim this suite exists to prove is a negative:
//
//   ASKING FOR A CHANGE WRITES NOTHING TO `programs`. Not draft_data, not status — including
//   after a change the user reads and abandons, and including after a call that fails.
//
// `draft_data` is re-read with the SERVICE client after every call and compared BYTE FOR BYTE
// against what it was before, rather than inferred from the response. Saving is still the
// existing POST /api/programs call made by a person pressing Apply (CLAUDE.md rule 3).
//
// The second claim is the layered-validation one: a response that is structurally fine but
// SCHEMA-INVALID must be refused with a 4xx and a written sentence, not passed through to a
// screen and a printer. The mock is what makes that reachable — the SDK's own parse would
// normally have rejected it first, and the route must not be the layer that trusts it.
//
// See tests/helpers/routeClient.ts for why this needs no server and what exactly is mocked.
// Runs over the network against the shared hosted project (CLAUDE.md §9).

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  actAs,
  errorMessage,
  jsonRequest,
  readResponse,
} from "@/tests/helpers/routeClient";
import { seedFixtures, type Fixtures } from "@/tests/helpers/seed";
import { AI_ERROR_KINDS, AiRequestError, AI_ERROR_STATUSES } from "@/lib/ai/errors";
import type { ProgramDraft } from "@/lib/program/draft";

vi.mock("@/lib/supabase/server", async () => {
  const { serverClientMock } = await import("@/tests/helpers/routeClient");
  return serverClientMock();
});

const callClaudeStructured = vi.fn();

vi.mock("@/lib/ai/client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/ai/client")>("@/lib/ai/client");
  return {
    ...actual,
    callClaudeStructured: (...args: unknown[]) => callClaudeStructured(...args),
  };
});

const SUNDAY_DATE = "2027-09-19";

const ORIGINAL_ANNOUNCEMENTS = "Ward temple night on Thursday.";
const NEW_ANNOUNCEMENTS = "Ward temple night on Thursday. The Primary children will sing.";

function draft(overrides: Partial<ProgramDraft> = {}): ProgramDraft {
  return {
    version: 1,
    heading: null,
    date: SUNDAY_DATE,
    sundayType: "standard",
    presiding: { printedName: "Mark Andersen", publicName: "Mark A." },
    conducting: { printedName: "Peter Lindqvist", publicName: "Peter L." },
    organist: null,
    chorister: null,
    openingHymn: { number: 19, title: "We Thank Thee, O God, for a Prophet" },
    invocation: { printedName: "David Brooks", publicName: "David B." },
    wardBusiness: "Sustaining a new Elders Quorum secretary.",
    sacramentHymn: null,
    specialNotes: null,
    musicalNumber: null,
    speakers: [
      {
        slotNumber: 1,
        kind: "member",
        printedName: "Sarah Whitfield",
        publicName: "Sarah W.",
        topic: "Charity Never Faileth",
      },
      { slotNumber: 2, kind: "empty", printedName: null, publicName: null, topic: null },
    ],
    closingHymn: { number: 152, title: "God Be with You Till We Meet Again" },
    benediction: null,
    announcements: ORIGINAL_ANNOUNCEMENTS,
    leadershipContacts: [],
    missionaries: null,
    missing: ["sacrament_hymn", "benediction", "speaker_slot"],
    ...overrides,
  };
}

function claudeResult(parsed: unknown) {
  return {
    parsed,
    cacheReadTokens: 0,
    cacheCreationTokens: 900,
    inputTokens: 2400,
    outputTokens: 700,
  };
}

// `params` is a Promise in Next 16. Every call in this suite goes through here, so there is no
// second way to get it wrong (plans/retros/route-tests-and-realtime.md).
async function callAiEdit(programId: string, body: unknown) {
  const { POST } = await import("@/app/api/programs/[id]/ai-edit/route");
  const request = jsonRequest(`http://localhost/api/programs/${programId}/ai-edit`, {
    method: "POST",
    body,
  });
  return readResponse(await POST(request, { params: Promise.resolve({ id: programId }) }));
}

describe("POST /api/programs/[id]/ai-edit", () => {
  let fixtures: Fixtures;

  let sundayId = "";
  let programId = "";
  let wardBProgramId = "";

  // The exact bytes of draft_data, read with the service client. Compared as a JSON string
  // rather than field by field, because "nothing changed" is the whole claim and a per-field
  // comparison is a list somebody has to remember to extend.
  async function readStoredDraft(id: string): Promise<string> {
    const { data, error } = await fixtures.service
      .from("programs")
      .select("draft_data, status")
      .eq("id", id)
      .single();

    if (error) throw new Error(`Could not re-read the program: ${error.message}`);
    return JSON.stringify({ draft: data.draft_data, status: data.status });
  }

  async function seedProgram(wardId: string, forSundayId: string): Promise<string> {
    const { data, error } = await fixtures.service
      .from("programs")
      .insert({
        ward_id: wardId,
        sunday_id: forSundayId,
        status: "draft",
        draft_data: draft() as unknown as never,
      })
      .select("id")
      .single();

    if (error) throw new Error(`Could not seed a program: ${error.message}`);
    return data.id;
  }

  async function setStatus(id: string, status: string): Promise<void> {
    const { error } = await fixtures.service
      .from("programs")
      .update({ status })
      .eq("id", id);

    if (error) throw new Error(`Could not set the status: ${error.message}`);
  }

  beforeAll(async () => {
    fixtures = await seedFixtures([
      "bishop",
      "wardSecretary",
      "musicCoordinator",
      "wardBBishop",
    ]);

    const seedSunday = async (wardId: string) => {
      const { data, error } = await fixtures.service
        .from("sundays")
        .insert({ ward_id: wardId, date: SUNDAY_DATE, type: "standard", speaking_slots: 2 })
        .select("id")
        .single();
      if (error) throw new Error(`Could not seed a Sunday: ${error.message}`);
      return data.id;
    };

    sundayId = await seedSunday(fixtures.wardAId);
    programId = await seedProgram(fixtures.wardAId, sundayId);

    const wardBSundayId = await seedSunday(fixtures.wardBId);
    wardBProgramId = await seedProgram(fixtures.wardBId, wardBSundayId);

    await actAs(fixtures, "wardSecretary");
  });

  afterAll(async () => {
    await fixtures?.cleanup();
  });

  beforeEach(async () => {
    callClaudeStructured.mockReset();
    callClaudeStructured.mockResolvedValue(
      claudeResult(draft({ announcements: NEW_ANNOUNCEMENTS })),
    );
    await setStatus(programId, "draft");
  });

  describe("a change the user has not accepted", () => {
    it("returns the proposed draft and the diff", async () => {
      await actAs(fixtures, "wardSecretary");

      const { status, body } = await callAiEdit(programId, {
        draft: draft(),
        history: [],
        instruction: "Add a note that the Primary children will sing.",
      });

      expect(status).toBe(200);

      const proposed = body.draft as ProgramDraft;
      expect(proposed.announcements).toBe(NEW_ANNOUNCEMENTS);

      // Exactly the described field moved. The diff is what makes a silently dropped field
      // visible, and a diff naming more than what was asked for is the failure it catches.
      const changes = body.changes as Array<{ field: string; label: string }>;
      expect(changes).toHaveLength(1);
      expect(changes[0]).toMatchObject({ field: "announcements", label: "Announcements" });
    });

    // THE ASSERTION THIS WHOLE SUITE IS FOR.
    it("writes nothing to the programs row", async () => {
      await actAs(fixtures, "wardSecretary");

      const before = await readStoredDraft(programId);

      await callAiEdit(programId, {
        draft: draft(),
        history: [],
        instruction: "Add a note that the Primary children will sing.",
      });

      expect(await readStoredDraft(programId)).toBe(before);
    });

    // The abandonment case, spelled out separately: a change nobody applied must leave the row
    // exactly as a change nobody asked for would.
    it("still writes nothing after a second change the user abandons", async () => {
      await actAs(fixtures, "wardSecretary");

      const before = await readStoredDraft(programId);

      await callAiEdit(programId, { draft: draft(), history: [], instruction: "One." });
      await callAiEdit(programId, { draft: draft(), history: [], instruction: "Two." });

      expect(await readStoredDraft(programId)).toBe(before);
    });

    // The client sends the draft ON SCREEN, not the stored one, so an unsaved edit is what the
    // model works from. The response must diff against that same draft.
    it("edits the draft in the body rather than the stored one", async () => {
      await actAs(fixtures, "wardSecretary");

      const onScreen = draft({ wardBusiness: "Something the secretary typed but never saved." });

      callClaudeStructured.mockResolvedValue(
        claudeResult({ ...onScreen, announcements: NEW_ANNOUNCEMENTS }),
      );

      const { status, body } = await callAiEdit(programId, {
        draft: onScreen,
        history: [],
        instruction: "Add a note.",
      });

      expect(status).toBe(200);

      const changes = body.changes as Array<{ field: string }>;
      expect(changes.map((change) => change.field)).toEqual(["announcements"]);

      const prompt = (callClaudeStructured.mock.calls.at(-1)?.[0] as { userPrompt: string })
        .userPrompt;
      expect(prompt).toContain("Something the secretary typed but never saved.");
    });
  });

  describe("a response this app cannot print", () => {
    it("refuses a schema-invalid draft with a 4xx and writes nothing", async () => {
      await actAs(fixtures, "wardSecretary");

      const before = await readStoredDraft(programId);

      // Structurally an object, and wrong in the two ways the API cannot constrain: the version
      // literal and the date pattern. Both are downgraded by the SDK into schema descriptions,
      // so this is exactly the shape that reaches a route which trusts `parsed`.
      callClaudeStructured.mockResolvedValue(
        claudeResult({ ...draft(), version: 2, date: "next Sunday" }),
      );

      const { status, body } = await callAiEdit(programId, {
        draft: draft(),
        history: [],
        instruction: "Anything.",
      });

      expect(status).toBe(422);
      expect(errorMessage(body)).toContain("nothing was changed");
      expect(body.draft).toBeUndefined();

      expect(await readStoredDraft(programId)).toBe(before);
    });

    it("refuses a draft that dropped a required field", async () => {
      await actAs(fixtures, "wardSecretary");

      const withoutBenediction: Record<string, unknown> = { ...draft() };
      delete withoutBenediction.benediction;

      callClaudeStructured.mockResolvedValue(claudeResult(withoutBenediction));

      const { status } = await callAiEdit(programId, {
        draft: draft(),
        history: [],
        instruction: "Anything.",
      });

      expect(status).toBe(422);
    });
  });

  describe("the six AI error kinds", () => {
    // Each kind keeps its own status and its own written sentence. Collapsing two of them into
    // one message is the failure lib/ai/errors.ts exists to prevent, and the route must not
    // catch AiRequestError to do it.
    it.each(AI_ERROR_KINDS)("maps %s to its own status", async (kind) => {
      await actAs(fixtures, "wardSecretary");

      const before = await readStoredDraft(programId);
      callClaudeStructured.mockRejectedValue(new AiRequestError(kind));

      const { status, body } = await callAiEdit(programId, {
        draft: draft(),
        history: [],
        instruction: "Anything.",
      });

      expect(status).toBe(AI_ERROR_STATUSES[kind]);
      expect(errorMessage(body)).not.toBe("");

      // A failure leaves the program exactly as it was.
      expect(await readStoredDraft(programId)).toBe(before);
    });

    it("gives the six kinds six distinguishable sentences", async () => {
      await actAs(fixtures, "wardSecretary");

      const sentences: string[] = [];

      for (const kind of AI_ERROR_KINDS) {
        callClaudeStructured.mockRejectedValue(new AiRequestError(kind));
        const { body } = await callAiEdit(programId, {
          draft: draft(),
          history: [],
          instruction: "Anything.",
        });
        sentences.push(errorMessage(body));
      }

      expect(new Set(sentences).size).toBe(AI_ERROR_KINDS.length);
    });
  });

  describe("who may ask for a change", () => {
    // program.build, not program.view. Asking for a change is an act of BUILDING the program and
    // it spends money on an outbound vendor call.
    it("refuses the music coordinator", async () => {
      await actAs(fixtures, "musicCoordinator");

      const { status } = await callAiEdit(programId, {
        draft: draft(),
        history: [],
        instruction: "Anything.",
      });

      expect(status).toBe(403);
      expect(callClaudeStructured).not.toHaveBeenCalled();
    });

    it("lets a member of the bishopric do it without the secretary", async () => {
      await actAs(fixtures, "bishop");

      const { status } = await callAiEdit(programId, {
        draft: draft(),
        history: [],
        instruction: "Add a note.",
      });

      expect(status).toBe(200);
    });

    // A program in another ward and a program RLS refused are indistinguishable, and both mean
    // "not yours".
    it("cannot reach another ward's program", async () => {
      await actAs(fixtures, "wardSecretary");

      const { status } = await callAiEdit(wardBProgramId, {
        draft: draft(),
        history: [],
        instruction: "Anything.",
      });

      expect(status).toBe(404);
      expect(callClaudeStructured).not.toHaveBeenCalled();
    });
  });

  describe("an approved program", () => {
    // Refused for the same reason the refresh route refuses it: an approved program is reopened
    // as a draft on purpose, not edited underneath the bishopric who signed it off.
    it("is refused with a 409 that names the way forward", async () => {
      await actAs(fixtures, "wardSecretary");
      await setStatus(programId, "approved");

      const { status, body } = await callAiEdit(programId, {
        draft: draft(),
        history: [],
        instruction: "Anything.",
      });

      expect(status).toBe(409);
      expect(errorMessage(body)).toContain("Reopen it as a draft");
      expect(callClaudeStructured).not.toHaveBeenCalled();
    });
  });

  describe("the request body", () => {
    it("refuses an empty instruction", async () => {
      await actAs(fixtures, "wardSecretary");

      const { status, body } = await callAiEdit(programId, {
        draft: draft(),
        history: [],
        instruction: "   ",
      });

      expect(status).toBe(400);
      expect(errorMessage(body)).toContain("Say what you would like changed");
      expect(callClaudeStructured).not.toHaveBeenCalled();
    });

    it("refuses a draft that is not a program", async () => {
      await actAs(fixtures, "wardSecretary");

      const { status } = await callAiEdit(programId, {
        draft: { version: 1 },
        history: [],
        instruction: "Anything.",
      });

      expect(status).toBe(400);
      expect(callClaudeStructured).not.toHaveBeenCalled();
    });

    it("carries the conversation into the prompt", async () => {
      await actAs(fixtures, "wardSecretary");

      await callAiEdit(programId, {
        draft: draft(),
        history: [
          { role: "user", content: "Add a note that the Primary children will sing." },
          { role: "assistant", content: "Special notes: nothing → The Primary will sing." },
        ],
        instruction: "Now change the ward business too.",
      });

      const prompt = (callClaudeStructured.mock.calls.at(-1)?.[0] as { userPrompt: string })
        .userPrompt;

      expect(prompt).toContain("Add a note that the Primary children will sing.");
      expect(prompt).toContain("Special notes: nothing → The Primary will sing.");
      expect(prompt).toContain("Now change the ward business too.");
    });

    // Decided server-side, never by the caller. A body that could name its own effort would be
    // spending the ward's money on terms it chose.
    it("calls at medium effort with the draft schema as its output format", async () => {
      await actAs(fixtures, "wardSecretary");

      await callAiEdit(programId, {
        draft: draft(),
        history: [],
        instruction: "Anything.",
      });

      const params = callClaudeStructured.mock.calls.at(-1)?.[0] as {
        effort: string;
        format: unknown;
      };

      expect(params.effort).toBe("medium");
      expect(params.format).toBeDefined();
    });
  });
});
