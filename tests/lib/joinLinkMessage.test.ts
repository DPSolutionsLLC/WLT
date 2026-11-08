import { describe, expect, it } from "vitest";
import { buildSmsLink, SMS_TRUNCATION_THRESHOLD } from "@/lib/assignments/smsLink";
import {
  buildJoinLinkEmail,
  buildJoinLinkGreeting,
  buildJoinLinkMessage,
  firstNameOf,
} from "@/lib/zoom/joinLinkMessage";

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
    expect(message.endsWith(`

${URL}`)).toBe(true);
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

describe("buildJoinLinkGreeting", () => {
  it("is the message without the link, so the link can be its own text", () => {
    const input = { displayName: "Ann Lee", wardName: "Buffalo Ward" };
    const greeting = buildJoinLinkGreeting(input);
    expect(greeting.startsWith("Hi Ann — ")).toBe(true);
    expect(greeting).not.toContain("https://");
    expect(buildJoinLinkMessage({ ...input, joinUrl: URL })).toBe(`${greeting}

${URL}`);
  });
});

describe("buildJoinLinkEmail", () => {
  const email = buildJoinLinkEmail({ displayName: "Ann Lee", wardName: "Buffalo Ward", joinUrl: URL });

  it("names the meeting in the subject", () => {
    expect(email.subject).toBe("Your link to watch Buffalo Ward sacrament meeting on Zoom");
  });

  it("hides the link behind the button: the HTML holds it only inside the href", () => {
    expect(email.html).toContain(`href="https://example.org/j/guest07?tk=abc"`);
    expect(email.html.split("https://example.org/j/guest07")).toHaveLength(2);
    expect(email.html).toContain(">Watch sacrament meeting</a>");
  });

  it("carries the full link in the plain-text copy for mail apps that show only text", () => {
    expect(email.text).toContain(`Watch sacrament meeting: ${URL}`);
  });

  it("says replies are not read, because the sender is a no-reply address", () => {
    expect(email.html).toContain("Replies to this email aren&#39;t read");
    expect(email.text).toContain("Replies to this email aren't read");
  });

  it("escapes a name and ward name, so neither can inject HTML", () => {
    const hostile = buildJoinLinkEmail({
      displayName: "<b>Ann</b>",
      wardName: 'Ward "<script>"',
      joinUrl: 'https://example.org/j/1?a="x"',
    });
    expect(hostile.html).not.toContain("<b>");
    expect(hostile.html).not.toContain("<script>");
    expect(hostile.html).toContain("&lt;b&gt;Ann&lt;/b&gt;");
    expect(hostile.html).toContain('href="https://example.org/j/1?a=&quot;x&quot;"');
  });

  it("still reads naturally when the ward name could not be read", () => {
    const fallback = buildJoinLinkEmail({ displayName: "Ann", wardName: null, joinUrl: URL });
    expect(fallback.subject).toBe("Your link to watch our sacrament meeting on Zoom");
  });
});
