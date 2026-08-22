import { describe, expect, it } from "vitest";
import {
  SMS_TRUNCATION_THRESHOLD,
  buildSmsLink,
  normalizePhone,
} from "@/lib/assignments/smsLink";

// The `sms:` handoff is the one thing in this app that leaves it entirely — the link is handed
// to a phone's own messaging app and nothing comes back. There is no delivery confirmation and
// no error to catch, so the URL's exact shape is the whole of the contract.

describe("normalizePhone", () => {
  it("keeps only the digits of a number written the way people write them", () => {
    expect(normalizePhone("(801) 555-0134")).toBe("8015550134");
    expect(normalizePhone("801.555.0134")).toBe("8015550134");
    expect(normalizePhone(" 801 555 0134 ")).toBe("8015550134");
  });

  it("keeps a single leading + for an international number", () => {
    expect(normalizePhone("+44 20 7946 0958")).toBe("+442079460958");
  });

  it("refuses something too short to be a phone number", () => {
    expect(normalizePhone("555")).toBeNull();
    expect(normalizePhone("")).toBeNull();
    expect(normalizePhone("n/a")).toBeNull();
  });
});

describe("buildSmsLink", () => {
  // iOS wants &body=, Android wants ?body=, and `?&body=` is the form both parse.
  // 04-talks-pipeline.md §Step 4 specifies it exactly, so this asserts it VERBATIM rather than
  // by parsing the URL — a URL parser would happily accept a form only one platform reads.
  it("produces the ?&body= form both platforms parse", () => {
    const { href } = buildSmsLink({ phone: "8015550134", body: "Hello" });

    expect(href).toBe("sms:8015550134?&body=Hello");
  });

  it("URI-encodes the body", () => {
    const { href } = buildSmsLink({
      phone: "8015550134",
      body: "Hello Sarah,\n\nYour topic is \"Faith & Works\".",
    });

    expect(href).toBe(
      "sms:8015550134?&body=Hello%20Sarah%2C%0A%0AYour%20topic%20is%20%22Faith%20%26%20Works%22.",
    );
  });

  it("normalizes the phone number into the link", () => {
    const { href } = buildSmsLink({ phone: "(801) 555-0134", body: "Hi" });

    expect(href).toBe("sms:8015550134?&body=Hi");
  });

  // A null href must render as NO LINK AT ALL. A disabled-looking anchor reads as "this is
  // broken" rather than "there is no number on file", and only one of those is true.
  it("yields a null href when there is no phone number", () => {
    expect(buildSmsLink({ phone: null, body: "Hi" }).href).toBeNull();
  });

  it("yields a null href when the phone number is not usable", () => {
    expect(buildSmsLink({ phone: "unknown", body: "Hi" }).href).toBeNull();
  });

  it("still reports truncation risk when there is no phone number", () => {
    const link = buildSmsLink({ phone: null, body: "x".repeat(600) });

    expect(link.href).toBeNull();
    expect(link.truncationRisk).toBe(true);
  });
});

describe("buildSmsLink truncation risk", () => {
  it("is false at the threshold and true one character past it", () => {
    const atThreshold = buildSmsLink({
      phone: "8015550134",
      body: "x".repeat(SMS_TRUNCATION_THRESHOLD),
    });
    const pastThreshold = buildSmsLink({
      phone: "8015550134",
      body: "x".repeat(SMS_TRUNCATION_THRESHOLD + 1),
    });

    expect(atThreshold.truncationRisk).toBe(false);
    expect(pastThreshold.truncationRisk).toBe(true);
  });

  // It is a hint for the UI, never a gate. A long message still produces a working link.
  it("never blocks the link", () => {
    const { href } = buildSmsLink({ phone: "8015550134", body: "x".repeat(2000) });

    expect(href).not.toBeNull();
  });

  // Measured on the RAW body, not the encoded one. What a phone truncates is the message the
  // person reads, and percent-encoding triples the length of every newline.
  it("measures the body a person would read, not its encoded form", () => {
    const body = "\n".repeat(200);

    expect(buildSmsLink({ phone: "8015550134", body }).truncationRisk).toBe(false);
  });
});
