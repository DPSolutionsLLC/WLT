// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { TodoCard } from "@/app/(app)/todos/TodoCard";
import type { SessionUser, TodoSummary } from "@/types/domain";

// A "Visit the ___ family" to-do (ITER-055 bv6). Booking a second visit is allowed, but only after
// the card asks — the user's decision walking scenario 102 — and the card counts the extra
// bookings rather than hiding the sooner one.

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), replace: vi.fn(), push: vi.fn() }),
}));

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    this.open = false;
  };
});

afterEach(cleanup);

const LENA: SessionUser = {
  id: "00000000-0000-4000-8000-000000000002",
  wardId: "00000000-0000-4000-8000-0000000000aa",
  homeWardId: "00000000-0000-4000-8000-0000000000aa",
  activeWardId: null,
  callingId: "00000000-0000-4000-8000-00000000ca11",
  role: "counselor",
  orgId: null,
  orgType: null,
  counselorPosition: 2,
  firstName: "Lena",
  lastName: "Ortiz",
  username: null,
  themePreference: "system",
  isActive: true,
  releasedModules: null,
  isSuperAdmin: false,
};

function visitTodo(bookedFor: string | null, otherBookingCount = 0): TodoSummary {
  return {
    id: "todo-1",
    title: "Visit the Ellis family",
    notes: null,
    tag: "Visits",
    doDate: null,
    dueDate: null,
    scheduledFor: null,
    scheduledWithMemberId: null,
    completedAt: null,
    assignedBy: null,
    actionItemId: null,
    sourceCompletedAt: null,
    askAssignmentId: null,
    askPrayerId: null,
    musicLink: null,
    zoomLink: null,
    zoomRegistrationLink: null,
    visitLink: { assignmentId: "assignment-1" },
    visitLogId: null,
    closedReason: null,
    talkOffAt: null,
    createdAt: "2026-11-01T00:00:00.000Z",
    updatedAt: "2026-11-01T00:00:00.000Z",
    steps: [],
    agendaSource: null,
    askSource: null,
    scheduledWithMemberName: null,
    visitSource: { householdId: "house-ellis", familyName: "Ellis", bookedFor, otherBookingCount },
    followUpSource: null,
  };
}

function renderCard(todo: TodoSummary) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <TodoCard
        todo={todo}
        today="2026-11-15"
        wardZone="America/Denver"
        user={LENA}
        canPickMember={false}
        visitBooking={{ leaders: [], memberNames: {} }}
        onChanged={vi.fn()}
      />
    </QueryClientProvider>,
  );
}

const pressCalendar = () =>
  fireEvent.click(screen.getByRole("button", { name: "Schedule Visit the Ellis family" }));

describe("TodoCard — a visit to-do", () => {
  it("opens the booking window straight away when nothing is booked", () => {
    renderCard(visitTodo(null));
    pressCalendar();
    expect(screen.getByRole("dialog", { name: "Book this visit" })).toBeTruthy();
    expect(screen.queryByRole("dialog", { name: "Book another visit?" })).toBeNull();
  });

  it("asks first when a visit is already booked, naming it in the ward's time", () => {
    renderCard(visitTodo("2026-11-21T02:30:00.000Z"));
    pressCalendar();
    const confirm = screen.getByRole("dialog", { name: "Book another visit?" });
    expect(confirm).toHaveTextContent(/The Ellis family already has a visit booked Fri, Nov 20, 2026, 7:30\sPM/);
    expect(screen.queryByRole("dialog", { name: "Book this visit" })).toBeNull();
  });

  it("opens the booking window on Book another", () => {
    renderCard(visitTodo("2026-11-21T02:30:00.000Z"));
    pressCalendar();
    fireEvent.click(screen.getByRole("button", { name: "Book another" }));
    expect(screen.getByRole("dialog", { name: "Book this visit" })).toBeTruthy();
    expect(screen.queryByRole("dialog", { name: "Book another visit?" })).toBeNull();
  });

  it("books nothing on Keep just that one", () => {
    renderCard(visitTodo("2026-11-21T02:30:00.000Z"));
    pressCalendar();
    fireEvent.click(screen.getByRole("button", { name: "Keep just that one" }));
    expect(screen.queryByRole("dialog", { name: "Book another visit?" })).toBeNull();
    expect(screen.queryByRole("dialog", { name: "Book this visit" })).toBeNull();
  });

  it("names the soonest booking and counts the rest", () => {
    renderCard(visitTodo("2026-11-21T02:30:00.000Z", 1));
    expect(screen.getByText(/Visit booked Fri, Nov 20, 2026, 7:30\sPM · and 1 more booked/)).toBeTruthy();
  });

  it("reads Upcoming, not Someday, once a visit is booked (defect 102-D3)", () => {
    renderCard(visitTodo("2026-11-21T02:30:00.000Z"));
    expect(screen.getByText("Upcoming")).toBeTruthy();
    expect(screen.queryByText("Someday")).toBeNull();
  });
});

// A follow-up from a visit (ITER-055 bv7). Decided walking scenario 106: Open Visits lands on THAT
// visit's card on the Households tab, not on whatever tab Visits last remembered.
function followUpTodo(): TodoSummary {
  return {
    ...visitTodo(null),
    title: "Ask about the temple trip",
    visitLink: null,
    visitSource: null,
    visitLogId: "visit-ellis",
    followUpSource: { familyName: "Ellis" },
  };
}

describe("TodoCard — a follow-up from a visit", () => {
  it("opens that visit's card on the Households tab", () => {
    renderCard(followUpTodo());
    fireEvent.click(screen.getByRole("button", { expanded: false }));
    const link = screen.getByRole("link", { name: "Open Visits" });
    expect(link.getAttribute("href")).toBe("/visits?tab=households&from=todos#visit-visit-ellis");
  });
});
