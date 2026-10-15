import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StakesAndWards } from "@/app/(app)/admin/stakes/StakesAndWards";
import type { Unit } from "@/types/domain";

// A ward is moved under a stake from its own Edit form, and once there it is listed UNDER that
// stake rather than vanishing from the page. Both were missing until the Buffalo Ward setup
// (2026-10-15): the server accepted `parentId` on PATCH and no screen sent it, and a ward unit
// with a parent was rendered nowhere.

const STAKE: Unit = {
  id: "11111111-1111-4111-8111-111111111111",
  type: "stake",
  parentId: null,
  unitNumber: null,
  name: "Sheridan, WY Stake",
};

const WARD: Unit = {
  id: "22222222-2222-4222-8222-222222222222",
  type: "ward",
  parentId: null,
  unitNumber: null,
  name: "Buffalo Ward",
};

function respondWith(unit: Unit) {
  return vi.fn().mockResolvedValue({ ok: true, json: async () => ({ unit }) } as Response);
}

function renderScreen(units: Unit[]) {
  render(<StakesAndWards initialUnits={units} wards={[]} canManage />);
}

function sentBody(fetchMock: ReturnType<typeof vi.fn>): Record<string, unknown> {
  const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
  return JSON.parse(String(init.body)) as Record<string, unknown>;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("StakesAndWards", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", respondWith({ ...WARD, parentId: STAKE.id }));
  });

  it("moves a ward under a stake from the ward's Edit form", async () => {
    renderScreen([STAKE, WARD]);
    expect(screen.getByText("Not under a stake yet")).toBeInTheDocument();

    const [, wardEdit] = screen.getAllByRole("button", { name: "Edit" });
    fireEvent.click(wardEdit);
    fireEvent.change(screen.getByLabelText("Under which stake"), {
      target: { value: STAKE.id },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    const fetchMock = vi.mocked(fetch);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock.mock.calls[0][0]).toBe(`/api/units/${WARD.id}`);
    expect(sentBody(fetchMock)).toEqual({
      name: "Buffalo Ward",
      unitNumber: null,
      parentId: STAKE.id,
    });

    await waitFor(() =>
      expect(screen.queryByText("Not under a stake yet")).not.toBeInTheDocument(),
    );
    expect(screen.getByText("1 ward: Buffalo Ward")).toBeInTheDocument();
    expect(screen.getByText("Buffalo Ward")).toBeInTheDocument();
  });

  it("lists a ward already under a stake beneath it, and can move it back out", async () => {
    vi.stubGlobal("fetch", respondWith(WARD));
    renderScreen([STAKE, { ...WARD, parentId: STAKE.id }]);
    expect(screen.queryByText("Not under a stake yet")).not.toBeInTheDocument();
    expect(screen.getByText("1 ward: Buffalo Ward")).toBeInTheDocument();

    const [, wardEdit] = screen.getAllByRole("button", { name: "Edit" });
    fireEvent.click(wardEdit);
    expect(screen.getByLabelText("Under which stake")).toHaveValue(STAKE.id);
    fireEvent.change(screen.getByLabelText("Under which stake"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1));
    expect(sentBody(vi.mocked(fetch)).parentId).toBeNull();
    await waitFor(() => expect(screen.getByText("Not under a stake yet")).toBeInTheDocument());
  });

  it("offers no stake choice when editing a stake, and sends no parent for it", async () => {
    vi.stubGlobal("fetch", respondWith(STAKE));
    renderScreen([STAKE, WARD]);

    const [stakeEdit] = screen.getAllByRole("button", { name: "Edit" });
    fireEvent.click(stakeEdit);
    expect(screen.queryByLabelText("Under which stake")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1));
    expect(sentBody(vi.mocked(fetch))).not.toHaveProperty("parentId");
  });
});
