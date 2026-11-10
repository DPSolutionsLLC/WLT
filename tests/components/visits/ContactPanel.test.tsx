import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ContactPanel, contactsWithPhones, type HouseholdContact } from "@/app/(app)/visits/ContactPanel";

// The contact window (ITER-055 bv3): phones that dial, and a call logged as an attempt.

const refresh = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh, replace: vi.fn(), push: vi.fn() }),
}));

const HOUSEHOLD_ID = "22222222-0000-4000-8000-000000000001";

const CONTACTS: HouseholdContact[] = [
  { memberId: "m-1", name: "Ana Rivera", phone: "(801) 555-0134" },
  { memberId: "m-2", name: "Luis Rivera", phone: null },
  { memberId: "m-3", name: "Sofia Rivera", phone: "12" },
];

function renderPanel(props: Partial<Parameters<typeof ContactPanel>[0]> = {}) {
  const queryClient = new QueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <ContactPanel
        householdId={HOUSEHOLD_ID}
        familyName="Rivera"
        contacts={CONTACTS}
        canLog
        today="2027-03-01"
        {...props}
      />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  refresh.mockReset();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("contactsWithPhones", () => {
  it("keeps only numbers that can be dialled, as tel: links", () => {
    expect(contactsWithPhones(CONTACTS)).toEqual([
      { memberId: "m-1", name: "Ana Rivera", display: "(801) 555-0134", href: "tel:8015550134" },
    ]);
  });
});

describe("ContactPanel", () => {
  it("lists each phone as a link that dials", () => {
    renderPanel();

    const link = screen.getByRole("link", { name: /Ana Rivera/ });
    expect(link.getAttribute("href")).toBe("tel:8015550134");
    expect(screen.queryByText("Luis Rivera")).toBeNull();
  });

  it("says so when nobody has a number", () => {
    renderPanel({ contacts: [{ memberId: "m-2", name: "Luis Rivera", phone: null }] });

    expect(screen.getByText("No phone number on file for the Rivera household.")).toBeTruthy();
  });

  it("asks how the call went before recording it", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    renderPanel();

    fireEvent.click(screen.getByRole("button", { name: "Record the call" }));

    expect(await screen.findByText("Choose how the call went.")).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("records a call as a phone attempt with how it went", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ visit: { id: "v-1" } }), { status: 201 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    renderPanel();

    fireEvent.change(screen.getByLabelText("How the call went"), {
      target: { value: "left_message" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Record the call" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/visits");
    expect(JSON.parse(init.body as string)).toEqual({
      householdId: HOUSEHOLD_ID,
      visitDate: "2027-03-01",
      visitType: "phone",
      outcome: "attempted",
      attemptDetail: "left_message",
      arrangement: "drop_in",
      sharedNotes: null,
    });
    expect(await screen.findByText("Call recorded as an attempt.")).toBeTruthy();
  });

  it("offers no logging when the reader cannot log for this organization", () => {
    renderPanel({ canLog: false });

    expect(screen.queryByRole("button", { name: "Record the call" })).toBeNull();
    expect(screen.getByRole("link", { name: /Ana Rivera/ })).toBeTruthy();
  });

  it("goes on to scheduling", () => {
    const onSchedule = vi.fn();
    renderPanel({ onSchedule });

    fireEvent.click(screen.getByRole("button", { name: "Schedule an appointment" }));

    expect(onSchedule).toHaveBeenCalledTimes(1);
  });
});
