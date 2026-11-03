import { describe, expect, it } from "vitest";
import { normalizeZoomJoinUrl, parseJoinLinkPaste } from "@/lib/zoom/joinLinkPaste";

const URL_ONE = "https://us02web.zoom.us/j/111?tk=abc";
const URL_TWO = "https://us02web.zoom.us/j/222?tk=def";

describe("normalizeZoomJoinUrl", () => {
  it("turns a /w/ link into a /j/ link, keeping tk and uuid exactly", () => {
    expect(
      normalizeZoomJoinUrl("https://us02web.zoom.us/w/81234567890?tk=Ab-c_D.e&uuid=WN_xYz-123"),
    ).toBe("https://us02web.zoom.us/j/81234567890?tk=Ab-c_D.e&uuid=WN_xYz-123");
  });

  it("handles the bare zoom.us host", () => {
    expect(normalizeZoomJoinUrl("https://zoom.us/w/1?tk=a")).toBe("https://zoom.us/j/1?tk=a");
  });

  it.each([
    ["a /j/ link", "https://us02web.zoom.us/j/1?tk=a"],
    ["a /w/ further down the path", "https://us02web.zoom.us/j/1/w/2?tk=a"],
    ["another host", "https://example.org/w/1?tk=a"],
    ["a look-alike host", "https://notzoom.us.example.org/w/1"],
  ])("leaves %s unchanged", (_label, url) => {
    expect(normalizeZoomJoinUrl(url)).toBe(url);
  });
});

describe("parseJoinLinkPaste", () => {
  it("reads a comma-separated line in name, email, link order", () => {
    expect(parseJoinLinkPaste(`Guest 01, guest01@example.org, ${URL_ONE}`)).toEqual({
      lines: [
        {
          lineNumber: 1,
          placeholderName: "Guest 01",
          placeholderEmail: "guest01@example.org",
          joinUrl: URL_ONE,
        },
      ],
      problems: [],
    });
  });

  it("reads a tab-separated copy from a spreadsheet in any column order", () => {
    const { lines, problems } = parseJoinLinkPaste(`${URL_ONE}\tGuest 01\tguest01@example.org`);
    expect(problems).toEqual([]);
    expect(lines[0]).toMatchObject({ placeholderName: "Guest 01", joinUrl: URL_ONE });
  });

  it("reads mixed tabs and commas, and joins leftover cells into the name", () => {
    const { lines } = parseJoinLinkPaste(`guest01@example.org,\tSacrament\tGuest 01, ${URL_ONE}`);
    expect(lines[0].placeholderName).toBe("Sacrament Guest 01");
  });

  it("lower-cases the email", () => {
    const { lines } = parseJoinLinkPaste(`Guest 01, Sacrament+Guest01@Example.ORG, ${URL_ONE}`);
    expect(lines[0].placeholderEmail).toBe("sacrament+guest01@example.org");
  });

  it("skips blank lines while keeping the real line numbers", () => {
    const { lines } = parseJoinLinkPaste(
      `\nGuest 01, g1@example.org, ${URL_ONE}\n\n   \nGuest 02, g2@example.org, ${URL_TWO}\n`,
    );
    expect(lines.map((line) => line.lineNumber)).toEqual([2, 5]);
  });

  it.each([
    ["no link", "Guest 01, g1@example.org", "There is no link starting with https:// on this line."],
    ["an http link", "Guest 01, g1@example.org, http://example.org/j/1", "The link must start with https://."],
    ["two links", `Guest 01, g1@example.org, ${URL_ONE}, ${URL_TWO}`, "There is more than one link on this line."],
    ["no email", `Guest 01, ${URL_ONE}`, "There is no email address on this line."],
    ["a bad email", `Guest 01, g1@nowhere, ${URL_ONE}`, '"g1@nowhere" is not a valid email address.'],
    ["no name", `g1@example.org, ${URL_ONE}`, "There is no placeholder name on this line."],
    ["a long name", `${"x".repeat(121)}, g1@example.org, ${URL_ONE}`, "The name is too long. Names can be at most 120 characters."],
    ["a long link", `Guest 01, g1@example.org, https://example.org/${"x".repeat(2000)}`, "The link is too long. Links can be at most 2000 characters."],
  ])("reports %s with its line number", (_label, line, message) => {
    const { lines, problems } = parseJoinLinkPaste(`Guest 00, g0@example.org, https://example.org/j/0\n${line}`);
    expect(lines).toHaveLength(1);
    expect(problems).toEqual([{ lineNumber: 2, message }]);
  });

  it("reports the same link twice within one paste", () => {
    const { lines, problems } = parseJoinLinkPaste(
      `Guest 01, g1@example.org, ${URL_ONE}\nGuest 02, g2@example.org, ${URL_ONE}`,
    );
    expect(lines).toHaveLength(1);
    expect(problems).toEqual([{ lineNumber: 2, message: "This link is the same as the one on line 1." }]);
  });

  it("reports the same email twice within one paste, case-insensitively", () => {
    const { problems } = parseJoinLinkPaste(
      `Guest 01, g1@example.org, ${URL_ONE}\nGuest 02, G1@Example.org, ${URL_TWO}`,
    );
    expect(problems).toEqual([
      { lineNumber: 2, message: "This email address is the same as the one on line 1." },
    ]);
  });

  it("stores a pasted /w/ link as its /j/ form", () => {
    const { lines } = parseJoinLinkPaste("Guest 01, g1@example.org, https://us02web.zoom.us/w/111?tk=abc");
    expect(lines[0].joinUrl).toBe(URL_ONE);
  });

  it("reports a /w/ and a /j/ copy of one link as the same link", () => {
    const { lines, problems } = parseJoinLinkPaste(
      `Guest 01, g1@example.org, ${URL_ONE}\nGuest 02, g2@example.org, https://us02web.zoom.us/w/111?tk=abc`,
    );
    expect(lines).toHaveLength(1);
    expect(problems).toEqual([{ lineNumber: 2, message: "This link is the same as the one on line 1." }]);
  });

  it("returns nothing for an empty paste", () => {
    expect(parseJoinLinkPaste("  \n\n")).toEqual({ lines: [], problems: [] });
  });
});
