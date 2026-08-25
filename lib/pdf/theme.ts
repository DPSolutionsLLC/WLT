import type { ProgramTemplate } from "@/lib/program/gather";

// Everything the four panels are allowed to know about how a program LOOKS, resolved once from
// `wards.settings.program_template` and handed down as a plain object.
//
// ---------------------------------------------------------------------------------------------
// WHY THERE ARE NO REGISTERED FONTS
// ---------------------------------------------------------------------------------------------
// program-d's plan says to register fonts from files under public/fonts/. That directory does not
// exist, and SPEC.md's own example value for `font_family` is "serif" — a generic family name, not
// a file name. Registering a real typeface would mean committing font binaries and making a
// licensing decision that nothing in this feature needs.
//
// So the three families below are the standard PDF base-14 fonts, which every PDF reader already
// has and @react-pdf/renderer therefore does NOT require Font.register() for. That also removes
// the failure the plan was warning about: there is no font fetch at render time, so there is no
// cold-start network call on Vercel that can fail.
//
// If a ward ever wants its own typeface, THAT is the change that adds public/fonts/ and a
// Font.register() call — and it needs a licence, not just a file.
const FONT_FAMILIES: Record<string, string> = {
  serif: "Times-Roman",
  "sans-serif": "Helvetica",
  sans: "Helvetica",
  monospace: "Courier",
  mono: "Courier",
};

const DEFAULT_FONT = "Times-Roman";

// A sacrament programme is a formal document read in a chapel. Serif is the boring, correct
// default, and it is what every printed programme this app replaces already uses.
export function resolveFontFamily(fontFamily: string | null): string {
  if (fontFamily === null) return DEFAULT_FONT;
  return FONT_FAMILIES[fontFamily.trim().toLowerCase()] ?? DEFAULT_FONT;
}

const DEFAULT_PRIMARY_COLOR = "#1a1a1a";

// The minimum contrast ratio a heading colour must reach against white paper.
//
// 4.5:1 is WCAG AA for body text. Paper is not a screen and this is not a WCAG surface, but the
// number is the right order of magnitude and it is a published threshold rather than a taste
// judgement — which matters, because the thing being guarded against is a ward typing "#ffee88"
// into a settings box and printing 200 invisible programmes with no error anywhere.
//
// talks-b measured stage-token contrast rather than eyeballing it. Same idea, one theme: white.
const MINIMUM_CONTRAST_RATIO = 4.5;

const HEX_COLOR = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;

export function parseHexColor(
  value: string,
): { red: number; green: number; blue: number } | null {
  const match = HEX_COLOR.exec(value.trim());
  if (!match) return null;

  const digits =
    match[1].length === 3
      ? match[1]
          .split("")
          .map((digit) => digit + digit)
          .join("")
      : match[1];

  return {
    red: Number.parseInt(digits.slice(0, 2), 16),
    green: Number.parseInt(digits.slice(2, 4), 16),
    blue: Number.parseInt(digits.slice(4, 6), 16),
  };
}

// WCAG 2.x relative luminance. The 0.03928 branch and the 2.4 exponent are from the spec — this
// is a transcription, not a formula anybody should re-derive.
function relativeLuminance(channel: number): number {
  const proportion = channel / 255;
  return proportion <= 0.03928
    ? proportion / 12.92
    : Math.pow((proportion + 0.055) / 1.055, 2.4);
}

export function contrastRatioAgainstWhite(hex: string): number | null {
  const parsed = parseHexColor(hex);
  if (!parsed) return null;

  const luminance =
    0.2126 * relativeLuminance(parsed.red) +
    0.7152 * relativeLuminance(parsed.green) +
    0.0722 * relativeLuminance(parsed.blue);

  // White's luminance is exactly 1, so the lighter colour is always white and the ordering in
  // (L1 + 0.05) / (L2 + 0.05) is fixed.
  return 1.05 / (luminance + 0.05);
}

export type ResolvedColor = {
  color: string;
  // Non-null ONLY when the ward's configured colour was rejected. The render result carries it up
  // so the route can say what happened — a colour silently swapped is a setting that looks broken
  // rather than one that was overruled (CLAUDE.md rule 7).
  rejectedReason: string | null;
};

export function resolvePrimaryColor(primaryColor: string | null): ResolvedColor {
  if (primaryColor === null || primaryColor.trim() === "") {
    return { color: DEFAULT_PRIMARY_COLOR, rejectedReason: null };
  }

  const ratio = contrastRatioAgainstWhite(primaryColor);

  if (ratio === null) {
    return {
      color: DEFAULT_PRIMARY_COLOR,
      rejectedReason: `The ward's programme colour ("${primaryColor}") is not a hex colour, so the default was printed instead.`,
    };
  }

  if (ratio < MINIMUM_CONTRAST_RATIO) {
    return {
      color: DEFAULT_PRIMARY_COLOR,
      rejectedReason: `The ward's programme colour ("${primaryColor}") is too pale to read on white paper, so the default was printed instead.`,
    };
  }

  const parsed = parseHexColor(primaryColor);
  return {
    // Normalised to a leading `#`. @react-pdf/renderer will not parse a bare "000000".
    color: parsed
      ? `#${parsed.red.toString(16).padStart(2, "0")}${parsed.green
          .toString(16)
          .padStart(2, "0")}${parsed.blue.toString(16).padStart(2, "0")}`
      : DEFAULT_PRIMARY_COLOR,
    rejectedReason: null,
  };
}

export const DEFAULT_CHURCH_NAME = "The Church of Jesus Christ of Latter-day Saints";

export type PdfTheme = {
  fontFamily: string;
  primaryColor: string;
  // The ward's own name for itself. Falls back to the ward row's name at the call site, because
  // this module never reads the database.
  wardName: string;
  churchName: string;
  colorRejectedReason: string | null;
};

// A ward whose settings are `{}` — which is every ward until Phase 11's admin screen is filled in
// — must still print. Every field defaults (program-a's rule, restated here because this is the
// second reader of the same blob).
export function resolveTheme(
  template: ProgramTemplate,
  fallbackWardName: string,
): PdfTheme {
  const primary = resolvePrimaryColor(template.primaryColor);

  return {
    fontFamily: resolveFontFamily(template.fontFamily),
    primaryColor: primary.color,
    wardName: template.wardName?.trim() || fallbackWardName,
    churchName: template.churchName?.trim() || DEFAULT_CHURCH_NAME,
    colorRejectedReason: primary.rejectedReason,
  };
}

// ---------------------------------------------------------------------------------------------
// SPACING AND SIZES
// ---------------------------------------------------------------------------------------------
// Points, because that is the only unit @react-pdf/renderer measures pages in. 72pt = 1 inch.
//
// A US Letter sheet in landscape is 792 x 612pt. Folded once down the middle each panel is
// 396pt wide, and PANEL_PADDING is what keeps type off the fold and off the printer's dead
// margin — the two places scenario 034 checks with a ruler.
export const PANEL_PADDING = 28;

export const FONT_SIZES = {
  churchName: 9,
  coverHeading: 20,
  coverWardName: 15,
  coverDate: 12,
  panelHeading: 12,
  lineLabel: 8,
  lineValue: 11,
  body: 9,
  caption: 7.5,
} as const;
