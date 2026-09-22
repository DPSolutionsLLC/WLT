// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  QuickLinksButton,
  type QuickLinksButtonProps,
} from "@/components/layout/QuickLinksButton";
import { NAVIGATION_ITEMS, type NavigationItem } from "@/lib/auth/navigation";

// ---------------------------------------------------------------------------
// THE COUNT IS OF ALL THE PINS, NOT OF THE PINS MATCHING THE DASHBOARD'S SEARCH BOX
// ---------------------------------------------------------------------------
// This button sits beside a search box that filters the grid, and "a count beside a filtered list
// counts the unfiltered rows" is a bug this codebase has recorded four times — `roster-b`,
// restated by `visits-b`, `visits-f` and `youth-g`. A component test is the only place it can be
// caught: the number looks perfectly plausible on screen either way.
//
// The strongest form of the assertion available is that the component TAKES NO SEARCH TERM AT
// ALL, so there is nothing for a future version to accidentally filter on. That is asserted
// structurally, on the prop type, as well as behaviourally below.

// jsdom implements <dialog> as an element but not its two METHODS, so Modal's effect throws the
// moment it opens. Shimmed here rather than in tests/setup.ts, and only these two, because the
// repo's standing position (tests/components/roster/MemberPicker.test.tsx) is that driving the
// native dialog through jsdom tests the polyfill rather than the component. That holds for a
// picker with an inline mode; this component has no life outside its modal, so the smallest shim
// that makes its OWN logic reachable is the honest trade. What the dialog does on a real device
// is the harness's job.
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    this.open = false;
  };
});

function itemFor(href: string): NavigationItem {
  const item = NAVIGATION_ITEMS.find((candidate) => candidate.href === href);
  if (!item) throw new Error(`No navigation item for ${href}`);
  return item;
}

const ROSTER = itemFor("/roster");
const VISITS = itemFor("/visits");
const MUSIC = itemFor("/music");

function mockFetch(result: { ok: boolean; body: unknown }): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: result.ok, json: async () => result.body }) as Response),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("QuickLinksButton count", () => {
  it("counts every pin", () => {
    render(
      <QuickLinksButton
        items={[ROSTER, VISITS, MUSIC]}
        pinnedHrefs={["/roster", "/visits", "/music"]}
      />,
    );

    expect(screen.getByRole("button", { name: /3 pinned/ })).toBeInTheDocument();
  });

  // THE HEADLINE ASSERTION. There is no `searchTerm` prop, so the count cannot be the filtered
  // one — this is what that guarantee looks like from the outside.
  it("accepts no search term, so a filter cannot reach the count", () => {
    const props = {
      items: [ROSTER, VISITS, MUSIC],
      pinnedHrefs: ["/roster", "/visits", "/music"],
      // Passed deliberately, and the cast is the assertion: `searchTerm` is not in
      // QuickLinksButtonProps, so it is ignored. If somebody adds it, this is what makes them
      // read the header above first.
      searchTerm: "music",
    } as unknown as QuickLinksButtonProps;

    render(<QuickLinksButton {...props} />);

    expect(screen.getByRole("button", { name: /3 pinned/ })).toBeInTheDocument();
  });

  it("does not count a pin whose module this person cannot reach", () => {
    // A calling changed and /visits went with it. The pin is stale, not a tile — counting it
    // would promise a shortcut to a page they would be refused.
    render(<QuickLinksButton items={[ROSTER, MUSIC]} pinnedHrefs={["/roster", "/visits"]} />);

    expect(screen.getByRole("button", { name: /1 pinned/ })).toBeInTheDocument();
  });

  it("counts nothing when nothing is pinned", () => {
    render(<QuickLinksButton items={[ROSTER, VISITS]} pinnedHrefs={[]} />);

    expect(screen.getByRole("button", { name: /0 pinned/ })).toBeInTheDocument();
  });
});

describe("QuickLinksButton modal", () => {
  function openModal(pinnedHrefs: string[]) {
    render(<QuickLinksButton items={[ROSTER, VISITS, MUSIC]} pinnedHrefs={pinnedHrefs} />);
    fireEvent.click(screen.getByRole("button", { name: /pinned/ }));
  }

  it("says so in words when nothing is pinned, rather than showing an empty list", () => {
    openModal([]);

    expect(screen.getByText(/Nothing is pinned yet/)).toBeInTheDocument();
  });

  it("pins a module and saves it", async () => {
    mockFetch({ ok: true, body: { quickLinks: ["/visits"] } });
    openModal([]);

    fireEvent.click(screen.getByRole("button", { name: "Pin Visits" }));

    await waitFor(() => expect(fetch).toHaveBeenCalled());
    const [, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      quickLinks: ["/visits"],
    });
  });

  // REORDER WITH BUTTONS, NOT ONLY WITH DRAG. A drag-only reorder is unreachable by keyboard.
  it("offers a keyboard-reachable reorder", async () => {
    mockFetch({ ok: true, body: { quickLinks: ["/visits", "/roster"] } });
    openModal(["/roster", "/visits"]);

    fireEvent.click(screen.getByRole("button", { name: "Move Visits up" }));

    await waitFor(() => expect(fetch).toHaveBeenCalled());
    const [, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      quickLinks: ["/visits", "/roster"],
    });
  });

  it("does not offer a move that would go off the end of the list", () => {
    openModal(["/roster", "/visits"]);

    expect(screen.getByRole("button", { name: "Move Roster up" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Move Visits down" })).toBeDisabled();
  });

  // An optimistic update that silently keeps a change the server refused leaves somebody looking
  // at pins they do not have (CLAUDE.md rule 7).
  it("puts the pins back and says so when the save is refused", async () => {
    mockFetch({ ok: false, body: { error: "Could not save your pinned links. Please try again." } });
    openModal(["/roster"]);

    fireEvent.click(screen.getByRole("button", { name: "Pin Visits" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/Could not save your pinned links/);

    const ordered = screen.getByRole("list", { name: "Pinned links, in order" });
    expect(within(ordered).queryByText("Visits")).toBeNull();
  });
});
