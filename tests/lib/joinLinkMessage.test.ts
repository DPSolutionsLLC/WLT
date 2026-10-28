import { describe, expect, it } from "vitest";
import { buildSmsLink, SMS_TRUNCATION_THRESHOLD } from "@/lib/assignments/smsLink";
import { buildJoinLinkMessage, firstNameOf } from "@/lib/zoom/joinLinkMessage";

// The text that goes with somebody's own Zoom join link (ITER-053, z2b).

const URL = "https://example.org/j/guest07?tk=abc";

describe("firstNameOf", () => {
  it("takes the first word of the saved name", () => {
    expect(firstNameOf("Ann Lee")).toBe("Ann");
    expect(firstNameOf("  Mary Ann   Smith ")).toBe("Mary");
  });

  it("answers null for a blank name rather than an empty string", () => {
    expect(firstNameOf("   ")).toBeNull();
  });
});

describe("buildJoinLinkMessage", () => {
  it("greets by first name, names the ward and carries the link exactly once", () => {
    const message = buildJoinLinkMessage({ displayName: "Ann Lee", wardName: "Buffalo Ward", joinUrl: URL });
    expect(message.startsWith("Hi Ann — ")).toBe(true);
    expect(message).toContain("Buffalo Ward sacrament meeting");
    expect(message.split(URL)).toHaveLength(2);
    expect(message).toContain("please don't share it");
  });

  it("still reads naturally when the ward name could not be read", () => {
    const message = buildJoinLinkMessage({ displayName: "Ann", wardName: null, joinUrl: URL });
    expect(message).toContain("watch our sacrament meeting on Zoom");
  });

  it("stays under the SMS truncation threshold with an ordinary Zoom link", () => {
    const message = buildJoinLinkMessage({
      displayName: "Bartholomew Featherstonehaugh",
      wardName: "Buffalo Ward",
      joinUrl: `https://us06web.zoom.us/w/${"9".repeat(11)}?tk=${"a".repeat(120)}`,
    });
    expect(buildSmsLink({ phone: "555-123-4567", body: message }).truncationRisk).toBe(false);
  });

  it("flags truncation for a very long link rather than cutting it", () => {
    const longUrl = `https://example.org/${"x".repeat(1900)}`;
    const message = buildJoinLinkMessage({ displayName: "Ann", wardName: "Buffalo Ward", joinUrl: longUrl });
    expect(message).toContain(longUrl);
    expect(message.length).toBeGreaterThan(SMS_TRUNCATION_THRESHOLD);
    expect(buildSmsLink({ phone: null, body: message }).truncationRisk).toBe(true);
  });
});
