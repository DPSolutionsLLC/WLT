import { SundayCard } from "@/components/sacrament/SundayCard";
import type { SundayCardProps } from "@/components/sacrament/SundayCard";

// The month grid behind the Sacrament hub.
//
// NO "use client", AND NO STATE. Month navigation is a URL change, not a piece of component
// state: app/(app)/calendar/MonthNavigation.tsx already owns it, pushes `?month=`, and the
// server re-reads. A second month-window helper — or a client-side month cursor holding its own
// idea of which Sundays to show — would be the second copy decisions.md §1.7 exists to refuse,
// and it would disagree with the page's own reads the first time somebody used the back button.
//
// LAYOUT: one column at 375px, widening from `md:` up — the prototype's `cal-grid`. Tailwind
// only, no measured hex anywhere, because P1 adopted the prototype's palette at the TOKEN level
// (plans/retros/design-system-tokens-and-primitives.md).
//
// `gap` rather than a margin on the child: a bottom margin on the last card leaves dead space at
// the end of every month, which is the same class of thing as P3's pb-24.

export type SacramentCalendarProps = {
  sundays: readonly SundayCardProps[];
};

export function SacramentCalendar({ sundays }: SacramentCalendarProps) {
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
      {sundays.map((sunday) => (
        <SundayCard key={sunday.sundayId} {...sunday} />
      ))}
    </div>
  );
}
