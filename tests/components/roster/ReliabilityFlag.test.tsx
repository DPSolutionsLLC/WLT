import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ReliabilityFlag } from "@/components/roster/ReliabilityFlag";
import { RELIABILITY_FLAG_KINDS } from "@/lib/assignments/reliabilityFlags";

// Driven off RELIABILITY_FLAG_KINDS rather than a hand-written list of four, so a FIFTH flag added
// to the enum fails HERE until somebody decides what it is called. A literal list would keep
// passing while the new kind rendered as nothing — which is precisely the failure roster-b's
// comment block warns about, one level down.
//
// The labels are asserted as WORDS. The wording is the feature: these are read aloud in a
// bishopric meeting, and "Declined twice recently" and "Unreliable" are not interchangeable
// however identical the arithmetic behind them is.

const EXPECTED_LABELS: Record<string, string> = {
  frequent_decliner: "Declined twice recently",
  late_canceller: "Cancelled close to the date",
  not_asked_recently: "Not asked in over a year",
  not_spoken_recently: "Has not spoken in two years",
};

describe("ReliabilityFlag", () => {
  it("renders a label for every kind in the union", () => {
    for (const kind of RELIABILITY_FLAG_KINDS) {
      const { unmount } = render(<ReliabilityFlag flags={[kind]} />);

      expect(screen.getByText(EXPECTED_LABELS[kind])).toBeInTheDocument();
      unmount();
    }
  });

  it("renders nothing at all for an empty array", () => {
    // Not an empty span and not a bordered box. An empty flag row beside a name reads as a
    // rendering fault, and roster-b shipped this component rendering nothing on purpose.
    const { container } = render(<ReliabilityFlag flags={[]} />);

    expect(container).toBeEmptyDOMElement();
  });

  it("renders every flag when a member has all four", () => {
    render(<ReliabilityFlag flags={RELIABILITY_FLAG_KINDS} />);

    for (const kind of RELIABILITY_FLAG_KINDS) {
      expect(screen.getByText(EXPECTED_LABELS[kind])).toBeInTheDocument();
    }
  });

  it("renders in enum order however the caller ordered them", () => {
    // Two members with the same flags read the same way down a list, whatever order the data
    // layer happened to return their history in.
    const { container } = render(
      <ReliabilityFlag flags={["not_spoken_recently", "frequent_decliner"]} />,
    );

    const text = container.textContent ?? "";

    expect(text.indexOf(EXPECTED_LABELS.frequent_decliner)).toBeGreaterThanOrEqual(0);
    expect(text.indexOf(EXPECTED_LABELS.frequent_decliner)).toBeLessThan(
      text.indexOf(EXPECTED_LABELS.not_spoken_recently),
    );
  });

  it("uses distinct wording for all four kinds", () => {
    const labels = RELIABILITY_FLAG_KINDS.map((kind) => EXPECTED_LABELS[kind]);

    expect(new Set(labels).size).toBe(RELIABILITY_FLAG_KINDS.length);
  });

  it("never describes a person — only a record", () => {
    // A guard on the wording rather than on the markup. These four words are the ones a bishop
    // would hesitate to read aloud, and 04-talks-pipeline.md §Step 8 makes neutral wording a
    // requirement rather than a preference.
    const forbidden = /unreliable|no.?show|flaky|problem|bad/i;

    for (const kind of RELIABILITY_FLAG_KINDS) {
      expect(EXPECTED_LABELS[kind]).not.toMatch(forbidden);
    }
  });
});
