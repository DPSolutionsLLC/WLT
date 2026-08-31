// @vitest-environment jsdom
//
// YouthAbsenceChip — guarded as a PAIR, for the reason CoverageBadge's suite states.
//
// ---------------------------------------------------------------------------
// WHY BOTH HALVES HAVE TO BE HERE
// ---------------------------------------------------------------------------
// `true` and `null` must render NOTHING: taking part is the ordinary case, and a chip on every
// card saying so is noise. But a suite asserting only that would make "delete the chip entirely" a
// passing fix for an over-eager one — the youth-b all-day lesson, where a marker whose absence is
// correct in one case and a defect in every other needs both directions pinned.
//
// ---------------------------------------------------------------------------
// THE COMPONENT AND THE FUNCTION MUST AGREE ON THE WORDS
// ---------------------------------------------------------------------------
// The sentence lives beside the computation that decides it (describeYouthAbsence), and three
// screens render this chip. The last case here asserts the rendered text IS that function's
// return value rather than a string this file typed out, so a second wording cannot appear in the
// component without going red.

import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { YouthAbsenceChip } from "@/components/youth/YouthAbsenceChip";
import { describeYouthAbsence } from "@/lib/youth/coverage";

describe("YouthAbsenceChip", () => {
  it("renders the sentence when the young person is not taking part", () => {
    render(<YouthAbsenceChip youthAttended={false} memberName="Ethan Brooks" />);

    expect(screen.getByText("Ethan Brooks is not taking part")).toBeTruthy();
  });

  // "This young person" beats a blank where the profile is not in the reader's list.
  it("falls back to a truthful placeholder when the name is not known", () => {
    render(<YouthAbsenceChip youthAttended={false} memberName={null} />);

    expect(screen.getByText("This young person is not taking part")).toBeTruthy();
  });

  it.each([true, null])("renders nothing at all for %s", (youthAttended) => {
    const { container } = render(
      <YouthAbsenceChip youthAttended={youthAttended} memberName="Ethan Brooks" />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  // THE WORDS COME FROM describeYouthAbsence(), NOT FROM THE COMPONENT.
  it("renders exactly what describeYouthAbsence returns", () => {
    const label = describeYouthAbsence(false, "Josh Miller");

    render(<YouthAbsenceChip youthAttended={false} memberName="Josh Miller" />);

    expect(label).not.toBeNull();
    expect(screen.getByText(label as string)).toBeTruthy();
  });

  // COLOUR IS NEVER THE ONLY SIGNAL (ITER-022). The chip carries a whole sentence, and the tone is
  // deliberately NOT the Cancelled chip's --warning: two different facts must not read as one.
  it("carries words rather than a bare tone, and not the Cancelled chip's tone", () => {
    const { container } = render(
      <YouthAbsenceChip youthAttended={false} memberName="Ethan Brooks" />,
    );

    const chip = container.firstElementChild as HTMLElement;

    expect(chip.textContent?.trim()).toBe("Ethan Brooks is not taking part");
    expect(chip.className).not.toContain("warning");
  });
});
