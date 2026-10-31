import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RegistrationForm } from "@/app/public/[slug]/RegistrationForm";
import type { PublicRegistrationQuestion } from "@/lib/zoom/publicRegistration";

// The public Zoom sign-up form (ITER-052): the right questions after Yes or No, a required question
// stopping the send with its own words, and a honeypot no person or screen reader meets.

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams("ref=AbCdE12345"),
}));

const QUESTIONS: PublicRegistrationQuestion[] = [
  {
    id: "11111111-1111-4111-8111-111111111111",
    prompt: "Would you welcome a visit from the missionaries?",
    kind: "yes_no",
    audience: "non_members",
    isRequired: false,
    shownWhenYesTo: null,
  },
  {
    id: "22222222-2222-4222-8222-222222222222",
    prompt: "Which class do you attend?",
    kind: "short_text",
    audience: "members",
    isRequired: true,
    shownWhenYesTo: null,
  },
  {
    id: "33333333-3333-4333-8333-333333333333",
    prompt: "What's your address?",
    kind: "short_text",
    audience: "non_members",
    isRequired: true,
    shownWhenYesTo: "11111111-1111-4111-8111-111111111111",
  },
];

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderForm() {
  return render(<RegistrationForm slug="zoom-abc" wardName="Buffalo Ward" questions={QUESTIONS} />);
}

function memberGroup() {
  return screen.getByRole("group", { name: "Are you a member of Buffalo Ward?" });
}

describe("RegistrationForm", () => {
  it("names the ward and asks no ward question until the member question is answered", () => {
    renderForm();
    expect(screen.getByRole("heading", { name: "Watch Buffalo Ward sacrament meeting" })).toBeTruthy();
    expect(screen.queryByText(/missionaries/)).toBeNull();
    expect(screen.queryByText(/Which class/)).toBeNull();
  });

  it("asks a non-member the non-member question only", () => {
    renderForm();
    fireEvent.click(within(memberGroup()).getByRole("button", { name: "No" }));
    expect(screen.getByText("Would you welcome a visit from the missionaries? (optional)")).toBeTruthy();
    expect(screen.queryByText(/Which class/)).toBeNull();
  });

  it("asks a member the member question only", () => {
    renderForm();
    fireEvent.click(within(memberGroup()).getByRole("button", { name: "Yes" }));
    expect(screen.getByLabelText("Which class do you attend?")).toBeTruthy();
    expect(screen.queryByText(/missionaries/)).toBeNull();
  });

  it("stops a send that is missing a required answer, with the question's words", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    renderForm();
    fireEvent.change(screen.getByLabelText("Your name"), { target: { value: "Avery Hart" } });
    fireEvent.change(screen.getByLabelText("Phone number"), { target: { value: "555-123-4567" } });
    fireEvent.click(within(memberGroup()).getByRole("button", { name: "Yes" }));
    fireEvent.click(screen.getByRole("button", { name: "Ask for a link" }));

    expect(screen.getByRole("alert").textContent).toBe("Please answer: Which class do you attend?");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("sends the referral code from the link", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ statusUrl: null, message: "Thanks — your request has been sent." }), {
        status: 201,
      }),
    );
    renderForm();
    fireEvent.change(screen.getByLabelText("Your name"), { target: { value: "Avery Hart" } });
    fireEvent.change(screen.getByLabelText("Phone number"), { target: { value: "555-123-4567" } });
    fireEvent.click(within(memberGroup()).getByRole("button", { name: "No" }));
    fireEvent.click(screen.getByRole("button", { name: "Ask for a link" }));

    expect(await screen.findByText("Thanks — your request has been sent.")).toBeTruthy();
    const body = JSON.parse(String(fetchSpy.mock.calls[0]?.[1]?.body)) as Record<string, unknown>;
    expect(body).toMatchObject({ slug: "zoom-abc", ref: "AbCdE12345", saysMember: false, website: "" });
  });

  it("asks for the address only after Yes to the missionaries, and requires it then", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    renderForm();
    fireEvent.change(screen.getByLabelText("Your name"), { target: { value: "Avery Hart" } });
    fireEvent.change(screen.getByLabelText("Phone number"), { target: { value: "555-123-4567" } });
    fireEvent.click(within(memberGroup()).getByRole("button", { name: "No" }));
    expect(screen.queryByLabelText("What's your address?")).toBeNull();

    const missionaries = screen.getByRole("group", { name: /missionaries/ });
    fireEvent.click(within(missionaries).getByRole("button", { name: "Yes" }));
    expect(screen.getByLabelText("What's your address?")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Ask for a link" }));
    expect(screen.getByRole("alert").textContent).toBe("Please answer: What's your address?");
    expect(fetchSpy).not.toHaveBeenCalled();

    fireEvent.click(within(missionaries).getByRole("button", { name: "No" }));
    expect(screen.queryByLabelText("What's your address?")).toBeNull();
  });

  it("does not send an address typed before the answer changed to No", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ statusUrl: null, message: "Thanks — your request has been sent." }), {
        status: 201,
      }),
    );
    renderForm();
    fireEvent.change(screen.getByLabelText("Your name"), { target: { value: "Avery Hart" } });
    fireEvent.change(screen.getByLabelText("Phone number"), { target: { value: "555-123-4567" } });
    fireEvent.click(within(memberGroup()).getByRole("button", { name: "No" }));
    const missionaries = screen.getByRole("group", { name: /missionaries/ });
    fireEvent.click(within(missionaries).getByRole("button", { name: "Yes" }));
    fireEvent.change(screen.getByLabelText("What's your address?"), { target: { value: "12 Elm Street" } });
    fireEvent.click(within(missionaries).getByRole("button", { name: "No" }));
    fireEvent.click(screen.getByRole("button", { name: "Ask for a link" }));

    await screen.findByText("Thanks — your request has been sent.");
    const body = JSON.parse(String(fetchSpy.mock.calls[0]?.[1]?.body)) as { answers: unknown[] };
    expect(body.answers).toEqual([
      { questionId: "11111111-1111-4111-8111-111111111111", answer: false },
    ]);
  });

  it("keeps the honeypot out of the tab order and away from assistive technology", () => {
    const { container } = renderForm();
    const honeypot = container.querySelector<HTMLInputElement>("#zoom-signup-website");
    expect(honeypot).not.toBeNull();
    expect(honeypot?.tabIndex).toBe(-1);
    expect(honeypot?.getAttribute("autocomplete")).toBe("off");
    expect(honeypot?.closest("[aria-hidden='true']")).not.toBeNull();
    // The accessibility tree — what a screen reader meets — has no such field.
    expect(screen.queryByRole("textbox", { name: "Leave this empty" })).toBeNull();
  });
});
