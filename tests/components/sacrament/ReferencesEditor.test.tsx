// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ReferencesEditor } from "@/components/sacrament/ReferencesEditor";
import type { SundayReferences, TalkReference } from "@/types/domain";

// The References modal's body and its two windows (p4-sacrament-c, reworked after walking
// scenario 074). `fetch` is stubbed: the GET answers with the payload under test, the search with
// the suggestions a test supplies, and every write with 201/200.

// jsdom has no showModal; the same stub QuickLinksButton.test.tsx uses. Focus trapping and the
// backdrop are the platform's job, which the harness walks.
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    this.open = false;
  };
});

const SUNDAY_ID = "sunday-1";

function reference(overrides: Partial<TalkReference> = {}): TalkReference {
  return {
    id: "ref-1",
    assignmentId: "talk-1",
    kind: "scripture",
    citation: "Alma 32:21",
    documentId: null,
    source: "manual",
    createdAt: "2027-03-01T00:00:00Z",
    ...overrides,
  };
}

function payload(overrides: Partial<SundayReferences> = {}): SundayReferences {
  return {
    decision: null,
    talks: [
      {
        assignmentId: "talk-1",
        slotNumber: 1,
        topicTitle: "Faith",
        speakerName: "Sarah Whitfield",
        suggestedScriptures: ["Hebrews 11:1", "Alma 32:21"],
      },
      {
        assignmentId: "talk-2",
        slotNumber: 2,
        topicTitle: "Hope",
        speakerName: null,
        suggestedScriptures: [],
      },
    ],
    references: [],
    ...overrides,
  };
}

type Call = { url: string; method: string; body: unknown };

function stubFetch(data: SundayReferences, suggestions: unknown[] = []) {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });

      const body = url.endsWith("/search")
        ? { suggestions }
        : method === "GET"
          ? data
          : { decision: null };
      return new Response(JSON.stringify(body), {
        status: method === "POST" && !url.endsWith("/search") ? 201 : 200,
        headers: { "Content-Type": "application/json" },
      });
    }),
  );
  return calls;
}

function renderEditor() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  return render(
    <QueryClientProvider client={queryClient}>
      <ReferencesEditor sundayId={SUNDAY_ID} onChanged={() => {}} />
    </QueryClientProvider>,
  );
}

function openDialog(): HTMLElement {
  const dialog = document.querySelectorAll("dialog[open]");
  return dialog[dialog.length - 1] as HTMLElement;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ReferencesEditor — the list", () => {
  it("renders a section per talk, with Search and Add manually on its title row", async () => {
    stubFetch(payload());
    renderEditor();

    expect(await screen.findByRole("heading", { name: "Talk 1: Faith" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Talk 2: Hope" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Search — Talk 1: Faith" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Add manually — Talk 1: Faith" }),
    ).toBeInTheDocument();
  });

  // The walk's "busy and messy" finding: no search field or manual row under each talk any more.
  it("shows no search field and no manual row until a window is opened", async () => {
    stubFetch(payload());
    renderEditor();

    await screen.findByRole("heading", { name: "Talk 1: Faith" });
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByRole("combobox")).toBeNull();
  });

  it("never calls the corpus the ward's", async () => {
    stubFetch(payload());
    renderEditor();

    const intro = await screen.findByText(/Nothing is chosen for you/);
    expect(intro.textContent).not.toMatch(/ward/i);
  });

  it("points to the Sunday's page when there are no topics", async () => {
    stubFetch(payload({ talks: [] }));
    renderEditor();

    expect(await screen.findByText(/No topics yet/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /this Sunday's page/ })).toHaveAttribute(
      "href",
      `/assignments/${SUNDAY_ID}`,
    );
  });

  it("puts Remove as an icon beside its citation, on the same row", async () => {
    stubFetch(payload({ references: [reference()] }));
    renderEditor();

    const remove = await screen.findByRole("button", { name: "Remove Alma 32:21" });
    const row = remove.closest("li");
    expect(row).not.toBeNull();
    expect(within(row!).getByText("Alma 32:21")).toBeInTheDocument();
    expect(remove.textContent).toBe("");
  });

  it("disables Finalize at zero references", async () => {
    stubFetch(payload());
    renderEditor();

    expect(await screen.findByRole("button", { name: "Finalize references" })).toBeDisabled();
  });

  it("lets an empty Sunday be skipped", async () => {
    stubFetch(payload());
    renderEditor();

    expect(await screen.findByRole("checkbox")).not.toBeDisabled();
  });

  // Defect 074-D1: skipping over references that exist is two claims on one pill.
  it("refuses a skip while references exist, and says what to do", async () => {
    stubFetch(payload({ references: [reference()] }));
    renderEditor();

    const skip = await screen.findByRole("checkbox");
    expect(skip).toBeDisabled();
    expect(skip).toHaveAccessibleDescription("Remove the references first to skip this Sunday.");
  });

  it("disables the skip checkbox while finalized", async () => {
    stubFetch(payload({ decision: "finalized", references: [reference()] }));
    renderEditor();

    expect(await screen.findByRole("checkbox")).toBeDisabled();
  });

  it("reads one reference in the singular", async () => {
    stubFetch(payload({ decision: "finalized", references: [reference()] }));
    renderEditor();

    expect(await screen.findByText("✓ Finalized — 1 reference ready.")).toBeInTheDocument();
  });

  it("reads several references in the plural", async () => {
    stubFetch(
      payload({
        decision: "finalized",
        references: [reference(), reference({ id: "ref-2", citation: "Ether 12:27" })],
      }),
    );
    renderEditor();

    expect(await screen.findByText("✓ Finalized — 2 references ready.")).toBeInTheDocument();
  });

  it("reads a skipped Sunday as nothing to finalize", async () => {
    stubFetch(payload({ decision: "skipped" }));
    renderEditor();

    expect(
      await screen.findByText("Skipped for this Sunday — nothing to finalize."),
    ).toBeInTheDocument();
    expect(screen.getByRole("checkbox")).toBeChecked();
  });
});

describe("ReferencesEditor — the search window", () => {
  const RESULTS = [
    {
      kind: "talk",
      citation: "The Power of Covenants — Elder Example, April 2025",
      documentId: "doc-2",
      snippet: "Covenants bind us",
      similarity: 0.38,
    },
  ];

  it("searches the topic the moment it opens, with the words left editable", async () => {
    const calls = stubFetch(payload(), RESULTS);
    renderEditor();

    fireEvent.click(await screen.findByRole("button", { name: "Search — Talk 1: Faith" }));

    const dialog = openDialog();
    expect(within(dialog).getByLabelText("Search the scriptures and conference talks")).toHaveValue(
      "Faith",
    );
    await within(dialog).findByText("General conference talks");

    const search = calls.find((call) => call.url.endsWith("/search"));
    expect(search?.body).toEqual({ assignmentId: "talk-1", query: "Faith" });
  });

  it("offers the topic's suggested scriptures, and marks one already on the talk as Added", async () => {
    stubFetch(payload({ references: [reference({ citation: "Alma 32:21" })] }), RESULTS);
    renderEditor();

    fireEvent.click(await screen.findByRole("button", { name: "Search — Talk 1: Faith" }));
    const dialog = openDialog();

    const suggested = within(dialog).getByRole("group", { name: "Suggested for this topic" });
    expect(within(suggested).getByText("Hebrews 11:1")).toBeInTheDocument();
    expect(within(suggested).getByText("Added")).toBeInTheDocument();
    expect(within(suggested).getAllByRole("checkbox")[1]).toBeDisabled();
  });

  it("adds every ticked item, suggested and found, in one press", async () => {
    const calls = stubFetch(payload(), RESULTS);
    renderEditor();

    fireEvent.click(await screen.findByRole("button", { name: "Search — Talk 1: Faith" }));
    const dialog = openDialog();
    await within(dialog).findByText("General conference talks");

    fireEvent.click(within(dialog).getByRole("checkbox", { name: /Hebrews 11:1/ }));
    fireEvent.click(within(dialog).getByRole("checkbox", { name: /The Power of Covenants/ }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Add 2 references" }));

    await waitFor(() =>
      expect(calls.filter((call) => call.method === "POST" && !call.url.endsWith("/search"))).toHaveLength(2),
    );

    const posted = calls
      .filter((call) => call.method === "POST" && !call.url.endsWith("/search"))
      .map((call) => call.body);
    expect(posted).toContainEqual({
      assignmentId: "talk-1",
      kind: "scripture",
      citation: "Hebrews 11:1",
      source: "manual",
    });
    expect(posted).toContainEqual({
      assignmentId: "talk-1",
      kind: "talk",
      citation: "The Power of Covenants — Elder Example, April 2025",
      source: "search",
      documentId: "doc-2",
    });
  });

  it("says so when nothing matched", async () => {
    stubFetch(payload(), []);
    renderEditor();

    fireEvent.click(await screen.findByRole("button", { name: "Search — Talk 2: Hope" }));

    expect(
      await within(openDialog()).findByText(/Nothing matched closely enough/),
    ).toBeInTheDocument();
  });

  it("closes only itself, leaving the References list behind it", async () => {
    stubFetch(payload(), RESULTS);
    renderEditor();

    fireEvent.click(await screen.findByRole("button", { name: "Search — Talk 1: Faith" }));
    fireEvent.click(within(openDialog()).getByRole("button", { name: "Cancel" }));

    await waitFor(() => expect(document.querySelectorAll("dialog[open]")).toHaveLength(0));
    expect(screen.getByRole("heading", { name: "Talk 1: Faith" })).toBeInTheDocument();
  });
});

describe("ReferencesEditor — the free search above the talks", () => {
  const RESULTS = [
    {
      kind: "scripture",
      citation: "Alma 32",
      documentId: "doc-1",
      snippet: "Faith is not to have a perfect knowledge",
      similarity: 0.41,
    },
  ];

  it("opens empty, searches nothing until asked, and offers no topic suggestions", async () => {
    const calls = stubFetch(payload(), RESULTS);
    renderEditor();

    fireEvent.click(await screen.findByRole("button", { name: "Search any topic" }));
    const dialog = openDialog();

    expect(within(dialog).getByLabelText("Search the scriptures and conference talks")).toHaveValue(
      "",
    );
    expect(within(dialog).queryByRole("group", { name: "Suggested for this topic" })).toBeNull();
    expect(calls.some((call) => call.url.endsWith("/search"))).toBe(false);
    expect(within(dialog).getByText("Select one or more, then press Add.")).toBeInTheDocument();
  });

  it("adds the picks to the talk chosen in Add to", async () => {
    const calls = stubFetch(payload(), RESULTS);
    renderEditor();

    fireEvent.click(await screen.findByRole("button", { name: "Search any topic" }));
    const dialog = openDialog();

    const addTo = within(dialog).getByLabelText("Add to");
    expect(within(addTo).getAllByRole("option").map((option) => option.textContent)).toEqual([
      "Talk 1: Faith",
      "Talk 2: Hope",
    ]);
    fireEvent.change(addTo, { target: { value: "talk-2" } });

    fireEvent.change(within(dialog).getByLabelText("Search the scriptures and conference talks"), {
      target: { value: "seeds of faith" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Search" }));

    fireEvent.click(await within(dialog).findByRole("checkbox", { name: /^Alma 32/ }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Add 1 reference" }));

    await waitFor(() =>
      expect(
        calls.find((call) => call.method === "POST" && !call.url.endsWith("/search"))?.body,
      ).toEqual({
        assignmentId: "talk-2",
        kind: "scripture",
        citation: "Alma 32",
        source: "search",
        documentId: "doc-1",
      }),
    );
    expect(calls.find((call) => call.url.endsWith("/search"))?.body).toEqual({
      assignmentId: "talk-2",
      query: "seeds of faith",
    });
  });
});

describe("ReferencesEditor — the manual window", () => {
  it("offers only Scripture and General conference talk", async () => {
    stubFetch(payload());
    renderEditor();

    fireEvent.click(await screen.findByRole("button", { name: "Add manually — Talk 1: Faith" }));

    const options = within(openDialog())
      .getAllByRole("option")
      .map((option) => option.textContent);
    expect(options).toEqual(["Scripture", "General conference talk"]);
  });

  it("adds what was typed as a manual reference", async () => {
    const calls = stubFetch(payload());
    renderEditor();

    fireEvent.click(await screen.findByRole("button", { name: "Add manually — Talk 1: Faith" }));
    const dialog = openDialog();

    fireEvent.change(within(dialog).getByRole("combobox"), { target: { value: "talk" } });
    fireEvent.change(within(dialog).getByLabelText("Reference"), {
      target: { value: "Faith to Move Mountains — April 2021" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Add" }));

    await waitFor(() =>
      expect(calls.find((call) => call.method === "POST")?.body).toEqual({
        assignmentId: "talk-1",
        kind: "talk",
        citation: "Faith to Move Mountains — April 2021",
        source: "manual",
      }),
    );
  });
});
