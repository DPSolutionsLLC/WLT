import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProgramBuilder } from "@/app/(app)/program/[sunday_id]/ProgramBuilder";
import type { DraftChange } from "@/lib/program/diff";
import type { ProgramDraft } from "@/lib/program/draft";

// THE ai-a REGRESSION, ASSERTED ON WHAT IS ON SCREEN.
//
// Restoring a settings version left the form holding the old values while every server-side test
// passed, because router.refresh() PRESERVES client state and the server was right the whole time
// (plans/retros/ai-a-settings-and-preview.md). This screen has that exact shape twice: applying a
// refresh, and applying an AI edit.
//
// So the assertion is on the RENDERED INPUT VALUES, never on a refetch call. A refetch call is
// precisely what passed while the bug was live — a test asking "did we invalidate the query?"
// would have gone green on the broken version.
//
// fireEvent rather than user-event: @testing-library/user-event is not a dependency of this
// project, and every other component suite here drives the DOM the same way.

const ORIGINAL_ANNOUNCEMENTS = "Ward temple night on Thursday.";
const NEW_ANNOUNCEMENTS = "Ward temple night on Thursday. The Primary will sing.";

function draft(overrides: Partial<ProgramDraft> = {}): ProgramDraft {
  return {
    version: 1,
    heading: null,
    date: "2026-09-20",
    sundayType: "standard",
    presiding: { printedName: "Mark Andersen", publicName: "Mark Andersen" },
    conducting: { printedName: "Peter Lindqvist", publicName: "Peter Lindqvist" },
    organist: null,
    chorister: null,
    openingHymn: { number: 19, title: "We Thank Thee, O God, for a Prophet" },
    invocation: { printedName: "David Brooks", publicName: "David Brooks" },
    wardBusiness: null,
    sacramentHymn: null,
    specialNotes: null,
    musicalNumber: null,
    speakers: [
      {
        slotNumber: 1,
        kind: "member",
        printedName: "Sarah Whitfield",
        publicName: "Sarah Whitfield",
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

const AI_CHANGES: DraftChange[] = [
  {
    field: "announcements",
    label: "Announcements",
    before: ORIGINAL_ANNOUNCEMENTS,
    after: NEW_ANNOUNCEMENTS,
  },
];

const REFRESH_CHANGES: DraftChange[] = [
  {
    field: "sacramentHymn",
    label: "Sacrament hymn",
    before: null,
    after: "169 — As Now We Take the Sacrament",
  },
];

const fetchMock = vi.fn();

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

function renderBuilder(
  initialDraft = draft(),
  initialStatus: "draft" | "pending_approval" | "approved" | "distributed" = "draft",
) {
  // retry: false so a queryFn rejection surfaces once rather than as three silent attempts.
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <ProgramBuilder
        sundayId="sunday-1"
        sundayLabel="20 September 2026"
        programId="program-1"
        initialStatus={initialStatus}
        initialDraft={initialDraft}
        canBuild
        // program-d's props. This suite is about the EDITOR — the form state, the cache and the
        // ai-a trap — so distribution is switched off here and covered by its own tests. A
        // canDistribute of false keeps the print-and-send panel out of these queries entirely.
        canDistribute={false}
        pdfUrl={null}
        distributedAt={null}
        recipients={{ count: 0, invalid: [] }}
        emailDisabledReason={null}
      />
    </QueryClientProvider>,
  );
}

function announcementsBox(): HTMLTextAreaElement {
  return screen.getByLabelText("Announcements") as HTMLTextAreaElement;
}

function instructionBox(): HTMLTextAreaElement {
  return screen.getByLabelText("What would you like changed?") as HTMLTextAreaElement;
}

function askFor(instruction: string): void {
  fireEvent.change(instructionBox(), { target: { value: instruction } });
  fireEvent.click(screen.getByRole("button", { name: "Ask for the change" }));
}

// The by-sunday read the TanStack Query cache makes on mount. Every mock below falls through to
// it, so a stray call cannot look like a missing handler.
function loadResponse(): Response {
  return jsonResponse({
    program: { status: "draft", draft: draft(), draftError: null },
  });
}

function lastBodyFor(fragment: string): Record<string, unknown> {
  const calls = fetchMock.mock.calls.filter(([url]) => String(url).includes(fragment));
  const last = calls.at(-1);
  return JSON.parse(String((last?.[1] as RequestInit | undefined)?.body)) as Record<
    string,
    unknown
  >;
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);

  // jsdom does not implement <dialog>, so Modal's showModal() throws and takes the effect with
  // it. Stubbed to the minimum that lets the refresh diff render — the dialog's OWN behaviour
  // (focus trapping, the backdrop, Escape) is deliberately not under test here, for the reason
  // tests/components/roster/MemberPicker.test.tsx records: driving it through jsdom would test
  // the polyfill rather than the component.
  HTMLDialogElement.prototype.showModal = function showModal() {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function close() {
    this.removeAttribute("open");
  };
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("ProgramBuilder — applying an AI edit resets the form", () => {
  beforeEach(() => {
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).includes("/ai-edit")) {
        return jsonResponse({
          draft: draft({ announcements: NEW_ANNOUNCEMENTS }),
          changes: AI_CHANGES,
        });
      }
      return loadResponse();
    });
  });

  it("shows the new value in the input, not the old one", async () => {
    renderBuilder();

    expect(announcementsBox()).toHaveValue(ORIGINAL_ANNOUNCEMENTS);

    askFor("Add a note that the Primary will sing");

    // A diff first. The reply is never applied automatically (CLAUDE.md rule 3).
    const apply = await screen.findByRole("button", { name: "Apply this change" });
    expect(announcementsBox()).toHaveValue(ORIGINAL_ANNOUNCEMENTS);

    fireEvent.click(apply);

    // THE ASSERTION THIS SUITE IS FOR.
    await waitFor(() => expect(announcementsBox()).toHaveValue(NEW_ANNOUNCEMENTS));
  });

  it("does not say the change was saved, because the route saved nothing", async () => {
    renderBuilder();

    askFor("Add a note");
    fireEvent.click(await screen.findByRole("button", { name: "Apply this change" }));

    await waitFor(() => expect(announcementsBox()).toHaveValue(NEW_ANNOUNCEMENTS));

    expect(screen.queryByText("Saved.")).toBeNull();
    expect(screen.getByText(/Save it to keep it/)).toBeInTheDocument();
  });

  // A second instruction must edit the ALREADY-UPDATED draft. That is what makes the conversation
  // a conversation rather than three independent requests.
  it("sends the applied draft and the conversation on the next instruction", async () => {
    renderBuilder();

    askFor("First change");
    fireEvent.click(await screen.findByRole("button", { name: "Apply this change" }));
    await waitFor(() => expect(announcementsBox()).toHaveValue(NEW_ANNOUNCEMENTS));

    askFor("Second change");

    await waitFor(() => {
      const body = lastBodyFor("/ai-edit") as {
        draft: ProgramDraft;
        history: Array<{ role: string; content: string }>;
        instruction: string;
      };

      expect(body.instruction).toBe("Second change");
      expect(body.draft.announcements).toBe(NEW_ANNOUNCEMENTS);
      expect(body.history).toHaveLength(2);
      expect(body.history[0]).toMatchObject({ role: "user", content: "First change" });
      expect(body.history[1]?.role).toBe("assistant");
    });
  });

  // A proposal the user discarded is not part of the conversation the next instruction edits
  // from — recording it would have the model working forward from a draft nobody accepted.
  it("keeps a discarded proposal out of the history", async () => {
    renderBuilder();

    askFor("First change");
    fireEvent.click(await screen.findByRole("button", { name: "Discard it" }));

    askFor("Second change");

    await waitFor(() => {
      const body = lastBodyFor("/ai-edit") as { history: unknown[] };
      expect(body.history).toHaveLength(0);
    });

    expect(announcementsBox()).toHaveValue(ORIGINAL_ANNOUNCEMENTS);
  });
});

describe("ProgramBuilder — applying a refresh resets the form", () => {
  const refreshed = draft({
    sacramentHymn: { number: 169, title: "As Now We Take the Sacrament" },
    missing: ["benediction", "speaker_slot"],
  });

  beforeEach(() => {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (String(url).includes("/refresh")) {
        const body = JSON.parse(String(init?.body)) as { apply: boolean };
        return jsonResponse({
          program: { status: "draft", draft: body.apply ? refreshed : draft() },
          changes: REFRESH_CHANGES,
          applied: body.apply,
        });
      }
      return loadResponse();
    });
  });

  it("shows the refreshed value in the input", async () => {
    renderBuilder();

    expect(screen.getByLabelText("Sacrament hymn title")).toHaveValue("");

    fireEvent.click(screen.getByRole("button", { name: "Check for changes" }));

    // Worded by consequence, not by mechanism (plans/retros/calendar-b-month-and-sunday.md).
    const apply = await screen.findByRole("button", { name: "Apply this change" });
    expect(screen.getByLabelText("Sacrament hymn title")).toHaveValue("");

    fireEvent.click(apply);

    await waitFor(() =>
      expect(screen.getByLabelText("Sacrament hymn title")).toHaveValue(
        "As Now We Take the Sacrament",
      ),
    );
  });

  it("asks before it applies — the first call writes nothing", async () => {
    renderBuilder();

    fireEvent.click(screen.getByRole("button", { name: "Check for changes" }));
    await screen.findByRole("button", { name: "Apply this change" });

    const refreshCalls = fetchMock.mock.calls.filter(([url]) =>
      String(url).includes("/refresh"),
    );

    expect(refreshCalls).toHaveLength(1);
    expect(lastBodyFor("/refresh")).toEqual({ apply: false });
  });
});

describe("ProgramBuilder — sending for approval says only what it did", () => {
  // THE DEFECT WALKING SCENARIO 031 FOUND. This printed "Sent for approval. The bishopric has
  // been notified." while ZERO rows were written to `notifications` — emitNotification is
  // fire-and-forget and returns silently on an unknown trigger key, so this screen cannot know
  // whether anybody was notified.
  //
  // A claim the client cannot verify is the silent-failure rule pointed the other way: not a
  // failure hidden from the user, but a success invented for them.
  it("does not claim the bishopric was notified", async () => {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (String(url) === "/api/programs") {
        const body = JSON.parse(String(init?.body)) as { action: string };
        if (body.action === "status") {
          return jsonResponse({ program: { status: "pending_approval", draft: draft() } });
        }
      }
      return loadResponse();
    });

    renderBuilder();

    fireEvent.click(screen.getByRole("button", { name: "Send for approval" }));

    expect(await screen.findByText("Sent for approval.")).toBeInTheDocument();
    expect(screen.queryByText(/notified/i)).toBeNull();
  });

  // The Send control goes; Save STAYS. A program at pending_approval is deliberately still
  // editable — isLocked() covers approved and distributed only — which the walk confirmed by
  // saving one and re-reading the row.
  it("drops the send control but keeps the save one", async () => {
    // The mock holds SERVER STATE rather than answering every read with "draft". Without that, a
    // background refetch lands after the status write and reverts the badge — which is a mock
    // artifact, but only because the real route would report the new status. Modelling it is
    // what makes this test about the component instead of about the stub.
    let serverStatus = "draft";

    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (String(url) === "/api/programs") {
        const body = JSON.parse(String(init?.body)) as { action: string; to?: string };
        if (body.action === "status") {
          serverStatus = body.to ?? "pending_approval";
          return jsonResponse({ program: { status: serverStatus, draft: draft() } });
        }
      }
      return jsonResponse({
        program: { status: serverStatus, draft: draft(), draftError: null },
      });
    });

    renderBuilder();
    fireEvent.click(screen.getByRole("button", { name: "Send for approval" }));

    await screen.findByText("Sent for approval.");

    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Send for approval" })).toBeNull(),
    );
    expect(screen.getByRole("button", { name: "Save the program" })).toBeInTheDocument();
  });
});

describe("ProgramBuilder — a failed AI edit changes nothing", () => {
  it("shows the route's own sentence and clears nothing", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).includes("/ai-edit")) {
        return jsonResponse(
          { error: "The AI service is busy. Wait a moment and try again — nothing was lost." },
          429,
        );
      }
      return loadResponse();
    });

    renderBuilder();

    askFor("Add a note");

    // The route's OWN written sentence, not a re-worded generic one. Six distinguishable
    // failures must stay six (plans/retros/ai-c-feature-routes.md).
    expect(
      await screen.findByText(
        "The AI service is busy. Wait a moment and try again — nothing was lost.",
      ),
    ).toBeInTheDocument();

    // NOTHING IS CLEARED ON FAILURE — not the draft, and not what the user typed.
    expect(announcementsBox()).toHaveValue(ORIGINAL_ANNOUNCEMENTS);
    expect(instructionBox()).toHaveValue("Add a note");
  });
});

describe("ProgramBuilder — an approved program offers no way to change it", () => {
  beforeEach(() => {
    fetchMock.mockImplementation(async () =>
      jsonResponse({ program: { status: "approved", draft: draft(), draftError: null } }),
    );
  });

  // HIDDEN, not disabled. Both routes refuse it with a 409, and a disabled control reads as
  // "this is coming" when the truth is that the program must be reopened first.
  it("hides the refresh and AI panels rather than disabling them", () => {
    renderBuilder(draft(), "approved");

    expect(screen.queryByRole("button", { name: "Check for changes" })).toBeNull();
    expect(screen.queryByLabelText("What would you like changed?")).toBeNull();
    expect(screen.queryByRole("button", { name: "Save the program" })).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------
// THE DEAD-END REGRESSION
// ---------------------------------------------------------------------------------------------
// Walking scenario 033 found this screen printing "Reopen it as a draft to change it" with NO
// BUTTON ANYWHERE: the sentence rendered inside the locked branch while every action sat inside
// `!locked`, so the instruction appeared exactly where the control did not.
//
// These tests assert the PAIRING — an instruction and the control it names — rather than either
// half alone. A test that only checked for the button would still pass if somebody rewrote the
// sentence to describe something else, and a test that only checked the sentence is what was there
// before, passing, while the feature was unusable.
describe("ProgramBuilder — reopening an approved program", () => {
  beforeEach(() => {
    fetchMock.mockImplementation(async () =>
      jsonResponse({ program: { status: "draft", draft: draft(), draftError: null } }),
    );
  });

  it("offers the button the locked sentence tells you to press", () => {
    renderBuilder(draft(), "approved");

    expect(screen.getByText(/Reopen it as a draft to change it/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reopen as a draft" })).toBeInTheDocument();
  });

  it("asks the status route to move the program back to draft", async () => {
    renderBuilder(draft(), "approved");

    fireEvent.click(screen.getByRole("button", { name: "Reopen as a draft" }));

    // The POST, not fetchMock.mock.calls[0] — the builder's own load query fires a GET to
    // /api/programs/by-sunday first, and asserting on call zero picks that up instead.
    const post = await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        ([, init]) => (init as RequestInit | undefined)?.method === "POST",
      );
      expect(call).toBeTruthy();
      return call as [string, RequestInit];
    });

    expect(post[0]).toBe("/api/programs");
    expect(JSON.parse(post[1].body as string)).toEqual({
      action: "status",
      programId: "program-1",
      to: "draft",
    });
  });

  // "Reopen" does not sound like "unpublish", and it does both — setProgramStatus clears
  // public_data in the same UPDATE. A bishopric member pressing this deserves to be told.
  it("says the program has left the public page, not merely that it reopened", async () => {
    renderBuilder(draft(), "approved");

    fireEvent.click(screen.getByRole("button", { name: "Reopen as a draft" }));

    expect(
      await screen.findByText("Reopened as a draft. It is no longer on the public page."),
    ).toBeInTheDocument();
  });

  it("surfaces a refusal rather than silently doing nothing", async () => {
    // Only the POST fails. Failing every request would make the LOAD query error too, and the
    // same sentence would render twice from two different causes — a test that passes without
    // proving which code path produced it.
    fetchMock.mockImplementation(async (_url: string, init?: RequestInit) =>
      init?.method === "POST"
        ? jsonResponse({ error: "Somebody else changed this program a moment ago." }, 409)
        : jsonResponse({ program: { status: "approved", draft: draft(), draftError: null } }),
    );

    renderBuilder(draft(), "approved");

    fireEvent.click(screen.getByRole("button", { name: "Reopen as a draft" }));

    expect(
      await screen.findByText("Somebody else changed this program a moment ago."),
    ).toBeInTheDocument();
  });

  // A DISTRIBUTED program has no path back — LEGAL_TRANSITIONS gives it none, because an emailed
  // PDF cannot be recalled. Offering the button would be offering a request the route always
  // refuses, which is the same dead end pointed the other way.
  it("offers no reopen button once a program is distributed, and says why", () => {
    renderBuilder(draft(), "distributed");

    expect(screen.queryByRole("button", { name: "Reopen as a draft" })).toBeNull();
    expect(screen.getByText(/cannot be reopened/)).toBeInTheDocument();
    expect(screen.queryByText(/Reopen it as a draft to change it/)).toBeNull();
  });
});
