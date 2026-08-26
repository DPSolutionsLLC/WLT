import { describe, expect, it } from "vitest";
import {
  digitsToCents,
  formatCents,
  formatDollars,
  normalizeQuantityInput,
  quantityValue,
} from "@/lib/tithing/money";

// The fixed-decimal amount field is the one place a counter can enter a WRONG NUMBER without
// noticing. Every other input on the screen is a quantity of physical objects they are holding;
// this one is a figure copied off a cheque, and the failure mode is an order of magnitude, not a
// typo. So the boundaries get asserted explicitly rather than sampled.

describe("formatCents", () => {
  it("always shows two decimal places, including below a dollar", () => {
    expect(formatCents(0)).toBe("0.00");
    expect(formatCents(1)).toBe("0.01");
    expect(formatCents(5)).toBe("0.05");
    expect(formatCents(10)).toBe("0.10");
    expect(formatCents(99)).toBe("0.99");
  });

  it("crosses into dollars without dropping the cents", () => {
    expect(formatCents(100)).toBe("1.00");
    expect(formatCents(105)).toBe("1.05");
    expect(formatCents(150)).toBe("1.50");
    expect(formatCents(23_600)).toBe("236.00");
  });

  it("groups thousands", () => {
    expect(formatCents(100_000)).toBe("1,000.00");
    expect(formatCents(1_000_000)).toBe("10,000.00");
    expect(formatCents(123_456_789)).toBe("1,234,567.89");
  });

  it("prefixes a dollar sign only in formatDollars", () => {
    expect(formatDollars(23_600)).toBe("$236.00");
    expect(formatCents(23_600)).not.toContain("$");
  });
});

describe("digitsToCents", () => {
  it("shifts every typed digit one place right of the decimal", () => {
    expect(digitsToCents("")).toBe(0);
    expect(digitsToCents("2")).toBe(2);
    expect(digitsToCents("23")).toBe(23);
    expect(digitsToCents("236")).toBe(236);
    expect(digitsToCents("23600")).toBe(23_600);
  });

  it("ignores everything that is not a digit", () => {
    // What the field actually receives once it has formatted itself: the user types one more
    // digit onto "236.00" and the browser hands back "236.001". Stripping the separators is what
    // makes the value round-trip instead of restarting.
    expect(digitsToCents("236.00")).toBe(23_600);
    expect(digitsToCents("1,234.56")).toBe(123_456);
    expect(digitsToCents("-45")).toBe(45);
    expect(digitsToCents("12e3")).toBe(123);
  });

  it("drops leading zeros so a typed value cannot grow a phantom digit", () => {
    expect(digitsToCents("000236")).toBe(236);
    expect(digitsToCents("0")).toBe(0);
    expect(digitsToCents("0.00")).toBe(0);
  });

  it("round-trips its own formatting", () => {
    for (const cents of [0, 1, 7, 99, 100, 999, 23_600, 100_000, 123_456_789]) {
      expect(digitsToCents(formatCents(cents))).toBe(cents);
    }
  });

  it("caps an implausible amount rather than returning an unsafe integer", () => {
    const mashed = digitsToCents("9".repeat(30));

    expect(Number.isSafeInteger(mashed)).toBe(true);
    expect(mashed).toBe(99_999_999_999);
  });
});

describe("normalizeQuantityInput", () => {
  it("keeps an untouched field empty rather than showing a zero", () => {
    expect(normalizeQuantityInput("")).toBe("");
    expect(quantityValue("")).toBe(0);
  });

  it("keeps a deliberately typed zero", () => {
    expect(normalizeQuantityInput("0")).toBe("0");
  });

  it("strips leading zeros and anything that is not a digit", () => {
    expect(normalizeQuantityInput("007")).toBe("7");
    expect(normalizeQuantityInput("12abc")).toBe("12");
    // A quantity of bills has no sign and no decimal point. Both characters are simply dropped,
    // so a stray keypress does nothing at all rather than leaving the field in a state its value
    // cannot come back out of.
    expect(normalizeQuantityInput("-3")).toBe("3");
    expect(normalizeQuantityInput("1.5")).toBe("15");
  });

  it("caps the quantity at six digits", () => {
    expect(normalizeQuantityInput("1234567890")).toBe("123456");
  });
});
