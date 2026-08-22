// The `sms:` handoff, as a pure function.
//
// Nothing outside this file may be imported: talks-b renders it in client components, and a
// single import of lib/assignments/queries.ts would pull in next/headers and break the
// production build — a violation that both `npm run lint` and `npm run typecheck` pass
// (plans/retros/roster-b-picker-and-orgs.md).
//
// This app never sends a message. It hands one to the phone's own messaging app with the body
// pre-filled, and a human taps send. There is no delivery confirmation anywhere in the flow,
// which is why every caller pairs the link with a Copy button — the link is dead in a desktop
// browser and truncates differently on every phone (CLAUDE.md §9).

export type SmsTarget = {
  phone: string | null;
  body: string;
};

export type SmsLink = {
  href: string | null;
  truncationRisk: boolean;
};

// Past this many characters the body starts getting cut off by some phones. The number is a
// guide, not a limit — nothing here blocks a longer message, it only tells the UI to give Copy
// more weight.
export const SMS_TRUNCATION_THRESHOLD = 500;

// The fewest digits that could be a real number. Anything shorter is a typo or a placeholder,
// and a tel-shaped string that dials nothing is worse than no link at all.
const MINIMUM_DIGITS = 7;

// Digits, plus a single leading + for an international number. Spaces, dashes, parentheses and
// dots are all how people write a number down and none of them belong in the URL.
export function normalizePhone(raw: string): string | null {
  const trimmed = raw.trim();
  const isInternational = trimmed.startsWith("+");
  const digits = trimmed.replace(/\D/g, "");

  if (digits.length < MINIMUM_DIGITS) return null;

  return isInternational ? `+${digits}` : digits;
}

// `sms:{phone}?&body={encoded}` verbatim. iOS wants `&body=`, Android wants `?body=`, and this
// form is the one both parse — 04-talks-pipeline.md §Step 4 specifies it exactly, so it is
// written here as a single template rather than assembled conditionally per platform.
//
// A null href means NO LINK AT ALL. A caller must not render a disabled-looking anchor: an
// anchor that cannot be followed reads as "this is broken" rather than "there is no number on
// file for this person", and only one of those is true.
export function buildSmsLink(target: SmsTarget): SmsLink {
  const truncationRisk = target.body.length > SMS_TRUNCATION_THRESHOLD;
  const phone = target.phone === null ? null : normalizePhone(target.phone);

  if (phone === null) {
    return { href: null, truncationRisk };
  }

  return {
    href: `sms:${phone}?&body=${encodeURIComponent(target.body)}`,
    truncationRisk,
  };
}
