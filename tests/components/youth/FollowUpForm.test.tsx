// @vitest-environment jsdom
//
// FollowUpForm — the half of "Did you go?" that is not visible.
//
// ---------------------------------------------------------------------------
// WHY THIS SUITE EXISTS
// ---------------------------------------------------------------------------
// The two answer buttons communicated by APPEARANCE ALONE: the primary variant's fill was the only
// thing saying which answer was stored, so a screen reader heard two identically named buttons and
// could not tell them apart, and a sighted reader had one signal made entirely of colour. ITER-022.
//
// ---------------------------------------------------------------------------
// BOTH DIRECTIONS ARE PINNED, WHICH IS CoverageBadge'S OWN STATED LESSON
// ---------------------------------------------------------------------------
// Every case asserts the UNSELECTED button is `aria-pressed="false"` as well as that the selected
// one is `"true"`. A suite asserting only the selected half would stay green if the attribute were
// removed from one button — and an aria-pressed present on one and absent on the other is worse
// than neither, because the reader is told about one answer and left to infer the other.
//
// `existingLog` is null throughout: the private-note fetch runs only when editing, so these renders
// touch the network not at all.

import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { FollowUpForm } from "@/app/(app)/youth/FollowUpForm";

type Overrides = {
  isAttendee?: boolean;
  confirmedAttendance?: boolean | null;
};

function renderForm({ isAttendee = true, confirmedAttendance = null }: Overrides = {}) {
  // retry: false so a rejection surfaces once rather than as three silent attempts — the rule
  // tests/components/program/ProgramBuilder.test.tsx states for the same reason.
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <FollowUpForm
        eventId="event-1"
        eventTitle="Varsity basketball vs Lincoln"
        existingLog={null}
        isAttendee={isAttendee}
        confirmedAttendance={confirmedAttendance}
        canFlag
        crossOrgVisibility={false}
        onClose={() => {}}
      />
    </QueryClientProvider>,
  );
}

function wentButton(): HTMLElement {
  return screen.getByRole("button", { name: "I went" });
}

function didNotGoButton(): HTMLElement {
  return screen.getByRole("button", { name: "I did not go" });
}

describe("FollowUpForm — did you go?", () => {
  it("announces that neither answer is stored, and says so in words", () => {
    renderForm({ confirmedAttendance: null });

    expect(wentButton()).toHaveAttribute("aria-pressed", "false");
    expect(didNotGoButton()).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByText(/You have not said either way/)).toBeInTheDocument();
  });

  it("announces a stored yes on both buttons, and names it in words", () => {
    renderForm({ confirmedAttendance: true });

    expect(wentButton()).toHaveAttribute("aria-pressed", "true");
    expect(didNotGoButton()).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByText("Recorded: you went.")).toBeInTheDocument();
  });

  it("announces a stored no on both buttons, and names it in words", () => {
    renderForm({ confirmedAttendance: false });

    expect(wentButton()).toHaveAttribute("aria-pressed", "false");
    expect(didNotGoButton()).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("Recorded: you did not go.")).toBeInTheDocument();
  });

  // NO ROW, NO QUESTION — the rule that predates this change and has to survive it. Somebody who
  // never said they were going has nothing to confirm or deny, and they may still write the
  // follow-up itself.
  it("does not ask at all when the reader has no attendee row", () => {
    renderForm({ isAttendee: false, confirmedAttendance: null });

    expect(screen.queryByRole("button", { name: "I went" })).toBeNull();
    expect(screen.queryByRole("button", { name: "I did not go" })).toBeNull();
    expect(screen.queryByText("Did you go?")).toBeNull();
    expect(screen.queryByText(/You have not said either way/)).toBeNull();
  });
});
