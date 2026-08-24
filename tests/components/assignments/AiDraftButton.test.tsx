import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AiDraftButton,
  RESTORE_TEMPLATE_LABEL,
} from "@/components/assignments/AiDraftButton";

// The two ways a textarea's contents get replaced, and the one guard that protects both.
//
// Losing an edited draft is the worst version of this feature — worse than no draft at all — so
// the confirm has to fire in BOTH directions. It is easy to add a restore control and forget that
// it discards typing just as thoroughly as the AI button does.
//
// fireEvent rather than user-event: @testing-library/user-event is not a dependency of this
// project, and every other component suite here clicks the same way.

const TEMPLATE = "Hello Sarah,\n\nThank you for agreeing to speak.";
const AI_DRAFT = "Hi Sarah! You're set to speak Sept 13.";
const EDITED = "Hi Sarah! My own words here.";

function setup(currentValue: string, templateValue?: string) {
  const onDraft = vi.fn();

  const element = (value: string) => (
    <AiDraftButton
      assignmentId="assignment-1"
      type="confirmation"
      currentValue={value}
      templateValue={templateValue}
      onDraft={onDraft}
    />
  );

  const { rerender } = render(element(currentValue));

  // Typing does not remount the button — the parent owns the textarea's state and this component
  // re-renders with a new `currentValue`. A test that MOUNTS with edited text is testing
  // something else entirely: the value a component starts with is, correctly, one nobody typed.
  return { onDraft, typeInTextarea: (value: string) => rerender(element(value)) };
}

function draftButton() {
  return screen.getByRole("button", { name: /Draft the confirmation with AI/ });
}

function restoreButton() {
  return screen.getByRole("button", { name: RESTORE_TEMPLATE_LABEL });
}

function respondWith(draft: string) {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ draft }),
  } as Response);
}

beforeEach(() => {
  vi.stubGlobal("fetch", respondWith(AI_DRAFT));
  vi.spyOn(window, "confirm").mockReturnValue(true);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("AiDraftButton — the way back to the template", () => {
  // A control that would do nothing is worse than no control: it sits beside one that does
  // something and implies the two are alternatives.
  it("offers no restore while the textarea still holds the template", () => {
    setup(TEMPLATE, TEMPLATE);

    expect(screen.queryByRole("button", { name: RESTORE_TEMPLATE_LABEL })).toBeNull();
  });

  it("offers the restore once the textarea has moved away from it", () => {
    setup(AI_DRAFT, TEMPLATE);

    expect(restoreButton()).toBeInTheDocument();
  });

  it("hands the template back through the same setter", () => {
    const { onDraft } = setup(AI_DRAFT, TEMPLATE);

    fireEvent.click(restoreButton());

    expect(onDraft).toHaveBeenCalledWith(TEMPLATE);
  });

  // Without a templateValue there is nothing to go back to, and the control must not appear at
  // all rather than appearing and restoring undefined.
  it("offers no restore when no template was supplied", () => {
    setup(AI_DRAFT);

    expect(screen.queryByRole("button", { name: RESTORE_TEMPLATE_LABEL })).toBeNull();
  });
});

describe("AiDraftButton — protecting an edit", () => {
  it("asks before restoring over something hand-typed", () => {
    const { typeInTextarea } = setup(TEMPLATE, TEMPLATE);
    typeInTextarea(EDITED);

    fireEvent.click(restoreButton());

    expect(window.confirm).toHaveBeenCalled();
  });

  it("keeps the edit when the restore confirm is declined", () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    const { onDraft, typeInTextarea } = setup(TEMPLATE, TEMPLATE);
    typeInTextarea(EDITED);

    fireEvent.click(restoreButton());

    expect(onDraft).not.toHaveBeenCalled();
  });

  it("keeps the edit when the AI confirm is declined, and spends nothing", () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    const { onDraft, typeInTextarea } = setup(TEMPLATE, TEMPLATE);
    typeInTextarea(EDITED);

    fireEvent.click(draftButton());

    expect(onDraft).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  // The round trip: draft, edit, restore, draft again. The set of untyped values has to grow as
  // the component produces them, or the second AI press warns about an edit that is long gone.
  it("stops warning once an edit has been replaced by a value it produced", async () => {
    const { typeInTextarea } = setup(TEMPLATE, TEMPLATE);
    typeInTextarea(EDITED);

    fireEvent.click(restoreButton());
    expect(window.confirm).toHaveBeenCalledTimes(1);

    typeInTextarea(TEMPLATE);
    fireEvent.click(draftButton());

    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(window.confirm).toHaveBeenCalledTimes(1);
  });

  // THE REASON BOTH DIRECTIONS LIVE IN THIS COMPONENT. A restore driven from the panel would
  // leave this component's set of untyped values stale, and the next AI press would warn about
  // losing an edit the user never made.
  it("does not warn when the AI replaces a value nobody typed", async () => {
    setup(TEMPLATE, TEMPLATE);

    fireEvent.click(draftButton());

    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(window.confirm).not.toHaveBeenCalled();
  });
});

describe("AiDraftButton — drafting", () => {
  it("hands a successful draft to the parent", async () => {
    const { onDraft } = setup(TEMPLATE, TEMPLATE);

    fireEvent.click(draftButton());

    await waitFor(() => expect(onDraft).toHaveBeenCalledWith(AI_DRAFT));
  });

  it("shows progress and cannot be pressed twice", async () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => {})));
    setup(TEMPLATE, TEMPLATE);

    fireEvent.click(draftButton());

    const busy = await screen.findByRole("button", { name: /Drafting…/ });
    expect(busy).toBeDisabled();
  });

  // An empty draft looks like an answer and is not one — the silent failure rule 7 forbids it.
  it("refuses an empty draft rather than blanking the textarea", async () => {
    vi.stubGlobal("fetch", respondWith("   "));
    const { onDraft } = setup(TEMPLATE, TEMPLATE);

    fireEvent.click(draftButton());

    await screen.findByText(/returned an empty draft/i);
    expect(onDraft).not.toHaveBeenCalled();
  });

  // Six distinguishable failures reach here as six written sentences. Re-wording one would
  // collapse "the key is missing" and "the service is busy" into the same message.
  it("surfaces the route's own sentence on failure and keeps the textarea", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({ error: "The AI service is busy. Wait a moment and try again." }),
      } as Response),
    );

    const { onDraft } = setup(TEMPLATE, TEMPLATE);
    fireEvent.click(draftButton());

    await screen.findByText(/The AI service is busy/);
    expect(onDraft).not.toHaveBeenCalled();
  });
});
