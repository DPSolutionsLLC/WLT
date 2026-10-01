// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { formatAppVersion, VersionStamp } from "@/components/layout/VersionStamp";

// The footer must read the same seven characters a push reports, or it cannot confirm anything.

describe("formatAppVersion", () => {
  it("shortens a full commit id to the seven characters git reports", () => {
    expect(formatAppVersion("4fcd059a1b2c3d4e5f60718293a4b5c6d7e8f901")).toBe("4fcd059");
  });

  it("reads 'local' when no commit id was captured", () => {
    expect(formatAppVersion(undefined)).toBe("local");
    expect(formatAppVersion("")).toBe("local");
    expect(formatAppVersion("   ")).toBe("local");
  });
});

describe("VersionStamp", () => {
  it("shows the version line", () => {
    render(<VersionStamp commitSha="4fcd059a1b2c3d4e5f60718293a4b5c6d7e8f901" />);
    expect(screen.getByText("Version 4fcd059")).toBeInTheDocument();
  });
});
