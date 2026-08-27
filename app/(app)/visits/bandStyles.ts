import type { VisitPriorityBand } from "@/types/domain";

// The four bands' colours, marks and fills, in ONE place.
//
// Lifted out of VisitProgressTable when AllOrganizationsTable arrived, rather than copied into
// it. Two tables rendering the same four states from two literals is two things to keep in step,
// and they would drift on the next colour change — the reason conventions.md says a component
// used by two modules moves rather than being copied.
//
// NO "use client" DIRECTIVE, and none is needed: this exports constants and no component. It
// compiles into whichever client bundle imports it. It must never gain a server import, or every
// table on the page becomes unbuildable (plans/retros/roster-b-picker-and-orgs.md).
//
// ---------------------------------------------------------------------------
// THE BAND CARRIES A MARK, A WORD, AND A FILL
// ---------------------------------------------------------------------------
// Following AppointmentPanel's state badges, which followed components/assignments/StageBadge.tsx
// — the colour is the TEXT and BORDER on the surrounding surface rather than white on a filled
// pill, because every token in app/globals.css was measured against --surface and
// --surface-raised in both themes and a SOLID fill would need its own second measurement per
// state in both themes.
//
// THE FILL BELOW IS A TINT, NOT A SOLID, for exactly that reason. It is the state colour at low
// opacity behind unchanged text, so the measured text-on-surface contrast still holds and no
// second measurement is owed. A solid fill with inverted text is the version that would owe one.
//
// Colour alone separates four states only for somebody who can see all four colours. Four
// different SHAPES separate them in greyscale too, and the word is always present so the badge
// never depends on the mark or the fill either.
//
// Text glyphs rather than emoji, deliberately: an emoji renders in its own colour on most
// platforms, which would fight the state colour and defeat the pill.
export const BAND_CLASSES: Record<VisitPriorityBand, string> = {
  never_visited: "border-danger text-danger",
  overdue: "border-danger text-danger",
  approaching: "border-warning text-warning",
  on_track: "border-success text-success",
};

// The tint that fills the pill. Separate from BAND_CLASSES because Tailwind needs the whole class
// name present in the source to emit it — a template string like `bg-${tone}/15` produces nothing.
export const BAND_FILL: Record<VisitPriorityBand, string> = {
  never_visited: "bg-danger/15",
  overdue: "bg-danger/25",
  approaching: "bg-warning/20",
  on_track: "bg-success/20",
};

// aria-hidden wherever these render: the word beside it already says the band, so a screen reader
// announcing "check mark On track" would just be reading the same fact twice.
export const BAND_MARKS: Record<VisitPriorityBand, string> = {
  never_visited: "○",
  overdue: "!",
  approaching: "◑",
  on_track: "✓",
};

// The neutral pill both tables use for a state that is NOT on the scale — do-not-contact, no
// goal, or an organization whose judgement this reader may not read. Shared for the same reason
// the three records above are: one border, one muted tone, one shape.
export const NEUTRAL_BADGE_CLASSES =
  "inline-flex items-center rounded-full border border-border px-2 py-0.5 text-xs text-muted";
