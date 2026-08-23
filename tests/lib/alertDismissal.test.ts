import { describe, expect, it } from "vitest";
import {
  buildDismissalCookie,
  GOAL_ALERT_DISMISSAL_COOKIE,
  isMonthDismissed,
  MAX_DISMISSED_MONTHS,
  parseDismissedMonths,
  readCookie,
  withMonthDismissed,
} from "@/lib/goals/alertDismissal";

// The goal alert dismissal moved from localStorage to a cookie so the SERVER can decide whether to
// render the banner. Reading it on the server is what removes the flash — the old version rendered
// a dismissed banner and hid it after hydration, measured at 268 ms unthrottled and 3.8 s at 20x
// CPU throttle.
//
// This value arrives from a cookie header, which means it is untrusted input: a person can edit it
// by hand, a browser can truncate it, and an old version of the app may have written a different
// shape. Every function here has to survive that without throwing, because the alternative is a
// 500 on the Sunday planning page over a dismissed banner.

describe("parseDismissedMonths", () => {
  it("reads a single month", () => {
    expect(parseDismissedMonths("2026-07")).toEqual(["2026-07"]);
  });

  it("reads several", () => {
    expect(parseDismissedMonths("2026-07,2026-08,2026-09")).toEqual([
      "2026-07",
      "2026-08",
      "2026-09",
    ]);
  });

  it("treats a missing cookie as nothing dismissed", () => {
    expect(parseDismissedMonths(undefined)).toEqual([]);
    expect(parseDismissedMonths("")).toEqual([]);
  });

  it("tolerates whitespace around entries", () => {
    expect(parseDismissedMonths("2026-07 , 2026-08")).toEqual(["2026-07", "2026-08"]);
  });

  describe("untrusted input", () => {
    // DROPS rather than throws. A malformed cookie must degrade to "the banner comes back", never
    // to a 500 on the page it appears on.
    it("drops entries that are not YYYY-MM", () => {
      expect(parseDismissedMonths("2026-07,nonsense,2026-08")).toEqual([
        "2026-07",
        "2026-08",
      ]);
    });

    it("drops a truncated month", () => {
      expect(parseDismissedMonths("2026-07,2026-")).toEqual(["2026-07"]);
    });

    it("survives a value that is entirely garbage", () => {
      expect(parseDismissedMonths("<script>alert(1)</script>")).toEqual([]);
    });

    it("does not throw on separators alone", () => {
      expect(parseDismissedMonths(",,,")).toEqual([]);
    });

    it("caps a cookie somebody stuffed", () => {
      const stuffed = Array.from({ length: 50 }, (_, i) =>
        `2026-${String((i % 12) + 1).padStart(2, "0")}`,
      ).join(",");

      expect(parseDismissedMonths(stuffed)).toHaveLength(MAX_DISMISSED_MONTHS);
    });
  });
});

describe("isMonthDismissed", () => {
  it("is true for a month in the list", () => {
    expect(isMonthDismissed("2026-07,2026-08", "2026-08")).toBe(true);
  });

  // The whole point of keying by month: dismissing July must not silence August.
  it("is false for a month that is not", () => {
    expect(isMonthDismissed("2026-07", "2026-08")).toBe(false);
  });

  it("is false when nothing has been dismissed", () => {
    expect(isMonthDismissed(undefined, "2026-07")).toBe(false);
  });

  it("does not match on a prefix", () => {
    expect(isMonthDismissed("2026-07", "2026-0")).toBe(false);
  });
});

describe("withMonthDismissed", () => {
  it("adds the first month", () => {
    expect(withMonthDismissed(undefined, "2026-07")).toBe("2026-07");
  });

  it("keeps months already dismissed", () => {
    expect(withMonthDismissed("2026-07", "2026-08")).toBe("2026-08,2026-07");
  });

  it("puts the newest first", () => {
    expect(withMonthDismissed("2026-07,2026-06", "2026-08")).toBe(
      "2026-08,2026-07,2026-06",
    );
  });

  it("does not duplicate a month dismissed twice", () => {
    expect(withMonthDismissed("2026-07,2026-06", "2026-07")).toBe("2026-07,2026-06");
  });

  // Newest-first is what makes the cap drop the LEAST recently dismissed rather than whichever
  // sorted earliest — a viewer who dismisses this month should not lose it to a cap.
  it("drops the least recently dismissed once full", () => {
    const full = Array.from({ length: MAX_DISMISSED_MONTHS }, (_, i) =>
      `2025-${String(i + 1).padStart(2, "0")}`,
    ).join(",");

    const next = withMonthDismissed(full, "2026-07");
    const months = next.split(",");

    expect(months).toHaveLength(MAX_DISMISSED_MONTHS);
    expect(months[0]).toBe("2026-07");
    expect(months).not.toContain(`2025-${String(MAX_DISMISSED_MONTHS).padStart(2, "0")}`);
  });

  it("refuses to write a month that is not YYYY-MM, leaving the cookie alone", () => {
    expect(withMonthDismissed("2026-07", "nonsense")).toBe("2026-07");
  });
});

describe("buildDismissalCookie", () => {
  it("carries the name, a path, an expiry and SameSite", () => {
    const cookie = buildDismissalCookie("2026-07", false);

    expect(cookie).toContain(`${GOAL_ALERT_DISMISSAL_COOKIE}=2026-07`);
    expect(cookie).toContain("Path=/");
    expect(cookie).toContain("Max-Age=");
    expect(cookie).toContain("SameSite=Lax");
  });

  // Conditional because dev runs on http://localhost, where a Secure cookie is silently dropped —
  // which would look exactly like the dismissal not working.
  it("omits Secure off https and includes it on", () => {
    expect(buildDismissalCookie("2026-07", false)).not.toContain("Secure");
    expect(buildDismissalCookie("2026-07", true)).toContain("Secure");
  });

  // NOT HttpOnly: the banner writes this from the browser. Asserted so nobody "hardens" it into
  // something the client can no longer set.
  it("is not HttpOnly", () => {
    expect(buildDismissalCookie("2026-07", true)).not.toContain("HttpOnly");
  });
});

describe("readCookie", () => {
  it("finds the value among others", () => {
    const jar = `sb-access-token=abc; ${GOAL_ALERT_DISMISSAL_COOKIE}=2026-07; theme=dark`;

    expect(readCookie(jar, GOAL_ALERT_DISMISSAL_COOKIE)).toBe("2026-07");
  });

  it("returns undefined when absent", () => {
    expect(readCookie("theme=dark", GOAL_ALERT_DISMISSAL_COOKIE)).toBeUndefined();
  });

  it("returns undefined for an empty jar", () => {
    expect(readCookie("", GOAL_ALERT_DISMISSAL_COOKIE)).toBeUndefined();
  });

  // A name that merely ENDS with the one we want must not match — `wlt_goal_alerts_dismissed`
  // and `x_wlt_goal_alerts_dismissed` are different cookies.
  it("matches the whole name, not a suffix", () => {
    const jar = `x_${GOAL_ALERT_DISMISSAL_COOKIE}=2026-07`;

    expect(readCookie(jar, GOAL_ALERT_DISMISSAL_COOKIE)).toBeUndefined();
  });

  it("handles a value containing an equals sign without truncating it", () => {
    expect(readCookie("token=a=b=c", "token")).toBe("a=b=c");
  });
});

describe("the round trip a dismissal actually takes", () => {
  it("survives write, read back, and check", () => {
    // Write July from an empty jar.
    const afterJuly = withMonthDismissed(undefined, "2026-07");
    const jar = `theme=dark; ${buildDismissalCookie(afterJuly, false).split(";")[0]}`;

    expect(isMonthDismissed(readCookie(jar, GOAL_ALERT_DISMISSAL_COOKIE), "2026-07")).toBe(
      true,
    );
    expect(isMonthDismissed(readCookie(jar, GOAL_ALERT_DISMISSAL_COOKIE), "2026-08")).toBe(
      false,
    );

    // Then dismiss August too, and confirm July is still dismissed.
    const afterAugust = withMonthDismissed(
      readCookie(jar, GOAL_ALERT_DISMISSAL_COOKIE),
      "2026-08",
    );

    expect(isMonthDismissed(afterAugust, "2026-07")).toBe(true);
    expect(isMonthDismissed(afterAugust, "2026-08")).toBe(true);
  });
});
