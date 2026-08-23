// Which months a viewer has dismissed the goal alert banner for, stored in a COOKIE.
//
// WHY A COOKIE AND NOT localStorage. The banner shipped reading localStorage, which the server
// cannot see — so the server had to render it for everybody and let the client hide it after
// hydration. That paints a dismissed banner and then removes it. Measured on the Sunday planning
// page: 268 ms on an unthrottled desktop, 645 ms at 4x CPU throttle, 3.8 s at 20x. A viewer who
// dismissed the banner got it flashed at them every time they opened another Sunday that month,
// which is the one thing dismissing was supposed to stop.
//
// A cookie travels with the request, so the Server Component decides and the HTML is right the
// first time. There is nothing to correct after hydration and therefore nothing to flash. The app
// already solves the same class of problem for the theme with a pre-paint inline script
// (app/layout.tsx); that works because a theme is one class on <html>, and it would be far more
// machinery here than simply telling the server.
//
// NOTHING CHANGES ABOUT WHAT THE DISMISSAL MEANS. A cookie is per-browser and per-device, exactly
// as localStorage was — dismissing on a laptop does not dismiss on a phone. That caveat is
// recorded in scenario 019 and stays true.
//
// PURE AND CLIENT-IMPORTABLE. No next/headers here: the page reads the cookie and the banner
// writes it, and both need this logic.

export const GOAL_ALERT_DISMISSAL_COOKIE = "wlt_goal_alerts_dismissed";

// A year. The value is a list of YYYY-MM strings, so an expiry only matters for a browser that is
// never used again — and a stale month in the list is harmless because nothing looks it up.
export const GOAL_ALERT_DISMISSAL_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

// Bounded so the cookie cannot grow forever on a browser that dismisses every month for years.
// Twelve is more than anybody has open at once, and the oldest entries are the ones nobody will
// look at again.
export const MAX_DISMISSED_MONTHS = 12;

const MONTH_PATTERN = /^\d{4}-\d{2}$/;

// Malformed entries are DROPPED rather than throwing. This value comes from a cookie, which a
// person can edit by hand and a browser can truncate — a banner is not worth a 500, and the
// failure mode of dropping is simply that the banner comes back.
export function parseDismissedMonths(cookieValue: string | undefined): string[] {
  if (!cookieValue) return [];

  return cookieValue
    .split(",")
    .map((month) => month.trim())
    .filter((month) => MONTH_PATTERN.test(month))
    .slice(0, MAX_DISMISSED_MONTHS);
}

export function isMonthDismissed(
  cookieValue: string | undefined,
  monthKey: string,
): boolean {
  return parseDismissedMonths(cookieValue).includes(monthKey);
}

// The newly dismissed month goes FIRST, so the cap drops the least recently dismissed rather than
// whichever happened to sort earliest.
export function withMonthDismissed(
  cookieValue: string | undefined,
  monthKey: string,
): string {
  if (!MONTH_PATTERN.test(monthKey)) return cookieValue ?? "";

  const existing = parseDismissedMonths(cookieValue).filter(
    (month) => month !== monthKey,
  );

  return [monthKey, ...existing].slice(0, MAX_DISMISSED_MONTHS).join(",");
}

// Built here rather than at the call site so the attributes cannot drift between the two places a
// cookie would otherwise be written. `Secure` is conditional because dev runs on http://localhost
// and a Secure cookie there is silently dropped — which would look exactly like the feature being
// broken. NOT HttpOnly: the banner writes this from the browser.
export function buildDismissalCookie(value: string, isSecure: boolean): string {
  const attributes = [
    `${GOAL_ALERT_DISMISSAL_COOKIE}=${value}`,
    "Path=/",
    `Max-Age=${GOAL_ALERT_DISMISSAL_MAX_AGE_SECONDS}`,
    "SameSite=Lax",
  ];

  if (isSecure) attributes.push("Secure");

  return attributes.join("; ");
}

// Reading `document.cookie` means finding one name in a semicolon-separated string; there is no
// browser API that does it. Kept here beside the writer so the two agree on the name.
export function readCookie(documentCookie: string, name: string): string | undefined {
  for (const entry of documentCookie.split(";")) {
    const separator = entry.indexOf("=");
    if (separator === -1) continue;

    if (entry.slice(0, separator).trim() === name) {
      return entry.slice(separator + 1).trim();
    }
  }

  return undefined;
}
