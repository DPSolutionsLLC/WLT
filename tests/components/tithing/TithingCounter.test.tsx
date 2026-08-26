import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TithingCounter } from "@/app/(tithing)/tithing/TithingCounter";

// The counting session end to end, asserted on what a person holding the phone would see.
//
// There is no server and no database to stand in for here — this module makes no request of any
// kind — so every one of these is a real run of the real component. What that buys is that the
// tests can be about behaviour rather than about plumbing: the amount field, the entry numbering,
// and the edit flow are the three places a wrong number could reach a paper slip.
//
// fireEvent rather than user-event: @testing-library/user-event is not a dependency of this
// project, and every other component suite here drives the DOM the same way.

// jsdom has no layout, so scrollTo is a stub that logs "Not implemented" to the virtual console.
// Replacing it keeps the output readable and lets the edit flow be asserted.
beforeEach(() => {
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function checkAmountField(row = 1): HTMLInputElement {
  return screen.getByLabelText(`Check ${row} amount`) as HTMLInputElement;
}

function checkNumberField(row = 1): HTMLInputElement {
  return screen.getByLabelText(`Check ${row} number`) as HTMLInputElement;
}

function quantityField(label: string): HTMLInputElement {
  return screen.getByLabelText(`${label} quantity`) as HTMLInputElement;
}

// "Grand Total" appears once per tab, and only one tab is rendered at a time.
function grandTotal(): string {
  const label = screen.getByText("Grand Total");
  return label.parentElement?.textContent?.replace("Grand Total", "").trim() ?? "";
}

function toastText(): string {
  return screen.getByRole("status").textContent ?? "";
}

function showSummary() {
  fireEvent.click(screen.getByRole("tab", { name: "Summary" }));
}

function showEntry() {
  fireEvent.click(screen.getByRole("tab", { name: "Entry" }));
}

function saveButton(): HTMLElement {
  return screen.getByRole("button", { name: /Save Entry|Update Entry/ });
}

// "Entry #2" is on screen twice over on the summary tab — once as the tag beside a check, once as
// the heading of the log tile — so every summary assertion is scoped to the card it belongs to.
function card(headingText: string): HTMLElement {
  return screen.getByText(headingText).closest("div")?.parentElement as HTMLElement;
}

function logTile(entryNumber: number): HTMLElement {
  return within(card("Entries"))
    .getByText(`Entry #${entryNumber}`)
    .closest("div")?.parentElement as HTMLElement;
}

// A complete envelope: one check and some cash, saved.
function saveEntry({ amount, twenties }: { amount: string; twenties: string }) {
  fireEvent.change(checkAmountField(), { target: { value: amount } });
  fireEvent.change(quantityField("$20"), { target: { value: twenties } });
  fireEvent.click(saveButton());
}

describe("TithingCounter", () => {
  it("opens on the entry tab with an empty first entry", () => {
    render(<TithingCounter />);

    expect(screen.getByText("0 entries")).toBeInTheDocument();
    expect(screen.getByText("Entry #1")).toBeInTheDocument();
    expect(grandTotal()).toBe("$0.00");
    expect(checkAmountField()).toHaveValue("");
  });

  describe("the fixed-decimal amount field", () => {
    // Each digit shifts the value one place right. This is the single input on the screen where
    // a wrong keystroke produces a plausible-looking number an order of magnitude out.
    it("shifts every typed digit one place right of the decimal", () => {
      render(<TithingCounter />);
      const amount = checkAmountField();

      fireEvent.change(amount, { target: { value: "2" } });
      expect(amount).toHaveValue("0.02");

      fireEvent.change(amount, { target: { value: "23" } });
      expect(amount).toHaveValue("0.23");

      fireEvent.change(amount, { target: { value: "236" } });
      expect(amount).toHaveValue("2.36");

      fireEvent.change(amount, { target: { value: "23600" } });
      expect(amount).toHaveValue("236.00");
      expect(grandTotal()).toBe("$236.00");
    });

    it("keeps accumulating when the browser hands back its own formatted value", () => {
      render(<TithingCounter />);
      const amount = checkAmountField();

      fireEvent.change(amount, { target: { value: "236" } });
      // What actually reaches onChange after the field has reformatted itself and one more digit
      // is typed at the end.
      fireEvent.change(amount, { target: { value: "2.360" } });

      expect(amount).toHaveValue("23.60");
    });

    it("takes letters in the check number but never in the amount", () => {
      render(<TithingCounter />);

      fireEvent.change(checkNumberField(), { target: { value: "1042A" } });
      fireEvent.change(checkAmountField(), { target: { value: "10a0" } });

      expect(checkNumberField()).toHaveValue("1042A");
      expect(checkAmountField()).toHaveValue("1.00");
    });
  });

  it("calculates a denomination inline and folds it into the grand total", () => {
    render(<TithingCounter />);

    fireEvent.change(quantityField("$20"), { target: { value: "3" } });

    const twentiesRow = quantityField("$20").parentElement;
    expect(within(twentiesRow as HTMLElement).getByText("$60.00")).toBeInTheDocument();
    expect(grandTotal()).toBe("$60.00");

    fireEvent.change(quantityField("Quarter"), { target: { value: "3" } });
    expect(grandTotal()).toBe("$60.75");
  });

  it("adds and removes check rows", () => {
    render(<TithingCounter />);

    fireEvent.click(screen.getByRole("button", { name: "+ Add Check" }));
    fireEvent.change(checkAmountField(1), { target: { value: "10000" } });
    fireEvent.change(checkAmountField(2), { target: { value: "2500" } });
    expect(grandTotal()).toBe("$125.00");

    fireEvent.click(screen.getByRole("button", { name: "Remove check 2" }));
    expect(grandTotal()).toBe("$100.00");
    expect(screen.queryByLabelText("Check 2 amount")).not.toBeInTheDocument();
  });

  describe("saving", () => {
    it("refuses an empty entry and says why", () => {
      render(<TithingCounter />);

      fireEvent.click(saveButton());

      expect(toastText()).toBe("Nothing to save — enter amounts first");
      expect(screen.getByText("0 entries")).toBeInTheDocument();
    });

    // A check number with no amount is a slip somebody started and abandoned. It totals zero, so
    // there is nothing to save.
    it("refuses an entry holding only a check number", () => {
      render(<TithingCounter />);

      fireEvent.change(checkNumberField(), { target: { value: "1042" } });
      fireEvent.click(saveButton());

      expect(toastText()).toBe("Nothing to save — enter amounts first");
    });

    it("saves, resets the form, and moves the badge on to the next entry", () => {
      render(<TithingCounter />);

      saveEntry({ amount: "23600", twenties: "2" });

      expect(toastText()).toBe("Entry #1 saved ✓");
      expect(screen.getByText("1 entry")).toBeInTheDocument();
      expect(screen.getByText("Entry #2")).toBeInTheDocument();
      expect(checkAmountField()).toHaveValue("");
      expect(quantityField("$20")).toHaveValue("");
      expect(grandTotal()).toBe("$0.00");
    });

    it("counts entries in the header as one and as several", () => {
      render(<TithingCounter />);

      saveEntry({ amount: "10000", twenties: "1" });
      expect(screen.getByText("1 entry")).toBeInTheDocument();

      saveEntry({ amount: "5000", twenties: "1" });
      expect(screen.getByText("2 entries")).toBeInTheDocument();
    });
  });

  describe("the summary", () => {
    it("totals the session across several entries", () => {
      render(<TithingCounter />);

      saveEntry({ amount: "10000", twenties: "1" });
      saveEntry({ amount: "5000", twenties: "2" });
      showSummary();

      expect(screen.getByText("Submissions").parentElement).toHaveTextContent("2");
      expect(grandTotal()).toBe("$210.00");
    });

    it("lists only the denominations somebody submitted", () => {
      render(<TithingCounter />);

      fireEvent.change(quantityField("$20"), { target: { value: "3" } });
      fireEvent.click(saveButton());
      showSummary();

      expect(screen.getByText("3 bills")).toBeInTheDocument();
      expect(screen.queryByText("$50")).not.toBeInTheDocument();
      // Nothing in the coin drawer, said as a sentence rather than as six zero rows.
      expect(screen.getByText("No coins entered")).toBeInTheDocument();
    });

    it("hides the checks card entirely when the session is all cash", () => {
      render(<TithingCounter />);

      fireEvent.change(quantityField("$20"), { target: { value: "3" } });
      fireEvent.click(saveButton());
      showSummary();

      expect(screen.queryByText("Checks Submitted")).not.toBeInTheDocument();
    });

    it("lists every check with the entry number written on its slip", () => {
      render(<TithingCounter />);

      fireEvent.change(checkNumberField(), { target: { value: "1042" } });
      fireEvent.change(checkAmountField(), { target: { value: "10000" } });
      fireEvent.click(saveButton());

      fireEvent.change(checkAmountField(), { target: { value: "2500" } });
      fireEvent.click(saveButton());
      showSummary();

      const checksCard = card("Checks Submitted");
      expect(within(checksCard).getByText("Ck #1042")).toBeInTheDocument();
      expect(within(checksCard).getByText("No check #")).toBeInTheDocument();
      expect(within(checksCard).getByText("Entry #1")).toBeInTheDocument();
      expect(within(checksCard).getByText("Entry #2")).toBeInTheDocument();
      expect(screen.getByText("Check Total (2 checks)")).toBeInTheDocument();
    });

    it("says the check total in the singular for one check", () => {
      render(<TithingCounter />);

      saveEntry({ amount: "10000", twenties: "0" });
      showSummary();

      expect(screen.getByText("Check Total (1 check)")).toBeInTheDocument();
    });

    it("shows an empty log before anything is saved", () => {
      render(<TithingCounter />);
      showSummary();

      expect(screen.getByText("No entries yet")).toBeInTheDocument();
    });
  });

  describe("editing", () => {
    it("pre-fills the form, banners the entry, and relabels the save button", () => {
      render(<TithingCounter />);

      saveEntry({ amount: "23600", twenties: "2" });
      showSummary();
      fireEvent.click(screen.getByRole("button", { name: "Edit" }));

      expect(screen.getByText("Editing Entry #1 — Save to update")).toBeInTheDocument();
      expect(screen.getByText("Editing #1")).toBeInTheDocument();
      expect(saveButton()).toHaveTextContent("Update Entry ✓");
      expect(checkAmountField()).toHaveValue("236.00");
      expect(quantityField("$20")).toHaveValue("2");
      expect(grandTotal()).toBe("$276.00");
    });

    it("updates in place without consuming a new entry number", () => {
      render(<TithingCounter />);

      saveEntry({ amount: "23600", twenties: "2" });
      showSummary();
      fireEvent.click(screen.getByRole("button", { name: "Edit" }));

      fireEvent.change(quantityField("$20"), { target: { value: "3" } });
      fireEvent.click(saveButton());

      expect(toastText()).toBe("Entry #1 updated ✓");
      expect(screen.getByText("1 entry")).toBeInTheDocument();
      // Still the next unused number, not #3.
      expect(screen.getByText("Entry #2")).toBeInTheDocument();
      expect(screen.queryByText(/Editing Entry/)).not.toBeInTheDocument();

      showSummary();
      expect(grandTotal()).toBe("$296.00");
    });

    // The reason editing is keyed on the entry number and not on a position in the array.
    // Deleting an earlier entry shifts every later index by one; an index-keyed edit would then
    // write the update into the wrong envelope, silently, and the paper slips would disagree
    // with the screen.
    it("still updates the right entry after an earlier one is deleted", () => {
      render(<TithingCounter />);

      saveEntry({ amount: "10000", twenties: "0" });
      saveEntry({ amount: "20000", twenties: "0" });
      showSummary();

      fireEvent.click(within(logTile(2)).getByRole("button", { name: "Edit" }));

      showSummary();
      fireEvent.click(within(logTile(1)).getByRole("button", { name: "Delete" }));

      showEntry();
      fireEvent.change(checkAmountField(), { target: { value: "30000" } });
      fireEvent.click(saveButton());

      expect(toastText()).toBe("Entry #2 updated ✓");
      showSummary();
      expect(within(card("Entries")).getByText("Entry #2")).toBeInTheDocument();
      expect(within(card("Entries")).queryByText("Entry #1")).not.toBeInTheDocument();
      expect(grandTotal()).toBe("$300.00");
    });

    it("cancels the edit when Clear is pressed instead of saving", () => {
      render(<TithingCounter />);

      saveEntry({ amount: "23600", twenties: "2" });
      showSummary();
      fireEvent.click(screen.getByRole("button", { name: "Edit" }));
      fireEvent.click(screen.getByRole("button", { name: "Clear" }));

      expect(screen.queryByText(/Editing Entry/)).not.toBeInTheDocument();
      expect(saveButton()).toHaveTextContent("Save Entry →");
      expect(checkAmountField()).toHaveValue("");

      showSummary();
      // The entry it was editing is untouched.
      expect(grandTotal()).toBe("$276.00");
    });

    it("drops out of edit mode when the entry being edited is deleted", () => {
      render(<TithingCounter />);

      saveEntry({ amount: "23600", twenties: "2" });
      showSummary();
      fireEvent.click(screen.getByRole("button", { name: "Edit" }));
      showSummary();
      fireEvent.click(screen.getByRole("button", { name: "Delete" }));

      expect(toastText()).toBe("Entry #1 removed");
      showEntry();
      expect(screen.queryByText(/Editing Entry/)).not.toBeInTheDocument();
      expect(saveButton()).toHaveTextContent("Save Entry →");
    });
  });

  describe("clearing", () => {
    it("clears the form without saving", () => {
      render(<TithingCounter />);

      fireEvent.change(checkAmountField(), { target: { value: "23600" } });
      fireEvent.click(screen.getByRole("button", { name: "Clear" }));

      expect(toastText()).toBe("Entry cleared");
      expect(grandTotal()).toBe("$0.00");
      expect(screen.getByText("0 entries")).toBeInTheDocument();
    });

    it("asks before clearing every saved entry, and does nothing if refused", () => {
      const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
      render(<TithingCounter />);

      saveEntry({ amount: "10000", twenties: "0" });
      showSummary();
      fireEvent.click(screen.getByRole("button", { name: "Clear All Entries" }));

      expect(confirmSpy).toHaveBeenCalledWith(
        "Clear all 1 saved entry? This cannot be undone.",
      );
      expect(screen.getByText("1 entry")).toBeInTheDocument();
    });

    it("clears everything and restarts the numbering once confirmed", () => {
      vi.spyOn(window, "confirm").mockReturnValue(true);
      render(<TithingCounter />);

      saveEntry({ amount: "10000", twenties: "0" });
      saveEntry({ amount: "20000", twenties: "0" });
      showSummary();
      fireEvent.click(screen.getByRole("button", { name: "Clear All Entries" }));

      expect(toastText()).toBe("Session cleared");
      expect(screen.getByText("No entries yet")).toBeInTheDocument();
      expect(screen.getByText("0 entries")).toBeInTheDocument();

      showEntry();
      expect(screen.getByText("Entry #1")).toBeInTheDocument();
    });

    it("says so rather than prompting when there is nothing to clear", () => {
      const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
      render(<TithingCounter />);

      showSummary();
      fireEvent.click(screen.getByRole("button", { name: "Clear All Entries" }));

      expect(confirmSpy).not.toHaveBeenCalled();
      expect(toastText()).toBe("Nothing to clear");
    });
  });

  // Nothing on this screen is written anywhere (TithingCounter.tsx says why), so leaving the page
  // destroys the count. The guard is the only thing standing between a stray back-swipe and a
  // recount of the whole tray.
  describe("leaving the page", () => {
    function dashboardLink(): HTMLElement {
      return screen.getByRole("link", { name: /Dashboard/ });
    }

    it("does not interrupt when there is nothing to lose", () => {
      const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
      render(<TithingCounter />);

      fireEvent.click(dashboardLink());

      expect(confirmSpy).not.toHaveBeenCalled();
    });

    it("warns when an entry has been typed but not saved", () => {
      const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
      render(<TithingCounter />);

      fireEvent.change(checkAmountField(), { target: { value: "23600" } });
      fireEvent.click(dashboardLink());

      expect(confirmSpy).toHaveBeenCalledOnce();
      expect(confirmSpy.mock.calls[0]?.[0]).toContain("Nothing on this screen is saved anywhere");
    });

    // Saved entries are at risk too. They live in this component and nowhere else.
    it("warns when entries have been saved and the form is empty", () => {
      const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
      render(<TithingCounter />);

      saveEntry({ amount: "10000", twenties: "0" });
      fireEvent.click(dashboardLink());

      expect(confirmSpy).toHaveBeenCalledOnce();
    });

    it("stays on the page when the warning is refused", () => {
      vi.spyOn(window, "confirm").mockReturnValue(false);
      render(<TithingCounter />);

      saveEntry({ amount: "10000", twenties: "0" });
      const clickWasHonoured = fireEvent.click(dashboardLink());

      // fireEvent returns false when a handler called preventDefault, which is what stops the
      // navigation.
      expect(clickWasHonoured).toBe(false);
    });
  });
});
