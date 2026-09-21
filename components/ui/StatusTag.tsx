import type { ReactNode } from "react";
import { Pill, type PillTone } from "@/components/ui/Pill";

// A smaller inline `Pill` with room for an icon.
//
// Built ON Pill rather than beside it, so there is still exactly one pill shape: this narrows the
// padding and adds a gap, and inherits the radius, the border and the tone rules from the one
// place they live. The moment this forks its own `rounded-full border px-2` the migration that
// made P4 a re-skin is undone.
//
// THE ICON IS DECORATIVE AND IS MARKED SO. It is wrapped aria-hidden because the words carry the
// meaning — a screen reader announcing a glyph's name before the label reads the same fact twice,
// or worse, reads "black star" where the label says "Overdue". This is the rule GaugePill's band
// mark and MemberStatusBadge's ⚠ both already follow.
//
// No "use client": no state, no handlers.

export type StatusTagProps = {
  children: ReactNode;
  tone?: PillTone;
  // Same escape hatch as Pill's, for a caller with its own measured palette.
  toneClassName?: string;
  icon?: ReactNode;
  className?: string;
  title?: string;
};

export function StatusTag({
  children,
  tone,
  toneClassName,
  icon,
  className = "",
  title,
}: StatusTagProps) {
  return (
    <Pill
      tone={tone}
      toneClassName={toneClassName}
      title={title}
      className={`gap-1 px-1.5 py-0 text-[0.6875rem] ${className}`.trim()}
    >
      {icon === undefined ? null : (
        <span aria-hidden="true" className="inline-flex shrink-0 items-center">
          {icon}
        </span>
      )}
      {children}
    </Pill>
  );
}
