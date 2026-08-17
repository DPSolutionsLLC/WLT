// The behaviours a filter test cannot reach: what a tap actually does. These three are the ones
// a later phase would notice first if they broke — single-select silently appending would give
// Phase 4 two speakers in one slot, and a `max` that ignores a tap rather than refusing it reads
// as a broken screen.
//
// Rendered in `mode: "inline"` deliberately. The modal shell is the native <dialog> element,
// whose showModal() behaviour belongs to the browser rather than to this component — driving it
// through jsdom would test the polyfill, not the picker. The harness scenario covers the dialog
// on a real device, which is where its actual job (usable one-handed at 375px) can be judged.

import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemberPicker, type MemberPickerProps } from "@/components/roster/MemberPicker";
import type { Member } from "@/lib/roster/queries";
import type { SessionUser } from "@/types/domain";

const ANDERSEN_HOUSEHOLD_ID = "00000000-0000-4000-8000-0000000000h1";

const BISHOP: SessionUser = {
  id: "00000000-0000-4000-8000-000000000001",
  wardId: "00000000-0000-4000-8000-000000000002",
  role: "bishop",
  orgId: null,
  counselorPosition: null,
  firstName: "Test",
  lastName: "Bishop",
  username: null,
  themePreference: "system",
  isActive: true,
};

function member(id: string, firstName: string, lastName: string): Member {
  return {
    id,
    householdId: ANDERSEN_HOUSEHOLD_ID,
    firstName,
    lastName,
    category: "adult",
    gender: "male",
    status: "active",
    phone: null,
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

const MEMBERS = [
  member("m-mark", "Mark", "Andersen"),
  member("m-ethan", "Ethan", "Andersen"),
];

// Controlled from the outside, the way every real consumer uses it. `latestValue` records what
// the parent was HANDED, so the assertions read the value that would have reached Phase 4 rather
// than whatever the component rendered about itself. Written from the change handler, never
// during render.
let latestValue: readonly string[] = [];

function PickerHarness(props: Partial<MemberPickerProps> & { initial?: string[] }) {
  const { initial = [], ...rest } = props;
  const [value, setValue] = useState<readonly string[]>(initial);

  function handleChange(next: string[]): void {
    latestValue = next;
    setValue(next);
  }

  return (
    <MemberPicker
      value={value}
      onChange={handleChange}
      user={BISHOP}
      mode="inline"
      {...rest}
    />
  );
}

function renderPicker(props: Partial<MemberPickerProps> & { initial?: string[] } = {}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  latestValue = props.initial ?? [];

  return render(
    <QueryClientProvider client={queryClient}>
      <PickerHarness {...props} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  latestValue = [];

  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string) => ({
      ok: true,
      json: async () =>
        input.startsWith("/api/households")
          ? { households: [{ id: ANDERSEN_HOUSEHOLD_ID, familyName: "Andersen" }] }
          : { members: MEMBERS },
    })),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("MemberPicker selection", () => {
  it("replaces the selection in single mode rather than appending", async () => {
    renderPicker();

    fireEvent.click(await screen.findByRole("button", { name: "Mark Andersen" }));
    await waitFor(() => expect(latestValue).toEqual(["m-mark"]));

    fireEvent.click(screen.getByRole("button", { name: "Ethan Andersen" }));

    // The whole reason Decision 1 made this controlled: a single-select picker that appended
    // would hand Phase 4 two speakers for one slot.
    await waitFor(() => expect(latestValue).toEqual(["m-ethan"]));
  });

  it("appends in multiple mode", async () => {
    renderPicker({ multiple: true });

    fireEvent.click(await screen.findByRole("button", { name: "Mark Andersen" }));
    await waitFor(() => expect(latestValue).toEqual(["m-mark"]));

    fireEvent.click(screen.getByRole("button", { name: "Ethan Andersen" }));
    await waitFor(() => expect(latestValue).toEqual(["m-mark", "m-ethan"]));
  });

  // Disabled with a reason on screen, never a tap that silently does nothing. On a phone, a row
  // that ignores a press is indistinguishable from an app that has frozen.
  it("disables the remaining rows once max is reached", async () => {
    renderPicker({ multiple: true, max: 1, initial: ["m-mark"] });

    const remaining = await screen.findByRole("button", { name: "Ethan Andersen" });

    expect(remaining).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent(
      "1 selected, which is the most this allows.",
    );
  });

  it("leaves an already-selected row enabled at max, so it can be removed", async () => {
    renderPicker({ multiple: true, max: 1, initial: ["m-mark"] });

    expect(await screen.findByRole("button", { name: "Mark Andersen" })).toBeEnabled();
  });

  it("removes a member when their chip is clicked", async () => {
    renderPicker({ multiple: true, initial: ["m-mark", "m-ethan"] });

    fireEvent.click(await screen.findByRole("button", { name: "Remove Mark Andersen" }));

    await waitFor(() => expect(latestValue).toEqual(["m-ethan"]));
  });
});

describe("MemberPicker empty states", () => {
  // "Nobody is in the roster" and "nobody matches what you asked for" send the user looking for
  // different problems, so they must not share a message.
  it("distinguishes an empty roster from an empty filter result", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string) => ({
        ok: true,
        json: async () =>
          input.startsWith("/api/households") ? { households: [] } : { members: [] },
      })),
    );

    renderPicker({ emptyMessage: "No members have been imported yet." });

    expect(
      await screen.findByText("No members have been imported yet."),
    ).toBeInTheDocument();
  });

  it("says nobody matches when the filter empties a non-empty roster", async () => {
    renderPicker({ filter: { categories: ["youth"] } });

    expect(await screen.findByText("No members match this filter.")).toBeInTheDocument();
  });
});

describe("MemberPicker failures", () => {
  // No silent failures (CLAUDE.md rule 7). A picker that renders an empty list when the request
  // was refused tells a bishop the ward has no members.
  it("surfaces the server's message rather than an empty list", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        json: async () => ({ error: "You do not have permission to do that." }),
      })),
    );

    renderPicker();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "You do not have permission to do that.",
    );
  });
});
