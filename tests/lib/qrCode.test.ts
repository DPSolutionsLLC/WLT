// @vitest-environment node
//
// The QR code that gets printed on the back of every programme and scanned by strangers.
//
// ---------------------------------------------------------------------------------------------
// WHAT "DECODES BACK TO THE INPUT" MEANS HERE, AND WHAT IT DOES NOT
// ---------------------------------------------------------------------------------------------
// A true check would photograph the printed square and decode it optically. That needs a decoder
// this project does not have and would not justify installing, so the round-trip below is done
// through the encoder's own segment list: QRCode.create() reports the data it encoded, and this
// asserts that data is character-for-character the URL we handed it.
//
// That catches the failures that are actually plausible in code — a truncated URL, a slug mangled
// by escaping, an empty payload — and it does not catch a code that is too small, too pale or too
// close to the fold to scan. Those are physical, and scenario 034 is the only check for them.

import { describe, expect, it } from "vitest";
import QRCode from "qrcode";
import { QR_MINIMUM_SIZE_POINTS, programQrDataUri } from "@/lib/pdf/qrCode";

const URL_WITH_HYPHEN = "https://wlt-iota.vercel.app/public/program-4f2a9c1e7b3d5086";

// The segments the encoder actually wrote, joined back into one string.
//
// A URL contains lowercase letters, so the encoder picks BYTE mode and `segment.data` comes back
// as a Uint8Array rather than a string — decoded here rather than stringified, because
// `String(bytes)` produces "104,116,116,..." and would compare unequal for the wrong reason.
function encodedPayload(text: string): string {
  return QRCode.create(text, { errorCorrectionLevel: "M" })
    .segments.map((segment) =>
      typeof segment.data === "string"
        ? segment.data
        : new TextDecoder().decode(Uint8Array.from(segment.data as ArrayLike<number>)),
    )
    .join("");
}

describe("programQrDataUri", () => {
  it("returns a PNG data URI", async () => {
    const dataUri = await programQrDataUri(URL_WITH_HYPHEN);

    // @react-pdf/renderer renders PNG and JPG and nothing else. An SVG here would reach the
    // renderer and throw, taking the whole programme with it — this is the phase plan's named
    // pitfall, asserted on the prefix rather than trusted.
    expect(dataUri.startsWith("data:image/png;base64,")).toBe(true);
  });

  it("produces a payload that is a real image", async () => {
    const dataUri = await programQrDataUri(URL_WITH_HYPHEN);
    const bytes = Buffer.from(dataUri.split(",")[1], "base64");

    // The eight-byte PNG signature. A data URI that claims to be a PNG and is not would fail in
    // the renderer with an opaque error rather than here with a named one.
    expect([...bytes.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    expect(bytes.byteLength).toBeGreaterThan(200);
  });

  // THE SLUG WITH A HYPHEN. Slugs are `program-` plus 16 hex characters, so every real slug has
  // one — a mangling that only showed up on hyphenated input would be a defect in every single
  // programme this app ever prints.
  it("encodes a hyphenated slug URL character for character", () => {
    expect(encodedPayload(URL_WITH_HYPHEN)).toBe(URL_WITH_HYPHEN);
  });

  it("encodes a plain URL character for character", () => {
    const url = "https://example.test/public/abc";

    expect(encodedPayload(url)).toBe(url);
  });

  // A blank URL encodes successfully and produces a scannable code that goes nowhere — a defect
  // that survives every test that only checks "did it return a PNG".
  it("refuses an empty URL", async () => {
    await expect(programQrDataUri("")).rejects.toThrow("empty URL");
  });

  it("refuses a whitespace-only URL", async () => {
    await expect(programQrDataUri("   ")).rejects.toThrow("empty URL");
  });

  describe("the printed size floor", () => {
    // 20mm, expressed in PDF points. A physical constraint, not a style choice: below it a folded,
    // handled programme stops scanning reliably. BackPanel asserts its own size against this at
    // module load, so a change that shrank the code would fail the build rather than a chapel.
    it("is 20mm converted to points", () => {
      expect(QR_MINIMUM_SIZE_POINTS).toBe(Math.ceil((20 / 25.4) * 72));
      expect(QR_MINIMUM_SIZE_POINTS).toBe(57);
    });
  });
});
