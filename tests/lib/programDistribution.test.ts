// @vitest-environment node
//
// Recipient resolution and the send, with Resend mocked at the module boundary.
//
// ---------------------------------------------------------------------------------------------
// NO REAL EMAIL LEAVES THIS SUITE
// ---------------------------------------------------------------------------------------------
// The account has a low free-tier quota, and — per plans/retros/deployment.md — its sender is
// unverified, so a real send would deliver only to the account owner and prove nothing about
// anybody else. `@/lib/email/resend` is mocked and nothing else is.
//
// ---------------------------------------------------------------------------------------------
// THE PROPERTY THIS SUITE EXISTS FOR
// ---------------------------------------------------------------------------------------------
// PARTIAL FAILURE MUST BE REPORTED AS PARTIAL. "Sent to 9 people" when three bounced is the most
// likely lie this feature could ship, and it is invisible to anybody who is not one of the three.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sendMock = vi.fn();
const configurationMock = vi.fn();

vi.mock("@/lib/email/resend", () => ({
  emailConfiguration: () => configurationMock(),
  getResendClient: () => ({ emails: { send: sendMock } }),
}));

const { DistributionError, parseDistributionList, sendProgramEmails, MAX_RECIPIENTS } =
  await import("@/lib/program/distribution");

const PDF = Buffer.from("%PDF-1.7 not a real programme");

function configured(): void {
  configurationMock.mockReturnValue({
    configured: true,
    fromAddress: "programme@buffaloward.test",
  });
}

async function send(recipients: readonly string[]) {
  return sendProgramEmails({
    recipients,
    wardName: "Buffalo Ward",
    sundayDate: "2026-09-20",
    pdf: PDF,
    publicUrl: "https://example.test/public/program-abc",
  });
}

beforeEach(() => {
  sendMock.mockReset();
  configurationMock.mockReset();
  configured();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("parseDistributionList", () => {
  it("reads the list and the librarian together", () => {
    const result = parseDistributionList({
      program_distribution_list: ["secretary@example.test", "bishop@example.test"],
      librarian_email: "librarian@example.test",
    });

    // FEATURES.md §Module 7 step 3: the librarian prints the programmes and is on the list whether
    // or not anybody remembered to add them.
    expect(result.addresses).toEqual([
      "secretary@example.test",
      "bishop@example.test",
      "librarian@example.test",
    ]);
  });

  it("emails a librarian who is also on the list only once", () => {
    const result = parseDistributionList({
      program_distribution_list: ["Librarian@Example.test", "bishop@example.test"],
      librarian_email: "librarian@example.test",
    });

    // Deduped case-insensitively. Two copies of the same programme in one inbox reads as a bug in
    // the app rather than as a duplicate in a settings box.
    expect(result.addresses).toEqual(["Librarian@Example.test", "bishop@example.test"]);
  });

  // Reported, never silently dropped: an address with a typo belongs to exactly the person who
  // will say they never received it.
  it("separates entries that are not email addresses", () => {
    const result = parseDistributionList({
      program_distribution_list: ["bishop@example.test", "not an address", "ruth@"],
      librarian_email: null,
    });

    expect(result.addresses).toEqual(["bishop@example.test"]);
    expect(result.invalid).toEqual(["not an address", "ruth@"]);
  });

  // Every ward, until Phase 11's admin screen is filled in.
  it("returns an empty list for a ward with no settings", () => {
    expect(parseDistributionList({}).addresses).toEqual([]);
    expect(parseDistributionList(null).addresses).toEqual([]);
  });

  // A settings blob that cannot be parsed is an empty recipient list — refused with its own
  // sentence — not a route that throws.
  it("survives a malformed settings blob", () => {
    expect(parseDistributionList({ program_distribution_list: "not-an-array" }).addresses).toEqual(
      [],
    );
    expect(parseDistributionList("nonsense").addresses).toEqual([]);
  });
});

describe("sendProgramEmails", () => {
  describe("what it refuses before sending anything", () => {
    it("refuses an empty recipient list with its own kind", async () => {
      await expect(send([])).rejects.toMatchObject({
        name: "DistributionError",
        kind: "no_recipients",
        status: 422,
      });

      // A successful send to nobody is the failure this guards. Nothing must have been attempted.
      expect(sendMock).not.toHaveBeenCalled();
    });

    it("refuses a list over the cap without truncating it", async () => {
      const tooMany = Array.from(
        { length: MAX_RECIPIENTS + 1 },
        (_, index) => `person${index}@example.test`,
      );

      await expect(send(tooMany)).rejects.toMatchObject({ kind: "too_many_recipients" });
      // NO SILENT CAPS. Sending to the first hundred and dropping the rest would look like success.
      expect(sendMock).not.toHaveBeenCalled();
    });

    it("refuses when no sending domain is configured", async () => {
      configurationMock.mockReturnValue({
        configured: false,
        reason: "Email distribution needs a verified sending domain.",
      });

      await expect(send(["bishop@example.test"])).rejects.toMatchObject({
        kind: "not_configured",
        status: 503,
      });
      expect(sendMock).not.toHaveBeenCalled();
    });
  });

  describe("a send that works", () => {
    it("reports everyone as sent and nobody as failed", async () => {
      sendMock.mockResolvedValue({ error: null });

      const outcome = await send(["a@example.test", "b@example.test"]);

      expect(outcome).toEqual({ sentCount: 2, failedCount: 0, failures: [] });
    });

    // Not one send with every address in `to`. A single email addressed to forty people shows all
    // forty addresses to all forty, and a ward's leadership addresses are not a published list.
    it("sends one email per recipient, each addressed only to that person", async () => {
      sendMock.mockResolvedValue({ error: null });

      await send(["a@example.test", "b@example.test"]);

      expect(sendMock).toHaveBeenCalledTimes(2);
      expect(sendMock.mock.calls[0][0].to).toEqual(["a@example.test"]);
      expect(sendMock.mock.calls[1][0].to).toEqual(["b@example.test"]);
    });

    it("attaches the PDF it was given", async () => {
      sendMock.mockResolvedValue({ error: null });

      await send(["a@example.test"]);

      const attachments = sendMock.mock.calls[0][0].attachments;
      expect(attachments).toHaveLength(1);
      expect(attachments[0].filename).toBe("sacrament-programme-2026-09-20.pdf");
      expect(Buffer.from(attachments[0].content, "base64").toString()).toBe(PDF.toString());
    });
  });

  describe("partial failure", () => {
    // THE POINT OF THE WHOLE FILE.
    it("reports both counts rather than only the successes", async () => {
      sendMock
        .mockResolvedValueOnce({ error: null })
        .mockResolvedValueOnce({ error: { name: "validation_error", message: "Invalid `to`" } })
        .mockResolvedValueOnce({ error: null });

      const outcome = await send([
        "good@example.test",
        "bounced@example.test",
        "alsogood@example.test",
      ]);

      expect(outcome.sentCount).toBe(2);
      expect(outcome.failedCount).toBe(1);
    });

    it("carries the vendor's own reason for each failure", async () => {
      sendMock
        .mockResolvedValueOnce({ error: null })
        .mockResolvedValueOnce({ error: { name: "validation_error", message: "Invalid `to`" } });

      const outcome = await send(["good@example.test", "bounced@example.test"]);

      // plans/retros/deployment.md: Resend's refusal reached the app as a bare 500 and its cause
      // survived only in Resend's dashboard. The reason travels with the result now.
      expect(outcome.failures).toEqual([
        { address: "bounced@example.test", reason: "Invalid `to`" },
      ]);
    });

    it("keeps going after a thrown error rather than abandoning the rest of the list", async () => {
      sendMock
        .mockRejectedValueOnce(new Error("socket hang up"))
        .mockResolvedValueOnce({ error: null });

      const outcome = await send(["first@example.test", "second@example.test"]);

      expect(outcome.sentCount).toBe(1);
      expect(outcome.failures[0].reason).toBe("socket hang up");
    });
  });

  describe("total failure", () => {
    // Distribution has no undo. Marking a programme `distributed` when nothing left the building
    // would be permanent, so this throws instead of returning a zero.
    it("throws rather than returning sentCount 0", async () => {
      sendMock.mockResolvedValue({
        error: { name: "validation_error", message: "The domain is not verified" },
      });

      await expect(send(["a@example.test", "b@example.test"])).rejects.toBeInstanceOf(
        DistributionError,
      );
    });

    it("names the vendor's reason in the message", async () => {
      sendMock.mockResolvedValue({
        error: { name: "validation_error", message: "The domain is not verified" },
      });

      await expect(send(["a@example.test"])).rejects.toThrow("The domain is not verified");
    });
  });
});
